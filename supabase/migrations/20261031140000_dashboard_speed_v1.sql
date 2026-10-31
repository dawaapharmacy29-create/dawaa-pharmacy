-- Dashboard speed (measured on Production 2026-10-31, small instance: 224MB shared_buffers).
--
-- 1) dawaa_customer_request_branch_key had `SET search_path`, which stops Postgres from inlining a SQL
--    function: every row paid a full function call (~0.4 ms). It is used by 46 functions and many RLS
--    policies (customer_requests among them). Same body, builtins qualified with pg_catalog, no SET:
--    1,291 customer requests went from 560 ms to 20 ms.
--
-- 2) Nine sales_invoices indexes had zero scans in 14 days of statistics (since 2026-10-17). Every
--    invoice sync still had to update them and they took cache space from the dashboard indexes.
--    Their definitions are kept below to recreate any of them. The loyalty phone index is kept on
--    purpose: the quarterly cashback batch runs on 1 Nov and is outside the statistics window.
--
-- 3) get_dashboard_monthly_sales_v172 re-read five months of invoices (~42k rows) on every dashboard
--    load. Closed months now come from dashboard_monthly_sales_cache, refreshed nightly; only the
--    current month (and any month missing from the cache) is read live. Same output shape.

-- 1) Inlinable branch key ---------------------------------------------------------------------------
create or replace function public.dawaa_customer_request_branch_key(p_branch text)
returns text
language sql
immutable
as $function$
  select case
    when pg_catalog.lower(pg_catalog.btrim(coalesce(p_branch, ''))) in ('فرع شكري', 'شكري', 'shokry', 'shoukry') then 'shokry'
    when pg_catalog.lower(pg_catalog.btrim(coalesce(p_branch, ''))) in ('فرع الشامي', 'الشامي', 'الشامى', 'elshamy', 'el-shamy', 'alshamy') then 'elshamy'
    when pg_catalog.btrim(coalesce(p_branch, '')) = '' then null
    else pg_catalog.lower(pg_catalog.btrim(p_branch))
  end
$function$;

-- 2) Unused sales_invoices indexes ------------------------------------------------------------------
-- CREATE INDEX idx_sales_invoices_invoice_no_key ON public.sales_invoices USING btree (invoice_no, invoice_date, branch);
-- CREATE INDEX idx_sales_invoices_seller_analysis ON public.sales_invoices USING btree (seller_name, analysis_datetime);
-- CREATE INDEX idx_sales_invoices_seller_name_trgm_v1 ON public.sales_invoices USING gin (seller_name gin_trgm_ops) WHERE ((seller_name IS NOT NULL) AND (btrim(seller_name) <> ''::text));
-- CREATE INDEX idx_sales_invoices_customer_name_date ON public.sales_invoices USING btree (customer_name, invoice_date);
-- CREATE INDEX sales_invoices_whatsapp_phone_invoice_datetime_idx ON public.sales_invoices USING btree (whatsapp_phone, invoice_datetime) WHERE ((whatsapp_phone IS NOT NULL) AND (btrim(whatsapp_phone) <> ''::text));
-- CREATE INDEX idx_sales_invoices_missing_staff_seller_date_v1 ON public.sales_invoices USING btree (seller_name, invoice_date DESC) WHERE (COALESCE(btrim(staff_id), ''::text) = ''::text);
-- CREATE INDEX sales_invoices_customer_phone_idx ON public.sales_invoices USING btree (customer_phone);
-- CREATE INDEX idx_sales_invoices_phone_compat ON public.sales_invoices USING btree (phone);
-- CREATE INDEX idx_sales_invoices_perf_staff_cairo_date_v2 ON public.sales_invoices USING btree (staff_id, (((invoice_date AT TIME ZONE 'Africa/Cairo'::text))::date)) WHERE (COALESCE(btrim(staff_id), ''::text) <> ''::text);
drop index if exists public.idx_sales_invoices_invoice_no_key;
drop index if exists public.idx_sales_invoices_seller_analysis;
drop index if exists public.idx_sales_invoices_seller_name_trgm_v1;
drop index if exists public.idx_sales_invoices_customer_name_date;
drop index if exists public.sales_invoices_whatsapp_phone_invoice_datetime_idx;
drop index if exists public.idx_sales_invoices_missing_staff_seller_date_v1;
drop index if exists public.sales_invoices_customer_phone_idx;
drop index if exists public.idx_sales_invoices_phone_compat;
drop index if exists public.idx_sales_invoices_perf_staff_cairo_date_v2;

