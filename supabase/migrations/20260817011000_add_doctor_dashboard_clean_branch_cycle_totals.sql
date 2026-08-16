create or replace function public.get_doctor_dashboard_branch_cycle_v1(p_branch text,p_start date,p_end date)
returns jsonb
language sql stable security definer set search_path='public','pg_catalog' as $$
  select jsonb_build_object(
    'branch',p_branch,
    'start_date',p_start,
    'end_date',p_end,
    'sales_total',coalesce(sum(coalesce(net_total,net_amount,discounted_amount,total_amount,amount,0)),0),
    'invoices_count',count(*),
    'items_count',coalesce(sum(coalesce(line_items_count,0)),0),
    'avg_invoice',case when count(*)>0 then coalesce(sum(coalesce(net_total,net_amount,discounted_amount,total_amount,amount,0)),0)/count(*) else 0 end
  )
  from public.dawaa_sales_invoices_dashboard_v1
  where branch=p_branch and coalesce(invoice_date::date,sale_date,created_at::date) between p_start and p_end;
$$;

grant execute on function public.get_doctor_dashboard_branch_cycle_v1(text,date,date) to authenticated, anon, service_role;
