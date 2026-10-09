drop trigger if exists trg_dawaa_mark_attendance_dirty_schedule_v1 on public.shift_schedules;
create trigger trg_dawaa_mark_attendance_dirty_schedule_v1
after insert or delete or update of staff_id,shift_date,date,day_of_week,day_name,shift_start,shift_end,start_time,end_time,is_off,is_day_off,status,effective_from,effective_to,has_custom_time
on public.shift_schedules
for each row execute function public.dawaa_mark_attendance_dirty_from_schedule_v1();

drop trigger if exists trg_dawaa_mark_attendance_dirty_timeoff_v1 on public.staff_time_off_requests;
create trigger trg_dawaa_mark_attendance_dirty_timeoff_v1
after insert or delete or update of staff_id,status,start_date,end_date,start_time,end_time,duration_minutes,request_kind,decided_at,cancelled_at
on public.staff_time_off_requests
for each row execute function public.dawaa_mark_attendance_dirty_from_timeoff_v1();