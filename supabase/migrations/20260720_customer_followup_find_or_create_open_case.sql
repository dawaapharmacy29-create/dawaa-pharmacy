alter table public.daily_followups
  add column if not exists client_request_id text;

create unique index if not exists daily_followups_client_request_id_uidx
  on public.daily_followups (client_request_id)
  where client_request_id is not null and btrim(client_request_id) <> '';

create index if not exists daily_followups_open_identity_case_idx
  on public.daily_followups (identity_key, branch, request_type, created_at desc)
  where completed_at is null
    and cancelled_at is null
    and archived_at is null
    and is_hidden is false
    and duplicate_of is null;

create or replace function public.dawaa_normalize_egyptian_mobile_v1(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when digits ~ '^00201[0125][0-9]{8}$' then '0' || substr(digits, 5)
    when digits ~ '^201[0125][0-9]{8}$' then '0' || substr(digits, 3)
    when digits ~ '^1[0125][0-9]{8}$' then '0' || digits
    else digits
  end
  from (select regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g') as digits) s;
$$;

create or replace function public.dawaa_customer_identity_key_v1(
  p_customer_id text,
  p_customer_code text,
  p_phone text,
  p_name text
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_phone text := public.dawaa_normalize_egyptian_mobile_v1(p_phone);
  v_name text;
begin
  if nullif(btrim(p_customer_id), '') is not null then
    return 'id:' || btrim(p_customer_id);
  end if;
  if nullif(btrim(p_customer_code), '') is not null
     and lower(btrim(p_customer_code)) not in ('0','null','undefined','غير محدد','غير معروف') then
    return 'code:' || btrim(p_customer_code);
  end if;
  if v_phone ~ '^01[0125][0-9]{8}$' then
    return 'phone:' || v_phone;
  end if;
  v_name := lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  if v_name <> '' and v_name not in ('0','غير محدد','غير معروف','عميل غير مسجل','عميل الصيدلية') then
    return 'name:' || v_name;
  end if;
  return null;
end;
$$;

create or replace function public.find_or_create_open_customer_followup(
  p_customer_id text,
  p_customer_code text,
  p_customer_name text,
  p_customer_phone text,
  p_branch text,
  p_request_type text,
  p_request_details text,
  p_followup_reason text,
  p_priority text,
  p_next_followup_date date,
  p_actor_staff_id text,
  p_actor_name text,
  p_client_request_id text default null,
  p_source text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff record;
  v_identity text;
  v_case_type text := coalesce(nullif(btrim(p_request_type), ''), 'general');
  v_branch text := nullif(btrim(p_branch), '');
  v_existing public.daily_followups%rowtype;
  v_created public.daily_followups%rowtype;
  v_lock_key text;
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
  if v_identity is null then raise exception 'customer_identity_required'; end if;
  if v_branch is null then raise exception 'branch_required'; end if;

  if nullif(btrim(p_client_request_id), '') is not null then
    select * into v_existing
    from public.daily_followups
    where client_request_id = btrim(p_client_request_id)
    limit 1;
    if v_existing.id is not null then
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
      v_existing.id, 'request_linked', 'open', p_actor_staff_id,
      coalesce(nullif(btrim(p_actor_name), ''), v_staff.name),
      coalesce(nullif(btrim(p_request_details), ''), nullif(btrim(p_followup_reason), ''), 'طلب متابعة إضافي'),
      jsonb_build_object('source', coalesce(nullif(btrim(p_source), ''), 'manual'), 'request_type', v_case_type, 'client_request_id', nullif(btrim(p_client_request_id), ''), 'requested_at', now())
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
    jsonb_build_object('source', coalesce(nullif(btrim(p_source), ''), 'manual'), 'request_type', v_case_type, 'client_request_id', nullif(btrim(p_client_request_id), ''))
  );

  return jsonb_build_object('followup_id', v_created.id, 'created', true, 'linked_to_open_case', false, 'identity_key', v_identity);
exception
  when unique_violation then
    if nullif(btrim(p_client_request_id), '') is not null then
      select * into v_existing from public.daily_followups where client_request_id = btrim(p_client_request_id) limit 1;
      if v_existing.id is not null then
        return jsonb_build_object('followup_id', v_existing.id, 'created', false, 'idempotent_replay', true, 'identity_key', v_existing.identity_key);
      end if;
    end if;
    raise;
end;
$$;

revoke all on function public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text) from public;
grant execute on function public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text) to anon, authenticated;

comment on function public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text)
is 'Transaction-safe find-or-create for an open customer followup. Validates an active internal staff account and links repeated requests as events.';
