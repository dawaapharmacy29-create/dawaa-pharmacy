create or replace function public.dawaa_attendance_manager_review_priority_v1(
  p_resolution_status text,
  p_staff_active boolean,
  p_attendance_date date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with ctx as (
    select greatest(0,((now() at time zone 'Africa/Cairo')::date-coalesce(p_attendance_date,(now() at time zone 'Africa/Cairo')::date)))::int as age_days
  )
  select jsonb_build_object(
    'priority_code',case
      when coalesce(p_staff_active,false)=false then 'former_staff'
      when coalesce(p_resolution_status,'') in (
        'missing_checkin','missing_checkout','absence_review','needs_event_review','time_off_conflict'
      ) then 'P1'
      when coalesce(p_resolution_status,'') in (
        'early_leave_review','worked_on_off','time_off_with_events'
      ) then 'P2'
      else 'P3'
    end,
    'sort_rank',case
      when coalesce(p_staff_active,false)=false then 90
      when coalesce(p_resolution_status,'') in (
        'missing_checkin','missing_checkout','absence_review','needs_event_review','time_off_conflict'
      ) then 10
      when coalesce(p_resolution_status,'') in (
        'early_leave_review','worked_on_off','time_off_with_events'
      ) then 20
      else 30
    end,
    'age_days',ctx.age_days,
    'age_bucket',case
      when ctx.age_days>=7 then '7_plus'
      when ctx.age_days>=3 then '3_6'
      when ctx.age_days>=1 then '1_2'
      else 'today'
    end,
    'priority_reason',case
      when coalesce(p_staff_active,false)=false then 'former_staff_separate_lane'
      when coalesce(p_resolution_status,'') in ('missing_checkin','missing_checkout') then 'payable_hours_blocked_by_missing_punch'
      when coalesce(p_resolution_status,'')='absence_review' then 'attendance_day_unresolved_absence'
      when coalesce(p_resolution_status,'')='needs_event_review' then 'attendance_evidence_incomplete'
      when coalesce(p_resolution_status,'')='time_off_conflict' then 'timeoff_conflict_blocks_truth'
      when coalesce(p_resolution_status,'')='early_leave_review' then 'worked_hours_known_policy_decision_pending'
      when coalesce(p_resolution_status,'')='worked_on_off' then 'worked_off_day_policy_decision_pending'
      when coalesce(p_resolution_status,'')='time_off_with_events' then 'attendance_timeoff_conflict_needs_manager'
      else 'manager_review_other'
    end
  )
  from ctx
$$;

revoke all on function public.dawaa_attendance_manager_review_priority_v1(text,boolean,date)
from public,anon,authenticated;
grant execute on function public.dawaa_attendance_manager_review_priority_v1(text,boolean,date)
to service_role;