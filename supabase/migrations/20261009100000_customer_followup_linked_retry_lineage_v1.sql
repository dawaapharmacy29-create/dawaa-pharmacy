-- Repo-only repair; never apply to live Supabase without explicit final approval.
-- Reuses existing follow-up event lineage. No new queue/table, identity inference, or branch rule.
-- CREATE OR REPLACE preserves the existing function owner and EXECUTE ACL.
begin;

do $guard$
begin
  if to_regprocedure('public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text)') is null then
    raise exception 'existing_customer_followup_core_required';
  end if;
end;
$guard$;

create index if not exists customer_service_followup_events_client_request_replay_idx
  on public.customer_service_followup_events ((metadata->>'client_request_id'), followup_id)
  where event_type in ('created', 'request_linked')
    and nullif(btrim(metadata->>'client_request_id'), '') is not null;

CREATE OR REPLACE FUNCTION public.find_or_create_open_customer_followup(p_customer_id text, p_customer_code text, p_customer_name text, p_customer_phone text, p_branch text, p_request_type text, p_request_details text, p_followup_reason text, p_priority text, p_next_followup_date date, p_actor_staff_id text, p_actor_name text, p_client_request_id text DEFAULT NULL::text, p_source text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_staff record;
  v_identity text;
  v_case_type text := coalesce(nullif(btrim(p_request_type), ''), 'general');
  v_branch text := nullif(btrim(p_branch), '');
  v_existing public.daily_followups%rowtype;
  v_created public.daily_followups%rowtype;
  v_lock_key text;
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
    -- The open-case lock below protects a different invariant (one open case per scope).
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
      -- Compare the retry with the scope this key was first recorded under, not the row's
      -- current values: a later branch sync or customer-data correction moves the row but
      -- must not turn the same logical retry into a conflict. Legacy events without a
      -- recorded scope fall back to the row.
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

  v_lock_key := v_identity || '|' || v_branch || '|' || v_case_type;
  perform pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  select * into v_existing
  from public.daily_followups
  where identity_key = v_identity
    and branch = v_branch
    and coalesce(nullif(btrim(request_type), ''), 'general') = v_case_type
    and completed_at is null
    and cancelled_at is null
    and archived_at is null
    and is_hidden is false
    and duplicate_of is null
  order by created_at desc nulls last
  limit 1
  for update;

  if v_existing.id is not null then
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
        'client_request_id', nullif(btrim(p_client_request_id), ''),
        'identity_key', v_identity,
        'branch', v_branch,
        'requested_at', now()
      )
    );

    return jsonb_build_object('followup_id', v_existing.id, 'created', false, 'linked_to_open_case', true, 'identity_key', v_identity);
  end if;

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
    if nullif(btrim(p_client_request_id), '') is not null then
      select * into v_existing from public.daily_followups where client_request_id = btrim(p_client_request_id) limit 1;
      if v_existing.id is not null then
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
    raise;
end;
$function$;

commit;
