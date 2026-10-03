-- Read-only diagnostic gate for sales invoice item evidence completeness.
-- It does not block imports or mutate sales/purchase planning data.

create or replace view public.sales_invoice_items_daily_completeness_v1
with (security_invoker = true)
as
with headers as (
  select
    coalesce(branch_name, branch) as branch,
    (coalesce(invoice_datetime, invoice_date) at time zone 'Africa/Cairo')::date as sales_date,
    count(distinct invoice_number) as header_invoices
  from public.sales_invoices
  where coalesce(branch_name, branch) in ('فرع شكري', 'فرع الشامي')
  group by 1, 2
),
items as (
  select
    branch,
    (invoice_date at time zone 'Africa/Cairo')::date as sales_date,
    count(distinct invoice_number) as item_invoices
  from public.sales_invoice_items_v21
  where branch in ('فرع شكري', 'فرع الشامي')
  group by 1, 2
)
select
  coalesce(h.branch, i.branch) as branch,
  coalesce(h.sales_date, i.sales_date) as sales_date,
  coalesce(h.header_invoices, 0)::bigint as header_invoices,
  coalesce(i.item_invoices, 0)::bigint as item_invoices,
  greatest(coalesce(h.header_invoices, 0) - coalesce(i.item_invoices, 0), 0)::bigint as missing_item_invoices,
  case
    when coalesce(h.header_invoices, 0) = 0 then null
    else round(100.0 * coalesce(i.item_invoices, 0) / h.header_invoices, 1)
  end as coverage_pct,
  case
    when coalesce(h.header_invoices, 0) = 0 then 'no_headers'
    when coalesce(i.item_invoices, 0) = 0 then 'missing'
    when (100.0 * i.item_invoices / h.header_invoices) >= 99 then 'complete'
    when (100.0 * i.item_invoices / h.header_invoices) >= 95 then 'partial'
    else 'material_gap'
  end as completeness_status
from headers h
full join items i using (branch, sales_date);

comment on view public.sales_invoice_items_daily_completeness_v1 is
'Read-only Cairo-day coverage diagnostic comparing sales invoice headers with invoices that have imported line-item evidence.';

revoke all on public.sales_invoice_items_daily_completeness_v1 from anon, authenticated;
