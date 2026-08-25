-- Keep authorization aligned with the canonical, indexed branch column.
-- sales_invoices.branch is complete in production and mandatory in every importer path.

drop policy if exists sales_invoices_scoped_select on public.sales_invoices;
create policy sales_invoices_scoped_select
on public.sales_invoices for select to anon, authenticated
using (
  (select public.dawaa_current_sales_invoice_scope_v1(array[
    'view_dashboard','view_sales','view_invoice_import','view_all_invoices',
    'import_sales_invoices','view_quarterly_incentives','view_points'
  ])) = 'ALL'
  or branch = (select public.dawaa_current_sales_invoice_scope_v1(array[
    'view_dashboard','view_sales','view_invoice_import','view_all_invoices',
    'import_sales_invoices','view_quarterly_incentives','view_points'
  ]))
);

drop policy if exists sales_invoices_scoped_insert on public.sales_invoices;
create policy sales_invoices_scoped_insert
on public.sales_invoices for insert to anon, authenticated
with check (
  (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) = 'ALL'
  or branch = (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices']))
);

drop policy if exists sales_invoices_scoped_update on public.sales_invoices;
create policy sales_invoices_scoped_update
on public.sales_invoices for update to anon, authenticated
using (
  (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) = 'ALL'
  or branch = (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices']))
)
with check (
  (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) = 'ALL'
  or branch = (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices']))
);
