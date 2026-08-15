-- Root cause fix for "canceling statement due to statement timeout" on the customer-service
-- top-50 / three-cycle intelligence queues (CustomerDailyPriorityQueues / SmartCustomerService).
--
-- DIAGNOSIS (confirmed live via EXPLAIN ANALYZE on project jkjqeqkshllustwlzzbf):
--   get_customer_service_recent_top50_core() and get_customer_service_three_cycle_intelligence_v1()
--   are SECURITY DEFINER LANGUAGE SQL functions whose WHERE clauses compute date boundaries from
--   the function's own parameters (p_days / p_as_of). SECURITY DEFINER functions are never inlined
--   by the planner, so Postgres plans the internal query once treating those parameters as opaque/
--   unknown values instead of the literal values actually passed in -> catastrophically bad generic
--   plan. Measured before fix: ~29-31s / ~11.1M buffer hits. The exact same SQL with the parameter
--   values inlined as literals: ~100-250ms / ~7-11k buffer hits. The `authenticated` role's
--   statement_timeout is 8s, so the bad plan was tripping the timeout intermittently under load.
--
-- FIX: rewrite both functions as PL/pgSQL, running the query via EXECUTE format(...) with the
-- parameter values embedded as literals. This forces Postgres to build + plan a fresh, literal-
-- specific query on every call, matching the fast/well-estimated plan every time.
--
-- ALSO NOTE (schema drift): a second overload
--   get_customer_service_recent_top50_v2(p_days integer, p_actor_id uuid)
-- exists live in production but was never captured in a migration file (only the 1-arg
-- p_days-only overload from 20260813024000 is in git history). It's a thin wrapper delegating to
-- the core function below and is recreated here so migration history matches production.

create or replace function public.get_customer_service_recent_top50_core(p_days integer, p_scope text)
returns table(customer_rank integer, branch text, customer_code text, customer_name text, customer_phone text, recent_sales numeric, invoice_count bigint, active_months integer, avg_invoice numeric, last_purchase date, importance_score numeric)
language plpgsql stable security definer
set search_path=public,pg_catalog
as $$
declare
  v_days integer := greatest(coalesce(p_days,90),1);
  v_scope text := coalesce(nullif(btrim(p_scope),''),'ALL');
