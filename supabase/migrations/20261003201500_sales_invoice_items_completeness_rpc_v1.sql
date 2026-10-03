-- Aggregate-only completeness gate for purchase demand evidence.
-- SECURITY INVOKER: underlying RLS/grants remain authoritative.
create or replace function public.sales_invoice_items_completeness_v1(
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns table(
  branch text,
  sales_date date,
  header_invoices bigint,
  item_invoices bigint,
  missing_item_invoices bigint,
  coverage_pct numeric,
  completeness_status text
)
language sql
stable
security invoker
set search_path = 'pg_catalog','public','pg_temp'
as $function$
  with h as (
    select
      case
        when trim(coalesce(si.branch_name,si.branch,'')) in ('فرع شكري','دواء شكري','شكري') then 'فرع شكري'
        when trim(coalesce(si.branch_name,si.branch,'')) in ('فرع الشامي','دواء الشامي','الشامي') then 'فرع الشامي'
      end branch,
      (coalesce(si.invoice_datetime,si.invoice_date) at time zone 'Africa/Cairo')::date sales_date,
      count(distinct coalesce(nullif(trim(si.invoice_number),''),nullif(trim(si.invoice_no),''))) header_invoices
    from public.sales_invoices si
    where coalesce(si.invoice_datetime,si.invoice_date) >= p_start_at
      and coalesce(si.invoice_datetime,si.invoice_date) <= p_end_at
      and trim(coalesce(si.branch_name,si.branch,'')) in ('فرع شكري','دواء شكري','شكري','فرع الشامي','دواء الشامي','الشامي')
    group by 1,2
  ), i as (
    select
      case
        when trim(coalesce(ii.branch,'')) in ('فرع شكري','دواء شكري','شكري') then 'فرع شكري'
        when trim(coalesce(ii.branch,'')) in ('فرع الشامي','دواء الشامي','الشامي') then 'فرع الشامي'
      end branch,
      (ii.invoice_date at time zone 'Africa/Cairo')::date sales_date,
      count(distinct nullif(trim(ii.invoice_number),'')) item_invoices
    from public.sales_invoice_items_v21 ii
    where ii.invoice_date >= p_start_at
      and ii.invoice_date <= p_end_at
      and trim(coalesce(ii.branch,'')) in ('فرع شكري','دواء شكري','شكري','فرع الشامي','دواء الشامي','الشامي')
    group by 1,2
  ), d as (
    select
      coalesce(h.branch,i.branch) branch,
      coalesce(h.sales_date,i.sales_date) sales_date,
      coalesce(h.header_invoices,0)::bigint header_invoices,
      coalesce(i.item_invoices,0)::bigint item_invoices
    from h full join i using(branch,sales_date)
  )
  select
    d.branch,d.sales_date,d.header_invoices,d.item_invoices,
    greatest(d.header_invoices-d.item_invoices,0)::bigint,
    case when d.header_invoices=0 then null
         else round(100.0*d.item_invoices/d.header_invoices,1) end,
    case
      when d.header_invoices=0 then 'no_headers'
      when d.item_invoices=0 then 'missing'
      when 100.0*d.item_invoices/d.header_invoices >= 99 then 'complete'
      when 100.0*d.item_invoices/d.header_invoices >= 95 then 'partial'
      else 'material_gap'
    end
  from d
  order by d.sales_date,d.branch
$function$;

revoke all on function public.sales_invoice_items_completeness_v1(timestamptz,timestamptz) from public,anon;
grant execute on function public.sales_invoice_items_completeness_v1(timestamptz,timestamptz) to authenticated;
