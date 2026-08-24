-- Resolve actor permission + branch once per statement (RLS init-plan), not once per row.
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
  v_actor_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not public.dawaa_current_actor_can(p_permissions) then
    return 'NONE';
  end if;

  select pg_catalog.lower(pg_catalog.btrim(coalesce(sa.role, ''))), sa.branch
    into v_role, v_actor_branch
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false)
  limit 1;

  if not found then return 'NONE'; end if;
  if v_role in ('general_manager', 'executive_manager', 'branches_manager', 'admin') then
    return 'ALL';
  end if;

  return coalesce(public.dawaa_customer_request_branch_key(v_actor_branch), 'NONE');
end;
$$;

drop policy if exists customers_core_scoped_select on public.customers;
drop policy if exists customers_core_scoped_insert on public.customers;
drop policy if exists customers_core_scoped_update on public.customers;
drop policy if exists customer_metrics_summary_core_scoped_select on public.customer_metrics_summary;

create policy customers_core_scoped_select
on public.customers for select to anon, authenticated
using (
  (select public.dawaa_current_customer_core_scope_v2(array[
    'view_customers','view_customer_details','view_customer_360','view_customer_service',
    'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
    'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
    'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
  ])) = 'ALL'
  or (
    (select public.dawaa_current_customer_core_scope_v2(array[
      'view_customers','view_customer_details','view_customer_360','view_customer_service',
      'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
      'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
      'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
    ])) <> 'NONE'
    and (
      public.dawaa_customer_request_branch_key(coalesce(effective_branch, branch)) is null
      or lower(btrim(coalesce(coalesce(effective_branch, branch), ''))) in ('متعدد الفروع','كل الفروع','all')
      or public.dawaa_customer_request_branch_key(coalesce(effective_branch, branch))
        = (select public.dawaa_current_customer_core_scope_v2(array[
          'view_customers','view_customer_details','view_customer_360','view_customer_service',
          'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
          'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
          'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
        ]))
    )
  )
);

create policy customers_core_scoped_insert
on public.customers for insert to anon, authenticated
with check (
  (select public.dawaa_current_customer_core_scope_v2(array['create_customer','edit_customer','import_customers','import_sales_invoices','view_customer_service'])) = 'ALL'
  or (
    (select public.dawaa_current_customer_core_scope_v2(array['create_customer','edit_customer','import_customers','import_sales_invoices','view_customer_service'])) <> 'NONE'
    and (
      public.dawaa_customer_request_branch_key(coalesce(effective_branch, branch)) is null
      or lower(btrim(coalesce(coalesce(effective_branch, branch), ''))) in ('متعدد الفروع','كل الفروع','all')
      or public.dawaa_customer_request_branch_key(coalesce(effective_branch, branch))
        = (select public.dawaa_current_customer_core_scope_v2(array['create_customer','edit_customer','import_customers','import_sales_invoices','view_customer_service']))
    )
  )
);

create policy customers_core_scoped_update
on public.customers for update to anon, authenticated
using (
  (select public.dawaa_current_customer_core_scope_v2(array['edit_customer','import_customers','import_sales_invoices','view_customer_service'])) = 'ALL'
  or (
    (select public.dawaa_current_customer_core_scope_v2(array['edit_customer','import_customers','import_sales_invoices','view_customer_service'])) <> 'NONE'
    and (
      public.dawaa_customer_request_branch_key(coalesce(effective_branch, branch)) is null
      or lower(btrim(coalesce(coalesce(effective_branch, branch), ''))) in ('متعدد الفروع','كل الفروع','all')
      or public.dawaa_customer_request_branch_key(coalesce(effective_branch, branch))
        = (select public.dawaa_current_customer_core_scope_v2(array['edit_customer','import_customers','import_sales_invoices','view_customer_service']))
    )
  )
)
with check (
  (select public.dawaa_current_customer_core_scope_v2(array['edit_customer','import_customers','import_sales_invoices','view_customer_service'])) = 'ALL'
  or (
    (select public.dawaa_current_customer_core_scope_v2(array['edit_customer','import_customers','import_sales_invoices','view_customer_service'])) <> 'NONE'
    and (
      public.dawaa_customer_request_branch_key(coalesce(effective_branch, branch)) is null
      or lower(btrim(coalesce(coalesce(effective_branch, branch), ''))) in ('متعدد الفروع','كل الفروع','all')
      or public.dawaa_customer_request_branch_key(coalesce(effective_branch, branch))
        = (select public.dawaa_current_customer_core_scope_v2(array['edit_customer','import_customers','import_sales_invoices','view_customer_service']))
    )
  )
);

create policy customer_metrics_summary_core_scoped_select
on public.customer_metrics_summary for select to anon, authenticated
using (
  (select public.dawaa_current_customer_core_scope_v2(array[
    'view_customers','view_customer_details','view_customer_360','view_customer_service',
    'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
    'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
    'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
  ])) = 'ALL'
  or (
    (select public.dawaa_current_customer_core_scope_v2(array[
      'view_customers','view_customer_details','view_customer_360','view_customer_service',
      'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
      'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
      'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
    ])) <> 'NONE'
    and (
      public.dawaa_customer_request_branch_key(branch) is null
      or lower(btrim(coalesce(branch, ''))) in ('متعدد الفروع','كل الفروع','all')
      or public.dawaa_customer_request_branch_key(branch)
        = (select public.dawaa_current_customer_core_scope_v2(array[
          'view_customers','view_customer_details','view_customer_360','view_customer_service',
          'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
          'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
          'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
        ]))
    )
  )
);

drop function public.dawaa_can_access_customer_core_branch_v1(text[],text);

revoke all on function public.dawaa_current_customer_core_scope_v2(text[]) from public;
grant execute on function public.dawaa_current_customer_core_scope_v2(text[])
  to anon, authenticated, service_role;

