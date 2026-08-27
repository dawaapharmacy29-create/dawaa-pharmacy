-- Architecture Hardening V5
-- These archive tables are historical snapshots only. The live points system writes through
-- record_employee_points_transaction_v3 / canonical employee_transactions. No client path
-- should read or mutate these legacy archives.

revoke all privileges on table public.archive_point_records_2026 from anon, authenticated;
revoke all privileges on table public.archive_points_transactions_2026 from anon, authenticated;

-- Remove obsolete client-facing RLS policies to eliminate stale alternate access paths.
drop policy if exists "Allow anon insert point records" on public.archive_point_records_2026;
drop policy if exists "Allow anon read point records" on public.archive_point_records_2026;
drop policy if exists "Allow anon update point records" on public.archive_point_records_2026;
drop policy if exists archive_point_records_2026_insert_app on public.archive_point_records_2026;
drop policy if exists archive_point_records_2026_select_app on public.archive_point_records_2026;
drop policy if exists archive_point_records_2026_update_app on public.archive_point_records_2026;
drop policy if exists point_records_client_read on public.archive_point_records_2026;

drop policy if exists "Allow anon insert points transactions" on public.archive_points_transactions_2026;
drop policy if exists "Allow anon read points transactions" on public.archive_points_transactions_2026;
drop policy if exists "Allow anon update points transactions" on public.archive_points_transactions_2026;
drop policy if exists archive_points_transactions_2026_insert_app on public.archive_points_transactions_2026;
drop policy if exists archive_points_transactions_2026_select_app on public.archive_points_transactions_2026;
drop policy if exists archive_points_transactions_2026_update_app on public.archive_points_transactions_2026;
drop policy if exists points_transactions_client_read on public.archive_points_transactions_2026;

alter table public.archive_point_records_2026 enable row level security;
alter table public.archive_points_transactions_2026 enable row level security;
