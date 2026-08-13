create or replace function public.get_customer_service_three_cycle_intelligence_v1(
  p_as_of date default current_date,
  p_actor_id uuid default null
)
returns table(
  branch text,
  customer_rank integer,
  customer_code text,
  customer_name text,
  customer_phone text,
  recent_sales numeric,
  last_purchase date,
  current_period_sales numeric,
  previous_period_sales numeric,
  prior_period_sales numeric,
  current_invoices bigint,
  previous_invoices bigint,
  prior_invoices bigint,
  baseline_sales numeric,
  change_vs_previous_pct numeric,
  change_vs_baseline_pct numeric,
  trend_state text,
  priority_score numeric,
  current_period_start date,
  current_period_end date,
  previous_period_start date,
  previous_period_end date,
  prior_period_start date,
  prior_period_end date
)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
  with bounds as (
    select case
      when extract(day from p_as_of)::int >= 26 then (date_trunc('month', p_as_of)::date + 25)
      else (date_trunc('month', p_as_of)::date - interval '1 month' + interval '25 days')::date
    end as current_start
  ), periods as (
    select b.current_start, p_as_of as current_end,
      (b.current_start - interval '1 month')::date as previous_start,
      ((b.current_start - interval '1 month')::date + (p_as_of - b.current_start))::date as previous_end,
      (b.current_start - interval '2 months')::date as prior_start,
      ((b.current_start - interval '2 months')::date + (p_as_of - b.current_start))::date as prior_end
    from bounds b
  ), top50 as (
    select * from public.get_customer_service_recent_top50_v2(90, p_actor_id)
  ), sales as (
    select t.branch,t.customer_rank,t.customer_code,t.customer_name,t.customer_phone,t.recent_sales,t.last_purchase,
      p.current_start,p.current_end,p.previous_start,p.previous_end,p.prior_start,p.prior_end,
      coalesce(sum(case when s.invoice_date::date between p.current_start and p.current_end then coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0) else 0 end),0)::numeric as current_sales,
      coalesce(sum(case when s.invoice_date::date between p.previous_start and p.previous_end then coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0) else 0 end),0)::numeric as previous_sales,
      coalesce(sum(case when s.invoice_date::date between p.prior_start and p.prior_end then coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0) else 0 end),0)::numeric as prior_sales,
      count(*) filter (where s.invoice_date::date between p.current_start and p.current_end)::bigint as current_count,
      count(*) filter (where s.invoice_date::date between p.previous_start and p.previous_end)::bigint as previous_count,
      count(*) filter (where s.invoice_date::date between p.prior_start and p.prior_end)::bigint as prior_count
    from top50 t cross join periods p
    left join public.sales_invoices s on s.branch=t.branch and btrim(coalesce(s.customer_code,''))=t.customer_code
      and s.invoice_date::date between p.prior_start and p.current_end and coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,0)>0
    group by t.branch,t.customer_rank,t.customer_code,t.customer_name,t.customer_phone,t.recent_sales,t.last_purchase,
      p.current_start,p.current_end,p.previous_start,p.previous_end,p.prior_start,p.prior_end
  ), calculated as (
    select s.*, ((s.previous_sales+s.prior_sales)/2.0)::numeric as baseline,
      case when s.previous_sales>0 then ((s.current_sales-s.previous_sales)/s.previous_sales*100.0)::numeric else null end as vs_previous,
      case when (s.previous_sales+s.prior_sales)>0 then ((s.current_sales-((s.previous_sales+s.prior_sales)/2.0))/((s.previous_sales+s.prior_sales)/2.0)*100.0)::numeric else null end as vs_baseline
    from sales s
  ), classified as (
    select c.*, case
      when c.current_sales=0 and c.baseline>=500 then 'خطر فقد'
      when c.baseline>=500 and c.current_sales < c.baseline*0.60 then 'تراجع قوي'
      when c.baseline>=500 and c.current_sales < c.baseline*0.85 then 'تراجع'
      when c.current_sales>=500 and c.baseline>0 and c.current_sales > c.baseline*1.35 then 'نمو قوي'
      when c.current_sales>=500 and c.baseline>0 and c.current_sales > c.baseline*1.10 then 'نمو'
      when c.current_sales>=500 and c.baseline=0 then 'عميل صاعد جديد'
      else 'مستقر'
    end as state from calculated c
  )
  select c.branch,c.customer_rank,c.customer_code,c.customer_name,c.customer_phone,round(c.recent_sales,2),c.last_purchase,
    round(c.current_sales,2),round(c.previous_sales,2),round(c.prior_sales,2),c.current_count,c.previous_count,c.prior_count,
    round(c.baseline,2),round(c.vs_previous,1),round(c.vs_baseline,1),c.state,
    round((c.recent_sales * case c.state when 'خطر فقد' then 1.45 when 'تراجع قوي' then 1.35 when 'تراجع' then 1.20 when 'نمو قوي' then 1.15 when 'نمو' then 1.08 when 'عميل صاعد جديد' then 1.10 else 1.00 end)::numeric,2) as priority_score,
    c.current_start,c.current_end,c.previous_start,c.previous_end,c.prior_start,c.prior_end
  from classified c
  order by c.branch,
    case c.state when 'خطر فقد' then 1 when 'تراجع قوي' then 2 when 'تراجع' then 3 when 'نمو قوي' then 4 when 'نمو' then 5 when 'عميل صاعد جديد' then 6 else 7 end,
    priority_score desc,c.customer_rank;
$$;

grant execute on function public.get_customer_service_three_cycle_intelligence_v1(date, uuid) to authenticated, anon;
