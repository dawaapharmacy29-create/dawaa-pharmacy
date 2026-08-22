create or replace function public.get_doctor_dashboard_daily_trend_v1(
  p_branch text,
  p_doctor_name text,
  p_start date,
  p_end date
)
returns table(
  sale_date date,
  net_sales numeric,
  invoices_count bigint,
  avg_invoice numeric
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
with bounds as (
  select p_start as start_date, least(p_end, current_date) as end_date
), target as (
  select public.normalize_cs_identity_name(p_doctor_name) as doctor_norm
), rows_for_doctor as (
  select
    si.invoice_date::date as sale_date,
    coalesce(
      nullif(si.net_total, 0),
      nullif(si.net_amount, 0),
      nullif(si.discounted_amount, 0),
      nullif(si.total_amount, 0),
      nullif(si.amount, 0),
      0
    )::numeric as amount
  from public.dawaa_sales_invoices_dashboard_v1 si
  cross join bounds b
  cross join target t
  where si.branch = p_branch
    and si.invoice_date >= b.start_date
    and si.invoice_date < (b.end_date + 1)::timestamp
    and public.normalize_cs_identity_name(
      coalesce(
        nullif(btrim(si.seller_name), ''),
        nullif(btrim(si.staff_name), ''),
        nullif(btrim(si.normalized_seller_name), '')
      )
    ) = t.doctor_norm
)
select
  r.sale_date,
  coalesce(sum(r.amount), 0)::numeric as net_sales,
  count(*)::bigint as invoices_count,
  case
    when count(*) > 0 then coalesce(sum(r.amount), 0)::numeric / count(*)
    else 0
  end::numeric as avg_invoice
from rows_for_doctor r
group by r.sale_date
order by r.sale_date;
$function$;

grant execute on function public.get_doctor_dashboard_daily_trend_v1(text, text, date, date) to authenticated, anon;
