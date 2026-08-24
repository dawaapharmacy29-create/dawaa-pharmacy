-- A Customer Request registration/achievement event belongs to exactly one doctor.
-- Prevent a later staff-id correction from creating a second positive award for the
-- same request event and policy version. Attribution corrections must be audited,
-- not silently double-settled.

create unique index if not exists uq_customer_request_incentive_logical_event
  on public.customer_request_incentive_events(request_id, event_key, policy_version);

create or replace function public.settle_customer_request_doctor_points(
  p_request_id uuid,
  p_event_key text,
  p_event_at timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.customer_requests%rowtype;
  v_staff_id uuid;
  v_staff record;
  v_tier_key text;
  v_policy record;
  v_points numeric(8,2);
  v_event_id uuid;
  v_txn_id uuid;
  v_cycle text;
  v_title text;
  v_reason text;
begin
  if p_event_key not in ('request_registered','request_achieved') then
    raise exception 'invalid customer request incentive event: %', p_event_key;
  end if;

  select * into v_request from public.customer_requests where id = p_request_id;
  if not found then return null; end if;

  if nullif(trim(coalesce(v_request.customer_id,'')), '') is null
     or nullif(trim(coalesce(v_request.customer_code,'')), '') is null
     or nullif(trim(coalesce(v_request.medicine_name,'')), '') is null
     or nullif(trim(coalesce(v_request.product_code,'')), '') is null
     or coalesce(v_request.sync_conflict,false)
     or coalesce(v_request.doctor_notes,'') ~* '(مكرر|بالخطأ|duplicate)'
     or coalesce(v_request.source_notes,'') ~* '(مكرر|بالخطأ|duplicate)' then
    return null;
  end if;

  v_staff_id := public.resolve_customer_request_registrar_staff_id(v_request);
  if v_staff_id is null then return null; end if;

  select s.id, s.name, s.branch into v_staff from public.staff s where s.id = v_staff_id;
  if not found then return null; end if;

  select sit.tier_key into v_tier_key
  from public.staff_incentive_tiers sit
  where sit.staff_id = v_staff_id
    and sit.tier_key in ('senior_doctor','mid_doctor','assistant')
  order by sit.updated_at desc nulls last, sit.created_at desc nulls last
  limit 1;
  if v_tier_key is null then return null; end if;

  select * into v_policy
  from public.customer_request_incentive_policy p
  where p.active = true
    and p.tier_key = v_tier_key
    and p.effective_from <= p_event_at
  order by p.effective_from desc, p.policy_version desc
  limit 1;
  if not found then return null; end if;

  -- Exactly one positive event per request/event/policy, regardless of later staff edits.
  select e.id into v_event_id
  from public.customer_request_incentive_events e
  where e.request_id = p_request_id
    and e.event_key = p_event_key
    and e.policy_version = v_policy.policy_version
  limit 1;
  if v_event_id is not null then return v_event_id; end if;

  v_points := case when p_event_key = 'request_registered'
    then v_policy.registration_points else v_policy.achievement_points end;
  if v_points is null or v_points <= 0 then return null; end if;

  insert into public.customer_request_incentive_events(
    request_id, event_key, staff_id, tier_key, points, policy_version, event_at, metadata
  ) values (
    p_request_id, p_event_key, v_staff_id, v_tier_key, v_points, v_policy.policy_version, p_event_at,
    jsonb_build_object(
      'customer_code', v_request.customer_code,
      'product_code', v_request.product_code,
      'medicine_name', v_request.medicine_name,
      'branch', v_request.branch,
      'policy_version', v_policy.policy_version,
      'attribution_locked_at_settlement', true
    )
  )
  on conflict (request_id, event_key, policy_version) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select e.id into v_event_id
    from public.customer_request_incentive_events e
    where e.request_id = p_request_id
      and e.event_key = p_event_key
      and e.policy_version = v_policy.policy_version
    limit 1;
    return v_event_id;
  end if;

  v_cycle := public.customer_request_cycle_label(p_event_at);
  v_title := case when p_event_key='request_registered' then 'تسجيل طلب عميل' else 'تحقيق طلب عميل' end;
  v_reason := v_title || ' — ' || coalesce(v_request.medicine_name,'صنف') || ' — ' || v_points || ' نقطة';

  insert into public.employee_transactions(
    staff_id, employee_id, employee_name, type, title, reason, amount, points, points_delta,
    source, source_id, transaction_date, created_at, description, month_cycle, branch,
    status, category, employee_visible, created_by, metadata
  ) values (
    v_staff_id, v_staff_id, v_staff.name, 'reward', v_title, v_reason, 0, v_points, v_points,
    'customer_request_incentive', v_event_id, (p_event_at at time zone 'Africa/Cairo')::date, p_event_at,
    v_reason, v_cycle, coalesce(v_request.branch,v_staff.branch), 'approved', 'customer_requests', true,
    'system_automation',
    jsonb_build_object(
      'request_id', p_request_id,
      'event_key', p_event_key,
      'tier_key', v_tier_key,
      'policy_version', v_policy.policy_version,
      'customer_code', v_request.customer_code,
      'product_code', v_request.product_code,
      'medicine_name', v_request.medicine_name
    )
  ) returning id into v_txn_id;

  update public.customer_request_incentive_events
  set employee_transaction_id = v_txn_id
  where id = v_event_id;

  return v_event_id;
end;
$$;
