-- Rollback for 20261009090000_doctor_sales_reconciliation_v1 (reference only; run only with approval).
-- 1. Restore the previous peer-comparison body: re-run supabase/migrations/20261008090000_branch_doctor_performance_window_v1.sql
--    (or drop the function if 20261008090000 was never applied).
-- 2. Remove the new read model (no data rows outside the device registry are written by this migration):
drop function if exists public.get_doctor_sales_reconciliation_v1(uuid, date, date);
drop function if exists public.dawaa_doctor_sales_reconciliation_v1(uuid[], text, date, date);
drop function if exists public.dawaa_doctor_attendance_days_v1(uuid[], date, date);
drop table if exists public.biometric_device_branches;
