-- Contract A: one open follow-up per customer + branch, whatever its request_type.
-- NOT APPLIED. Repo-only forward migration; apply only through the reviewed activation plan.
--
-- Production already enforces this with daily_followups_one_open_case_per_customer_branch_uidx
-- (identity_key, branch; open rows). This migration does NOT create, drop or widen that index.
-- It makes the writers agree with it, so a request of another type for a customer who already
-- has an open case in that branch is linked to that case instead of attempting a second row
-- and surfacing a raw unique_violation:
--   1. find_or_create_open_customer_followup: lookup and lock on (identity_key, branch); a
--      different request_type is recorded as a request_linked event with its own type; a
--      unique_violation from a writer outside this lock re-reads the open case and links.
--   2. dawaa_create_exceptional_followup_v2: same open-case check and lock; links instead of inserting.
--   3. list_open_followup_duplicate_groups_v1: groups by (identity_key, branch).
-- Function bodies only: no DDL on tables, no data rewrite. CREATE OR REPLACE keeps owner and ACL.
begin;

do $guard$
begin
  if to_regprocedure('public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text)') is null
     or to_regprocedure('public.dawaa_create_exceptional_followup_v2(text,text,text,text,text,text,text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.list_open_followup_duplicate_groups_v1(text)') is null
     or to_regprocedure('public.dawaa_customer_identity_key_v1(text,text,text,text)') is null
     or to_regprocedure('public.dawaa_require_customer_service_actor_v1(boolean)') is null
     or to_regprocedure('public.dawaa_log_customer_followup_event_v1(text,text,text,text,text,jsonb,text,text)') is null
     or to_regprocedure('public.dawaa_parse_followup_datetime_v1(text)') is null then
    raise exception 'followup_contract_a_prerequisites_missing';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.find_or_create_open_customer_followup(p_customer_id text, p_customer_code text, p_customer_name text, p_customer_phone text, p_branch text, p_request_type text, p_request_details text, p_followup_reason text, p_priority text, p_next_followup_date date, p_actor_staff_id text, p_actor_name text, p_client_request_id text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text)
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
      return jsonb_build_object('followup_id', v_existing.id, 'created', false, 'idempotent_replay', true, 'identity_key', v_existing.identity_key);
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
        p_actor_staff_id, coalesce(nullif(btrim(p_source), ''), 'manual'), v_identity,
        nullif(btrim(p_client_request_id), ''), false, false
      ) returning * into v_created;

      insert into public.customer_service_followup_events(
        followup_id, event_type, event_status, actor_staff_id, actor_name, notes, metadata
      ) values (
        v_created.id, 'created', 'open', p_actor_staff_id,
        coalesce(nullif(btrim(p_actor_name), ''), v_staff.name),
        coalesce(nullif(btrim(p_request_details), ''), nullif(btrim(p_followup_reason), ''), 'إنشاء متابعة'),
        jsonb_build_object('source', coalesce(nullif(btrim(p_source), ''), 'manual'), 'request_type', v_case_type, 'client_request_id', nullif(btrim(p_client_request_id), ''), 'identity_key', v_identity, 'branch', v_branch)
      );

      return jsonb_build_object('followup_id', v_created.id, 'created', true, 'linked_to_open_case', false, 'identity_key', v_identity);
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
            return jsonb_build_object('followup_id', v_existing.id, 'created', false, 'idempotent_replay', true, 'identity_key', v_existing.identity_key);
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

  update public.daily_followups
    set updated_at = now(),
        next_followup_date = coalesce(p_next_followup_date, next_followup_date),
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
      'source', coalesce(nullif(btrim(p_source), ''), 'manual'),
      'request_type', v_case_type,
      'case_request_type', coalesce(nullif(btrim(v_existing.request_type), ''), 'general'),
      'client_request_id', nullif(btrim(p_client_request_id), ''),
      'identity_key', v_identity,
      'branch', v_branch,
      'requested_at', now()
    )
  );

  return jsonb_build_object(
    'followup_id', v_existing.id, 'created', false, 'linked_to_open_case', true, 'identity_key', v_identity,
    'request_type', v_case_type, 'case_request_type', coalesce(nullif(btrim(v_existing.request_type), ''), 'general'));
end;
$function$;

