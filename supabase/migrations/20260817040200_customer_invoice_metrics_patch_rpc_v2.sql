-- Server-side aggregate used to refresh list-page customer metrics without
-- downloading thousands of invoice rows for a page of customers.
-- This deliberately preserves the existing list patch semantics by reading
-- sales_invoices directly and using the same amount precedence as the current
-- frontend fallback.

create or replace function public.get_customer_invoice_metrics_patch_v1(p_customer_codes text[])
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
security definer
set search_path = public, pg_catalog
as $$
  select
    si.customer_code,
    count(*)::bigint as invoices_count,
    coalesce(sum(coalesce(si.net_amount, si.discounted_amount, si.amount, si.gross_amount, 0)),0)::numeric as total_spent,
    min(si.invoice_date::date) as first_purchase,
    max(si.invoice_date::date) as last_purchase,
    count(distinct date_trunc('month', si.invoice_date))::bigint as active_months
  from public.sales_invoices si
  where si.customer_code = any(coalesce(p_customer_codes, array[]::text[]))
  group by si.customer_code;
$$;

grant execute on function public.get_customer_invoice_metrics_patch_v1(text[]) to authenticated, service_role;