begin
  return query execute format($f$
    with base as (
      select s.branch,btrim(s.customer_code) customer_code,
        sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric recent_sales,
        count(*)::bigint invoice_count,
        count(distinct date_trunc('month',s.invoice_date))::integer active_months,
        avg(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric avg_invoice,
        max(s.invoice_date)::date last_purchase
      from public.sales_invoices s
      where s.invoice_date>=greatest(date_trunc('month',current_date)-interval '2 months',(current_date-%1$L::int)::timestamp)
        and s.invoice_date<(current_date+1)::timestamp
        and s.branch in ('فرع شكري','فرع الشامي')
        and (%2$L='ALL' or lower(btrim(s.branch))=%2$L)
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
    from enriched e order by e.branch,e.customer_rank
  $f$, v_days, v_scope);
end;
$$;

grant execute on function public.get_customer_service_recent_top50_core(integer,text) to anon,authenticated;

-- Previously-undocumented live overload: thin wrapper delegating to the core function.
create or replace function public.get_customer_service_recent_top50_v2(p_days integer default 90, p_actor_id uuid default null)
returns table(customer_rank integer, branch text, customer_code text, customer_name text, customer_phone text, recent_sales numeric, invoice_count bigint, active_months integer, avg_invoice numeric, last_purchase date, importance_score numeric)
language sql stable security definer
set search_path=public,pg_catalog
as $$
  select * from public.get_customer_service_recent_top50_core(p_days, public.dawaa_customer_service_queue_scope_v3(p_actor_id));
$$;

grant execute on function public.get_customer_service_recent_top50_v2(integer,uuid) to anon,authenticated;

create or replace function public.get_customer_service_three_cycle_intelligence_v1(p_as_of date default current_date, p_actor_id uuid default null)
returns table(branch text, customer_rank integer, customer_code text, customer_name text, customer_phone text, recent_sales numeric, last_purchase date, current_period_sales numeric, previous_period_sales numeric, prior_period_sales numeric, current_invoices bigint, previous_invoices bigint, prior_invoices bigint, baseline_sales numeric, change_vs_previous_pct numeric, change_vs_baseline_pct numeric, trend_state text, priority_score numeric, current_period_start date, current_period_end date, previous_period_start date, previous_period_end date, prior_period_start date, prior_period_end date)
language plpgsql stable security definer
set search_path=public,pg_catalog
as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_scope text := coalesce(nullif(public.dawaa_customer_service_queue_scope_v3(p_actor_id),''),'');
  v_current_start date;
  v_current_end date;
  v_previous_start date;
  v_previous_end date;
  v_prior_start date;
  v_prior_end date;
  v_recent_start date;
begin
  v_current_end := v_as_of;
  v_current_start := case when extract(day from v_as_of)::int>=26
    then date_trunc('month',v_as_of)::date+25
    else (date_trunc('month',v_as_of)::date-interval '1 month'+interval '25 days')::date end;
  v_recent_start := (date_trunc('month',v_as_of)-interval '2 months')::date;
  v_previous_start := (v_current_start-interval '1 month')::date;
  v_previous_end := (v_previous_start+(v_as_of-v_current_start))::date;
  v_prior_start := (v_current_start-interval '2 months')::date;
  v_prior_end := (v_prior_start+(v_as_of-v_current_start))::date;

  return query execute format($f$
    with agg as materialized (
      select s.branch,btrim(s.customer_code) customer_code,
        sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric recent_sales,
        count(*)::bigint invoice_count,
        count(distinct date_trunc('month',s.invoice_date))::integer active_months,
        avg(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0))::numeric avg_invoice,
        max(s.invoice_date)::date last_purchase,
        coalesce(sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)) filter(where s.invoice_date>=%3$L::timestamp and s.invoice_date<(%4$L::date+1)::timestamp),0)::numeric current_sales,
        coalesce(sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)) filter(where s.invoice_date>=%5$L::timestamp and s.invoice_date<(%6$L::date+1)::timestamp),0)::numeric previous_sales,
        coalesce(sum(coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)) filter(where s.invoice_date>=%7$L::timestamp and s.invoice_date<(%8$L::date+1)::timestamp),0)::numeric prior_sales,
        count(*) filter(where s.invoice_date>=%3$L::timestamp and s.invoice_date<(%4$L::date+1)::timestamp)::bigint current_count,
        count(*) filter(where s.invoice_date>=%5$L::timestamp and s.invoice_date<(%6$L::date+1)::timestamp)::bigint previous_count,
        count(*) filter(where s.invoice_date>=%7$L::timestamp and s.invoice_date<(%8$L::date+1)::timestamp)::bigint prior_count
      from public.sales_invoices s
      where s.invoice_date>=%1$L::timestamp and s.invoice_date<(%4$L::date+1)::timestamp
        and s.branch in ('فرع شكري','فرع الشامي')
        and (%9$L='ALL' or lower(btrim(s.branch))=%9$L)
        and nullif(btrim(s.customer_code),'') is not null
        and btrim(s.customer_code) not in ('5','10','54','170','12820')
        and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)>0
        and not exists(select 1 from public.customer_flags f where f.flag_key='wholesale_b2b' and coalesce(f.is_active,false) and f.customer_code=btrim(s.customer_code))
      group by s.branch,btrim(s.customer_code)
    ), scored as (
      select a.*,round((a.recent_sales*(0.70+0.10*least(a.active_months,3)))::numeric,2) importance_score
      from agg a
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
      round((c.recent_sales*case c.state when 'خطر فقد' then 1.45 when 'تراجع قوي' then 1.35 when 'تراجع' then 1.20 when 'نمو قوي' then 1.15 when 'نمو' then 1.08 when 'عميل صاعد جديد' then 1.10 else 1.00 end)::numeric,2),
      %2$L::date,%4$L::date,%5$L::date,%6$L::date,%7$L::date,%8$L::date
    from classified c
    order by c.branch,case c.state when 'خطر فقد' then 1 when 'تراجع قوي' then 2 when 'تراجع' then 3 when 'نمو قوي' then 4 when 'نمو' then 5 when 'عميل صاعد جديد' then 6 else 7 end,18 desc,c.customer_rank
  $f$, v_recent_start, v_current_start, v_current_start, v_current_end, v_previous_start, v_previous_end, v_prior_start, v_prior_end, v_scope);
end;
$$;

grant execute on function public.get_customer_service_three_cycle_intelligence_v1(date,uuid) to anon,authenticated;
