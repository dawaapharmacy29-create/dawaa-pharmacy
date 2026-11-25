# Database hardening — 2026-11-25

Production project: dawaa-pharmacy-os. Changes applied and verified via Supabase migrations; no business records deleted or changed.

| Change | Verification |
|---|---|
| idx_base44_sync_run_log_ran_at_v1 | Latest timestamp query 90.191 → 3.960 ms; valid index |
| idx_employee_transactions_source_id_status_v1 and idx_conversation_sales_reviews_pending_impact_v1 | Review lookup 489.504 → 11.767 ms; counts unchanged (12, 212); valid indexes |
| compute_app_data_health_v2() scoped work_mem=8MB | Duplicate check warm-cache 207.265 → 137.088 ms; no temp spill; all health counts unchanged |
| RLS and revoke PUBLIC/anon/authenticated on three internal backup tables | No public ordinary tables without RLS; verified anon/authenticated read denied on backups |
| Remove idx_inventory_count_items_session_id_fk | Identical inventory_count_items_session_idx remains valid; no constraint dependencies |

## Reproducibility
Actual live migration versions must be reconciled with the repository before merging any migration files. Do not replay changes under arbitrary new versions. Exact SQL is recorded below for review.

```sql
CREATE INDEX IF NOT EXISTS idx_base44_sync_run_log_ran_at_v1 ON public.base44_sync_run_log (ran_at);
CREATE INDEX IF NOT EXISTS idx_employee_transactions_source_id_status_v1 ON public.employee_transactions (source_id) INCLUDE (status);
CREATE INDEX IF NOT EXISTS idx_conversation_sales_reviews_pending_impact_v1 ON public.conversation_sales_reviews (id) WHERE impact_status='pending';
ALTER FUNCTION public.compute_app_data_health_v2() SET work_mem TO '8MB';
ALTER TABLE public.backup_attendance_null_hours_20261124 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_shift_schedules_mohamed_omar_20261124 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_sales_batch_20261118_1718 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.backup_attendance_null_hours_20261124, public.backup_shift_schedules_mohamed_omar_20261124, public.backup_sales_batch_20261118_1718 FROM PUBLIC, anon, authenticated;
DROP INDEX public.idx_inventory_count_items_session_id_fk;
```

## Rollback
Index additions are reversible via DROP INDEX; recreate the removed index on inventory_count_items(session_id) if required. ALTER FUNCTION public.compute_app_data_health_v2() RESET work_mem restores the prior setting. Do not restore public access to sensitive backups; use authorized administrative recovery instead.

## Remaining work
- Eight security-definer views with anon SELECT grants require session-aware authorization and branch-scope parity tests. Frontend uses a custom verified staff-session header with an anon client; blanket revocation may break valid sessions. Do not expose sensitive data or rely on UI checks alone.
- Cron: 282 failures in inspected 24h, 275 startup timeouts, concentrated before a server restart; 300 later runs with no failures. Investigate infrastructure metrics and recurring timeout patterns; do not assume root cause.
- Attendance queue error 55000 requires explicit manager approval; preserve guard.
- Monthly customer calculation and full-history health scans need bounded incremental design and parity testing.
- Audit trigger already skips identical updates. Preserve financial audit history.
- Full application/browser regression and npm run verify not executed. No claim of overall application speedup.
