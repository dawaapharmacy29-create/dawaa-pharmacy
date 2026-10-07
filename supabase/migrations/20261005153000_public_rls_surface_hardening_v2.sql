-- Public-schema RLS surface hardening V2.
-- Close three Security Advisor errors without changing the intended application contract:
-- 1) SLA policies remain read-only for authenticated users and server-owned for writes.
-- 2) Sales bridge tokens are service-only secrets.
-- 3) Task activity log is an append-only/server-owned audit surface written by SECURITY DEFINER task triggers.

-- -----------------------------------------------------------------------------
-- Notification SLA policies: authenticated read-only, no anonymous access.
-- notification_events_v2_base is security_invoker and intentionally reads this table.
-- -----------------------------------------------------------------------------
alter table public.notification_sla_policies enable row level security;

revoke all on table public.notification_sla_policies from anon;
revoke insert,update,delete,truncate,references,trigger on table public.notification_sla_policies from authenticated;
grant select on table public.notification_sla_policies to authenticated;

drop policy if exists notification_sla_policies_authenticated_read_v2
  on public.notification_sla_policies;
create policy notification_sla_policies_authenticated_read_v2
on public.notification_sla_policies
for select
to authenticated
using (auth.uid() is not null);

-- -----------------------------------------------------------------------------
-- Import bridge tokens: secret capability tokens, never a browser table.
-- The only live database consumer is reconcile_sales_chunk_20260908_bridge(), SECURITY DEFINER.
-- -----------------------------------------------------------------------------
alter table public.sales_import_bridge_tokens_20260908 enable row level security;
revoke all on table public.sales_import_bridge_tokens_20260908 from anon,authenticated;
grant select,insert,update,delete on table public.sales_import_bridge_tokens_20260908 to service_role;

-- -----------------------------------------------------------------------------
-- Task activity log: server-owned audit trail.
-- task_after_write_v2() is SECURITY DEFINER and remains the writer.
-- -----------------------------------------------------------------------------
alter table public.task_activity_log enable row level security;
revoke all on table public.task_activity_log from anon,authenticated;
grant select,insert,update,delete on table public.task_activity_log to service_role;

comment on table public.notification_sla_policies is
  'RLS-protected SLA configuration. Authenticated users may read; writes are server-owned.';
comment on table public.sales_import_bridge_tokens_20260908 is
  'Service-only import bridge capability tokens. Browser access is denied by grants and RLS.';
comment on table public.task_activity_log is
  'Server-owned task audit trail. Written by SECURITY DEFINER task lifecycle triggers; no direct browser DML.';

notify pgrst,'reload schema';
