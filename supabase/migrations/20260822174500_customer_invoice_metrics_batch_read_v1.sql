create or replace function public.get_customer_invoice_metrics_batch_v1(p_customer_codes text[])
returns table(
  customer_code text,
  invoices_count bigint,
  total_spent numeric,
  first_purchase date,
  last_purchase date,
  active_months bigint
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $function$
  select
    btrim(si.customer_code) as customer_code,
    count(*)::bigint as invoices_count,
    coalesce(sum(
      coalesce(
        nullif(si.net_amount,0),
        nullif(si.discounted_amount,0),
        nullif(si.amount,0),
        nullif(si.gross_amount,0),
        0
      )
    ),0)::numeric as total_spent,
    min(si.invoice_date::date) as first_purchase,
    max(si.invoice_date::date) as last_purchase,
    count(distinct to_char(si.invoice_date, 'YYYY-MM'))::bigint as active_months
  from public.sales_invoices si
  where p_customer_codes is not null
    and cardinality(p_customer_codes) > 0
    and btrim(si.customer_code) = any(p_customer_codes)
  group by btrim(si.customer_code);
$function$;
