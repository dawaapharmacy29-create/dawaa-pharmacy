-- A shift worked on a day off that crosses midnight: its check-out after midnight is filed under the next
-- date (often typed as a check-in), so the day kept a single evening punch and the quick decision could not
-- tell its hours. The day's own punches now take that next-date punch as the day's last one when:
--   * the day has exactly one punch of its own, at noon or later;
--   * the next-date punch is the first one within 13 hours after it;
--   * it is not the next day's own shift start (more than 3 hours before that day's scheduled start).
create or replace function public.dr_wael_day_own_punches_v1(p_staff_id uuid, p_date date)
returns table (punches int, first_at timestamptz, last_at timestamptz)
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
  with own as (
    select count(*)::int as n, min(l.recorded_at) as first_at, max(l.recorded_at) as last_at
    from public.staff_attendance_logs l
    where l.staff_id = p_staff_id and l.shift_date = p_date and coalesce(l.status, '') <> 'rejected'
      and not public.dr_wael_punch_belongs_to_neighbor_v1(p_staff_id, p_date)
  ),
  carried as (
    select (
      select min(l.recorded_at)
      from public.staff_attendance_logs l
      where l.staff_id = p_staff_id and l.shift_date = p_date + 1 and coalesce(l.status, '') <> 'rejected'
        and l.recorded_at > o.last_at and l.recorded_at <= o.last_at + interval '13 hours'
    ) as out_at
    from own o
    where o.n = 1 and extract(hour from o.first_at at time zone 'Africa/Cairo') >= 12
  ),
  usable as (
    select c.out_at
    from carried c
    where c.out_at is not null
      and c.out_at < coalesce((select a.scheduled_start_at from public.attendance_daily_summary a
                               where a.staff_id = p_staff_id and a.attendance_date = p_date + 1), 'infinity'::timestamptz)
                     - interval '3 hours'
  )
  select case when u.out_at is not null then 2 else o.n end,
         o.first_at,
         coalesce(u.out_at, o.last_at)
  from own o
  left join usable u on true;
$function$;

revoke all on function public.dr_wael_day_own_punches_v1(uuid, date) from public, anon, authenticated;
