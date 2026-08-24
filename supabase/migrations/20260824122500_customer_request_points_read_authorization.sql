-- Require a real app staff context (or Supabase Auth session) before exposing
-- Customer Request doctor point read models through anon-executable RPCs.

create or replace function public.dawaa_customer_request_points_reader_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_identifier text := public.dawaa_request_staff_identifier();
  v_allowed boolean := false;
begin
  if auth.uid() is not null then
    return true;
  end if;

  if v_identifier is null then
    return false;
  end if;

  select exists(
    select 1
    from public.staff_accounts sa
    where sa.id::text = v_identifier
      and coalesce(sa.active, true) = true
      and coalesce(sa.can_login, true) = true
  ) into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

create or replace function public.get_customer_request_doctor_incentive_preview(p_staff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier_key text;
  v_policy record;
begin
  if not public.dawaa_customer_request_points_reader_allowed() then
    raise exception 'not_authorized';
  end if;

  if p_staff_id is null or not exists (select 1 from public.staff s where s.id = p_staff_id) then
    return jsonb_build_object('tier_key', null,'registration_points', null,'achievement_points', null,'policy_version', null,'points_eligible', false,'blocked_reason', 'doctor_not_linked_to_staff');
  end if;

  select sit.tier_key into v_tier_key
  from public.staff_incentive_tiers sit
  where sit.staff_id = p_staff_id
    and sit.tier_key in ('senior_doctor','mid_doctor','assistant')
  order by sit.updated_at desc nulls last, sit.created_at desc nulls last
  limit 1;

  if v_tier_key is null then
    return jsonb_build_object('tier_key', null,'registration_points', null,'achievement_points', null,'policy_version', null,'points_eligible', false,'blocked_reason', 'doctor_tier_missing');
  end if;

  select p.policy_version, p.registration_points, p.achievement_points into v_policy
  from public.customer_request_incentive_policy p
  where p.active = true
    and p.tier_key = v_tier_key
    and p.effective_from <= now()
  order by p.effective_from desc, p.policy_version desc
  limit 1;

  if not found then
    return jsonb_build_object('tier_key', v_tier_key,'registration_points', null,'achievement_points', null,'policy_version', null,'points_eligible', false,'blocked_reason', 'incentive_policy_missing');
  end if;

  return jsonb_build_object('tier_key', v_tier_key,'registration_points', v_policy.registration_points,'achievement_points', v_policy.achievement_points,'policy_version', v_policy.policy_version,'points_eligible', true,'blocked_reason', null);
end;
$$;

create or replace function public.get_customer_request_doctor_points_summary(p_staff_id uuid,p_month_cycle text default null)
returns table (staff_id uuid,staff_name text,branch text,tier_key text,month_cycle text,eligible_registered_requests bigint,achieved_requests bigint,achievement_rate numeric,registration_events bigint,achievement_events bigint,registration_points numeric,achievement_points numeric,total_points numeric)
language sql
stable
security definer
set search_path = public
as $$
  select s.staff_id,s.staff_name,s.branch,s.tier_key,s.month_cycle,s.eligible_registered_requests,s.achieved_requests,s.achievement_rate,s.registration_events,s.achievement_events,s.registration_points,s.achievement_points,s.total_points
  from public.customer_request_doctor_points_summary_v1 s
  where public.dawaa_customer_request_points_reader_allowed()
    and s.staff_id = p_staff_id
    and (p_month_cycle is null or s.month_cycle = p_month_cycle)
  order by s.month_cycle desc;
$$;

create or replace function public.get_customer_request_doctor_points_leaderboard(p_month_cycle text,p_branch text default null)
returns table (staff_id uuid,staff_name text,branch text,tier_key text,month_cycle text,eligible_registered_requests bigint,achieved_requests bigint,achievement_rate numeric,registration_events bigint,achievement_events bigint,registration_points numeric,achievement_points numeric,total_points numeric)
language sql
stable
security definer
set search_path = public
as $$
  select s.staff_id,s.staff_name,s.branch,s.tier_key,s.month_cycle,s.eligible_registered_requests,s.achieved_requests,s.achievement_rate,s.registration_events,s.achievement_events,s.registration_points,s.achievement_points,s.total_points
  from public.customer_request_doctor_points_summary_v1 s
  where public.dawaa_customer_request_points_reader_allowed()
    and s.month_cycle = p_month_cycle
    and (p_branch is null or trim(p_branch) = '' or lower(trim(p_branch)) = 'all' or s.branch = p_branch)
  order by s.total_points desc,s.achievement_rate desc,s.staff_name;
$$;

create or replace function public.get_customer_request_incentive_events(p_request_id uuid)
returns table (id uuid,request_id uuid,event_key text,staff_id uuid,tier_key text,points numeric,policy_version text,event_at timestamptz,employee_transaction_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select e.id,e.request_id,e.event_key,e.staff_id,e.tier_key,e.points,e.policy_version,e.event_at,e.employee_transaction_id
  from public.customer_request_incentive_events e
  where public.dawaa_customer_request_points_reader_allowed()
    and e.request_id = p_request_id
  order by e.event_at asc;
$$;
