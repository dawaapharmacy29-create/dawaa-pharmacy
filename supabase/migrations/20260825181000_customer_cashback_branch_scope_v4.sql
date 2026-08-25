begin;

-- Scope customer cashback cycles to the current Dawaa staff branch.
drop policy if exists customer_cashback_cycles_auth_insert on public.customer_cashback_cycles;
drop policy if exists customer_cashback_cycles_auth_select on public.customer_cashback_cycles;
drop policy if exists customer_cashback_cycles_auth_update on public.customer_cashback_cycles;
drop policy if exists customer_cashback_cycles_insert_app on public.customer_cashback_cycles;
drop policy if exists customer_cashback_cycles_select_app on public.customer_cashback_cycles;
drop policy if exists customer_cashback_cycles_update_app on public.customer_cashback_cycles;

create policy customer_cashback_cycles_branch_select_v4
on public.customer_cashback_cycles
for select to anon, authenticated
using (public.dawaa_can_access_customer_points_branch_v1(branch,false));

create policy customer_cashback_cycles_branch_insert_v4
on public.customer_cashback_cycles
for insert to anon, authenticated
with check (public.dawaa_can_access_customer_points_branch_v1(branch,true));

create policy customer_cashback_cycles_branch_update_v4
on public.customer_cashback_cycles
for update to anon, authenticated
using (public.dawaa_can_access_customer_points_branch_v1(branch,true))
with check (public.dawaa_can_access_customer_points_branch_v1(branch,true));

-- Scope cashback account settings to the same branch boundary.
drop policy if exists customer_cashback_accounts_auth_insert on public.customer_cashback_accounts;
drop policy if exists customer_cashback_accounts_auth_select on public.customer_cashback_accounts;
drop policy if exists customer_cashback_accounts_auth_update on public.customer_cashback_accounts;
drop policy if exists customer_cashback_accounts_insert_app on public.customer_cashback_accounts;
drop policy if exists customer_cashback_accounts_select_app on public.customer_cashback_accounts;
drop policy if exists customer_cashback_accounts_update_app on public.customer_cashback_accounts;

create policy customer_cashback_accounts_branch_select_v4
on public.customer_cashback_accounts
for select to anon, authenticated
using (public.dawaa_can_access_customer_points_branch_v1(branch,false));

create policy customer_cashback_accounts_branch_insert_v4
on public.customer_cashback_accounts
for insert to anon, authenticated
with check (public.dawaa_can_access_customer_points_branch_v1(branch,true));

create policy customer_cashback_accounts_branch_update_v4
on public.customer_cashback_accounts
for update to anon, authenticated
using (public.dawaa_can_access_customer_points_branch_v1(branch,true))
with check (public.dawaa_can_access_customer_points_branch_v1(branch,true));

-- Events do not have a branch column; inherit access from their owning cashback cycle.
drop policy if exists customer_cashback_events_insert_app on public.customer_cashback_events;
drop policy if exists customer_cashback_events_select_app on public.customer_cashback_events;
drop policy if exists customer_cashback_events_update_app on public.customer_cashback_events;

create policy customer_cashback_events_branch_select_v4
on public.customer_cashback_events
for select to anon, authenticated
using (
  exists (
    select 1
    from public.customer_cashback_cycles c
    where c.id = coalesce(customer_cashback_events.cashback_cycle_id, customer_cashback_events.cycle_id)
      and public.dawaa_can_access_customer_points_branch_v1(c.branch,false)
  )
);

create policy customer_cashback_events_branch_insert_v4
on public.customer_cashback_events
for insert to anon, authenticated
with check (
  exists (
    select 1
    from public.customer_cashback_cycles c
    where c.id = coalesce(customer_cashback_events.cashback_cycle_id, customer_cashback_events.cycle_id)
      and public.dawaa_can_access_customer_points_branch_v1(c.branch,true)
  )
);

create policy customer_cashback_events_branch_update_v4
on public.customer_cashback_events
for update to anon, authenticated
using (
  exists (
    select 1
    from public.customer_cashback_cycles c
    where c.id = coalesce(customer_cashback_events.cashback_cycle_id, customer_cashback_events.cycle_id)
      and public.dawaa_can_access_customer_points_branch_v1(c.branch,true)
  )
)
with check (
  exists (
    select 1
    from public.customer_cashback_cycles c
    where c.id = coalesce(customer_cashback_events.cashback_cycle_id, customer_cashback_events.cycle_id)
      and public.dawaa_can_access_customer_points_branch_v1(c.branch,true)
  )
);

notify pgrst, 'reload schema';
commit;
