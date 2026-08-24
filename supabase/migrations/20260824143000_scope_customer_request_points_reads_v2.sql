-- Scope Customer Request doctor-points read RPCs to the canonical current staff actor.
-- This migration intentionally comes after all Customer Request points migrations in PR #280,
-- so future rebuilds preserve the stricter final read boundary.

create or replace function public.dawaa_can_read_customer_request_doctor_points(p_staff_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_branch text;
  v_actor_staff_text text;
  v_actor_staff_id uuid;
  v_target_branch text;
begin
  if p_staff_id is null then return false; end if;

  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then return false; end if;
  if not public.user_has_permission(v_actor_id, 'view_points') then return false; end if;

  select lower(trim(coalesce(sa.role,''))), trim(coalesce(sa.branch,'')), nullif(trim(coalesce(sa.staff_id,'')), '')
    into v_actor_role, v_actor_branch, v_actor_staff_text
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if not found then return false; end if;

  if v_actor_role in ('general_manager','executive_manager','branches_manager','admin') then
    return true;
  end if;

  begin
    v_actor_staff_id := v_actor_staff_text::uuid;
  exception when others then
    v_actor_staff_id := null;
  end;

  if v_actor_staff_id is not null and v_actor_staff_id = p_staff_id then
    return true;
  end if;

  if v_actor_role in ('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening') then
    select trim(coalesce(s.branch,'')) into v_target_branch
    from public.staff s
    where s.id = p_staff_id
    limit 1;

    return nullif(v_target_branch,'') is not null
      and lower(v_target_branch) = lower(v_actor_branch);
  end if;

  return false;
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
  if not public.dawaa_can_read_customer_request_doctor_points(p_staff_id) then
    raise exception 'not_authorized';
  end if;

  if not exists (select 1 from public.staff s where s.id = p_staff_id) then
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
  where public.dawaa_can_read_customer_request_doctor_points(p_staff_id)
    and s.staff_id = p_staff_id
    and (p_month_cycle is null or s.month_cycle = p_month_cycle)
  order by s.month_cycle desc;
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
  where e.request_id = p_request_id
    and public.dawaa_can_read_customer_request_doctor_points(e.staff_id)
  order by e.event_at asc;
$$;

create or replace function public.get_customer_request_doctor_points_leaderboard(p_month_cycle text,p_branch text default null)
returns table (staff_id uuid,staff_name text,branch text,tier_key text,month_cycle text,eligible_registered_requests bigint,achieved_requests bigint,achievement_rate numeric,registration_events bigint,achievement_events bigint,registration_points numeric,achievement_points numeric,total_points numeric)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not public.user_has_permission(v_actor_id, 'view_points') then
    return;
  end if;

  select lower(trim(coalesce(sa.role,''))), trim(coalesce(sa.branch,''))
    into v_actor_role, v_actor_branch
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if v_actor_role in ('general_manager','executive_manager','branches_manager','admin') then
    return query
    select s.staff_id,s.staff_name,s.branch,s.tier_key,s.month_cycle,s.eligible_registered_requests,s.achieved_requests,s.achievement_rate,s.registration_events,s.achievement_events,s.registration_points,s.achievement_points,s.total_points
    from public.customer_request_doctor_points_summary_v1 s
    where s.month_cycle = p_month_cycle
      and (p_branch is null or trim(p_branch) = '' or lower(trim(p_branch)) = 'all' or lower(trim(s.branch)) = lower(trim(p_branch)))
    order by s.total_points desc,s.achievement_rate desc,s.staff_name;
    return;
  end if;

  if v_actor_role in ('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening') then
    return query
    select s.staff_id,s.staff_name,s.branch,s.tier_key,s.month_cycle,s.eligible_registered_requests,s.achieved_requests,s.achievement_rate,s.registration_events,s.achievement_events,s.registration_points,s.achievement_points,s.total_points
    from public.customer_request_doctor_points_summary_v1 s
    where s.month_cycle = p_month_cycle
      and lower(trim(s.branch)) = lower(v_actor_branch)
      and (p_branch is null or trim(p_branch) = '' or lower(trim(p_branch)) = 'all' or lower(trim(p_branch)) = lower(v_actor_branch))
    order by s.total_points desc,s.achievement_rate desc,s.staff_name;
  end if;
end;
$$;

revoke all on function public.dawaa_can_read_customer_request_doctor_points(uuid) from public, anon, authenticated;
grant execute on function public.dawaa_can_read_customer_request_doctor_points(uuid) to service_role;

revoke all on function public.get_customer_request_doctor_incentive_preview(uuid) from public;
revoke all on function public.get_customer_request_doctor_points_summary(uuid,text) from public;
revoke all on function public.get_customer_request_doctor_points_leaderboard(text,text) from public;
revoke all on function public.get_customer_request_incentive_events(uuid) from public;
grant execute on function public.get_customer_request_doctor_incentive_preview(uuid) to anon, authenticated, service_role;
grant execute on function public.get_customer_request_doctor_points_summary(uuid,text) to anon, authenticated, service_role;
grant execute on function public.get_customer_request_doctor_points_leaderboard(text,text) to anon, authenticated, service_role;
grant execute on function public.get_customer_request_incentive_events(uuid) to anon, authenticated, service_role;
