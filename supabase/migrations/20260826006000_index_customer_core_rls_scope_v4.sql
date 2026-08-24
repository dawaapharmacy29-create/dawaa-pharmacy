-- Make customer RLS index-friendly: resolve one canonical branch once, then compare directly.
create or replace function public.dawaa_current_customer_core_scope_v2(p_permissions text[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_role text;
  v_branch_key text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not public.dawaa_current_actor_can(p_permissions) then return 'NONE'; end if;

  select pg_catalog.lower(pg_catalog.btrim(coalesce(sa.role, ''))),
         public.dawaa_customer_request_branch_key(sa.branch)
    into v_role, v_branch_key
  from public.staff_accounts sa
  where sa.id = v_actor_id and coalesce(sa.active, false) and coalesce(sa.can_login, false)
  limit 1;

  if not found then return 'NONE'; end if;
  if v_role in ('general_manager', 'executive_manager', 'branches_manager', 'admin') then return 'ALL'; end if;
  if v_branch_key = 'shokry' then return 'فرع شكري'; end if;
  if v_branch_key = 'elshamy' then return 'فرع الشامي'; end if;
  return 'NONE';
end;
$$;

create or replace function public.dawaa_current_customer_read_scope_v4()
returns text language sql stable security definer set search_path = '' as $$
  select public.dawaa_current_customer_core_scope_v2(array[
    'view_customers','view_customer_details','view_customer_360','view_customer_service',
    'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
    'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
    'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
  ])
$$;

create or replace function public.dawaa_current_customer_write_scope_v4()
returns text language sql stable security definer set search_path = '' as $$
  select public.dawaa_current_customer_core_scope_v2(
    array['create_customer','edit_customer','import_customers','import_sales_invoices','view_customer_service']
  )
$$;

create index if not exists idx_customers_access_branch_v4
  on public.customers ((coalesce(effective_branch, branch)));
create index if not exists idx_customer_metrics_summary_access_branch_v4
  on public.customer_metrics_summary (branch);

drop policy if exists customers_core_scoped_select on public.customers;
drop policy if exists customers_core_scoped_insert on public.customers;
drop policy if exists customers_core_scoped_update on public.customers;
drop policy if exists customer_metrics_summary_core_scoped_select on public.customer_metrics_summary;

create policy customers_core_scoped_select
on public.customers for select to anon, authenticated
using (
  (select public.dawaa_current_customer_read_scope_v4()) = 'ALL'
  or (
    (select public.dawaa_current_customer_read_scope_v4()) <> 'NONE'
    and (
      coalesce(effective_branch, branch) is null
      or coalesce(effective_branch, branch) in ('متعدد الفروع','كل الفروع','all')
      or coalesce(effective_branch, branch) = (select public.dawaa_current_customer_read_scope_v4())
    )
  )
);

create policy customers_core_scoped_insert
on public.customers for insert to anon, authenticated
with check (
  (select public.dawaa_current_customer_write_scope_v4()) = 'ALL'
  or (
    (select public.dawaa_current_customer_write_scope_v4()) <> 'NONE'
    and (
      coalesce(effective_branch, branch) is null
      or coalesce(effective_branch, branch) in ('متعدد الفروع','كل الفروع','all')
      or coalesce(effective_branch, branch) = (select public.dawaa_current_customer_write_scope_v4())
    )
  )
);

create policy customers_core_scoped_update
on public.customers for update to anon, authenticated
using (
  (select public.dawaa_current_customer_write_scope_v4()) = 'ALL'
  or (
    (select public.dawaa_current_customer_write_scope_v4()) <> 'NONE'
    and (
      coalesce(effective_branch, branch) is null
      or coalesce(effective_branch, branch) in ('متعدد الفروع','كل الفروع','all')
      or coalesce(effective_branch, branch) = (select public.dawaa_current_customer_write_scope_v4())
    )
  )
)
with check (
  (select public.dawaa_current_customer_write_scope_v4()) = 'ALL'
  or (
    (select public.dawaa_current_customer_write_scope_v4()) <> 'NONE'
    and (
      coalesce(effective_branch, branch) is null
      or coalesce(effective_branch, branch) in ('متعدد الفروع','كل الفروع','all')
      or coalesce(effective_branch, branch) = (select public.dawaa_current_customer_write_scope_v4())
    )
  )
);

create policy customer_metrics_summary_core_scoped_select
on public.customer_metrics_summary for select to anon, authenticated
using (
  (select public.dawaa_current_customer_read_scope_v4()) = 'ALL'
  or (
    (select public.dawaa_current_customer_read_scope_v4()) <> 'NONE'
    and (
      branch is null or branch in ('متعدد الفروع','كل الفروع','all')
      or branch = (select public.dawaa_current_customer_read_scope_v4())
    )
  )
);

revoke all on function public.dawaa_current_customer_read_scope_v4() from public;
revoke all on function public.dawaa_current_customer_write_scope_v4() from public;
grant execute on function public.dawaa_current_customer_read_scope_v4() to anon, authenticated, service_role;
grant execute on function public.dawaa_current_customer_write_scope_v4() to anon, authenticated, service_role;

