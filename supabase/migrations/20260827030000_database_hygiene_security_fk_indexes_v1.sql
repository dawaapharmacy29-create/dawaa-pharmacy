-- Database hygiene v1
-- 1) Close accidental Data API exposure on an internal repair backup.
-- 2) Enable RLS on the remaining public table that has no client grants.
-- 3) Add covering indexes for foreign keys confirmed by the live catalog to have no left-prefix index.
-- 4) Remove only exact duplicate, non-constraint-backed indexes confirmed by pg_get_indexdef.

-- Internal one-off repair snapshot: backend/service-role only.
alter table if exists public.customer_loyalty_repair_backup_20260825 enable row level security;
revoke all privileges on table public.customer_loyalty_repair_backup_20260825 from anon, authenticated;

-- This table currently has no anon/authenticated grants; RLS adds defense in depth.
alter table if exists public.customer_request_staff_attribution_decisions enable row level security;

-- Foreign-key coverage. Single-column FK indexes also serve the leading-column requirement.
create index if not exists idx_biometric_staff_mapping_staff_account_id_fk
  on public.biometric_staff_mapping (staff_account_id);

create index if not exists idx_customer_points_approval_requests_ledger_id_fk
  on public.customer_points_approval_requests (ledger_id);
create index if not exists idx_customer_points_approval_requests_setting_id_fk
  on public.customer_points_approval_requests (setting_id);

create index if not exists idx_customer_request_incentive_events_employee_transaction_id_fk
  on public.customer_request_incentive_events (employee_transaction_id);

create index if not exists idx_customer_request_staff_attr_decisions_reviewed_by_fk
  on public.customer_request_staff_attribution_decisions (reviewed_by_account_id);
create index if not exists idx_customer_request_staff_attr_decisions_staff_id_fk
  on public.customer_request_staff_attribution_decisions (staff_id);

create index if not exists idx_customer_request_sync_inbox_target_request_id_fk
  on public.customer_request_sync_inbox (target_request_id);

create index if not exists idx_customer_requests_source_assigned_staff_id_fk
  on public.customer_requests (source_assigned_staff_id);
create index if not exists idx_customer_requests_source_recorded_staff_id_fk
  on public.customer_requests (source_recorded_staff_id);

create index if not exists idx_customer_service_watchlist_added_by_fk
  on public.customer_service_watchlist (added_by);

create index if not exists idx_daily_checklist_task_responsibility_rule_key_fk
  on public.daily_checklist_task_responsibility (rule_key);

create index if not exists idx_data_cleanup_candidates_archive_run_id_fk
  on public.data_cleanup_candidates (archive_run_id);

create index if not exists idx_doctor_voucher_allocations_credit_movement_id_fk
  on public.doctor_voucher_allocations (credit_movement_id);

create index if not exists idx_pillar_competition_bonuses_winner_staff_id_fk
  on public.pillar_competition_bonuses (winner_staff_id);

create index if not exists idx_point_appeals_event_id_fk
  on public.point_appeals (event_id);

create index if not exists idx_staff_daily_checklist_items_rule_key_on_fail_fk
  on public.staff_daily_checklist_items (rule_key_on_fail);

create index if not exists idx_staff_daily_checklist_submissions_item_id_fk
  on public.staff_daily_checklist_submissions (item_id);
create index if not exists idx_staff_daily_checklist_submissions_reviewed_by_fk
  on public.staff_daily_checklist_submissions (reviewed_by);

create index if not exists idx_warehouse_shortage_dispatch_items_product_id_fk
  on public.warehouse_shortage_dispatch_items (product_id);

-- Exact duplicate indexes: keep the canonical/older names and remove only the redundant copies.
drop index if exists public.idx_customer_metrics_summary_access_branch_v4;
drop index if exists public.idx_customer_requests_product_id;
