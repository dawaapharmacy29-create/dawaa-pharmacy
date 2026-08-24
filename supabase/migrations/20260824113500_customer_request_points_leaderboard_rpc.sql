-- Read-only leaderboard boundary for Customer Request performance.
create or replace function public.get_customer_request_doctor_points_leaderboard(
  p_month_cycle text,
  p_branch text default null
)
returns table (
  staff_id uuid,
  staff_name text,
  branch text,
  tier_key text,
  month_cycle text,
  eligible_registered_requests bigint,
  achieved_requests bigint,
  achievement_rate numeric,
  registration_events bigint,
  achievement_events bigint,
  registration_points numeric,
  achievement_points numeric,
  total_points numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.staff_id,
    s.staff_name,
    s.branch,
    s.tier_key,
    s.month_cycle,
    s.eligible_registered_requests,
    s.achieved_requests,
    s.achievement_rate,
    s.registration_events,
    s.achievement_events,
    s.registration_points,
    s.achievement_points,
    s.total_points
  from public.customer_request_doctor_points_summary_v1 s
  where s.month_cycle = p_month_cycle
    and (p_branch is null or trim(p_branch) = '' or lower(trim(p_branch)) = 'all' or s.branch = p_branch)
  order by s.total_points desc, s.achievement_rate desc, s.staff_name;
$$;

revoke all on function public.get_customer_request_doctor_points_leaderboard(text,text) from public;
grant execute on function public.get_customer_request_doctor_points_leaderboard(text,text) to anon, authenticated, service_role;
