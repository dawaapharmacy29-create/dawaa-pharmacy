-- Make Customer Service priority queues resilient to intermittent statement timeouts.
-- Keep the five confirmed excluded customer codes only: 54 / 12820 / 10 / 5 / 170.

create or replace function public.get_customer_service_recent_top50_core(p_days integer, p_scope text)
returns table(customer_rank integer, branch text, customer_code text, customer_name text, customer_phone text, recent_sales numeric, invoice_count bigint, active_months integer, avg_invoice numeric, last_purchase date, importance_score numeric)
language sql stable security definer
set search_path=public,pg_catalog
as $$
with base as (
  select s.branch,btrim(s.customer_code) customer_code,
    sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric recent_sales,
    count(*)::bigint invoice_count,
    count(distinct date_trunc('month',s.invoice_date))::integer active_months,
    avg(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric avg_invoice,
    max(s.invoice_date)::date last_purchase
  from public.sales_invoices s
  where s.invoice_date>=greatest(date_trunc('month',current_date)-interval '2 months',(current_date-greatest(coalesce(p_days,90),1))::timestamp)
    and s.invoice_date<(current_date+1)::timestamp
    and s.branch in ('فرع شكري','فرع الشامي')
    and (p_scope='ALL' or lower(btrim(s.branch))=p_scope)
    and nullif(btrim(s.customer_code),'') is not null
    and btrim(s.customer_code) not in ('5','10','54','170','12820')
    and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)>0
  group by s.branch,btrim(s.customer_code)
), filtered as (
  select b.* from base b
  where not exists(select 1 from public.customer_flags x where x.flag_key='wholesale_b2b' and coalesce(x.is_active,false) and x.customer_code=b.customer_code)
), scored as (
  select f.*,round((f.recent_sales*(0.70+0.10*least(f.active_months,3)))::numeric,2) importance_score from filtered f
), ranked as (
  select s.*,row_number() over(partition by s.branch order by s.importance_score desc,s.recent_sales desc,s.invoice_count desc,s.last_purchase desc,s.customer_code)::integer customer_rank
  from scored s
), top50 as materialized (
  select * from ranked where customer_rank<=50
), enriched as (
  select t.customer_rank,t.branch,t.customer_code,
    coalesce(public.dawaa_clean_customer_name(c.name),'عميل كود '||t.customer_code) customer_name,
    coalesce(nullif(btrim(c.phone),''),nullif(btrim(c.whatsapp_phone),''),nullif(btrim(c.phone_alt),''),'') customer_phone,
    t.recent_sales,t.invoice_count,t.active_months,t.avg_invoice,t.last_purchase,t.importance_score
  from top50 t
  left join lateral (
    select c.name,c.phone,c.whatsapp_phone,c.phone_alt
    from public.customers c
    where c.customer_code=t.customer_code
    order by case when c.branch=t.branch then 0 else 1 end,c.updated_at desc nulls last,c.id
    limit 1
  ) c on true
)
select e.customer_rank,e.branch,e.customer_code,e.customer_name,e.customer_phone,round(e.recent_sales,2),e.invoice_count,e.active_months,round(e.avg_invoice,2),e.last_purchase,e.importance_score
from enriched e order by e.branch,e.customer_rank;
$$;

grant execute on function public.get_customer_service_recent_top50_core(integer,text) to anon,authenticated;

