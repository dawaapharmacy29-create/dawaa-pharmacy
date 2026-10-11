-- Monthly Evaluation V5: close legacy direct-table access.
-- Canonical reads/writes are authorization-scoped SECURITY DEFINER RPCs.
-- The legacy table policies allowed every authenticated client to bypass those checks.

alter table public.staff_monthly_manager_evaluations enable row level security;

drop policy if exists "staff evaluations authenticated read"
  on public.staff_monthly_manager_evaluations;
drop policy if exists "staff evaluations authenticated write"
  on public.staff_monthly_manager_evaluations;

revoke all on table public.staff_monthly_manager_evaluations from anon, authenticated;
grant all on table public.staff_monthly_manager_evaluations to service_role;

-- Audit is already RPC-only; repeat the boundary here so future grants cannot be
-- mistaken as part of the V5 public contract.
alter table public.staff_monthly_evaluation_audit enable row level security;
revoke all on table public.staff_monthly_evaluation_audit from anon, authenticated;
grant all on table public.staff_monthly_evaluation_audit to service_role;

notify pgrst,'reload schema';
