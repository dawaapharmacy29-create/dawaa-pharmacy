create or replace function public.get_doctor_dashboard_branch_cycle_v1(
  p_branch text,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
  with bounds as (
    select p_start as start_date, least(p_end, current_date) as end_date
  ), truth as (
    select
      count(*)::bigint as invoices_count,
      coalesce(sum(coalesce(net_amount, discounted_amount, total_amount, amount, gross_amount, net_total, 0)), 0) as sales_total,
      coalesce(sum(coalesce(line_items_count, 0)), 0) as items_count
    from public.dawaa_sales_invoices_dashboard_v1, bounds b
    where branch = p_branch
      and invoice_date >= b.start_date
      and invoice_date < (b.end_date + 1)
  )
  select jsonb_build_object(
    'branch', p_branch,
    'start_date', b.start_date,
    'end_date', b.end_date,
    'sales_total', t.sales_total,
    'invoices_count', t.invoices_count,
    'items_count', t.items_count,
    'avg_invoice', case when t.invoices_count > 0 then t.sales_total / t.invoices_count else 0 end
  )
  from bounds b cross join truth t;
$function$;

grant execute on function public.get_doctor_dashboard_branch_cycle_v1(text,date,date) to anon, authenticated;
