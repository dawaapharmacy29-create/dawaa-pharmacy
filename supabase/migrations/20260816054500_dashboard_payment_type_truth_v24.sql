-- Keep payment-type cards on the same canonical clean invoice truth as the executive dashboard.
create or replace function public.get_sales_payment_type_breakdown(
  p_start date,
  p_end date,
  p_branch text default 'ALL'
) returns table(
  invoice_type text,
  invoice_count bigint,
  total_value numeric,
  avg_invoice numeric,
  pct_of_value numeric,
  pct_of_count numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_start date := coalesce(p_start, current_date - 30);
  v_end date := coalesce(p_end, current_date);
  v_branch text := coalesce(nullif(btrim(p_branch),''),'ALL');
begin
  return query execute format($f$
    with base as (
      select
        coalesce(nullif(btrim(s.invoice_type),''),'غير محدد') as itype,
        coalesce(s.net_amount,s.net_total,s.total_amount,s.amount,s.discounted_amount,s.gross_amount,0)::numeric as val
      from public.dawaa_sales_invoices_dashboard_v1 s
      where s.invoice_date >= %1$L::timestamp
        and s.invoice_date < (%2$L::date + 1)::timestamp
        and s.branch in ('فرع شكري','فرع الشامي')
        and (%3$L='ALL' or lower(btrim(s.branch))=lower(%3$L))
    )
    select
      b.itype,
      count(*)::bigint,
      round(sum(b.val)::numeric,2),
      round((sum(b.val)/nullif(count(*),0))::numeric,2),
      round((sum(b.val)/nullif(sum(sum(b.val)) over(),0)*100)::numeric,1),
      round((count(*)::numeric/nullif(sum(count(*)) over(),0)*100)::numeric,1)
    from base b
    group by b.itype
    order by sum(b.val) desc
  $f$, v_start, v_end, v_branch);
end;
$$;

grant execute on function public.get_sales_payment_type_breakdown(date,date,text) to anon, authenticated;
