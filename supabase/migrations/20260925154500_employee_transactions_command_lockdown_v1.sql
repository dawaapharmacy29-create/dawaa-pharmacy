-- Employee transactions command-only lockdown V1.
-- The app may read through scoped RLS, but all ledger mutations must go through
-- authorization-aware SECURITY DEFINER commands.

revoke insert,update,delete on table public.employee_transactions
  from public,anon,authenticated;

drop policy if exists employee_transactions_insert_source_authorized
  on public.employee_transactions;
drop policy if exists employee_transactions_update_source_authorized
  on public.employee_transactions;

comment on table public.employee_transactions
  is 'Canonical employee points/incentive ledger. Application mutation is command-only; direct INSERT/UPDATE/DELETE is revoked.';
