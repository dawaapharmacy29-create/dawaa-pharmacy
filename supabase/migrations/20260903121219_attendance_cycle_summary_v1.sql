create or replace function public.attendance_cycle_summary_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  role text,
  branch text,
  cycle_start date,
  cycle_end date,
  scheduled_days integer,
  off_days integer,
  present_days integer,
  absent_days integer,
  on_time_days integer,
  late_days integer,
  very_late_days integer,
  total_late_minutes integer,
  early_leave_days integer,
  total_early_leave_minutes integer,
  missing_checkout_days integer,
  worked_on_off_days integer,
  approved_exception_days integer,
  schedule_issue_days integer,
  biometric_days integer,
  biometric_events integer,
  attendance_rate numeric,
  punctuality_rate numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor public.staff_accounts%rowtype;
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception using errcode='22023', message='valid attendance cycle dates required';
  end if;
  if (p_end - p_start) > 62 then
    raise exception using errcode='22023', message='attendance cycle cannot exceed 63 days';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;
  if not found then
    raise exception using errcode='42501', message='active staff actor required';
  end if;

  return query
  with daily as (
    select d.work_day, a.*
    from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') g(day_ts)
    cross join lateral (select g.day_ts::date as work_day) d
    cross join lateral public.attendance_daily_command_v1(d.work_day, p_branch) a
  ), agg as (
    select
      x.staff_id,
      max(x.staff_name) as staff_name,
      max(x.role) as role,
      max(x.branch) as branch,
      count(*) filter (where x.schedule_status='scheduled')::int as scheduled_days,
      count(*) filter (where x.schedule_status='off')::int as off_days,
      count(*) filter (where x.first_check_in is not null)::int as present_days,
      count(*) filter (where x.attendance_status='absent')::int as absent_days,
      count(*) filter (where x.attendance_status in ('on_time','working_now') and coalesce(x.late_minutes,0)=0)::int as on_time_days,
      count(*) filter (where coalesce(x.late_minutes,0)>0)::int as late_days,
      count(*) filter (where coalesce(x.late_minutes,0)>30)::int as very_late_days,
      coalesce(sum(x.late_minutes),0)::int as total_late_minutes,
      count(*) filter (where coalesce(x.early_leave_minutes,0)>0)::int as early_leave_days,
      coalesce(sum(x.early_leave_minutes),0)::int as total_early_leave_minutes,
      count(*) filter (where x.attendance_status='missing_checkout')::int as missing_checkout_days,
      count(*) filter (where x.attendance_status='worked_on_off')::int as worked_on_off_days,
      count(*) filter (where x.attendance_status='approved_exception' or x.approved_exception_type is not null)::int as approved_exception_days,
      count(*) filter (where x.attendance_status in ('schedule_conflict','schedule_missing','punch_without_valid_schedule'))::int as schedule_issue_days,
      count(*) filter (where coalesce(x.biometric_events,0)>0)::int as biometric_days,
      coalesce(sum(x.biometric_events),0)::int as biometric_events
    from daily x
    group by x.staff_id
  )
  select
    a.staff_id,a.staff_name,a.role,a.branch,p_start,p_end,
    a.scheduled_days,a.off_days,a.present_days,a.absent_days,a.on_time_days,
    a.late_days,a.very_late_days,a.total_late_minutes,a.early_leave_days,
    a.total_early_leave_minutes,a.missing_checkout_days,a.worked_on_off_days,
    a.approved_exception_days,a.schedule_issue_days,a.biometric_days,a.biometric_events,
    case when a.scheduled_days>0 then round((a.present_days::numeric/a.scheduled_days::numeric)*100,1) else 0 end,
    case when a.present_days>0 then round((a.on_time_days::numeric/a.present_days::numeric)*100,1) else 0 end
  from agg a
  order by a.branch,a.staff_name;
end;
$$;

revoke all on function public.attendance_cycle_summary_v1(date,date,text) from public;
grant execute on function public.attendance_cycle_summary_v1(date,date,text) to anon, authenticated, service_role;
