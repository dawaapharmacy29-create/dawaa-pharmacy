-- Stage 4A: read-only dashboard/truth functions only.
-- Preserve the existing column precedence; treat zero as an absent fallback value.

create or replace function public.get_dashboard_sales_summary_v171(
  p_start date,
  p_end date,
  p_branch text default null
)
returns table(
  invoices_count bigint,
  sales_total numeric,
  avg_invoice numeric,
  linked_invoices bigint,
  unregistered_customer_invoices bigint,
  linked_sales numeric,
  unregistered_customer_sales numeric,
  customer_link_rate_percent numeric,
  linked_customers bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with excluded as (
  select customer_code
  from public.customer_flags
  where flag_key='system_generic_code' and coalesce(is_active,false)
), s as (
  select
    coalesce(
      nullif(si.net_total,0),
      nullif(si.net_amount,0),
      nullif(si.discounted_amount,0),
      nullif(si.total_amount,0),
      nullif(si.amount,0),
      0
    ) v,
    nullif(btrim(si.customer_code),'') code,
    lower(coalesce(si.customer_name,'')) nm
  from public.sales_invoices si
  left join excluded e on e.customer_code=btrim(coalesce(si.customer_code,''))
  where si.invoice_date>=p_start
    and si.invoice_date<(p_end+1)::timestamp
    and e.customer_code is null
    and not (
      lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)'
    )
    and (
      p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch
    )
), m as (
  select *,
    code is not null
    and code not in ('0','-','null','NULL')
    and nm not like '%غير مسجل%' linked
  from s
)
select
  count(*)::bigint,
  coalesce(sum(v),0)::numeric,
  (coalesce(sum(v),0)/nullif(count(*),0))::numeric,
  count(*) filter(where linked)::bigint,
  count(*) filter(where not linked)::bigint,
  coalesce(sum(v) filter(where linked),0)::numeric,
  coalesce(sum(v) filter(where not linked),0)::numeric,
  case when count(*)>0 then count(*) filter(where linked)::numeric*100/count(*) else 0 end,
  count(distinct code) filter(where linked)::bigint
from m;
$function$;

create or replace function public.get_dashboard_branch_distribution_v171(
  p_start date,
  p_end date,
  p_branch text default null
)
returns table(
  branch text,
  sales_total numeric,
  invoices_count bigint,
  avg_invoice numeric,
  linked_customers bigint
)
language sql
stable
security definer
set search_path to 'public'
as $function$
with excluded as (
  select customer_code
  from public.customer_flags
  where flag_key='system_generic_code' and coalesce(is_active,false)
), s as (
  select
    coalesce(nullif(btrim(si.branch),''),'غير محدد') b,
    coalesce(
      nullif(si.net_total,0),
      nullif(si.net_amount,0),
      nullif(si.discounted_amount,0),
      nullif(si.total_amount,0),
      nullif(si.amount,0),
      0
    ) v,
    nullif(btrim(si.customer_code),'') code,
    lower(coalesce(si.customer_name,'')) nm
  from public.sales_invoices si
  left join excluded e on e.customer_code=btrim(coalesce(si.customer_code,''))
  where si.invoice_date>=p_start
    and si.invoice_date<(p_end+1)::timestamp
    and e.customer_code is null
    and not (
      lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
      or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)'
    )
    and (
      p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch
    )
)
select
  b,
  sum(v)::numeric,
  count(*)::bigint,
  (sum(v)/nullif(count(*),0))::numeric,
  count(distinct code) filter(
    where code is not null and code not in ('0','-','null','NULL') and nm not like '%غير مسجل%'
  )::bigint
from s
group by b
order by 2 desc;
$function$;

create or replace function public.check_sales_daily_summary_gaps(
  p_start_date date,
  p_end_date date
)
returns table(
  sale_date date,
  branch text,
  raw_invoices_count integer,
  summary_invoices_count integer,
  raw_net_total numeric,
  summary_net_total numeric
)
language sql
stable
as $function$
with truth as (
  select
    coalesce(invoice_date::date,sale_date) d,
    coalesce(nullif(btrim(branch),''),nullif(btrim(branch_name),''),'غير محدد') b,
    count(*)::int c,
    sum(
      coalesce(
        nullif(net_total,0),
        nullif(net_amount,0),
        nullif(discounted_amount,0),
        nullif(total_amount,0),
        nullif(amount,0),
        0
      )
    )::numeric s
  from public.dawaa_sales_invoices_dashboard_v1
  where coalesce(invoice_date::date,sale_date) between p_start_date and p_end_date
  group by 1,2
), summary as (
  select sale_date d,branch b,sum(invoices_count)::int c,sum(net_total)::numeric s
  from public.dawaa_sales_daily_summary_clean_v1
  where sale_date between p_start_date and p_end_date
  group by 1,2
)
select
  coalesce(t.d,s.d),
  coalesce(t.b,s.b),
  coalesce(t.c,0),
  coalesce(s.c,0),
  coalesce(t.s,0),
  coalesce(s.s,0)
from truth t
full join summary s on s.d=t.d and s.b=t.b;
$function$;
