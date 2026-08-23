-- Runtime index for branch-scoped employee ledger/report reads.
-- The canonical employeeTransactionReadModel pushes branch + created_at filters to PostgreSQL.
-- This composite index prevents cross-branch ledger scans for points/incentive reports.

create index if not exists idx_employee_transactions_branch_created_at
  on public.employee_transactions (branch, created_at desc);
