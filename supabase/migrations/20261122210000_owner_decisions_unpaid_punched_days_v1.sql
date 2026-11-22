-- Owner decision 2026-11-22: approved days paid 0 hours although the punches show a full shift.
-- Hours are from the shift's first to its last punch. A night shift is filed on the date it started.
with fix(staff_id, day, hours, span) as (
  values
    ('086d5092-331e-43c9-8abc-c55efb09cc9d'::uuid, date '2026-11-08', 7.28::numeric, '20:20 → 03:37'),   -- محمد كمال
    ('086d5092-331e-43c9-8abc-c55efb09cc9d'::uuid, date '2026-11-09', 6.40::numeric, '19:53 → 02:17'),
    ('086d5092-331e-43c9-8abc-c55efb09cc9d'::uuid, date '2026-11-12', 7.90::numeric, '19:42 → 03:36'),
    ('086d5092-331e-43c9-8abc-c55efb09cc9d'::uuid, date '2026-11-13', 7.28::numeric, '19:40 → 02:57')
)
update public.attendance_daily_summary a
set payroll_eligible_hours = f.hours,
    approved_by = 'owner_decision:2026-11-22',
    approved_by_name = 'قرار المالك',
    approved_at = now(),
    approval_note = 'قرار المالك 22/11: شيفت ليل ' || f.span || ' = ' || f.hours
      || ' ساعة. البصمتين اتسجلوا حضور فاليوم اتحسب صفر',
    resolution_snapshot = coalesce(a.resolution_snapshot, '{}'::jsonb)
      || jsonb_build_object('manager_approved_payroll_eligible_hours', f.hours, 'owner_decision_at', '2026-11-22',
                            'hours_evidence', f.span, 'previous_hours', a.payroll_eligible_hours),
    updated_at = now()
from fix f
where a.staff_id = f.staff_id and a.attendance_date = f.day
  and a.status = 'approved' and coalesce(a.payroll_eligible_hours, 0) = 0;

with fix(name, day, hours, why) as (
  values
    ('محمد حجازي', date '2026-11-18', 12.70::numeric, 'الإدارة أكدت إنه اشتغل، والبصمات 13:13 → 01:55'),
    ('د رضا',      date '2026-11-14',  5.28::numeric, 'اشتغل يوم أوف 15:46 → 21:03'),
    ('احمد السايس', date '2026-11-02',  9.32::numeric, 'اشتغل 09:42 → 19:01 ومالوش جدول')
)
update public.attendance_daily_summary a
set payroll_eligible_hours = f.hours,
    approved_by = 'owner_decision:2026-11-22',
    approved_by_name = 'قرار المالك',
    approved_at = now(),
    approval_note = coalesce(a.approval_note || ' — ', '') || 'قرار المالك 22/11: ' || f.why || ' = ' || f.hours || ' ساعة',
    resolution_snapshot = coalesce(a.resolution_snapshot, '{}'::jsonb)
      || jsonb_build_object('manager_approved_payroll_eligible_hours', f.hours, 'owner_decision_at', '2026-11-22',
                            'hours_evidence', f.why, 'previous_hours', a.payroll_eligible_hours),
    updated_at = now()
from fix f
join public.staff st on btrim(st.name) = f.name
where a.staff_id = st.id and a.attendance_date = f.day
  and a.status = 'approved' and coalesce(a.payroll_eligible_hours, 0) = 0;

-- هبه محمد 17/11 is inside her approved leave (6/11 → 1/12) but was closed as an absence without permission.
update public.attendance_daily_summary a
set resolution_status = 'approved_time_off',
    time_off_request_id = 'f2080a8b-a68c-4e9c-b03f-3274cadc912a',
    payroll_eligible_hours = 0,
    approved_by = 'owner_decision:2026-11-22',
    approved_by_name = 'قرار المالك',
    approved_at = now(),
    approval_note = 'قرار المالك 22/11: اليوم جوه إجازتها بإذن الإدارة (6/11 → 1/12)، مش غياب من غير إذن',
    resolution_snapshot = coalesce(a.resolution_snapshot, '{}'::jsonb)
      || jsonb_build_object('owner_decision_at', '2026-11-22', 'previous_resolution_status', a.resolution_status,
                            'time_off_kind', 'approved_absence'),
    updated_at = now()
where a.staff_id = 'dea91886-1ae8-4766-a166-9952866a5024' and a.attendance_date = date '2026-11-17'
  and a.status = 'approved' and a.resolution_status = 'absence_review';
