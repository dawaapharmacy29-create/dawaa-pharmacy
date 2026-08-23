create or replace function public.get_customer_service_weekly_queue_completion_v1(p_branch text, p_week_start date, p_week_end date)
returns table(days_counted integer, total_items integer, total_handled integer, completion_rate numeric)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
with params as (
  select lower(btrim(coalesce(p_branch,''))) scope
), days as materialized (
  select d::date queue_date
  from generate_series(p_week_start::timestamp,p_week_end::timestamp,interval '1 day') d
), branches as (
  select b from (values ('فرع شكري'),('فرع الشامي')) x(b), params p
  where p.scope='all' or lower(btrim(b))=p.scope
), excluded as materialized (
  select customer_code from public.customer_flags
  where flag_key in ('wholesale_b2b','system_generic_code') and coalesce(is_active,false)
), top50 as materialized (
  select t.* from public.get_customer_service_recent_top50_cached((select scope from params)) t
), vip_daily as materialized (
  select d.queue_date,t.branch,t.customer_code,
    row_number() over(
      partition by d.queue_date,t.branch
      order by mod((t.customer_rank-1)-mod((d.queue_date-date '2026-01-01')::integer*7,50)+50,50),t.customer_rank
    )::integer branch_daily_order
  from days d join top50 t on true
), vip as (
  select v.queue_date,v.branch,
    count(*) filter(where v.branch_daily_order<=7)::integer total,
    count(*) filter(where v.branch_daily_order<=7 and exists(
      select 1 from public.daily_followups f
      where f.branch=v.branch and btrim(f.customer_code)=v.customer_code and f.date=v.queue_date::text
    ))::integer handled
  from vip_daily v
  group by v.queue_date,v.branch
), plus500_customers as materialized (
  select s.sale_date::date queue_date,s.branch,btrim(s.customer_code) customer_code
  from public.dawaa_sales_invoices_dashboard_v1 s, params p
  where s.sale_date between p_week_start and p_week_end
    and s.branch in ('فرع شكري','فرع الشامي')
    and (p.scope='all' or lower(btrim(s.branch))=p.scope)
    and nullif(btrim(s.customer_code),'') is not null
    and coalesce(nullif(s.net_total,0),nullif(s.net_amount,0),nullif(s.discounted_amount,0),nullif(s.total_amount,0),nullif(s.amount,0),0)>=500
    and not exists(select 1 from excluded x where x.customer_code=btrim(s.customer_code))
  group by s.sale_date::date,s.branch,btrim(s.customer_code)
), plus500 as (
  select p.queue_date,p.branch,count(*)::integer total,
    count(*) filter(where exists(
      select 1 from public.daily_followups f
      where f.branch=p.branch and btrim(f.customer_code)=p.customer_code and f.date=p.queue_date::text
    ))::integer handled
  from plus500_customers p group by p.queue_date,p.branch
), point_balances as materialized (
  select d.queue_date,l.branch,btrim(l.customer_code) customer_code,
    sum(coalesce(l.points_amount,0))::numeric points_balance,
    max(l.contacted_at) last_contacted_at
  from days d
  join public.customer_points_ledger l
    on l.branch in ('فرع شكري','فرع الشامي')
   and ((select scope from params)='all' or lower(btrim(l.branch))=(select scope from params))
   and nullif(btrim(l.customer_code),'') is not null
   and nullif(btrim(l.customer_name),'') is not null
   and btrim(l.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
   and (l.expiry_date is null or l.expiry_date>=d.queue_date)
  where not exists(select 1 from excluded x where x.customer_code=btrim(l.customer_code))
  group by d.queue_date,l.branch,btrim(l.customer_code)
  having sum(coalesce(l.points_amount,0))>0
), points_ranked as materialized (
  select p.*,
    row_number() over(partition by p.queue_date,p.branch order by p.last_contacted_at asc nulls first,p.points_balance desc,p.customer_code)::integer rn
  from point_balances p
), points as (
  select p.queue_date,p.branch,
    count(*) filter(where p.rn<=10)::integer total,
    count(*) filter(where p.rn<=10 and p.last_contacted_at is not null and p.last_contacted_at::date=p.queue_date)::integer handled
  from points_ranked p group by p.queue_date,p.branch
), daily as (
  select d.queue_date,b.b branch,
    coalesce(v.total,0)+coalesce(p.total,0)+coalesce(pt.total,0) total,
    coalesce(v.handled,0)+coalesce(p.handled,0)+coalesce(pt.handled,0) handled
  from days d cross join branches b
  left join vip v on v.queue_date=d.queue_date and v.branch=b.b
  left join plus500 p on p.queue_date=d.queue_date and p.branch=b.b
  left join points pt on pt.queue_date=d.queue_date and pt.branch=b.b
), agg as (
  select count(distinct queue_date) filter(where total>0)::integer days_counted,
    coalesce(sum(total),0)::integer total_items,
    coalesce(sum(handled),0)::integer total_handled
  from daily
)
select a.days_counted,a.total_items,a.total_handled,
  case when a.total_items>0 then round(a.total_handled::numeric/a.total_items::numeric*100,1) else null end completion_rate
from agg a;
$$;

revoke all on function public.get_customer_service_weekly_queue_completion_v1(text,date,date) from public;
grant execute on function public.get_customer_service_weekly_queue_completion_v1(text,date,date) to authenticated;
