-- Keep branch/target/doctor sales truth independent from customer-service exclusions.
-- Sales truth excludes only explicit codes 5,10,54,170,4902,12820 plus pending invoices.
-- Customer analytics additionally excludes wholesale_b2b and system_generic_code.

create or replace view public.dawaa_customer_sales_analytics_v1 as
select si.*
from public.dawaa_sales_invoices_dashboard_v1 si
where not exists (
  select 1
  from public.customer_flags cf
  where cf.flag_key in ('wholesale_b2b','system_generic_code')
    and coalesce(cf.is_active,false)
    and cf.customer_code=btrim(coalesce(si.customer_code,''))
);

comment on view public.dawaa_customer_sales_analytics_v1 is
  'Customer analytics truth: sales truth plus customer-service exclusions wholesale_b2b and system_generic_code.';

create or replace function public.dawaa_is_customer_analytics_excluded_v1(p_customer_code text)
returns boolean
language sql
stable
set search_path to 'public','pg_catalog'
as $function$
  select exists (
    select 1 from public.customer_flags cf
    where cf.flag_key in ('wholesale_b2b','system_generic_code')
      and coalesce(cf.is_active,false)
      and cf.customer_code=btrim(coalesce(p_customer_code,''))
  );
$function$;

-- Customer/followup routines that consume canonical sales are explicitly moved
-- to customer analytics truth, preventing future sales-policy changes from altering
-- VIP, follow-up, points, customer cards, cohorts, or customer metrics.
do $do$
declare
  r record;
  v_def text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and (p.proname ilike '%customer%' or p.proname ilike '%followup%')
      and pg_get_functiondef(p.oid) like '%public.dawaa_sales_invoices_dashboard_v1%'
  loop
    v_def := pg_get_functiondef(r.oid);
    v_def := replace(v_def,'public.dawaa_sales_invoices_dashboard_v1','public.dawaa_customer_sales_analytics_v1');
    execute v_def;
  end loop;
end
$do$;

-- Align the cached/background doctor metrics with the same source used by doctor dashboards.
create or replace function public.refresh_doctor_metrics_daily()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today date := current_date;
  v_month_start date := date_trunc('month', current_date)::date;
  v_month_cycle text := to_char(current_date, 'YYYY-MM');
  v_count integer := 0;
begin
  with doctors as (
    select s.id doctor_id,s.name doctor_name,s.branch,
           public.dawaa_normalize_doctor_name(s.name) norm_name
    from public.staff s
    where s.role='صيدلاني' and coalesce(s.is_active,true)=true
  ), invoice_truth as materialized (
    select public.dawaa_normalize_doctor_name(
             coalesce(nullif(btrim(i.seller_name),''),nullif(btrim(i.staff_name),''),nullif(btrim(i.normalized_seller_name),''))
           ) norm_name,
           i.invoice_date,
           coalesce(nullif(i.net_total,0),nullif(i.net_amount,0),nullif(i.discounted_amount,0),nullif(i.total_amount,0),nullif(i.amount,0),0)::numeric value
    from public.dawaa_sales_invoices_dashboard_v1 i
    where i.invoice_date>=v_month_start::timestamp and i.invoice_date<(v_today+1)::timestamp
  ), daily as (
    select d.doctor_id,coalesce(sum(i.value),0) daily_sales,count(*) daily_invoice_count
    from doctors d join invoice_truth i on i.norm_name=d.norm_name
    where i.invoice_date>=v_today::timestamp and i.invoice_date<(v_today+1)::timestamp
    group by d.doctor_id
  ), monthly as (
    select d.doctor_id,coalesce(sum(i.value),0) monthly_sales,count(*) monthly_invoice_count
    from doctors d join invoice_truth i on i.norm_name=d.norm_name
    group by d.doctor_id
  ), pending as (
    select d.doctor_id,count(*) customers_to_contact
    from doctors d join public.daily_followups f
      on public.dawaa_normalize_doctor_name(f.assigned_doctor)=d.norm_name
     and coalesce(f.open_case,true)=true
    group by d.doctor_id
  ), points as (
    select d.doctor_id,coalesce(sum(t.points_delta),0) points_balance
    from doctors d join public.employee_transactions t
      on t.staff_id=d.doctor_id and t.status='active' and t.month_cycle=v_month_cycle
    group by d.doctor_id
  )
  insert into public.doctor_metrics(
    doctor_id,doctor_name,branch,metric_date,daily_sales,monthly_sales,
    daily_invoice_count,monthly_invoice_count,points_balance,rewards_balance,
    discount_balance,customers_to_contact,updated_at
  )
  select d.doctor_id,d.doctor_name,d.branch,v_today,
         coalesce(dl.daily_sales,0),coalesce(m.monthly_sales,0),
         coalesce(dl.daily_invoice_count,0),coalesce(m.monthly_invoice_count,0),
         coalesce(pt.points_balance,0)::int,0,0,coalesce(p.customers_to_contact,0),now()
  from doctors d
  left join daily dl on dl.doctor_id=d.doctor_id
  left join monthly m on m.doctor_id=d.doctor_id
  left join pending p on p.doctor_id=d.doctor_id
  left join points pt on pt.doctor_id=d.doctor_id
  on conflict (doctor_id,metric_date) do update set
    doctor_name=excluded.doctor_name,branch=excluded.branch,
    daily_sales=excluded.daily_sales,monthly_sales=excluded.monthly_sales,
    daily_invoice_count=excluded.daily_invoice_count,monthly_invoice_count=excluded.monthly_invoice_count,
    points_balance=excluded.points_balance,customers_to_contact=excluded.customers_to_contact,updated_at=now();

  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;
