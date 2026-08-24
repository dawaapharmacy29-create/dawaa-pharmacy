-- Protect canonical customer identity and its metrics projection.
-- Known branches are isolated; unresolved/multi-branch identities remain shared
-- between authorized staff until the data-quality backlog is resolved.

create or replace function public.dawaa_can_access_customer_core_branch_v1(
  p_permissions text[],
  p_branch text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_role text;
  v_actor_branch text;
  v_data_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not public.dawaa_current_actor_can(p_permissions) then
    return false;
  end if;

  select lower(pg_catalog.btrim(pg_catalog.coalesce(sa.role, ''))), sa.branch
    into v_role, v_actor_branch
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and pg_catalog.coalesce(sa.active, false)
    and pg_catalog.coalesce(sa.can_login, false)
  limit 1;

  if not found then return false; end if;
  if v_role in ('general_manager', 'executive_manager', 'branches_manager', 'admin') then
    return true;
  end if;

  v_data_branch := public.dawaa_customer_request_branch_key(p_branch);
  if v_data_branch is null
     or lower(pg_catalog.btrim(pg_catalog.coalesce(p_branch, ''))) in ('متعدد الفروع', 'كل الفروع', 'all') then
    return true;
  end if;

  return public.dawaa_customer_request_branch_key(v_actor_branch) is not null
    and public.dawaa_customer_request_branch_key(v_actor_branch) = v_data_branch;
end;
$$;

alter table public.customers enable row level security;
alter table public.customer_metrics_summary enable row level security;

drop policy if exists "Enable insert for all users" on public.customers;
drop policy if exists "Enable read access for all users" on public.customers;
drop policy if exists "Enable update for all users" on public.customers;
drop policy if exists customers_branch_select on public.customers;
drop policy if exists customers_branch_update on public.customers;
drop policy if exists customers_branch_write on public.customers;
drop policy if exists customers_client_read on public.customers;
drop policy if exists customers_insert_app on public.customers;
drop policy if exists customers_select_app on public.customers;
drop policy if exists customers_update_app on public.customers;

create policy customers_core_scoped_select
on public.customers for select to anon, authenticated
using (
  public.dawaa_can_access_customer_core_branch_v1(
    array[
      'view_customers','view_customer_details','view_customer_360','view_customer_service',
      'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
      'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
      'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
    ],
    coalesce(effective_branch, branch)
  )
);

create policy customers_core_scoped_insert
on public.customers for insert to anon, authenticated
with check (
  public.dawaa_can_access_customer_core_branch_v1(
    array['create_customer','edit_customer','import_customers','import_sales_invoices','view_customer_service'],
    coalesce(effective_branch, branch)
  )
);

create policy customers_core_scoped_update
on public.customers for update to anon, authenticated
using (
  public.dawaa_can_access_customer_core_branch_v1(
    array['edit_customer','import_customers','import_sales_invoices','view_customer_service'],
    coalesce(effective_branch, branch)
  )
)
with check (
  public.dawaa_can_access_customer_core_branch_v1(
    array['edit_customer','import_customers','import_sales_invoices','view_customer_service'],
    coalesce(effective_branch, branch)
  )
);

-- No client delete/truncate path exists for canonical customer identity.
revoke delete, truncate on public.customers from anon, authenticated;

drop policy if exists customer_metrics_summary_admin_all on public.customer_metrics_summary;
drop policy if exists customer_metrics_summary_anon_select on public.customer_metrics_summary;
drop policy if exists customer_metrics_summary_auth_insert on public.customer_metrics_summary;
drop policy if exists customer_metrics_summary_auth_select on public.customer_metrics_summary;
drop policy if exists customer_metrics_summary_auth_update on public.customer_metrics_summary;

create policy customer_metrics_summary_core_scoped_select
on public.customer_metrics_summary for select to anon, authenticated
using (
  public.dawaa_can_access_customer_core_branch_v1(
    array[
      'view_customers','view_customer_details','view_customer_360','view_customer_service',
      'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
      'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
      'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
    ],
    branch
  )
);

-- This is a derived projection. Only backend/service commands may mutate it.
revoke insert, update, delete, truncate on public.customer_metrics_summary from anon, authenticated;

revoke all on function public.dawaa_can_access_customer_core_branch_v1(text[],text) from public;
grant execute on function public.dawaa_can_access_customer_core_branch_v1(text[],text)
  to anon, authenticated, service_role;

