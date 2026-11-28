-- Owner decision 2026-11-22: د احمد حافظ (no longer active), night of 29/10.
-- His punches were read wrong (16:04 held for review, 02:53 typed as a check-in) so the day had no check-out, and
-- he is inactive so the app cannot record a shift or punch for him. His own invoices show the shift: 58 sales
-- from 21:22 to 06:45. Paid from the first to the last invoice, no missing-punch incident, no deduction.
update public.attendance_daily_summary a
set status = 'approved',
    payroll_eligible_hours = 9.38,
    resolution_origin = 'manager',
    review_required = false,
    approved_by = 'owner_decision:2026-11-22',
    approved_by_name = 'قرار المالك',
    approved_at = now(),
    resolved_at = now(),
    approval_note = 'قرار المالك 22/11: البصمات اتقرت غلط (16:04 تحت المراجعة و02:53 اتسجلت حضور). '
      || 'الشيفت من فواتيره: 58 فاتورة من 21:22 لـ 06:45 = 9.38 ساعة. من غير نسيان بصمة ولا خصم',
    resolution_snapshot = coalesce(a.resolution_snapshot, '{}'::jsonb)
      || jsonb_build_object('manager_approved_payroll_eligible_hours', 9.38,
                            'owner_decision_at', '2026-11-22',
                            'hours_evidence', 'own invoices 21:22 → 06:45'),
    updated_at = now()
from public.staff st
where st.id = a.staff_id and btrim(st.name) = 'د احمد حافظ'
  and a.attendance_date = date '2026-10-29' and a.status = 'pending_review';
