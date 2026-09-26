-- Attendance report performance + read-only payroll truth preview.
-- No payroll rows are written and no approved/paid payroll is recalculated.

create or replace function public.attendance_dashboard_daily_summary_v1(
  p_date date,
  p_branch text default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public','pg_catalog'
as $$
  with rows as (
    select * from public.attendance_daily_command_v1(p_date,p_branch)
  )
  select jsonb_build_object(
    'staff', count(*),
    'on_time', count(*) filter (where attendance_status in ('on_time','working_now')),
    'late', count(*) filter (where attendance_status in ('late','very_late')),
    'missing', count(*) filter (where attendance_status in ('absent','not_arrived','missing_checkin','missing_checkout')),
    'issues', count(*) filter (where attendance_status in ('schedule_conflict','schedule_missing','punch_without_valid_schedule','no_schedule','invalid_schedule_time','needs_event_review')),
    'generated_at', now()
  )
  from rows;
$$;

revoke all on function public.attendance_dashboard_daily_summary_v1(date,text) from public,anon;
grant execute on function public.attendance_dashboard_daily_summary_v1(date,text) to authenticated,service_role;

create or replace function public.attendance_payroll_truth_preview_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  role text,
  branch text,
  actual_worked_days integer,
  actual_worked_hours numeric,
  base_payable_hours numeric,
  off_days integer,
  approved_time_off_days integer,
  absence_days integer,
  pending_review_days integer,
  worked_on_off_days integer,
  approved_overtime_hours numeric,
  pending_overtime_hours numeric
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor_id uuid;
begin
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 45 then
    raise exception 'invalid_attendance_payroll_truth_range' using errcode='22023';
  end if;

  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  return query
  with eligible_staff as (
    select s.id, s.name, s.role, s.branch
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ),
  attendance_agg as (
    select
      a.staff_id,
      count(*) filter (
        where a.status='approved'
          and coalesce(a.candidate_hours,0)>0
          and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')
      )::integer as actual_worked_days,
      round(coalesce(sum(a.candidate_hours) filter (
        where a.status='approved'
          and coalesce(a.candidate_hours,0)>0
          and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')
      ),0),2) as actual_worked_hours,
      round(coalesce(sum(
        case
          when a.status='approved'
            and coalesce(a.candidate_hours,0)>0
            and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')
          then least(
            coalesce(a.candidate_hours,0),
            coalesce(
              greatest(extract(epoch from (a.scheduled_end_at-a.scheduled_start_at))/3600.0,0),
              coalesce(a.candidate_hours,0)
            )
          )
          else 0
        end
      ),0),2) as base_payable_hours,
      count(*) filter (where a.status='approved' and a.resolution_status='off_day')::integer as off_days,
      count(*) filter (where a.status='approved' and a.resolution_status='approved_time_off')::integer as approved_time_off_days,
      count(*) filter (where a.status='approved' and a.resolution_status='absence_review')::integer as absence_days,
      count(*) filter (where a.status='pending_review')::integer as pending_review_days,
      count(*) filter (where a.status='approved' and a.resolution_status='worked_on_off' and coalesce(a.candidate_hours,0)>0)::integer as worked_on_off_days
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
    group by a.staff_id
  ),
  overtime_agg as (
    select
      o.staff_id,
      round(coalesce(sum(o.overtime_hours) filter (where o.status='approved'),0),2) as approved_overtime_hours,
      round(coalesce(sum(o.overtime_hours) filter (where o.status='pending'),0),2) as pending_overtime_hours
    from public.staff_overtime_approvals o
    where o.attendance_date between p_start and p_end
    group by o.staff_id
  )
  select
    s.id,
    s.name,
    s.role,
    s.branch,
    coalesce(a.actual_worked_days,0),
    coalesce(a.actual_worked_hours,0),
    coalesce(a.base_payable_hours,0),
    coalesce(a.off_days,0),
    coalesce(a.approved_time_off_days,0),
    coalesce(a.absence_days,0),
    coalesce(a.pending_review_days,0),
    coalesce(a.worked_on_off_days,0),
    coalesce(o.approved_overtime_hours,0),
    coalesce(o.pending_overtime_hours,0)
  from eligible_staff s
  left join attendance_agg a on a.staff_id=s.id
  left join overtime_agg o on o.staff_id=s.id
  order by s.branch,s.name;
end;
$$;

revoke all on function public.attendance_payroll_truth_preview_v1(date,date,text) from public,anon;
grant execute on function public.attendance_payroll_truth_preview_v1(date,date,text) to authenticated,service_role;
