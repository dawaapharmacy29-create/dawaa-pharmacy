create or replace function public.get_dashboard_invoice_health_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
with period as materialized (
  select invoice_date, customer_code, customer_phone, seller_name, branch
  from public.sales_invoices
  where invoice_date >= p_start
    and invoice_date < (p_end + 1)::timestamp
    and (p_branch is null or btrim(p_branch) = '' or branch = p_branch)
), latest_batch as (
  select import_batch
  from public.sales_invoices
  where import_batch is not null
    and (p_branch is null or btrim(p_branch) = '' or branch = p_branch)
  order by created_at desc
  limit 1
)
select jsonb_build_object(
  'invoicesWithoutCustomerCode', count(*) filter(where customer_code is null or customer_code = ''),
  'invoicesWithoutCustomerPhone', count(*) filter(where customer_phone is null or customer_phone = ''),
  'invoicesWithoutSellerName', count(*) filter(where seller_name is null or seller_name = ''),
  'invoicesWithoutBranch', count(*) filter(where branch is null or branch = ''),
  'lastInvoiceDate', max(invoice_date),
  'latestImportBatch', (select import_batch from latest_batch)
)
from period;
$$;
