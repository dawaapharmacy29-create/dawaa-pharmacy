-- Top 50 means the current calendar month plus the two preceding months.
-- This intentionally excludes older customers (for example January/February, and May in August).
create or replace function public.get_customer_service_recent_top50_v2(p_days integer default 90)
returns table(customer_rank integer,branch text,customer_code text,customer_name text,customer_phone text,recent_sales numeric,
  invoice_count bigint,active_months integer,avg_invoice numeric,last_purchase date,importance_score numeric)
language sql stable security definer set search_path=public,pg_catalog as $$
  with scope as (select public.dawaa_customer_intelligence_access_scope_v1() value), base as (
    select s.branch,btrim(s.customer_code) customer_code,max(nullif(btrim(s.customer_name),'')) customer_name,
      max(nullif(btrim(coalesce(s.customer_phone,s.phone)),'')) customer_phone,
      sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric recent_sales,
      count(*)::bigint invoice_count,count(distinct date_trunc('month',s.invoice_date))::integer active_months,
      avg(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric avg_invoice,max(s.invoice_date)::date last_purchase
    from public.sales_invoices s cross join scope sc
    where s.invoice_date >= (date_trunc('month',current_date)-interval '2 months')
      and s.invoice_date < (current_date+1)::timestamptz
      and s.branch in ('فرع شكري','فرع الشامي') and (sc.value='ALL' or lower(btrim(s.branch))=sc.value)
      and nullif(btrim(s.customer_code),'') is not null and btrim(s.customer_code) not in ('5','10','54','170','12820')
      and nullif(btrim(s.customer_name),'') is not null and btrim(s.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
      and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)>0
    group by s.branch,btrim(s.customer_code)
  ), scored as (
    select b.*,round((b.recent_sales*(0.70+0.10*least(b.active_months,3)))::numeric,2) importance_score from base b
  ), ranked as (
    select s.*,row_number() over(partition by s.branch order by s.importance_score desc,s.recent_sales desc,s.invoice_count desc,s.last_purchase desc,s.customer_code)::integer customer_rank from scored s
  )
  select r.customer_rank,r.branch,r.customer_code,r.customer_name,r.customer_phone,round(r.recent_sales,2),r.invoice_count,r.active_months,
    round(r.avg_invoice,2),r.last_purchase,r.importance_score from ranked r where r.customer_rank<=50 order by r.branch,r.customer_rank;
$$;
