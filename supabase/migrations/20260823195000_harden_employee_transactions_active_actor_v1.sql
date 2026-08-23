-- First safe hardening step for the shared employee transaction ledger.
-- Keep existing read behavior for now because several screens still read the
-- ledger directly and scope rows in application code. Writes must no longer be
-- unconditional public/anon operations: they require a canonical active staff
-- actor. Fine-grained source/permission authorization follows after each
-- transitional direct writer is migrated behind the canonical write boundary.

drop policy if exists "Allow insert employee transactions" on public.employee_transactions;
drop policy if exists employee_transactions_insert_app on public.employee_transactions;
drop policy if exists employee_transactions_insert_active_actor on public.employee_transactions;

create policy employee_transactions_insert_active_actor
on public.employee_transactions
for insert
to anon, authenticated
with check (public.dawaa_current_staff_account_id_strict() is not null);

drop policy if exists "Allow update employee transactions" on public.employee_transactions;
drop policy if exists employee_transactions_update_app on public.employee_transactions;
drop policy if exists employee_transactions_update_active_actor on public.employee_transactions;

create policy employee_transactions_update_active_actor
on public.employee_transactions
for update
to anon, authenticated
using (public.dawaa_current_staff_account_id_strict() is not null)
with check (public.dawaa_current_staff_account_id_strict() is not null);
