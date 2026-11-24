-- Owner decision 2026-11-24: a rider is classified on the days actually attended, not only after 26 days. The
-- committed / regular credits are already per attended day (5 and 30 minutes), so the band scales with the days;
-- only the 26-day gate is removed. Before this, every rider below 26 days had no band, so no hourly, order or trip
-- rate (trip rate 0 for أحمد رمضان, محمود القطري, محمد حجازي and others).
update public.delivery_payroll_policy_versions
set min_attended_days = 1,
    notes = notes || ' | 2026-11-24: التصنيف على أيام الحضور الفعلية (حد أدنى يوم واحد) بقرار الإدارة، بدل شرط 26 يوم.',
    updated_at = now()
where policy_code = 'delivery_salary_v1' and active and min_attended_days <> 1;
