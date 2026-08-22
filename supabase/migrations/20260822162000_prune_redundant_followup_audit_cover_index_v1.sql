-- The smaller (branch, created_at desc) index covers branch/date filtering.
-- Keep the global dashboard covering index and the followup history index.

drop index if exists public.customer_followup_audit_log_branch_dashboard_cover_v1;
