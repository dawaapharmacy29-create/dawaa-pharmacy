-- Independent customer follow-up obligations. NOT APPLIED automatically.
--
-- A customer OBLIGATION (a complaint, a promise, a callback request, a linked request) is not the
-- same thing as the EXECUTION TASK (the daily_followups case Contract A keeps one of per
-- customer + branch). One task may serve several obligations; each obligation keeps its own
-- identity, due date, status and outcome.
--
--  * find_or_create_open_customer_followup records one obligation per business request key
--    (client_request_id), for a new case and for a linked request alike. A linked request no
--    longer overwrites the case due date: the case due date is the EARLIEST open obligation.
--  * Closing one obligation (dawaa_close_customer_followup_obligation_v1) never closes another
--    or the task.
--  * Closing the task through ANY existing path (14 legacy/current functions) is checked at the
--    table: with exactly one open obligation, that obligation is closed with the task's outcome;
--    with two or more open obligations the task cannot be closed until they are resolved one by
--    one; a duplicate merge moves open obligations to the surviving case instead of closing them.
--  * Existing cases without obligation rows are unaffected (production had 0 linked requests).
--
-- Rollback: drop trigger dawaa_followup_task_close_guard_v1 on public.daily_followups; drop
-- function public.dawaa_close_customer_followup_obligation_v1(uuid,text,text,text); re-run
-- find_or_create_open_customer_followup from
-- 20261009180000_customer_followup_one_open_case_contract_a_v1.sql; then drop table
-- public.customer_followup_obligations (after exporting it if it holds data).

create table if not exists public.customer_followup_obligations (
  id uuid primary key default gen_random_uuid(),
  followup_id text not null references public.daily_followups(id) on delete restrict,
  client_request_id text not null,
  obligation_type text not null default 'general',
  source text not null default 'manual',
  details text,
  reason text,
  due_date date,
  status text not null default 'open'
    check (status in ('open','fulfilled','cancelled')),
  outcome text,
  outcome_note text,
  opened_at timestamptz not null default now(),
  opened_by text,
  closed_at timestamptz,
  closed_by text,
  updated_at timestamptz not null default now(),
  constraint customer_followup_obligations_request_uk unique (client_request_id),
  constraint customer_followup_obligations_closed_ck check ((status = 'open') = (closed_at is null))
);
create index if not exists customer_followup_obligations_open_idx
  on public.customer_followup_obligations(followup_id) where status = 'open';

alter table public.customer_followup_obligations enable row level security;
revoke all on table public.customer_followup_obligations from public, anon, authenticated;
grant select on table public.customer_followup_obligations to authenticated;
grant all on table public.customer_followup_obligations to service_role;
drop policy if exists customer_followup_obligations_select_v1 on public.customer_followup_obligations;
-- Same visibility as the task: daily_followups RLS applies inside the subquery.
create policy customer_followup_obligations_select_v1 on public.customer_followup_obligations
  for select to authenticated
  using (exists (select 1 from public.daily_followups f where f.id = followup_id));

-- The task's due date is the earliest due date among its open obligations (never a later
-- request's date silently replacing an earlier promise).
create or replace function public.dawaa_recompute_followup_due_v1(p_followup_id text)
returns void language plpgsql security definer
set search_path to 'public','pg_catalog'
as $function$
declare v_due date;
begin
  select min(o.due_date) into v_due from public.customer_followup_obligations o
  where o.followup_id = p_followup_id and o.status = 'open' and o.due_date is not null;
  if v_due is not null then
    update public.daily_followups set next_followup_date = v_due, updated_at = now()
    where id = p_followup_id and next_followup_date is distinct from v_due;
  end if;
end $function$;
revoke all on function public.dawaa_recompute_followup_due_v1(text) from public, anon, authenticated;

