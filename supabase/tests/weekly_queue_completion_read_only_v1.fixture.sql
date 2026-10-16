-- Fixture for 20261015140100_weekly_queue_completion_read_only_v1.
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.customer_flags (customer_code text, flag_key text, is_active boolean);
create table public.daily_followups (branch text, customer_code text, date text);
create table public.dawaa_customer_sales_analytics_v1 (
  sale_date date, invoice_date timestamp, branch text, customer_code text,
  net_total numeric, net_amount numeric, discounted_amount numeric, total_amount numeric, amount numeric
);
create table public.customer_points_ledger (branch text, customer_code text, customer_name text, points_amount numeric, contacted_at timestamptz, expiry_date date);
create table public.customer_service_top50_cache (scope text primary key, computed_at timestamptz not null, payload jsonb not null);

-- Deterministic stand-in for the (dynamic SQL) core ranking, keyed by scope.
create table public.test_top50_source (scope text, customer_rank integer, branch text, customer_code text);
create or replace function public.get_customer_service_recent_top50_core(p_days integer, p_scope text)
returns table(customer_rank integer, branch text, customer_code text, customer_name text, customer_phone text, recent_sales numeric, invoice_count bigint, active_months integer, avg_invoice numeric, last_purchase date, importance_score numeric)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$
  select s.customer_rank, s.branch, s.customer_code, 'عميل '||s.customer_code, '', 100::numeric, 1::bigint, 1, 100::numeric, date '2026-10-01', (100 - s.customer_rank)::numeric
  from public.test_top50_source s where s.scope = p_scope order by s.branch, s.customer_rank
$$;

-- Production definition (2026-10-15) of the VOLATILE cache-refreshing reader.
create or replace function public.get_customer_service_recent_top50_cached(p_scope text)
returns table(customer_rank integer, branch text, customer_code text, customer_name text, customer_phone text, recent_sales numeric, invoice_count bigint, active_months integer, avg_invoice numeric, last_purchase date, importance_score numeric)
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_row public.customer_service_top50_cache%rowtype;
  v_payload jsonb;
begin
  select * into v_row from public.customer_service_top50_cache c where c.scope = p_scope;
  if v_row.scope is null or v_row.computed_at < now() - interval '2 hours' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_payload
    from public.get_customer_service_recent_top50_core(90, p_scope) t;
    insert into public.customer_service_top50_cache (scope, computed_at, payload)
    values (p_scope, now(), v_payload)
    on conflict (scope) do update set computed_at = excluded.computed_at, payload = excluded.payload
    returning * into v_row;
  end if;
  return query
  select (x->>'customer_rank')::integer, x->>'branch', x->>'customer_code', x->>'customer_name', x->>'customer_phone',
    (x->>'recent_sales')::numeric, (x->>'invoice_count')::bigint, (x->>'active_months')::integer,
    (x->>'avg_invoice')::numeric, (x->>'last_purchase')::date, (x->>'importance_score')::numeric
  from jsonb_array_elements(v_row.payload) x;
end;
$function$;

-- Data: 9 ranked VIP customers per branch, some handled; +500 sales; points balances.
insert into public.test_top50_source (scope, customer_rank, branch, customer_code)
select sc, r, b, left(b, 3) || '-' || r
from unnest(array['all','فرع شكري']) sc
cross join generate_series(1, 9) r
cross join unnest(array['فرع شكري','فرع الشامي']) b
where sc = 'all' or b = sc;

insert into public.daily_followups (branch, customer_code, date)
select 'فرع شكري', 'فرع-' || r, d::date::text
from generate_series(1, 9, 2) r cross join generate_series(date '2026-10-10', date '2026-10-16', interval '1 day') d;

insert into public.dawaa_customer_sales_analytics_v1 (sale_date, invoice_date, branch, customer_code, net_total, amount)
values (date '2026-10-11', '2026-10-11', 'فرع الشامي', 'P500-1', 700, 700),
       (date '2026-10-12', '2026-10-12', 'فرع شكري', 'P500-2', 900, 900),
       (date '2026-10-12', '2026-10-12', 'فرع شكري', 'P500-3', 100, 100);
insert into public.daily_followups (branch, customer_code, date) values ('فرع شكري', 'P500-2', '2026-10-12');

insert into public.customer_points_ledger (branch, customer_code, customer_name, points_amount, contacted_at, expiry_date)
values ('فرع شكري', 'L-1', 'عميل أول', 50, '2026-10-13 10:00+02', null),
       ('فرع الشامي', 'L-2', 'عميل ثاني', 20, null, date '2026-12-31'),
       ('فرع الشامي', 'L-3', 'عميل نقدي', 90, null, null);