create or replace function public.dawaa_create_exceptional_followup_v2(p_customer_id text default null,p_customer_code text default null,p_customer_name text default null,p_customer_phone text default null,p_branch text default null,p_priority text default 'مهم',p_reason text default null,p_followup_datetime text default null,p_assigned_doctor text default null,p_request_details text default null,p_notes text default null,p_created_by text default null,p_created_by_name text default null)
returns public.daily_followups language plpgsql security definer set search_path=public,auth,pg_catalog as $function$
declare a public.staff_accounts; dt timestamptz; n text; reason text; f public.daily_followups; v_identity text; v_branch text;
begin
  a:=public.dawaa_require_customer_service_actor_v1(false);
  dt:=coalesce(public.dawaa_parse_followup_datetime_v1(p_followup_datetime),now()); n:=nullif(trim(coalesce(p_customer_name,'')),''); reason:=nullif(trim(coalesce(p_reason,'')),'');
  if n is null then raise exception 'اسم العميل مطلوب'; end if;
  if reason is null then raise exception 'سبب المتابعة مطلوب'; end if;
  if nullif(trim(coalesce(p_branch,'')),'') is null then raise exception 'الفرع مطلوب'; end if;
  v_branch:=trim(p_branch);
  v_identity:=public.dawaa_customer_identity_key_v1(p_customer_id,p_customer_code,p_customer_phone,n);

  if v_identity is not null then
    -- Contract A: one open follow-up per customer + branch. Same lock as find_or_create.
    perform pg_advisory_xact_lock(hashtextextended('followup-open-case:'||v_identity||'|'||v_branch,0));
    select * into f from public.daily_followups
    where identity_key=v_identity and branch=v_branch
      and completed_at is null and cancelled_at is null and archived_at is null
      and is_hidden is false and duplicate_of is null
    order by created_at asc nulls last, id limit 1 for update;
  end if;

  if f.id is null then
    begin
      insert into public.daily_followups(date,followup_date,followup_datetime,customer_id,customer_code,customer_name,name,customer_phone,phone,branch,followup_type,category,priority,followup_reason,suggested_action,request_type,request_details,request_status,notes,followup_notes,status,followup_status,contact_status,assigned_to,responsible_name,assigned_doctor,created_by,created_by_name,created_at,updated_at,identity_key)
      values((dt at time zone 'Africa/Cairo')::date,(dt at time zone 'Africa/Cairo')::date,dt,nullif(trim(coalesce(p_customer_id,'')),''),nullif(trim(coalesce(p_customer_code,'')),''),n,n,nullif(trim(coalesce(p_customer_phone,'')),''),nullif(trim(coalesce(p_customer_phone,'')),''),v_branch,'exceptional','متابعة استثنائية',coalesce(nullif(trim(coalesce(p_priority,'')),''),'مهم'),reason,reason,'متابعة استثنائية',coalesce(nullif(trim(coalesce(p_request_details,'')),''),reason),'open',nullif(trim(coalesce(p_notes,'')),''),nullif(trim(coalesce(p_notes,'')),''),'معلق','معلق','معلق',nullif(trim(coalesce(p_assigned_doctor,'')),''),nullif(trim(coalesce(p_assigned_doctor,'')),''),nullif(trim(coalesce(p_assigned_doctor,'')),''),a.id::text,coalesce(a.name,a.username),now(),now(),v_identity) returning * into f;
      perform public.dawaa_log_customer_followup_event_v1(f.id::text,'created',null,'معلق',reason,jsonb_build_object('source','exceptional'),a.id::text,coalesce(a.name,a.username));
      return f;
    exception when unique_violation then
      -- A writer outside this lock committed the open case first: link to it, never surface the raw error.
      f:=null;
      if v_identity is not null then
        select * into f from public.daily_followups
        where identity_key=v_identity and branch=v_branch
          and completed_at is null and cancelled_at is null and archived_at is null
          and is_hidden is false and duplicate_of is null
        order by created_at asc nulls last, id limit 1 for update;
      end if;
      if f.id is null then
        raise exception 'followup_open_case_conflict' using errcode='P0001',
          detail='An open follow-up for this customer and branch exists but is not linkable (hidden or merged).';
      end if;
    end;
  end if;

  update public.daily_followups set updated_at=now() where id=f.id returning * into f;
  perform public.dawaa_log_customer_followup_event_v1(f.id::text,'request_linked',coalesce(f.followup_status,f.status),coalesce(f.followup_status,f.status),reason,
    jsonb_build_object('source','exceptional','request_type','متابعة استثنائية','case_request_type',coalesce(nullif(trim(f.request_type),''),'general'),
      'priority',coalesce(nullif(trim(coalesce(p_priority,'')),''),'مهم'),'followup_datetime',dt,'assigned_doctor',nullif(trim(coalesce(p_assigned_doctor,'')),''),
      'request_details',nullif(trim(coalesce(p_request_details,'')),''),'notes',nullif(trim(coalesce(p_notes,'')),''),'identity_key',v_identity,'branch',v_branch),
    a.id::text,coalesce(a.name,a.username));
  return f;
end $function$;

create or replace function public.list_open_followup_duplicate_groups_v1(p_branch text default null)
returns table(identity_key text, branch text, request_type text, open_count bigint, canonical_id text, duplicate_ids text[], customer_name text, customer_code text, customer_phone text, newest_at timestamptz)
language sql security invoker set search_path = public, pg_catalog as $function$
  -- Contract A: a duplicate is a second open case for the same customer + branch, whatever its
  -- request_type. request_type reports the canonical (oldest) row's type.
  with open_rows as (
    select d.*, row_number() over (
      partition by d.identity_key, coalesce(d.branch, '')
      order by d.created_at asc nulls last, d.id
    ) as rn
    from public.daily_followups d
    where d.identity_key is not null
      and d.completed_at is null
      and d.cancelled_at is null
      and d.archived_at is null
      and coalesce(d.is_hidden, false) = false
      and d.duplicate_of is null
      and (p_branch is null or trim(p_branch) = '' or p_branch = 'كل الفروع' or d.branch = p_branch)
  )
  select identity_key, coalesce(branch, 'غير محدد'),
    max(coalesce(nullif(trim(request_type), ''), 'general')) filter (where rn = 1),
    count(*)::bigint,
    min(id::text) filter (where rn = 1),
    array_agg(id::text order by created_at) filter (where rn > 1),
    max(coalesce(customer_name, name)), max(customer_code), max(coalesce(customer_phone, phone)), max(created_at)
  from open_rows
  group by identity_key, branch
  having count(*) > 1
  order by count(*) desc, max(created_at) desc;
$function$;

commit;
