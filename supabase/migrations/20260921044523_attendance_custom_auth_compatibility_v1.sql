drop policy if exists shift_schedules_select_authenticated_v2 on public.shift_schedules;
drop policy if exists shift_schedules_select_app_v3 on public.shift_schedules;

create policy shift_schedules_select_app_v3
on public.shift_schedules
for select
to anon,authenticated
using (true);

grant execute on function public.replace_staff_shift_schedule_version_v1(uuid,jsonb,date,text) to anon,authenticated;
grant execute on function public.attendance_dashboard_daily_summary_v1(date,text) to anon,authenticated;
grant execute on function public.attendance_payroll_truth_preview_v1(date,date,text) to anon,authenticated;
grant execute on function public.attendance_schedule_health_v1(text) to anon,authenticated;
grant execute on function public.attendance_resolution_drift_v1(date,date,text) to anon,authenticated;
grant execute on function public.attendance_payroll_engine_v2(uuid,text) to anon,authenticated;
grant execute on function public.list_pending_overtime_v1(text) to anon,authenticated;
grant execute on function public.list_overtime_decisions_v1(text,text,integer) to anon,authenticated;
grant execute on function public.decide_overtime_approval_v1(uuid,text,text) to anon,authenticated;
