-- Data fix for the days the old quick decision «اعتماد اليوم زي ما البصمات بتقول» approved with 0 hours
-- although the day had a shift of punches (off day / no schedule). Approved by the owner on 2026-11-22.
-- Same window and rule as the fixed decision: the hours between the day's own first and last punch, only for
-- days with 2+ own punches; the manager's approval stays, with the hours and a note added.
with fixed as (
  select a.id, o.first_at, o.last_at,
         round((extract(epoch from (o.last_at - o.first_at)) / 3600.0)::numeric, 2) as hours
  from public.attendance_daily_summary a
  join public.staff st on st.id = a.staff_id and st.is_active is true
  cross join lateral public.dr_wael_day_own_punches_v1(a.staff_id, a.attendance_date) o
  where a.attendance_date between date '2026-10-26' and date '2026-11-21'
    and a.status = 'approved'
    and coalesce(a.payroll_eligible_hours, 0) = 0
    and a.approval_note = 'قرار سريع: اعتماد اليوم زي ما البصمات بتقول'
    and a.resolution_status in ('off_day', 'no_schedule', 'approved_time_off', 'worked_on_off')
    and o.punches >= 2
)
update public.attendance_daily_summary a
set payroll_eligible_hours = f.hours,
    approval_note = a.approval_note || ' (' || to_char(f.first_at at time zone 'Africa/Cairo', 'HH24:MI') || ' → '
      || to_char(f.last_at at time zone 'Africa/Cairo', 'HH24:MI') || ') — تصحيح 22/11: الساعات من البصمات بدل صفر',
    resolution_snapshot = coalesce(a.resolution_snapshot, '{}'::jsonb)
      || jsonb_build_object('manager_approved_payroll_eligible_hours', f.hours,
                            'corrected_from_zero_hours_at', '2026-11-22'),
    updated_at = now()
from fixed f
where a.id = f.id and f.hours > 0 and f.hours <= 12;
-- As applied, the first run also touched 7 days of staff no longer active (محمد كمال's 16-hour spans among
-- them); those were put back to 0 hours and their original note the same minute. The filters above are the
-- net effect: 11 days of active staff.