create or replace function public.find_or_create_open_customer_followup(p_customer_id text, p_customer_code text, p_customer_name text, p_customer_phone text, p_branch text, p_request_type text, p_request_details text, p_followup_reason text, p_priority text, p_next_followup_date date, p_actor_staff_id text, p_actor_name text, p_client_request_id text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_staff record;
  v_identity text;
  v_case_type text := coalesce(nullif(btrim(p_request_type), ''), 'general');
  v_branch text := nullif(btrim(p_branch), '');
  v_existing public.daily_followups%rowtype;
  v_created public.daily_followups%rowtype;
  v_replay_ids text[];
  v_scope jsonb;
  v_today text := to_char(timezone('Africa/Cairo', now()), 'YYYY-MM-DD');
  v_request_key text := coalesce(nullif(btrim(p_client_request_id), ''), 'followup:' || gen_random_uuid()::text);
  v_obligation uuid;
  v_source text := coalesce(nullif(btrim(p_source), ''), 'manual');
begin
  if nullif(btrim(p_actor_staff_id), '') is null then
    raise exception 'actor_staff_id_required';
  end if;

  select * into v_staff
  from public.resolve_staff_account_safe(p_actor_staff_id)
  limit 1;

  if v_staff.id is null or v_staff.active is not true or v_staff.can_login is not true then
    raise exception 'active_staff_account_required';
  end if;

  if coalesce(v_staff.role, '') not in (
    'customer_service','customer_service_manager','general_manager','branch_manager',
    'branches_manager','admin','doctor','pharmacist','shift_supervisor','shift_supervisor_evening'
  ) then
    raise exception 'followup_create_permission_denied';
  end if;

  v_identity := public.dawaa_customer_identity_key_v1(
    p_customer_id, p_customer_code, p_customer_phone, p_customer_name
  );
  if v_identity is null then
    raise exception 'customer_identity_required';
  end if;
  if v_branch is null then
    raise exception 'branch_required';
  end if;

  if nullif(btrim(p_client_request_id), '') is not null then
    -- Serialize the business retry key before checking creation AND linked-request history.
    perform pg_advisory_xact_lock(hashtextextended('followup-client-request:' || btrim(p_client_request_id), 0));
    select * into v_existing
    from public.daily_followups
    where client_request_id = btrim(p_client_request_id)
    limit 1;

    if v_existing.id is null then
      select array_agg(link.followup_id) into v_replay_ids
      from (
        select distinct e.followup_id
        from public.customer_service_followup_events e
        where e.event_type in ('created', 'request_linked')
          and nullif(btrim(e.metadata->>'client_request_id'), '') is not null
          and e.metadata->>'client_request_id' = btrim(p_client_request_id)
        limit 2
      ) link;
      if coalesce(cardinality(v_replay_ids), 0) > 1 then
        raise exception 'followup_client_request_lineage_conflict';
      end if;
      if coalesce(cardinality(v_replay_ids), 0) = 1 then
        select * into v_existing from public.daily_followups where id = v_replay_ids[1];
        if v_existing.id is null then
          raise exception 'followup_client_request_target_missing';
        end if;
      end if;
    end if;

    if v_existing.id is null then
      -- An obligation recorded under this key is also lineage (its task may since have been merged).
      select f.* into v_existing
      from public.customer_followup_obligations o join public.daily_followups f on f.id = o.followup_id
      where o.client_request_id = btrim(p_client_request_id)
      limit 1;
    end if;

    if v_existing.id is not null then
      -- A retry is compared with the scope its key was first recorded under (identity, branch
      -- and the request_type the caller sent), not with the row's current values.
      select e.metadata into v_scope
      from public.customer_service_followup_events e
      where e.followup_id = v_existing.id
        and e.event_type in ('created', 'request_linked')
        and e.metadata->>'client_request_id' = btrim(p_client_request_id)
      order by e.created_at nulls last, e.id
      limit 1;
      if coalesce(v_scope->>'identity_key', v_existing.identity_key) is distinct from v_identity
         or coalesce(v_scope->>'branch', v_existing.branch) is distinct from v_branch
         or coalesce(nullif(btrim(v_scope->>'request_type'), ''), nullif(btrim(v_existing.request_type), ''), 'general') is distinct from v_case_type then
        raise exception 'followup_client_request_scope_conflict';
      end if;
      select o.id into v_obligation from public.customer_followup_obligations o
      where o.client_request_id = btrim(p_client_request_id);
      return jsonb_build_object('followup_id', v_existing.id, 'created', false, 'idempotent_replay', true,
        'identity_key', v_existing.identity_key, 'obligation_id', v_obligation);
    end if;
  end if;

  -- Contract A: the open case is per customer + branch. Same lock key for every request_type.
  perform pg_advisory_xact_lock(hashtextextended('followup-open-case:' || v_identity || '|' || v_branch, 0));

  select * into v_existing
  from public.daily_followups
  where identity_key = v_identity
    and branch = v_branch
    and completed_at is null
    and cancelled_at is null
    and archived_at is null
    and is_hidden is false
    and duplicate_of is null
  order by created_at asc nulls last, id
  limit 1
  for update;

  if v_existing.id is null then
    begin
      insert into public.daily_followups(
        date, customer_id, customer_name, name, phone, customer_phone, customer_code,
        branch, status, followup_status, contact_status, followup_type, request_type,
        request_details, followup_reason, priority, next_followup_date, created_by,
        created_by_name, requested_by_staff_id, request_source, identity_key,
        client_request_id, is_hidden, is_duplicate
      ) values (
        v_today, nullif(btrim(p_customer_id), ''), nullif(btrim(p_customer_name), ''),
        nullif(btrim(p_customer_name), ''), public.dawaa_normalize_egyptian_mobile_v1(p_customer_phone),
        public.dawaa_normalize_egyptian_mobile_v1(p_customer_phone), nullif(btrim(p_customer_code), ''),
        v_branch, 'not_started', 'pending', 'pending', v_case_type, v_case_type,
        nullif(btrim(p_request_details), ''), nullif(btrim(p_followup_reason), ''),
        coalesce(nullif(btrim(p_priority), ''), 'متوسطة'), p_next_followup_date,
        p_actor_staff_id, coalesce(nullif(btrim(p_actor_name), ''), v_staff.name),
        p_actor_staff_id, v_source, v_identity,
        nullif(btrim(p_client_request_id), ''), false, false
      ) returning * into v_created;

      insert into public.customer_service_followup_events(
        followup_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata
      ) values (
        v_created.id, 'created', 'open', p_actor_staff_id,
        coalesce(nullif(btrim(p_actor_name), ''), v_staff.name),
        coalesce(nullif(btrim(p_request_details), ''), nullif(btrim(p_followup_reason), ''), 'إنشاء متابعة'),
        jsonb_build_object('source', v_source, 'request_type', v_case_type, 'client_request_id', nullif(btrim(p_client_request_id), ''), 'identity_key', v_identity, 'branch', v_branch)
      );

      insert into public.customer_followup_obligations(
        followup_id, client_request_id, obligation_type, source, details, reason, due_date, opened_by
      ) values (
        v_created.id, v_request_key, v_case_type, v_source,
        nullif(btrim(p_request_details), ''), nullif(btrim(p_followup_reason), ''), p_next_followup_date, p_actor_staff_id
      ) returning id into v_obligation;

      return jsonb_build_object('followup_id', v_created.id, 'created', true, 'linked_to_open_case', false,
        'identity_key', v_identity, 'obligation_id', v_obligation);
    exception
      when unique_violation then
        -- Another writer that does not take this lock committed first. Never surface the raw
        -- error: a replay of this key returns its case; otherwise link to the open case.
        if nullif(btrim(p_client_request_id), '') is not null then
          select * into v_existing from public.daily_followups where client_request_id = btrim(p_client_request_id) limit 1;
          if v_existing.id is not null then
            if v_existing.identity_key is distinct from v_identity
               or v_existing.branch is distinct from v_branch
               or coalesce(nullif(btrim(v_existing.request_type), ''), 'general') is distinct from v_case_type then
              raise exception 'followup_client_request_scope_conflict';
            end if;
            select o.id into v_obligation from public.customer_followup_obligations o
            where o.client_request_id = btrim(p_client_request_id);
            return jsonb_build_object('followup_id', v_existing.id, 'created', false, 'idempotent_replay', true,
              'identity_key', v_existing.identity_key, 'obligation_id', v_obligation);
          end if;
        end if;
        select * into v_existing
        from public.daily_followups
        where identity_key = v_identity
          and branch = v_branch
          and completed_at is null
          and cancelled_at is null
          and archived_at is null
          and is_hidden is false
          and duplicate_of is null
        order by created_at asc nulls last, id
        limit 1
        for update;
        if v_existing.id is null then
          raise exception 'followup_open_case_conflict' using errcode = 'P0001',
            detail = 'An open follow-up for this customer and branch exists but is not linkable (hidden or merged).';
        end if;
    end;
  end if;

  -- The task keeps its own priority; a request's due date is recorded on ITS obligation and the
  -- task due date becomes the earliest open obligation (never a later date replacing an earlier one).
  update public.daily_followups
    set updated_at = now(),
        priority = coalesce(nullif(btrim(p_priority), ''), priority)
  where id = v_existing.id;

  insert into public.customer_service_followup_events(
    followup_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata
  ) values (
    v_existing.id,
    'request_linked',
    'open',
    p_actor_staff_id,
    coalesce(nullif(btrim(p_actor_name), ''), v_staff.name),
    coalesce(nullif(btrim(p_request_details), ''), nullif(btrim(p_followup_reason), ''), 'طلب متابعة إضافي'),
    jsonb_build_object(
      'source', v_source,
      'request_type', v_case_type,
      'case_request_type', coalesce(nullif(btrim(v_existing.request_type), ''), 'general'),
      'client_request_id', nullif(btrim(p_client_request_id), ''),
      'identity_key', v_identity,
      'branch', v_branch,
      'requested_at', now()
    )
  );

  -- A legacy task created before obligations existed gets its own original obligation first, so
  -- the earlier request is never absorbed by the new one.
  insert into public.customer_followup_obligations(
    followup_id, client_request_id, obligation_type, source, details, reason, due_date, opened_by, opened_at
  ) values (
    v_existing.id, coalesce(nullif(btrim(v_existing.client_request_id), ''), 'legacy-task:' || v_existing.id),
    coalesce(nullif(btrim(v_existing.request_type), ''), 'general'), coalesce(v_existing.request_source, 'legacy'),
    v_existing.request_details, v_existing.followup_reason, v_existing.next_followup_date,
    v_existing.created_by, coalesce(v_existing.created_at, now())
  ) on conflict (client_request_id) do nothing;

  insert into public.customer_followup_obligations(
    followup_id, client_request_id, obligation_type, source, details, reason, due_date, opened_by
  ) values (
    v_existing.id, v_request_key, v_case_type, v_source,
    nullif(btrim(p_request_details), ''), nullif(btrim(p_followup_reason), ''), p_next_followup_date, p_actor_staff_id
  ) returning id into v_obligation;

  perform public.dawaa_recompute_followup_due_v1(v_existing.id);

  return jsonb_build_object(
    'followup_id', v_existing.id, 'created', false, 'linked_to_open_case', true, 'identity_key', v_identity,
    'request_type', v_case_type, 'case_request_type', coalesce(nullif(btrim(v_existing.request_type), ''), 'general'),
    'obligation_id', v_obligation);
end;
$function$;

-- Close ONE obligation. Never closes the task or any other obligation.
create or replace function public.dawaa_close_customer_followup_obligation_v1(
  p_obligation_id uuid, p_status text, p_outcome text, p_note text default null)
returns jsonb language plpgsql security definer
set search_path to 'public','auth','pg_catalog'
as $function$
declare
  a public.staff_accounts;
  v_role text;
  v_obligation public.customer_followup_obligations%rowtype;
  v_task public.daily_followups%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
begin
  a := public.dawaa_require_customer_service_actor_v1(false);
  if v_status not in ('fulfilled', 'cancelled') then raise exception 'obligation_status_invalid'; end if;
  if nullif(btrim(coalesce(p_outcome, '')), '') is null then raise exception 'obligation_outcome_required'; end if;

  select * into v_obligation from public.customer_followup_obligations where id = p_obligation_id;
  if not found then raise exception 'obligation_not_found'; end if;
  -- Same lock order as task creation/linking: task row, then obligation row.
  select * into v_task from public.daily_followups where id = v_obligation.followup_id for update;
  v_role := lower(trim(coalesce(a.role, a.staff_role, '')));
  if v_role not in ('general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager')
     and nullif(trim(coalesce(a.branch, '')), '') is distinct from v_task.branch then
    raise exception 'لا يمكن إغلاق التزام خارج فرع الحساب';
  end if;
  select * into v_obligation from public.customer_followup_obligations where id = p_obligation_id for update;

  if v_obligation.status <> 'open' then
    if v_obligation.status = v_status and v_obligation.outcome is not distinct from btrim(p_outcome) then
      return jsonb_build_object('obligation_id', v_obligation.id, 'status', v_obligation.status, 'idempotent_replay', true);
    end if;
    raise exception 'obligation_already_closed';
  end if;

  update public.customer_followup_obligations
     set status = v_status, outcome = btrim(p_outcome), outcome_note = nullif(btrim(coalesce(p_note, '')), ''),
         closed_at = now(), closed_by = a.id::text, updated_at = now()
   where id = v_obligation.id;
  perform public.dawaa_recompute_followup_due_v1(v_obligation.followup_id);

  insert into public.customer_service_followup_events(
    followup_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata
  ) values (
    v_obligation.followup_id, 'obligation_closed', v_status, a.id::text, coalesce(a.name, a.username),
    btrim(p_outcome),
    jsonb_build_object('obligation_id', v_obligation.id, 'client_request_id', v_obligation.client_request_id,
      'obligation_type', v_obligation.obligation_type, 'note', nullif(btrim(coalesce(p_note, '')), ''))
  );

  return jsonb_build_object('obligation_id', v_obligation.id, 'status', v_status, 'followup_id', v_obligation.followup_id,
    'open_obligations_remaining', (select count(*) from public.customer_followup_obligations
      where followup_id = v_obligation.followup_id and status = 'open'));
end $function$;
revoke all on function public.dawaa_close_customer_followup_obligation_v1(uuid,text,text,text) from public;
grant execute on function public.dawaa_close_customer_followup_obligation_v1(uuid,text,text,text) to anon, authenticated, service_role;

-- Task-close guard at the table, so every existing completion path (manual, Excel import,
-- purchase reconciliation, duplicate repair, branch transfer) obeys the same rule.
create or replace function public.dawaa_followup_task_close_guard_v1()
returns trigger language plpgsql security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_open integer;
  v_closed_status text;
  v_terminal_status text[] := array['completed','cancelled','archived','closed','merged_duplicate','تم','ملغي'];
  v_terminal_followup text[] := array['completed','تم','تم التواصل','تم الشراء بعد المتابعة','ملغي'];
  v_was_open boolean := old.completed_at is null and old.cancelled_at is null and old.archived_at is null
    and coalesce(old.is_hidden, false) = false and old.duplicate_of is null
    and lower(coalesce(old.status, '')) <> all (v_terminal_status)
    and lower(coalesce(old.followup_status, '')) <> all (v_terminal_followup);
  v_is_open boolean := new.completed_at is null and new.cancelled_at is null and new.archived_at is null
    and coalesce(new.is_hidden, false) = false and new.duplicate_of is null
    and lower(coalesce(new.status, '')) <> all (v_terminal_status)
    and lower(coalesce(new.followup_status, '')) <> all (v_terminal_followup);
begin
  if not v_was_open or v_is_open then return new; end if;

  -- A duplicate merge moves the open obligations to the surviving task: nothing is lost or closed.
  if new.duplicate_of is not null and old.duplicate_of is null then
    update public.customer_followup_obligations
       set followup_id = new.duplicate_of, updated_at = now()
     where followup_id = new.id and status = 'open';
    perform public.dawaa_recompute_followup_due_v1(new.duplicate_of);
    return new;
  end if;

  select count(*) into v_open from public.customer_followup_obligations
  where followup_id = new.id and status = 'open';
  if v_open = 0 then return new; end if;
  if v_open > 1 then
    raise exception 'followup_task_has_open_obligations'
      using errcode = '55000',
            detail = format('%s open obligations must each be closed with their own outcome first.', v_open);
  end if;

  v_closed_status := case when new.completed_at is not null
      or lower(coalesce(new.status, '')) in ('completed','closed','تم')
      or lower(coalesce(new.followup_status, '')) in ('completed','تم','تم التواصل','تم الشراء بعد المتابعة')
    then 'fulfilled' else 'cancelled' end;
  update public.customer_followup_obligations
     set status = v_closed_status,
         outcome = coalesce(nullif(btrim(new.followup_status), ''), nullif(btrim(new.status), ''), v_closed_status),
         outcome_note = 'closed with its only execution task',
         closed_at = now(), closed_by = 'execution_task:' || new.id, updated_at = now()
   where followup_id = new.id and status = 'open';
  return new;
end $function$;
revoke all on function public.dawaa_followup_task_close_guard_v1() from public, anon, authenticated;

drop trigger if exists dawaa_followup_task_close_guard_v1 on public.daily_followups;
create trigger dawaa_followup_task_close_guard_v1
  before update on public.daily_followups
  for each row execute function public.dawaa_followup_task_close_guard_v1();
