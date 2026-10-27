-- Executive dashboard monthly trend in one read instead of one RPC per month.
--
-- Measured on production (2026-10-27): the dashboard fired 5 concurrent
-- get_dashboard_sales_summary_v171 calls (one per month) inside a 32-request page
-- load. Alone the call runs in ~125 ms; under that fan-out pg_stat_statements shows a
-- 3.1 s mean (max 14 s) — contention, not a bad plan.
--
-- Numbers must stay identical to v171, so this function:
-- - reads the same view (dawaa_sales_invoices_dashboard_v1: same pending/draft and
--   excluded-customer-code rules),
-- - uses the same value expression and branch predicate,
-- - uses the same half-open bounds per month: invoice_date >= month_start and
--   invoice_date < (month_end + 1)::timestamp,
-- - keeps the month windows the client used: calendar months ending at p_end's
--   month, where only that last month is cut at p_end. No cycle (26→25) semantics
--   are introduced or changed here.

create or replace function public.get_dashboard_monthly_sales_v172(
  p_end date,
  p_branch text default null,
  p_months integer default 5
)
returns table(month_start date, month_end date, invoices_count bigint, sales_total numeric)
language sql
stable
security definer
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
), s as (
  select si.invoice_date,
         coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0) v
  from public.dawaa_sales_invoices_dashboard_v1 si
  where si.invoice_date >= (select min(month_start) from months)
    and si.invoice_date < (p_end + 1)::timestamp
    and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch)
)
select m.month_start, m.month_end, count(s.v)::bigint, coalesce(sum(s.v),0)::numeric
from months m
left join s on s.invoice_date >= m.month_start and s.invoice_date < (m.month_end + 1)::timestamp
group by m.month_start, m.month_end
order by m.month_start;
$function$;

revoke all on function public.get_dashboard_monthly_sales_v172(date, text, integer) from public;
grant execute on function public.get_dashboard_monthly_sales_v172(date, text, integer) to anon, authenticated, service_role;

comment on function public.get_dashboard_monthly_sales_v172(date, text, integer) is
  'Monthly sales trend in one pass; per-month totals identical to get_dashboard_sales_summary_v171.';

notify pgrst, 'reload schema';
