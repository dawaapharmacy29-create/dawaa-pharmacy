-- Customer Requests doctor points policy v1
-- Approved schedule:
-- tier 1 / senior_doctor: registration +2, achievement +4
-- tier 2 / mid_doctor:    registration +1, achievement +2
-- tier 3 / assistant:     registration +0.5, achievement +1
-- A request is achieved when it first enters a fulfilled state used by the existing fulfillment KPI.

create table if not exists public.customer_request_incentive_policy (
  policy_version text not null,
  tier_key text not null,
  registration_points numeric(8,2) not null,
  achievement_points numeric(8,2) not null,
  effective_from timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (policy_version, tier_key),
  constraint customer_request_incentive_policy_tier_chk
    check (tier_key in ('senior_doctor','mid_doctor','assistant'))
);

insert into public.customer_request_incentive_policy(
  policy_version, tier_key, registration_points, achievement_points, effective_from, active
) values
  ('2026-08-24-v1','senior_doctor',2,4,'2026-08-24 00:00:00+03',true),
  ('2026-08-24-v1','mid_doctor',1,2,'2026-08-24 00:00:00+03',true),
  ('2026-08-24-v1','assistant',0.5,1,'2026-08-24 00:00:00+03',true)
on conflict (policy_version, tier_key) do update set
  registration_points = excluded.registration_points,
  achievement_points = excluded.achievement_points,
  effective_from = excluded.effective_from,
  active = excluded.active;

create table if not exists public.customer_request_incentive_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.customer_requests(id) on delete cascade,
  event_key text not null,
  staff_id uuid not null references public.staff(id),
  tier_key text not null,
  points numeric(8,2) not null,
  policy_version text not null,
  event_at timestamptz not null,
  employee_transaction_id uuid null references public.employee_transactions(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint customer_request_incentive_event_key_chk check (event_key in ('request_registered','request_achieved')),
  constraint customer_request_incentive_event_tier_chk check (tier_key in ('senior_doctor','mid_doctor','assistant')),
  unique(request_id, event_key, staff_id, policy_version)
);

create index if not exists idx_customer_request_incentive_events_staff_date
  on public.customer_request_incentive_events(staff_id, event_at desc);

create unique index if not exists uq_employee_transactions_customer_request_event
  on public.employee_transactions(source, source_id)
  where source = 'customer_request_incentive';

create or replace function public.customer_request_cycle_label(p_event_at timestamptz)
returns text
language sql
immutable
as $$
  select case
    when extract(day from (p_event_at at time zone 'Africa/Cairo')) >= 26
      then to_char((p_event_at at time zone 'Africa/Cairo')::date, 'YYYY-MM')
    else to_char(((p_event_at at time zone 'Africa/Cairo')::date - interval '1 month')::date, 'YYYY-MM')
  end
$$;

create or replace function public.resolve_customer_request_registrar_staff_id(p_request public.customer_requests)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_created_uuid uuid;
begin
  if p_request.doctor_id is not null and exists(select 1 from public.staff s where s.id = p_request.doctor_id) then
    return p_request.doctor_id;
  end if;

  begin
    v_created_uuid := nullif(trim(coalesce(p_request.created_by,'')), '')::uuid;
  exception when others then
    v_created_uuid := null;
  end;

  if v_created_uuid is not null then
    select s.id into v_staff_id from public.staff s where s.id = v_created_uuid limit 1;
    if v_staff_id is not null then return v_staff_id; end if;

    select sa.staff_id into v_staff_id
    from public.staff_accounts sa
    where sa.id = v_created_uuid and sa.staff_id is not null
    limit 1;
    if v_staff_id is not null then return v_staff_id; end if;
  end if;

  return null;
end;
$$;

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

  -- Valid identity is required before points can exist.
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

  select s.id, s.name, s.branch into v_staff
  from public.staff s where s.id = v_staff_id;
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
      'policy_version', v_policy.policy_version
    )
  )
  on conflict (request_id, event_key, staff_id, policy_version) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select e.id into v_event_id
    from public.customer_request_incentive_events e
    where e.request_id = p_request_id and e.event_key = p_event_key
      and e.staff_id = v_staff_id and e.policy_version = v_policy.policy_version
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

create or replace function public.customer_request_doctor_points_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registered_at timestamptz;
  v_old_fulfilled boolean;
  v_new_fulfilled boolean;
begin
  v_registered_at := coalesce(new.requested_at,new.created_at,now());

  if tg_op = 'INSERT' then
    perform public.settle_customer_request_doctor_points(new.id,'request_registered',v_registered_at);
    if new.status in ('available','arrived','customer_contacted','delivered','closed') then
      perform public.settle_customer_request_doctor_points(new.id,'request_achieved',coalesce(new.updated_at,now()));
    end if;
    return new;
  end if;

  v_old_fulfilled := old.status in ('available','arrived','customer_contacted','delivered','closed');
  v_new_fulfilled := new.status in ('available','arrived','customer_contacted','delivered','closed');

  if not v_old_fulfilled and v_new_fulfilled then
    perform public.settle_customer_request_doctor_points(new.id,'request_achieved',coalesce(new.updated_at,now()));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customer_request_doctor_points on public.customer_requests;
create trigger trg_customer_request_doctor_points
after insert or update of status on public.customer_requests
for each row execute function public.customer_request_doctor_points_trigger();

-- Backfill only policy-effective requests. Idempotency is guaranteed by the event unique key.
do $$
declare r record;
begin
  for r in
    select id, coalesce(requested_at,created_at) registered_at, status, updated_at
    from public.customer_requests
    where coalesce(requested_at,created_at) >= '2026-08-24 00:00:00+03'::timestamptz
  loop
    perform public.settle_customer_request_doctor_points(r.id,'request_registered',coalesce(r.registered_at,now()));
    if r.status in ('available','arrived','customer_contacted','delivered','closed') then
      perform public.settle_customer_request_doctor_points(r.id,'request_achieved',coalesce(r.updated_at,now()));
    end if;
  end loop;
end $$;

revoke all on table public.customer_request_incentive_policy from public, anon;
revoke all on table public.customer_request_incentive_events from public, anon;
grant select on table public.customer_request_incentive_policy to authenticated, service_role;
grant select on table public.customer_request_incentive_events to authenticated, service_role;
revoke all on function public.settle_customer_request_doctor_points(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.settle_customer_request_doctor_points(uuid,text,timestamptz) to service_role;