-- 3) Closed-month sales cache -----------------------------------------------------------------------
create table if not exists public.dashboard_monthly_sales_cache (
  branch text not null,          -- '' = all branches, otherwise sales_invoices.branch as stored
  month_start date not null,
  invoices_count bigint not null,
  sales_total numeric not null,
  refreshed_at timestamptz not null default now(),
  primary key (branch, month_start)
);
alter table public.dashboard_monthly_sales_cache enable row level security;
revoke all on public.dashboard_monthly_sales_cache from public, anon, authenticated;

-- Recomputes the closed months of the last 24 with the exact window get_dashboard_monthly_sales_v172 uses.
create or replace function public.refresh_dashboard_monthly_sales_cache_v1()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_current date := date_trunc('month', (now() at time zone 'Africa/Cairo')::date)::date;
  v_rows integer;
begin
  with months as (
    select (v_current - make_interval(months => g))::date month_start
    from generate_series(1, 24) g
  ), s as (
    select date_trunc('month', si.invoice_date)::date month_start, si.branch,
           coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0) v
    from public.dawaa_sales_invoices_dashboard_v1 si
    where si.invoice_date >= (select min(month_start) from months)
      and si.invoice_date < v_current::timestamp
  )
  insert into public.dashboard_monthly_sales_cache(branch, month_start, invoices_count, sales_total, refreshed_at)
  select coalesce(s.branch, ''), s.month_start, count(s.v), coalesce(sum(s.v), 0), now()
  from s
  where s.month_start in (select month_start from months)
  group by grouping sets ((s.month_start, s.branch), (s.month_start))
  having grouping(s.branch) = 1 or nullif(s.branch, '') is not null
  on conflict (branch, month_start) do update
    set invoices_count = excluded.invoices_count, sales_total = excluded.sales_total, refreshed_at = excluded.refreshed_at;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;
revoke all on function public.refresh_dashboard_monthly_sales_cache_v1() from public, anon, authenticated;

create or replace function public.get_dashboard_monthly_sales_v172(p_end date, p_branch text default null, p_months integer default 5)
returns table(month_start date, month_end date, invoices_count bigint, sales_total numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
with months as (
  select m.month_start,
         case
           when m.month_start = date_trunc('month', p_end)::date
             then least(p_end, (m.month_start + interval '1 month' - interval '1 day')::date)
           else (m.month_start + interval '1 month' - interval '1 day')::date
         end as month_end
  from (
    select (date_trunc('month', p_end) - make_interval(months => g))::date as month_start
    from generate_series(0, greatest(1, least(coalesce(p_months, 5), 24)) - 1) g
  ) m
), cache_key as (
  select case when p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') then '' else p_branch end k
), cached as (
  -- Only whole months that are closed relative to both p_end and today.
  select c.month_start, c.invoices_count, c.sales_total
  from public.dashboard_monthly_sales_cache c
  join months m on m.month_start = c.month_start
  where c.branch = (select k from cache_key)
    and m.month_start < date_trunc('month', p_end)::date
    and m.month_start < date_trunc('month', (now() at time zone 'Africa/Cairo')::date)::date
), live_months as (
  select m.* from months m where not exists (select 1 from cached c where c.month_start = m.month_start)
), s as (
  select si.invoice_date,
         coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0) v
  from public.dawaa_sales_invoices_dashboard_v1 si
  where si.invoice_date >= (select min(month_start) from live_months)
    and si.invoice_date < (p_end + 1)::timestamp
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
), live as (
  select m.month_start, m.month_end, count(s.v)::bigint invoices_count, coalesce(sum(s.v),0)::numeric sales_total
  from live_months m
  left join s on s.invoice_date >= m.month_start and s.invoice_date < (m.month_end + 1)::timestamp
  group by m.month_start, m.month_end
)
select * from live
union all
select m.month_start, m.month_end, c.invoices_count, c.sales_total
from cached c join months m on m.month_start = c.month_start
order by 1;
$function$;

select public.refresh_dashboard_monthly_sales_cache_v1();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.schedule('dawaa-dashboard-monthly-sales-cache-v1', '50 1 * * *',
      'select public.refresh_dashboard_monthly_sales_cache_v1();')$q$;
  end if;
end;
$$;
