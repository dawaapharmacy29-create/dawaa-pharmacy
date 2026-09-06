-- Broader gap found while continuing the doctor-page review: five tables holding
-- per-staff incentive/performance data had *_auth_select/_auth_insert/_auth_update
-- policies with qual/with_check = true -- i.e. open to ANY authenticated account,
-- not just SELECT but INSERT and UPDATE too. Any logged-in staff account (including
-- a pharmacist/doctor) could read every other doctor's individual incentive sales,
-- targets, and audit trail, and could technically insert or edit those rows --
-- fabricating or altering incentive amounts and manager/quarterly review scores.
-- The separate "_admin_all" policy on each table was already correctly gated by
-- is_app_admin() and is left untouched.
--
-- doctor_incentive_sales / doctor_incentive_targets are actively read by the
-- quarterly incentives and staff performance profile screens (gated by
-- view_quarterly_incentives / view_staff_details, which pharmacist does not hold).
-- The other three tables were not referenced by any frontend code at the time of
-- this fix (0 rows in all six tables, likely superseded by the current
-- incentive_cycles/incentive_cycle_staff_snapshots system) but were fixed the same
-- way as a schema hardening before they accumulate data or get wired up again.
--
-- New rule for all five (six tables, quarterly_performance_items scoped via its
-- parent review row):
--   - SELECT: the staff member themselves, or anyone holding view_quarterly_incentives
--     / manage_incentives (covers general_manager/executive_manager/branches_manager
--     via dawaa_current_actor_can's admin short-circuit, plus branch_manager who holds
--     view_quarterly_incentives).
--   - INSERT/UPDATE: manage_incentives holders only (nobody, including the reviewed
--     doctor themselves, can create or edit their own incentive/performance figures).
--
-- APPLIED DIRECTLY TO PRODUCTION on 2026-09-06 via Supabase MCP. This file mirrors
-- that change into version control -- it does not need to be re-applied.

