-- Safe read-hardening stage for the shared employee transaction ledger.
-- Preserve existing application-side row/branch scoping for now, but eliminate
-- unconditional public reads. Fine-grained own/branch/admin row scoping follows
-- after remaining direct readers move to a canonical read model.

drop policy if exists "Allow read employee transactions" on public.employee_transactions;
drop policy if exists employee_transactions_select_app on public.employee_transactions;
drop policy if exists employee_transactions_select_active_actor on public.employee_transactions;

create policy employee_transactions_select_active_actor
on public.employee_transactions
for select
to anon, authenticated
using (public.dawaa_current_staff_account_id_strict() is not null);