create or replace function public.get_customer_service_three_cycle_intelligence_v1(p_as_of date default current_date,p_actor_id uuid default null)
returns table(branch text, customer_rank integer, customer_code text, customer_name text, customer_phone text, recent_sales numeric, last_purchase date, current_period_sales numeric, previous_period_sales numeric, prior_period_sales numeric, current_invoices bigint, previous_invoices bigint, prior_invoices bigint, baseline_sales numeric, change_vs_previous_pct numeric, change_vs_baseline_pct numeric, trend_state text, priority_score numeric, current_period_start date, current_period_end date, previous_period_start date, previous_period_end date, prior_period_start date, prior_period_end date)
language sql stable security definer
set search_path=public,pg_catalog
as $$
with scope as (
  select public.dawaa_customer_service_queue_scope_v3(p_actor_id) value
), bounds as (
  select case when extract(day from p_as_of)::int>=26
    then date_trunc('month',p_as_of)::date+25
    else (date_trunc('month',p_as_of)::date-interval '1 month'+interval '25 days')::date end current_start,
    (date_trunc('month',p_as_of)-interval '2 months')::date recent_start
), p as (
  select b.recent_start,b.current_start,p_as_of current_end,
    (b.current_start-interval '1 month')::date previous_start,
    ((b.current_start-interval '1 month')::date+(p_as_of-b.current_start))::date previous_end,
    (b.current_start-interval '2 months')::date prior_start,
    ((b.current_start-interval '2 months')::date+(p_as_of-b.current_start))::date prior_end
  from bounds b
), agg as materialized (
  select s.branch,btrim(s.customer_code) customer_code,
    sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric recent_sales,
    count(*)::bigint invoice_count,
    count(distinct date_trunc('month',s.invoice_date))::integer active_months,
    avg(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric avg_invoice,
    max(s.invoice_date)::date last_purchase,
    coalesce(sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)) filter(where s.invoice_date>=p.current_start::timestamp and s.invoice_date<(p.current_end+1)::timestamp),0)::numeric current_sales,
    coalesce(sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)) filter(where s.invoice_date>=p.previous_start::timestamp and s.invoice_date<(p.previous_end+1)::timestamp),0)::numeric previous_sales,
    coalesce(sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)) filter(where s.invoice_date>=p.prior_start::timestamp and s.invoice_date<(p.prior_end+1)::timestamp),0)::numeric prior_sales,
    count(*) filter(where s.invoice_date>=p.current_start::timestamp and s.invoice_date<(p.current_end+1)::timestamp)::bigint current_count,
    count(*) filter(where s.invoice_date>=p.previous_start::timestamp and s.invoice_date<(p.previous_end+1)::timestamp)::bigint previous_count,
    count(*) filter(where s.invoice_date>=p.prior_start::timestamp and s.invoice_date<(p.prior_end+1)::timestamp)::bigint prior_count,
    p.current_start,p.current_end,p.previous_start,p.previous_end,p.prior_start,p.prior_end
  from public.sales_invoices s cross join p cross join scope sc
  where s.invoice_date>=p.recent_start::timestamp and s.invoice_date<(p.current_end+1)::timestamp
    and s.branch in ('فرع شكري','فرع الشامي')
    and (sc.value='ALL' or lower(btrim(s.branch))=sc.value)
    and nullif(btrim(s.customer_code),'') is not null
    and btrim(s.customer_code) not in ('5','10','54','170','12820')
    and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)>0
    and not exists(select 1 from public.customer_flags f where f.flag_key='wholesale_b2b' and coalesce(f.is_active,false) and f.customer_code=btrim(s.customer_code))
  group by s.branch,btrim(s.customer_code),p.current_start,p.current_end,p.previous_start,p.previous_end,p.prior_start,p.prior_end
), scored as (
  select a.*,round((a.recent_sales*(0.70+0.10*least(a.active_months,3)))::numeric,2) importance_score from agg a
), ranked as (
  select s.*,row_number() over(partition by s.branch order by s.importance_score desc,s.recent_sales desc,s.invoice_count desc,s.last_purchase desc,s.customer_code)::integer customer_rank
  from scored s
), top50 as materialized (
  select * from ranked where customer_rank<=50
), enriched as (
  select t.*,
    coalesce(public.dawaa_clean_customer_name(c.name),'عميل كود '||t.customer_code) customer_name,
    coalesce(nullif(btrim(c.phone),''),nullif(btrim(c.whatsapp_phone),''),nullif(btrim(c.phone_alt),''),'') customer_phone
  from top50 t
  left join lateral (
    select c.name,c.phone,c.whatsapp_phone,c.phone_alt from public.customers c
    where c.customer_code=t.customer_code
    order by case when c.branch=t.branch then 0 else 1 end,c.updated_at desc nulls last,c.id limit 1
  ) c on true
), calculated as (
  select e.*,((e.previous_sales+e.prior_sales)/2.0)::numeric baseline,
    case when e.previous_sales>0 then ((e.current_sales-e.previous_sales)/e.previous_sales*100.0)::numeric end vs_previous,
    case when (e.previous_sales+e.prior_sales)>0 then ((e.current_sales-((e.previous_sales+e.prior_sales)/2.0))/((e.previous_sales+e.prior_sales)/2.0)*100.0)::numeric end vs_baseline
  from enriched e
), classified as (
  select c.*,case
    when c.current_sales=0 and c.baseline>=500 then 'خطر فقد'
    when c.baseline>=500 and c.current_sales<c.baseline*0.60 then 'تراجع قوي'
    when c.baseline>=500 and c.current_sales<c.baseline*0.85 then 'تراجع'
    when c.current_sales>=500 and c.baseline>0 and c.current_sales>c.baseline*1.35 then 'نمو قوي'
    when c.current_sales>=500 and c.baseline>0 and c.current_sales>c.baseline*1.10 then 'نمو'
    when c.current_sales>=500 and c.baseline=0 then 'عميل صاعد جديد'
    else 'مستقر' end state
  from calculated c
)
select c.branch,c.customer_rank,c.customer_code,c.customer_name,c.customer_phone,round(c.recent_sales,2),c.last_purchase,
  round(c.current_sales,2),round(c.previous_sales,2),round(c.prior_sales,2),c.current_count,c.previous_count,c.prior_count,
  round(c.baseline,2),round(c.vs_previous,1),round(c.vs_baseline,1),c.state,
  round((c.recent_sales*case c.state when 'خطر فقد' then 1.45 when 'تراجع قوي' then 1.35 when 'تراجع' then 1.20 when 'نمو قوي' then 1.15 when 'نمو' then 1.08 when 'عميل صاعد جديد' then 1.10 else 1.00 end)::numeric,2) priority_score,
  c.current_start,c.current_end,c.previous_start,c.previous_end,c.prior_start,c.prior_end
from classified c
order by c.branch,case c.state when 'خطر فقد' then 1 when 'تراجع قوي' then 2 when 'تراجع' then 3 when 'نمو قوي' then 4 when 'نمو' then 5 when 'عميل صاعد جديد' then 6 else 7 end,priority_score desc,c.customer_rank;
$$;

grant execute on function public.get_customer_service_three_cycle_intelligence_v1(date,uuid) to anon,authenticated;