create or replace function public.dawaa_can_read_own_or_privileged_incentive_row_v1(p_staff_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select
    public.dawaa_current_actor_can(array['view_quarterly_incentives', 'manage_incentives'])
    or exists (
      select 1 from public.staff_accounts sa
      where sa.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(sa.active, false)
        and coalesce(sa.can_login, false)
        and (sa.id = p_staff_id or sa.staff_id = p_staff_id::text)
    )
$$;

revoke all on function public.dawaa_can_read_own_or_privileged_incentive_row_v1(uuid) from public;

-- doctor_incentive_sales
drop policy if exists doctor_incentive_sales_auth_select on public.doctor_incentive_sales;
create policy doctor_incentive_sales_select_scoped_v1
on public.doctor_incentive_sales
for select
to authenticated
using (public.dawaa_can_read_own_or_privileged_incentive_row_v1(coalesce(staff_id, doctor_id)));

drop policy if exists doctor_incentive_sales_auth_insert on public.doctor_incentive_sales;
create policy doctor_incentive_sales_insert_privileged_v1
on public.doctor_incentive_sales
for insert
to authenticated
with check (public.dawaa_current_actor_can(array['manage_incentives']));

drop policy if exists doctor_incentive_sales_auth_update on public.doctor_incentive_sales;
create policy doctor_incentive_sales_update_privileged_v1
on public.doctor_incentive_sales
for update
to authenticated
using (public.dawaa_current_actor_can(array['manage_incentives']))
with check (public.dawaa_current_actor_can(array['manage_incentives']));

-- doctor_incentive_targets
drop policy if exists doctor_incentive_targets_auth_select on public.doctor_incentive_targets;
create policy doctor_incentive_targets_select_scoped_v1
on public.doctor_incentive_targets
for select
to authenticated
using (public.dawaa_can_read_own_or_privileged_incentive_row_v1(coalesce(staff_id, doctor_id)));

drop policy if exists doctor_incentive_targets_auth_insert on public.doctor_incentive_targets;
create policy doctor_incentive_targets_insert_privileged_v1
on public.doctor_incentive_targets
for insert
to authenticated
with check (public.dawaa_current_actor_can(array['manage_incentives']));

drop policy if exists doctor_incentive_targets_auth_update on public.doctor_incentive_targets;
create policy doctor_incentive_targets_update_privileged_v1
on public.doctor_incentive_targets
for update
to authenticated
using (public.dawaa_current_actor_can(array['manage_incentives']))
with check (public.dawaa_current_actor_can(array['manage_incentives']));

-- incentive_audit_log
drop policy if exists incentive_audit_log_auth_select on public.incentive_audit_log;
create policy incentive_audit_log_select_scoped_v1
on public.incentive_audit_log
for select
to authenticated
using (public.dawaa_can_read_own_or_privileged_incentive_row_v1(staff_id));

drop policy if exists incentive_audit_log_auth_insert on public.incentive_audit_log;
create policy incentive_audit_log_insert_privileged_v1
on public.incentive_audit_log
for insert
to authenticated
with check (public.dawaa_current_actor_can(array['manage_incentives']));

drop policy if exists incentive_audit_log_auth_update on public.incentive_audit_log;
create policy incentive_audit_log_update_privileged_v1
on public.incentive_audit_log
for update
to authenticated
using (public.dawaa_current_actor_can(array['manage_incentives']))
with check (public.dawaa_current_actor_can(array['manage_incentives']));

-- manager_performance_reviews
drop policy if exists manager_performance_reviews_auth_select on public.manager_performance_reviews;
create policy manager_performance_reviews_select_scoped_v1
on public.manager_performance_reviews
for select
to authenticated
using (public.dawaa_can_read_own_or_privileged_incentive_row_v1(staff_id));

drop policy if exists manager_performance_reviews_auth_insert on public.manager_performance_reviews;
create policy manager_performance_reviews_insert_privileged_v1
on public.manager_performance_reviews
for insert
to authenticated
with check (public.dawaa_current_actor_can(array['manage_incentives']));

drop policy if exists manager_performance_reviews_auth_update on public.manager_performance_reviews;
create policy manager_performance_reviews_update_privileged_v1
on public.manager_performance_reviews
for update
to authenticated
using (public.dawaa_current_actor_can(array['manage_incentives']))
with check (public.dawaa_current_actor_can(array['manage_incentives']));

-- quarterly_performance_reviews
drop policy if exists quarterly_performance_reviews_auth_select on public.quarterly_performance_reviews;
create policy quarterly_performance_reviews_select_scoped_v1
on public.quarterly_performance_reviews
for select
to authenticated
using (public.dawaa_can_read_own_or_privileged_incentive_row_v1(staff_id));

drop policy if exists quarterly_performance_reviews_auth_insert on public.quarterly_performance_reviews;
create policy quarterly_performance_reviews_insert_privileged_v1
on public.quarterly_performance_reviews
for insert
to authenticated
with check (public.dawaa_current_actor_can(array['manage_incentives']));

drop policy if exists quarterly_performance_reviews_auth_update on public.quarterly_performance_reviews;
create policy quarterly_performance_reviews_update_privileged_v1
on public.quarterly_performance_reviews
for update
to authenticated
using (public.dawaa_current_actor_can(array['manage_incentives']))
with check (public.dawaa_current_actor_can(array['manage_incentives']));

-- quarterly_performance_items (no staff_id column directly; scoped via its parent review)
drop policy if exists quarterly_performance_items_auth_select on public.quarterly_performance_items;
create policy quarterly_performance_items_select_scoped_v1
on public.quarterly_performance_items
for select
to authenticated
using (
  exists (
    select 1 from public.quarterly_performance_reviews r
    where r.id = quarterly_performance_items.review_id
      and public.dawaa_can_read_own_or_privileged_incentive_row_v1(r.staff_id)
  )
);

drop policy if exists quarterly_performance_items_auth_insert on public.quarterly_performance_items;
create policy quarterly_performance_items_insert_privileged_v1
on public.quarterly_performance_items
for insert
to authenticated
with check (public.dawaa_current_actor_can(array['manage_incentives']));

drop policy if exists quarterly_performance_items_auth_update on public.quarterly_performance_items;
create policy quarterly_performance_items_update_privileged_v1
on public.quarterly_performance_items
for update
to authenticated
using (public.dawaa_current_actor_can(array['manage_incentives']))
with check (public.dawaa_current_actor_can(array['manage_incentives']));
