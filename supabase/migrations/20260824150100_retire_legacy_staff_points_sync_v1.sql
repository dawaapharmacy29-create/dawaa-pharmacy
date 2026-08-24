-- Retire the pre-ledger snapshot synchronizer.
--
-- employee_transactions is the canonical points ledger and
-- dawaa_refresh_staff_points_snapshot_v1 is its database-owned projection.
-- This legacy function referenced the removed point_records table and was
-- executable by public/anon roles in Production.

drop function if exists public.sync_staff_points_balance(text, text, text);
