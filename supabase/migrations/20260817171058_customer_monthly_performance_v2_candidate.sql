create or replace function public.calculate_customer_monthly_performance_v2(
  p_branch text,
  p_period_start date,
  p_period_end date,
  p_prev_period_start date,
  p_prev_period_end date
)
returns table(
  customer_code text, customer_name text, phone text, branch text,
  sales_amount numeric, invoice_count integer, items_count integer,
  avg_invoice numeric, avg_items_per_invoice numeric, purchase_days integer,
  first_purchase_date date, last_purchase_date date,
  cash_sales numeric, delivery_sales numeric, cash_ratio numeric, delivery_ratio numeric,
  current_segment text, previous_segment text,
  previous_month_sales numeric, previous_month_invoice_count integer,
  sales_change_amount numeric, sales_change_pct numeric, invoice_change_pct numeric,
  customer_state text, is_new_ever boolean, had_purchase_before_prev_period boolean,
  month_2_ago_sales numeric, month_3_ago_sales numeric
)
language sql stable security definer
set search_path='public'
as $function$
with params as (
  select (p_prev_period_end - p_prev_period_start + 1)::int as period_days
), base as (
  select
    coalesce(m.target_customer_code, si.customer_code, si.customer_phone) as ckey,
    coalesce(m.target_customer_code, si.customer_code) as canonical_code,
    si.customer_name,
    coalesce(si.customer_phone, si.phone) as phone,
    si.branch,
    si.invoice_date,
    coalesce(si.net_amount, si.discounted_amount, si.total_amount, si.amount, si.net_total, 0) as amt,
    coalesce(si.line_items_count,0) as items,
    si.invoice_type
  from public.dawaa_sales_invoices_dashboard_v1 si
  left join public.customer_merge_map m
    on m.source_customer_code=si.customer_code
   and m.action_status='applied'
   and coalesce(m.is_canonical,false)=false
  cross join params p
  where si.invoice_date >= least(date '2026-01-01', p_prev_period_start - (2 * p.period_days))
    and si.invoice_date <= p_period_end
    and coalesce(m.target_customer_code, si.customer_code, si.customer_phone) is not null
    and (p_branch is null or si.branch=p_branch)
), agg as (
  select
    ckey,
    coalesce(max(canonical_code) filter(where invoice_date between p_period_start and p_period_end),
             max(canonical_code) filter(where invoice_date between p_prev_period_start and p_prev_period_end)) as customer_code,
    coalesce(max(customer_name) filter(where invoice_date between p_period_start and p_period_end),
             max(customer_name) filter(where invoice_date between p_prev_period_start and p_prev_period_end)) as customer_name,
    coalesce(max(phone) filter(where invoice_date between p_period_start and p_period_end),
             max(phone) filter(where invoice_date between p_prev_period_start and p_prev_period_end)) as phone,
    case
      when count(distinct branch) filter(where invoice_date between p_period_start and p_period_end) > 1 then 'متعدد الفروع'
      when count(*) filter(where invoice_date between p_period_start and p_period_end) > 0 then max(branch) filter(where invoice_date between p_period_start and p_period_end)
      when count(distinct branch) filter(where invoice_date between p_prev_period_start and p_prev_period_end) > 1 then 'متعدد الفروع'
      else max(branch) filter(where invoice_date between p_prev_period_start and p_prev_period_end)
    end as branch,
    coalesce(sum(amt) filter(where invoice_date between p_period_start and p_period_end),0) as sales_amount,
    count(*) filter(where invoice_date between p_period_start and p_period_end) as invoice_count,
    coalesce(sum(items) filter(where invoice_date between p_period_start and p_period_end),0) as items_count,
    count(distinct invoice_date::date) filter(where invoice_date between p_period_start and p_period_end) as purchase_days,
    min(invoice_date::date) filter(where invoice_date between p_period_start and p_period_end) as first_purchase_date,
    coalesce(max(invoice_date::date) filter(where invoice_date between p_period_start and p_period_end),
             max(invoice_date::date) filter(where invoice_date between p_prev_period_start and p_prev_period_end)) as last_purchase_date,
    coalesce(sum(amt) filter(where invoice_date between p_period_start and p_period_end and invoice_type='كاش'),0) as cash_sales,
    coalesce(sum(amt) filter(where invoice_date between p_period_start and p_period_end and invoice_type='توصيل منزلى'),0) as delivery_sales,
    coalesce(sum(amt) filter(where invoice_date between p_prev_period_start and p_prev_period_end),0) as prev_sales,
    count(*) filter(where invoice_date between p_prev_period_start and p_prev_period_end) as prev_invoice_count,
    bool_or(invoice_date >= date '2026-01-01' and invoice_date < p_prev_period_start) as had_before_raw,
    coalesce(sum(amt) filter(where invoice_date between p_prev_period_start-(select period_days from params) and p_prev_period_start-1),0) as m2_sales,
    coalesce(sum(amt) filter(where invoice_date between p_prev_period_start-2*(select period_days from params) and p_prev_period_start-(select period_days from params)-1),0) as m3_sales
  from base
  group by ckey
  having count(*) filter(where invoice_date between p_period_start and p_period_end) > 0
      or count(*) filter(where invoice_date between p_prev_period_start and p_prev_period_end) > 0
), normalized as (
  select a.*,
         case when a.invoice_count=0 and a.prev_invoice_count>0 then true else coalesce(a.had_before_raw,false) end as had_before
  from agg a
)
select
  c.customer_code,c.customer_name,c.phone,c.branch,c.sales_amount,c.invoice_count::int,c.items_count::int,
  round(c.sales_amount/greatest(1,c.invoice_count),2),
  round(c.items_count::numeric/greatest(1,c.invoice_count),2),c.purchase_days::int,
  c.first_purchase_date,c.last_purchase_date,c.cash_sales,c.delivery_sales,
  case when c.sales_amount>0 then round(c.cash_sales/c.sales_amount*100,1) else 0 end,
  case when c.sales_amount>0 then round(c.delivery_sales/c.sales_amount*100,1) else 0 end,
  case when c.sales_amount>=8000 then 'مهم جدًا' when c.sales_amount>=4000 then 'مهم' when c.sales_amount>=1500 then 'متوسط' else 'عادي' end,
  case when c.prev_sales>=8000 then 'مهم جدًا' when c.prev_sales>=4000 then 'مهم' when c.prev_sales>=1500 then 'متوسط' else 'عادي' end,
  c.prev_sales,c.prev_invoice_count::int,c.sales_amount-c.prev_sales,
  case when c.prev_sales>0 then round((c.sales_amount-c.prev_sales)/c.prev_sales*100,1) end,
  case when c.prev_invoice_count>0 then round((c.invoice_count-c.prev_invoice_count)::numeric/c.prev_invoice_count*100,1) end,
  case when not c.had_before and c.prev_sales=0 then 'جديد'
       when c.had_before and c.prev_sales=0 and c.sales_amount>0 then 'مستعاد'
       when c.prev_sales>0 and c.sales_amount=0 then 'مختفي هذا الشهر'
       when c.prev_sales=0 and c.sales_amount=0 then 'غير نشط'
       when (c.sales_amount-c.prev_sales)/nullif(c.prev_sales,0)>=0.30 then 'نمو قوي'
       when (c.sales_amount-c.prev_sales)/nullif(c.prev_sales,0)>=0.10 then 'نمو'
       when (c.sales_amount-c.prev_sales)/nullif(c.prev_sales,0)>=-0.10 then 'مستقر'
       when (c.sales_amount-c.prev_sales)/nullif(c.prev_sales,0)>=-0.30 then 'تراجع' else 'تراجع قوي' end,
  not c.had_before,c.had_before,c.m2_sales,c.m3_sales
from normalized c;
$function$;
revoke all on function public.calculate_customer_monthly_performance_v2(text,date,date,date,date) from public;
grant execute on function public.calculate_customer_monthly_performance_v2(text,date,date,date,date) to authenticated, service_role;
