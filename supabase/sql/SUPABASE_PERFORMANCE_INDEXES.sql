-- SUPABASE PERFORMANCE INDEXES
-- Phase 4 — Performance Upgrade
-- Date: 2026-06-16
--
-- IMPORTANT: Review each index before executing.
-- Run EXPLAIN ANALYZE on heavy queries first.
-- These are RECOMMENDED, not automatically applied.
-- Execute only if confirmed safe and documented.

-- ─────────────────────────────────────────────────────────────
-- sales_invoices — Most queried table (dashboard, analytics)
-- ─────────────────────────────────────────────────────────────

-- Enable fast date range filtering (main dashboard query)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_invoices_invoice_date
  ON sales_invoices (invoice_date);

-- Enable fast branch + date filtering (branch performance queries)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_invoices_branch_date
  ON sales_invoices (branch, invoice_date);

-- Enable fast seller + date filtering (doctor performance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_invoices_seller_date
  ON sales_invoices (seller_name, invoice_date);

-- Enable fast customer lookup (customer history)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_invoices_customer_code
  ON sales_invoices (customer_code);

-- ─────────────────────────────────────────────────────────────
-- daily_followups — Customer service queue
-- ─────────────────────────────────────────────────────────────

-- Enable fast date filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_followups_date
  ON daily_followups (followup_date);

-- Enable fast branch + date filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_followups_branch_date
  ON daily_followups (branch, followup_date);

-- Enable fast responsible person filtering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_followups_responsible_date
  ON daily_followups (responsible_name, followup_date);

-- ─────────────────────────────────────────────────────────────
-- points_transactions — Staff points queries
-- ─────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_points_transactions_staff_cycle
  ON points_transactions (staff_id, cycle_start);

-- ─────────────────────────────────────────────────────────────
-- point_records — Legacy points table
-- ─────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_point_records_staff_created
  ON point_records (staff_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- customers — Customer search
-- ─────────────────────────────────────────────────────────────

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_customer_code
  ON customers (customer_code);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_phone
  ON customers (phone);

-- Full-text search on customer name (Arabic-aware)
-- Use only if Postgres version >= 12 and pg_trgm extension is enabled
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_name_trgm
--   ON customers USING GIN (name gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES
-- Run these after creating indexes to confirm they're being used
-- ─────────────────────────────────────────────────────────────

-- EXPLAIN ANALYZE
-- SELECT * FROM sales_invoices
-- WHERE invoice_date >= '2026-05-26' AND invoice_date < '2026-06-26'
-- AND branch = 'فرع شكري';
