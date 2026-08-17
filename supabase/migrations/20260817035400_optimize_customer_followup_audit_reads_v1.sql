-- Speed up the live customer follow-up cockpit audit feed.
-- The UI selects the latest 5,000 audit rows (and branch-filtered variants).
-- Existing indexes still required heap fetches for every selected row because
-- metadata and display columns were not covered. These covering indexes allow
-- index-only reads while preserving the exact table/query behavior.

create index if not exists customer_followup_audit_log_dashboard_cover_v1
on public.customer_followup_audit_log (created_at desc)
include (id, followup_id, action, actor_name, branch, metadata);

create index if not exists customer_followup_audit_log_branch_dashboard_cover_v1
on public.customer_followup_audit_log (branch, created_at desc)
include (id, followup_id, action, actor_name, metadata);

analyze public.customer_followup_audit_log;
