create or replace function public.get_staff_performance_sales_truth_v1(
  p_staff_id uuid,
  p_start date,
  p_end date
) returns jsonb
language sql
stable
set search_path = public, pg_catalog
as $function$
with staff_row as (
  select s.id, s.name from public.staff s where s.id = p_staff_id limit 1
),
aliases as materialized (
  select public.normalize_cs_identity_name(sr.name) norm from staff_row sr
  union
  select public.normalize_cs_identity_name(a.alias_name)
  from public.staff_identity_aliases a
  where a.staff_id = p_staff_id and coalesce(a.active, true)
),
matched as materialized (
  select si.id, si.invoice_date, si.customer_code, si.customer_phone,
    coalesce(nullif(si.net_total,0),nullif(si.net_amount,0),nullif(si.discounted_amount,0),
      nullif(si.total_amount,0),nullif(si.amount,0),nullif(si.gross_total,0),nullif(si.gross_amount,0),0)::numeric resolved_amount
  from public.sales_invoices si
  where si.invoice_date >= p_start and si.invoice_date < (p_end + 1)::timestamp
    and (
      si.staff_id = p_staff_id::text
      or (
        coalesce(btrim(si.staff_id),'') = ''
        and public.normalize_cs_identity_name(coalesce(nullif(btrim(si.normalized_seller_name),''),
          nullif(btrim(si.seller_name),''),nullif(btrim(si.staff_name),'')))
          in (select norm from aliases where norm <> '')
      )
    )
)
select jsonb_build_object(
  'rows', coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'invoice_date',invoice_date,'customer_code',customer_code,
    'customer_phone',customer_phone,'amount',resolved_amount
  ) order by invoice_date desc,id),'[]'::jsonb),
  'matchedCount',count(*)::bigint,
  'matchedSales',coalesce(sum(resolved_amount),0)::numeric
)
from matched;
$function$;

revoke all on function public.get_staff_performance_sales_truth_v1(uuid,date,date) from public;
revoke execute on function public.get_staff_performance_sales_truth_v1(uuid,date,date) from anon;
grant execute on function public.get_staff_performance_sales_truth_v1(uuid,date,date) to authenticated;
