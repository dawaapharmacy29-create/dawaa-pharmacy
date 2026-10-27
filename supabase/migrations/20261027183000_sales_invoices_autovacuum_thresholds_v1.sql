-- sales_invoices: let autovacuum actually run. Storage parameters only; no data change.
--
-- Production (2026-10-27): sales_invoices has never been vacuumed (last_autovacuum
-- null, autovacuum_count 0). With the default 20% scale factors on 81,091 rows,
-- autovacuum needs > 16,268 dead tuples or > 17,218 inserts since the last vacuum;
-- the table had 12,748 dead tuples and 3,611 inserts, so the thresholds are never met
-- by daily imports and sync updates. Result: only 70.3% of heap pages are all-visible,
-- so the dashboard's index-only scans fetch heap pages (e.g. 7,760 heap fetches for
-- October), and a cold dashboard RPC read takes seconds (doctor sales 4,248 ms cold
-- vs 95 ms warm on the same call).
--
-- 2% scale factors (~1,670 dead tuples / ~2,620 inserts) keep the visibility map
-- current. Autovacuum is non-blocking (SHARE UPDATE EXCLUSIVE): reads, inserts and
-- updates continue while it runs.

alter table public.sales_invoices set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.02
);
