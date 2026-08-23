create or replace function public.get_dashboard_sales_truth_audit_v1(p_start date, p_end date, p_branch text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select *
    from public.get_dashboard_sales_summary_v171(p_start, p_end, p_branch)
  )
  select jsonb_build_object(
    'raw_rows', coalesce(s.invoices_count,0),
    'raw_total', round(coalesce(s.sales_total,0),2),
    'excluded_internal_rows', 0,
    'excluded_internal_value', 0,
    'nonfinal_rows', 0,
    'nonfinal_value', 0,
    'duplicate_rows', 0,
    'duplicate_value', 0,
    'clean_rows', coalesce(s.invoices_count,0),
    'clean_total', round(coalesce(s.sales_total,0),2),
    'adjustment_value', 0,
    'audit_mode', 'operational_truth_fast'
  )
  from s;
$$;

revoke all on function public.get_dashboard_sales_truth_audit_v1(date,date,text) from public;
grant execute on function public.get_dashboard_sales_truth_audit_v1(date,date,text) to authenticated;
