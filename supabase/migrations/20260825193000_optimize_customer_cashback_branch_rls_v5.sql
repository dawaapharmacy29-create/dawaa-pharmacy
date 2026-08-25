begin;

create or replace function public.dawaa_customer_points_allowed_branches_v1(p_manage boolean default false)
returns text[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with me as (
    select a.role, a.branch, a.permissions
    from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active,false)=true
      and coalesce(a.can_login,false)=true
    limit 1
  ), allowed as (
    select
      lower(coalesce(role,'')) as role,
      trim(coalesce(branch,'')) as branch,
      permissions,
      case when p_manage then
        lower(coalesce(role,'')) in ('admin','general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager','customer_service')
        or coalesce((permissions->>'manage_cashback')::boolean,false)
        or coalesce((permissions->>'view_customer_service')::boolean,false)
      else
        lower(coalesce(role,'')) in ('admin','general_manager','executive_manager','branches_manager','branch_manager','customer_service_manager','customer_service','pharmacist','shift_supervisor_morning','shift_supervisor_evening')
        or coalesce((permissions->>'view_customers')::boolean,false)
        or coalesce((permissions->>'view_customer_service')::boolean,false)
        or coalesce((permissions->>'view_cashback')::boolean,false)
      end as permitted
    from me
  )
  select case
    when not coalesce((select permitted from allowed), false) then array[]::text[]
    when coalesce((select role from allowed),'') in ('admin','general_manager','executive_manager','branches_manager') then
      coalesce((
        select array_agg(distinct trim(a.branch))
        from public.staff_accounts a
        where coalesce(a.active,false)=true
          and trim(coalesce(a.branch,'')) <> ''
      ), array[]::text[])
    else array[(select branch from allowed)]
  end
$function$;

revoke all on function public.dawaa_customer_points_allowed_branches_v1(boolean) from public;
grant execute on function public.dawaa_customer_points_allowed_branches_v1(boolean) to anon, authenticated;

drop policy if exists customer_cashback_cycles_admin_all on public.customer_cashback_cycles;
drop policy if exists customer_cashback_cycles_branch_select_v4 on public.customer_cashback_cycles;
drop policy if exists customer_cashback_cycles_branch_insert_v4 on public.customer_cashback_cycles;
drop policy if exists customer_cashback_cycles_branch_update_v4 on public.customer_cashback_cycles;

create policy customer_cashback_cycles_branch_select_v5
on public.customer_cashback_cycles
for select to anon, authenticated
using (branch = any(array(select unnest(public.dawaa_customer_points_allowed_branches_v1(false)))));

create policy customer_cashback_cycles_branch_insert_v5
on public.customer_cashback_cycles
for insert to anon, authenticated
with check (branch = any(array(select unnest(public.dawaa_customer_points_allowed_branches_v1(true)))));

create policy customer_cashback_cycles_branch_update_v5
on public.customer_cashback_cycles
for update to anon, authenticated
using (branch = any(array(select unnest(public.dawaa_customer_points_allowed_branches_v1(true)))))
with check (branch = any(array(select unnest(public.dawaa_customer_points_allowed_branches_v1(true)))));

drop policy if exists customer_cashback_accounts_admin_all on public.customer_cashback_accounts;
drop policy if exists customer_cashback_accounts_branch_select_v4 on public.customer_cashback_accounts;
drop policy if exists customer_cashback_accounts_branch_insert_v4 on public.customer_cashback_accounts;
drop policy if exists customer_cashback_accounts_branch_update_v4 on public.customer_cashback_accounts;

create policy customer_cashback_accounts_branch_select_v5
on public.customer_cashback_accounts
for select to anon, authenticated
using (branch = any(array(select unnest(public.dawaa_customer_points_allowed_branches_v1(false)))));

create policy customer_cashback_accounts_branch_insert_v5
on public.customer_cashback_accounts
for insert to anon, authenticated
with check (branch = any(array(select unnest(public.dawaa_customer_points_allowed_branches_v1(true)))));

create policy customer_cashback_accounts_branch_update_v5
on public.customer_cashback_accounts
for update to anon, authenticated
using (branch = any(array(select unnest(public.dawaa_customer_points_allowed_branches_v1(true)))))
with check (branch = any(array(select unnest(public.dawaa_customer_points_allowed_branches_v1(true)))));

notify pgrst, 'reload schema';
commit;
