drop index if exists public.idx_delivery_payroll_rate_bands_policy;

create index if not exists idx_delivery_payroll_sync_audit_cycle_created
  on public.delivery_payroll_sync_audit_v1(month_cycle, created_at desc);
