-- Owner decision 2026-11-23: د اسلام فاروق's weekly day off is Thursday (as it was before his suspension). The
-- Thursday row of his new 19:00 → 05:00 schedule (from 21/11) becomes a day off. The first Thursday on it is
-- 26/11, so no day already read changes.
update public.shift_schedules
set shift_start = null, shift_end = null, start_time = null, end_time = null, hours = 0,
    is_off = true, is_day_off = true, is_different = false, has_custom_time = false,
    notes = 'قرار المالك 23/11: الإجازة الأسبوعية الخميس', updated_at = now()
where staff_id = '3b2f682d-be41-4374-a0b8-25411ee6e8d3' and shift_date is null and date is null
  and trim(day_name) = 'الخميس' and effective_from = date '2026-11-21' and effective_to is null
  and source = 'dr_wael_smart_shift_v1';
