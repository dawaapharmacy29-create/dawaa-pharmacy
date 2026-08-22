create or replace function public.get_dashboard_monthly_sales_v2(
  p_end date,
  p_branch text default null,
  p_months integer default 5
)
returns table(
  month_start date,
  month_label text,
  branch text,
  sales_total numeric,
  invoices_count bigint,
  avg_invoice numeric
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  i integer;
  m_start date;
  m_end date;
  m_count integer := greatest(1, least(coalesce(p_months, 5), 24));
begin
  for i in reverse (m_count - 1)..0 loop
    m_start := (date_trunc('month', p_end::timestamp) - (i || ' month')::interval)::date;
    m_end := least((m_start + interval '1 month - 1 day')::date, p_end);
    return query
      select
        m_start,
        to_char(m_start, 'YYYY-MM'),
        coalesce(nullif(btrim(p_branch),''), 'كل الفروع'),
        coalesce(sum(coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)),0)::numeric,
        count(*)::bigint,
        case when count(*) > 0 then
          coalesce(sum(coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),nullif(si.total_amount,0),nullif(si.amount,0),0)),0)::numeric / count(*)
        else 0 end::numeric
      from public.dawaa_sales_invoices_dashboard_v1 si
      where si.invoice_date >= m_start::timestamp
        and si.invoice_date < (m_end + 1)::timestamp
        and (p_branch is null or btrim(p_branch)='' or p_branch in ('كل الفروع','الكل') or si.branch=p_branch);
  end loop;
end;
$function$;

grant execute on function public.get_dashboard_monthly_sales_v2(date,text,integer) to authenticated, anon;
