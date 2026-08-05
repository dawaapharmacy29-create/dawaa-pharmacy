-- ═══════════════════════════════════════════════════════════════
  -- DAWAA - PERFORMANCE INDEXES (READY TO RUN)
  -- Generated: 2026-06-17
  -- 
  -- HOW TO APPLY:
  --   1. Open your Supabase project → SQL Editor
  --   2. Paste this entire file and click Run
  --   3. Each index is CONCURRENT — no table locks, safe on production
  --   4. One-time operation — already applied indexes are skipped automatically
  -- ═══════════════════════════════════════════════════════════════

  -- ─────────────────────────────────────────────────────────────
  -- sales_invoices — Most queried table (dashboard, analytics, staff perf)
  -- ─────────────────────────────────────────────────────────────

  -- Date range queries (most common dashboard filter)
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_si_date_branch
    ON sales_invoices (invoice_date, branch);

  -- Seller performance queries
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_si_seller_date
    ON sales_invoices (seller_name, invoice_date);

  -- Customer history queries
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_si_customer_code_date
    ON sales_invoices (customer_code, invoice_date);

  -- Branch + date range (used in daily/monthly analytics)
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_si_branch_date
    ON sales_invoices (branch, invoice_date DESC);

  -- Invoice number lookups
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_si_invoice_no
    ON sales_invoices (invoice_no);

  -- ─────────────────────────────────────────────────────────────
  -- employees / staff — Team management queries
  -- ─────────────────────────────────────────────────────────────

  -- Active staff by branch (main team page query)
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_branch_status
    ON employees (branch, status)
    WHERE status = 'active';

  -- Staff name search
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_staff_name_trgm
    ON employees USING gin (name gin_trgm_ops);

  -- ─────────────────────────────────────────────────────────────
  -- customers — Customer management queries
  -- ─────────────────────────────────────────────────────────────

  -- Branch filter (most common customer query)
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_branch
    ON customers (branch);

  -- Retention status filter
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_retention
    ON customers (retention_status, branch);

  -- Last purchase (at-risk filtering)
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_last_purchase
    ON customers (last_purchase DESC NULLS LAST);

  -- Phone lookup (search)
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_phone
    ON customers (phone);

  -- ─────────────────────────────────────────────────────────────
  -- employee_transactions / points_ledger — Points & incentives
  -- ─────────────────────────────────────────────────────────────

  -- Staff transactions by cycle (incentive calculations)
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emp_tx_staff_cycle
    ON employee_transactions (staff_id, month_cycle);

  -- Employee name + cycle (fallback when no staff_id)
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emp_tx_name_cycle
    ON employee_transactions (employee_name, month_cycle);

  -- ─────────────────────────────────────────────────────────────
  -- shift_schedules — Attendance and shift queries
  -- ─────────────────────────────────────────────────────────────

  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_staff_day
    ON shift_schedules (staff_id, day_name);

  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_shifts_branch
    ON shift_schedules (branch, day_name);

  -- ─────────────────────────────────────────────────────────────
  -- followups / customer_followups — CRM queries  
  -- ─────────────────────────────────────────────────────────────

  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_followups_date_branch
    ON followups (followup_date DESC, branch);

  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_followups_customer
    ON followups (customer_id, followup_date DESC);

  -- ═══════════════════════════════════════════════════════════════
  -- Note: If you get "extension does not exist" for gin_trgm_ops,
  -- run this first: CREATE EXTENSION IF NOT EXISTS pg_trgm;
  -- ═══════════════════════════════════════════════════════════════
  