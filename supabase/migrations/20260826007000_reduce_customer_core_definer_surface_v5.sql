-- The policy wrappers need no elevated privilege; only the scoped resolver does.
create or replace function public.dawaa_current_customer_read_scope_v4()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select public.dawaa_current_customer_core_scope_v2(array[
    'view_customers','view_customer_details','view_customer_360','view_customer_service',
    'view_customer_requests','view_crm','view_customer_incubation','view_cashback',
    'view_loyalty_tiers','view_analytics','view_analytics_sales','view_invoices',
    'view_invoice_import','import_sales_invoices','import_customers','view_schedule'
  ])
$$;

create or replace function public.dawaa_current_customer_write_scope_v4()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select public.dawaa_current_customer_core_scope_v2(
    array['create_customer','edit_customer','import_customers','import_sales_invoices','view_customer_service']
  )
$$;

revoke all on function public.dawaa_current_customer_read_scope_v4() from public;
revoke all on function public.dawaa_current_customer_write_scope_v4() from public;
grant execute on function public.dawaa_current_customer_read_scope_v4() to anon, authenticated, service_role;
grant execute on function public.dawaa_current_customer_write_scope_v4() to anon, authenticated, service_role;

