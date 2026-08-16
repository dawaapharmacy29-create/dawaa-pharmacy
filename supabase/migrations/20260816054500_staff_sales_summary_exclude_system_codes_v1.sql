-- Keep doctor/staff sales metrics aligned with the cleaned branch sales truth.
-- Internal/system customer codes remain in sales_invoices for audit/returns,
-- but are excluded from staff sales, invoice count and average-invoice metrics.

drop materialized view if exists public.staff_sales_summary;

create materialized view public.staff_sales_summary as
select
  invoice_date::date as sale_date,
  coalesce(branch,'غير محدد') as branch,
  coalesce(seller_name,'غير محدد') as seller_name,
  count(*) as invoices_count,
  coalesce(sum(coalesce(net_amount,amount,gross_amount,0)),0) as net_total,
  coalesce(sum(coalesce(gross_amount,amount,net_amount,0)),0) as gross_total,
  coalesce(sum(coalesce(discount_amount,0)),0) as discount_total,
  coalesce(avg(coalesce(net_amount,amount,gross_amount,0)),0) as avg_invoice,
  count(distinct coalesce(nullif(customer_code,''),customer_id::text,nullif(regexp_replace(coalesce(customer_phone,''),'[^0-9]','','g'),''),nullif(customer_name,''))) as unique_customers
from public.sales_invoices s
where invoice_date is not null
  and seller_name is not null
  and not public.dawaa_is_sales_target_excluded_customer_v1(s.branch,s.customer_code)
group by invoice_date::date,coalesce(branch,'غير محدد'),coalesce(seller_name,'غير محدد');

create unique index staff_sales_summary_unique_idx on public.staff_sales_summary(sale_date,branch,seller_name);
create index staff_sales_summary_date_idx on public.staff_sales_summary(sale_date desc);
create index staff_sales_summary_branch_idx on public.staff_sales_summary(branch);
create index staff_sales_summary_seller_idx on public.staff_sales_summary(seller_name);
grant select on public.staff_sales_summary to anon, authenticated;
