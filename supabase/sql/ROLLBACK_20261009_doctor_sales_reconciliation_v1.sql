-- Rollback for 20261009090000_doctor_sales_reconciliation_v1 (reference only; run only with approval).
-- None of these objects existed in production before this migration (the peer comparison was never applied;
-- 20261008090000 is retired), so rollback removes all of them and the Eye returns to its "not enabled" state.
-- No existing data is touched: the migration never wrote to sales_invoices, biometric_attendance_logs,
-- attendance_daily_summary or conversation reviews.
begin;
drop function if exists public.get_branch_doctor_performance_window_v1(text, date, date);
drop function if exists public.get_doctor_sales_reconciliation_v1(uuid, date, date);
drop function if exists public.dawaa_doctor_sales_reconciliation_v1(uuid[], text, date, date);
drop function if exists public.dawaa_doctor_attendance_days_v1(uuid[], date, date);
drop table if exists public.biometric_device_branches;
commit;
