with evidence as (
  select
    a.schedule_id,
    min(a.attendance_date) as first_used_on
  from public.attendance_daily_summary a
  where a.schedule_id is not null
  group by a.schedule_id
)
update public.shift_schedules ss
set effective_from=e.first_used_on
from evidence e
where ss.id=e.schedule_id
  and e.first_used_on<ss.effective_from;
