-- Data fix (owner-approved 2026-11-22): days worked on a scheduled day off whose shift crossed midnight.
-- The check-out after midnight was read as a stray check-in of the next date, so the day kept one punch and
-- the quick decision approved it with 0 hours. Hours are from the shift's first punch to that check-out.
with fix(name, day, hours, span) as (
  values
    ('د/ عمر',       date '2026-10-27',  7.91, '17:42 → 01:36'),
    ('د/ عمر',       date '2026-11-10',  8.59, '18:16 → 02:52'),
    ('د/ عمر',       date '2026-11-17',  7.35, '18:26 → 01:47'),
    ('د دنيا',       date '2026-10-30',  7.45, '17:18 → 00:45'),
    ('د دنيا',       date '2026-11-13',  7.09, '17:29 → 00:35'),
    ('د دنيا',       date '2026-11-20',  7.25, '17:13 → 00:28'),
    ('د محمد شبل',   date '2026-10-29', 10.47, '23:04 → 09:32'),
    ('د محمد شبل',   date '2026-11-05', 10.37, '23:17 → 09:39'),
    ('د محمد شبل',   date '2026-11-12', 10.30, '23:34 → 09:53'),
    ('د محمد شبل',   date '2026-11-19',  8.92, '23:56 → 08:52'),
    ('اسلام السبع',  date '2026-11-20',  8.77, '18:16 → 03:02')
)
update public.attendance_daily_summary a
set payroll_eligible_hours = f.hours::numeric,
    approval_note = coalesce(a.approval_note, '') || ' (' || f.span
      || ') — تصحيح 22/11: شيفت عدّى نص الليل في يوم أوف، الساعات من البصمات بدل صفر',
    resolution_snapshot = coalesce(a.resolution_snapshot, '{}'::jsonb)
      || jsonb_build_object('manager_approved_payroll_eligible_hours', f.hours::numeric,
                            'corrected_overnight_off_day_at', '2026-11-22'),
    updated_at = now()
from fix f
join public.staff st on btrim(st.name) = btrim(f.name) and st.is_active is true
where a.staff_id = st.id and a.attendance_date = f.day
  and a.status = 'approved' and coalesce(a.payroll_eligible_hours, 0) = 0
  and a.resolution_status = 'worked_on_off';
