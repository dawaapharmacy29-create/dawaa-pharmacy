-- Restore safe read access to the followup audit log.
-- The table has RLS enabled in production; without an explicit policy and grants,
-- customer service and management pages fail with "permission denied".

grant select on public.customer_followup_audit_log to anon, authenticated;

alter table public.customer_followup_audit_log enable row level security;

drop policy if exists customer_followup_audit_log_select_scope on public.customer_followup_audit_log;
create policy customer_followup_audit_log_select_scope
on public.customer_followup_audit_log
for select
to anon, authenticated
using (
  public.dawaa_can_access_customer_intelligence_branch(coalesce(branch, ''))
);