-- The previous queue function body (Production, calling the VOLATILE cached reader) as the parity oracle.
create or replace function public.test_old_weekly_queue_completion(p_branch text, p_week_start date, p_week_end date)
returns table(days_counted integer, total_items integer, total_handled integer, completion_rate numeric)
language sql security definer set search_path to 'public', 'pg_catalog'
as $function$
with params as (select lower(btrim(coalesce(p_branch,''))) scope),
days as materialized (select d::date queue_date from generate_series(p_week_start::timestamp,p_week_end::timestamp,interval '1 day') d),
branches as (select b from (values ('فرع شكري'),('فرع الشامي')) x(b), params p where p.scope='all' or lower(btrim(b))=p.scope),
excluded as materialized (select customer_code from public.customer_flags where flag_key in ('wholesale_b2b','system_generic_code') and coalesce(is_active,false)),
top50 as materialized (select t.* from public.get_customer_service_recent_top50_cached((select scope from params)) t),
vip_daily as materialized (
  select d.queue_date,t.branch,t.customer_code,
    row_number() over(partition by d.queue_date,t.branch order by mod((t.customer_rank-1)-mod((d.queue_date-date '2026-01-01')::integer*7,50)+50,50),t.customer_rank)::integer branch_daily_order
  from days d join top50 t on true),
vip as (
  select v.queue_date,v.branch,
    count(*) filter(where v.branch_daily_order<=7)::integer total,
    count(*) filter(where v.branch_daily_order<=7 and exists(select 1 from public.daily_followups f where f.branch=v.branch and btrim(f.customer_code)=v.customer_code and f.date=v.queue_date::text))::integer handled
  from vip_daily v group by v.queue_date,v.branch),
plus500_customers as materialized (
  select s.sale_date::date queue_date,s.branch,btrim(s.customer_code) customer_code
  from public.dawaa_customer_sales_analytics_v1 s, params p
  where s.sale_date between p_week_start and p_week_end and s.branch in ('فرع شكري','فرع الشامي')
    and (p.scope='all' or lower(btrim(s.branch))=p.scope) and nullif(btrim(s.customer_code),'') is not null
    and coalesce(nullif(s.net_total,0),nullif(s.net_amount,0),nullif(s.discounted_amount,0),nullif(s.total_amount,0),nullif(s.amount,0),0)>=500
    and not exists(select 1 from excluded x where x.customer_code=btrim(s.customer_code))
  group by s.sale_date::date,s.branch,btrim(s.customer_code)),
plus500 as (
  select p.queue_date,p.branch,count(*)::integer total,
    count(*) filter(where exists(select 1 from public.daily_followups f where f.branch=p.branch and btrim(f.customer_code)=p.customer_code and f.date=p.queue_date::text))::integer handled
  from plus500_customers p group by p.queue_date,p.branch),
point_balances as materialized (
  select d.queue_date,l.branch,btrim(l.customer_code) customer_code, sum(coalesce(l.points_amount,0))::numeric points_balance, max(l.contacted_at) last_contacted_at
  from days d join public.customer_points_ledger l
    on l.branch in ('فرع شكري','فرع الشامي') and ((select scope from params)='all' or lower(btrim(l.branch))=(select scope from params))
   and nullif(btrim(l.customer_code),'') is not null and nullif(btrim(l.customer_name),'') is not null
   and btrim(l.customer_name) not in ('عميل الصيدلية','عميل نقدي','عميل عابر','كاش','عميل','.')
   and (l.expiry_date is null or l.expiry_date>=d.queue_date)
  where not exists(select 1 from excluded x where x.customer_code=btrim(l.customer_code))
  group by d.queue_date,l.branch,btrim(l.customer_code) having sum(coalesce(l.points_amount,0))>0),
points_ranked as materialized (select p.*, row_number() over(partition by p.queue_date,p.branch order by p.last_contacted_at asc nulls first,p.points_balance desc,p.customer_code)::integer rn from point_balances p),
points as (
  select p.queue_date,p.branch, count(*) filter(where p.rn<=10)::integer total,
    count(*) filter(where p.rn<=10 and p.last_contacted_at is not null and p.last_contacted_at::date=p.queue_date)::integer handled
  from points_ranked p group by p.queue_date,p.branch),
daily as (
  select d.queue_date,b.b branch, coalesce(v.total,0)+coalesce(p.total,0)+coalesce(pt.total,0) total, coalesce(v.handled,0)+coalesce(p.handled,0)+coalesce(pt.handled,0) handled
  from days d cross join branches b
  left join vip v on v.queue_date=d.queue_date and v.branch=b.b
  left join plus500 p on p.queue_date=d.queue_date and p.branch=b.b
  left join points pt on pt.queue_date=d.queue_date and pt.branch=b.b),
agg as (select count(distinct queue_date) filter(where total>0)::integer days_counted, coalesce(sum(total),0)::integer total_items, coalesce(sum(handled),0)::integer total_handled from daily)
select a.days_counted,a.total_items,a.total_handled, case when a.total_items>0 then round(a.total_handled::numeric/a.total_items::numeric*100,1) else null end completion_rate
from agg a;
$function$;

-- A placeholder for the Production STABLE queue function, replaced by the migration.
create or replace function public.get_customer_service_weekly_queue_completion_v1(p_branch text, p_week_start date, p_week_end date)
returns table(days_counted integer, total_items integer, total_handled integer, completion_rate numeric)
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select * from public.test_old_weekly_queue_completion(p_branch, p_week_start, p_week_end) $$;
revoke all on function public.get_customer_service_weekly_queue_completion_v1(text,date,date) from public;
grant execute on function public.get_customer_service_weekly_queue_completion_v1(text,date,date) to anon, authenticated, service_role;
