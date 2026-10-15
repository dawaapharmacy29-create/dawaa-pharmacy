-- Covering partial index for get_invoice_data_health_v1's missing-classification reads under RLS.
--
-- Production evidence (2026-10-15, EXPLAIN ANALYZE as anon, read-only): get_invoice_data_health_v1 is a
-- SECURITY INVOKER read, so the sales_invoices policy (actor scope as InitPlans, then branch = scope) applies.
-- The existing partial index idx_sales_invoices_health_missing_classification_v1 does not contain `branch`, so
-- every one of the ~65.5k rows matching "customer_segment is null and customer_type is null" needed a heap
-- fetch to evaluate the policy: class_count fell back to a Seq Scan of the 157 MB heap (6.0 s) and class_sample
-- walked the partial index with heap fetches (27.6 s); the RPC hit the statement timeout (HTTP 500, ~31 s).
--
-- This index carries `branch`, so both reads can be answered by an index-only scan when the visibility map is
-- current. Index only: no data change, no policy or function change, no behavior change. The existing index is
-- kept. Note for apply: a plain CREATE INDEX holds a SHARE lock on sales_invoices (writes wait) for the build;
-- the partial index covers ~65k rows. The visibility map also needs a VACUUM (ANALYZE) of sales_invoices
-- (11,360 heap fetches on the branch index-only count) — an operational step, not part of this migration.

create index if not exists idx_sales_invoices_health_missing_classification_branch_v1
  on public.sales_invoices (id) include (branch)
  where customer_segment is null and customer_type is null;
