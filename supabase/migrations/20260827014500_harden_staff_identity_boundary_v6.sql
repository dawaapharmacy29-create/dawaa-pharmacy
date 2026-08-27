-- Architecture Hardening V6
-- `staff` is a core identity/directory table. Historical policies allowed anon/authenticated
-- clients to SELECT/INSERT/UPDATE every row with `true`. Replace those duplicate permissive
-- policies with one authenticated application-actor read boundary and one manage-staff write
-- boundary. Custom app sessions are supported through dawaa_current_staff_id_v1().

alter table public.staff enable row level security;

-- Remove all historical broad policies.
drop policy if exists "Allow anon insert staff" on public.staff;
drop policy if exists "Allow insert staff" on public.staff;
drop policy if exists staff_insert_app on public.staff;
drop policy if exists "Allow anon read staff" on public.staff;
drop policy if exists "Allow read staff" on public.staff;
drop policy if exists staff_select_app on public.staff;
drop policy if exists "Allow anon update staff" on public.staff;
drop policy if exists "Allow update staff" on public.staff;
drop policy if exists staff_update_app on public.staff;

-- Directory reads require a real signed-in application actor. This still works for the
-- custom x-dawaa-user-id session because dawaa_current_staff_id_v1 resolves staff_accounts.
create policy staff_actor_read_v6
on public.staff
for select
to anon, authenticated
using (public.dawaa_current_staff_id_v1() is not null);

-- Staff mutations are administrative commands even when the UI still uses the table API.
-- Authorization is centralized in the same permission helper used by staff-account management.
create policy staff_manager_insert_v6
on public.staff
for insert
to anon, authenticated
with check (public.dawaa_can_manage_staff());

create policy staff_manager_update_v6
on public.staff
for update
to anon, authenticated
using (public.dawaa_can_manage_staff())
with check (public.dawaa_can_manage_staff());

-- No direct DELETE policy on purpose. Archiving/deactivation should remain the operational
-- lifecycle so historical references are not orphaned.
