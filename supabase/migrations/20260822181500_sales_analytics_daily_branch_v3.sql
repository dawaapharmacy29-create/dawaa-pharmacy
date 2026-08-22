create or replace function public.get_sales_analytics_summary_v1(
  p_start date,
  p_end date,
  p_branch text default null,
  p_doctor text default null
)
returns jsonb
language sql
stable
set search_path = public
as $$
with base as materialized (
  select
    coalesce(si.sale_date::date, si.invoice_date::date) as sale_day,
    coalesce(nullif(btrim(si.branch_name), ''), nullif(btrim(si.branch), ''), 'غير محدد') as branch,
    coalesce(nullif(btrim(si.normalized_seller_name), ''),nullif(btrim(si.seller_name), ''),nullif(btrim(si.staff_name), ''),'') as seller_name,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric as amount,
    coalesce(nullif(btrim(si.customer_code), ''),nullif(btrim(si.customer_phone), ''),nullif(btrim(si.customer_name), '')) as customer_key
  from public.dawaa_sales_invoices_dashboard_v1 si
  where si.invoice_date >= p_start
    and si.invoice_date < (p_end + 1)::timestamp
    and (p_branch is null or btrim(p_branch) = '' or coalesce(nullif(btrim(si.branch_name), ''),nullif(btrim(si.branch), ''),'غير محدد') = btrim(p_branch))
    and (p_doctor is null or btrim(p_doctor) = '' or public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name), ''),nullif(btrim(si.seller_name), ''),nullif(btrim(si.staff_name), ''),'')) = public.normalize_cs_identity_name(p_doctor))
),
daily as (
  select sale_day,coalesce(sum(amount),0)::numeric as net_sales,count(*)::bigint as invoices_count,
    count(distinct customer_key) filter(where customer_key is not null)::bigint as unique_customers
  from base where sale_day is not null group by sale_day
),
kpis as (
  select coalesce(sum(amount),0)::numeric as net_sales,count(*)::bigint as invoices_count,
    count(distinct customer_key) filter(where customer_key is not null)::bigint as unique_customers,
    (select count(*)::bigint from daily where net_sales > 0) as active_days
  from base
),
branch_agg as (
  select branch,coalesce(sum(amount),0)::numeric as net_sales,count(*)::bigint as invoices_count,
    count(distinct customer_key) filter(where customer_key is not null)::bigint as unique_customers
  from base group by branch
),
branch_day as (
  select sale_day,branch,coalesce(sum(amount),0)::numeric as net_total,count(*)::bigint as invoices_count,
    count(distinct customer_key) filter(where customer_key is not null)::bigint as unique_customers
  from base where sale_day is not null group by sale_day,branch
),
last_dates as (
  select sale_day from (select distinct sale_day from branch_day) d order by sale_day desc limit 5
),
last_dates_ranked as (
  select sale_day,row_number() over(order by sale_day) as rn from last_dates
),
last5 as (
  select bd.sale_day,bd.branch,bd.net_total,bd.invoices_count,prev.net_total as previous_day_net_total
  from branch_day bd
  join last_dates_ranked ld on ld.sale_day=bd.sale_day
  left join last_dates_ranked pld on pld.rn=ld.rn-1
  left join branch_day prev on prev.sale_day=pld.sale_day and prev.branch=bd.branch
),
staff_agg as (
  select seller_name,branch,coalesce(sum(amount),0)::numeric as net_total,count(*)::bigint as invoices_count,
    count(distinct customer_key) filter(where customer_key is not null)::bigint as unique_customers
  from base where coalesce(btrim(seller_name),'')<>'' group by seller_name,branch
),
health as (
  select count(*) filter(where customer_key is null)::bigint as invoices_without_customer,
    count(*) filter(where coalesce(btrim(seller_name),'')='')::bigint as invoices_without_doctor,
    count(*) filter(where branch='غير محدد')::bigint as invoices_without_branch
  from base
)
select jsonb_build_object(
  'kpis',(select jsonb_build_object('netSales',net_sales,'invoicesCount',invoices_count,'avgInvoice',case when invoices_count>0 then net_sales/invoices_count else 0 end,'uniqueCustomers',unique_customers,'activeDays',active_days) from kpis),
  'dailyTrend',coalesce((select jsonb_agg(jsonb_build_object('date',sale_day,'netSales',net_sales,'invoicesCount',invoices_count,'avgInvoice',case when invoices_count>0 then net_sales/invoices_count else 0 end,'uniqueCustomers',unique_customers) order by sale_day) from daily),'[]'::jsonb),
  'dailySales',coalesce((select jsonb_agg(jsonb_build_object('saleDate',sale_day,'branch',branch,'shift',null,'netTotal',net_total,'invoicesCount',invoices_count,'avgInvoice',case when invoices_count>0 then net_total/invoices_count else 0 end,'uniqueCustomers',unique_customers) order by sale_day,branch) from branch_day),'[]'::jsonb),
  'branchRows',coalesce((select jsonb_agg(jsonb_build_object('branch',b.branch,'netSales',b.net_sales,'invoicesCount',b.invoices_count,'avgInvoice',case when b.invoices_count>0 then b.net_sales/b.invoices_count else 0 end,'uniqueCustomers',b.unique_customers,'share',case when k.net_sales<>0 then (b.net_sales/k.net_sales)*100 else 0 end) order by b.net_sales desc) from branch_agg b cross join kpis k),'[]'::jsonb),
  'last5DaysByBranch',coalesce((select jsonb_agg(jsonb_build_object('date',sale_day,'branch',branch,'netTotal',net_total,'invoicesCount',invoices_count,'avgInvoice',case when invoices_count>0 then net_total/invoices_count else 0 end,'previousDayNetTotal',previous_day_net_total,'changePercent',case when previous_day_net_total is not null and previous_day_net_total<>0 then ((net_total-previous_day_net_total)/previous_day_net_total)*100 else null end) order by sale_day,branch) from last5),'[]'::jsonb),
  'staffSales',coalesce((select jsonb_agg(jsonb_build_object('saleDate',null,'sellerName',seller_name,'branch',branch,'netTotal',net_total,'invoicesCount',invoices_count,'avgInvoice',case when invoices_count>0 then net_total/invoices_count else 0 end,'uniqueCustomers',unique_customers) order by net_total desc) from staff_agg),'[]'::jsonb),
  'dataHealth',(select jsonb_build_object('invoicesWithoutCustomer',invoices_without_customer,'invoicesWithoutDoctor',invoices_without_doctor,'invoicesWithoutBranch',invoices_without_branch) from health)
);
$$;
