with baseline_rows as (
  select
    ss.id,
    (
      select min(a.attendance_date)
      from public.attendance_daily_summary a
      where a.staff_id=ss.staff_id
        and a.attendance_date<ss.effective_from
    ) as evidenced_from
  from public.shift_schedules ss
  where ss.shift_date is null
    and ss.date is null
    and ss.effective_to is null
    and ss.source is null
    and exists (
      select 1
      from public.attendance_daily_summary a
      where a.staff_id=ss.staff_id
        and a.attendance_date<ss.effective_from
    )
    and not exists (
      select 1
      from public.shift_schedules other
      where other.staff_id=ss.staff_id
        and other.id<>ss.id
        and other.shift_date is null
        and other.date is null
        and trim(coalesce(other.day_name,''))=trim(coalesce(ss.day_name,''))
    )
)
update public.shift_schedules ss
set effective_from=b.evidenced_from
from baseline_rows b
where ss.id=b.id
  and b.evidenced_from is not null
  and b.evidenced_from<ss.effective_from;
