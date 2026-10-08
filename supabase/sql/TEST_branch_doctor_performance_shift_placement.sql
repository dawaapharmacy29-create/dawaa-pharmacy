-- Read-only regression check for get_branch_doctor_performance_window_v1 shift placement.
-- Uses the same predicates as the migration on synthetic rows (no table writes). Expected:
--   id 1 (03:00 next day)   -> shift_date 2026-09-01, night   (night shift crossing midnight stays one shift)
--   id 2 (10:30, no window) -> null (outside every attendance window = unplaced, never guessed)
--   id 3 (21:30)            -> shift_date 2026-09-02, evening (within the +60 min tolerance of the evening window)
--   id 4 (21:20 day before) -> shift_date 2026-09-01, night   (40 min before shift start)
--   id 5 (08:45 next day)   -> shift_date 2026-09-01, night   (45 min after shift end)
--   hour classes: 0-4 night, 5-12 morning, 13-20 evening, 21-23 night
with productive_days(staff_id, attendance_date, win_start, win_end, shift_src) as (values
  ('T', '2026-09-01'::date, '2026-09-01 22:00'::timestamp at time zone 'Africa/Cairo', '2026-09-02 08:00'::timestamp at time zone 'Africa/Cairo', '2026-09-01 22:00'::timestamp at time zone 'Africa/Cairo'),
  ('T', '2026-09-02'::date, '2026-09-02 14:00'::timestamp at time zone 'Africa/Cairo', '2026-09-02 22:00'::timestamp at time zone 'Africa/Cairo', '2026-09-02 14:00'::timestamp at time zone 'Africa/Cairo')
), pd as (
  select *, case when extract(hour from shift_src at time zone 'Africa/Cairo') >= 5 and extract(hour from shift_src at time zone 'Africa/Cairo') < 13 then 'morning'
                 when extract(hour from shift_src at time zone 'Africa/Cairo') >= 13 and extract(hour from shift_src at time zone 'Africa/Cairo') < 21 then 'evening'
                 else 'night' end shift
  from productive_days
), attributed(id, staff_id, ts) as (values
  (1, 'T', '2026-09-02 03:00'::timestamp at time zone 'Africa/Cairo'),
  (2, 'T', '2026-09-02 10:30'::timestamp at time zone 'Africa/Cairo'),
  (3, 'T', '2026-09-02 21:30'::timestamp at time zone 'Africa/Cairo'),
  (4, 'T', '2026-09-01 21:20'::timestamp at time zone 'Africa/Cairo'),
  (5, 'T', '2026-09-02 08:45'::timestamp at time zone 'Africa/Cairo')
), t as (select *, (ts at time zone 'Africa/Cairo')::date d from attributed)
select distinct on (t.id) t.id, p.attendance_date shift_date, p.shift
from t left join pd p on p.staff_id = t.staff_id and p.attendance_date in (t.d, t.d - 1)
  and t.ts >= p.win_start - interval '60 minutes' and t.ts < p.win_end + interval '60 minutes'
order by t.id, (p.attendance_date is null), abs(extract(epoch from (t.ts - p.win_start)));
