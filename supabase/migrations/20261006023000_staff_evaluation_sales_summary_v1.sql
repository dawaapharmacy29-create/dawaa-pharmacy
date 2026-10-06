-- Evaluation header intentionally reuses get_staff_performance_sales_bundle_v1.
-- This helper remains available for narrow consumers and avoids the legacy heavy invoice-truth payload.
create or replace function public.get_staff_evaluation_sales_summary_v1(
 p_staff_id uuid,p_start date,p_end_exclusive date
) returns table(sales numeric,invoices bigint,customers bigint,avg_invoice numeric,data_as_of date)
language sql stable set search_path=public,pg_catalog as $function$
with bundle as (
 select public.get_staff_performance_sales_bundle_v1(p_staff_id,p_start,p_end_exclusive,p_start,31) payload
), cycle as (
 select value row from bundle,jsonb_array_elements(coalesce(payload->'cycles','[]'::jsonb))
 where value->>'cycle_start'=p_start::text limit 1
)
select coalesce((row->>'sales')::numeric,0),coalesce((row->>'invoices')::bigint,0),
 coalesce((row->>'customers')::bigint,0),
 case when coalesce((row->>'invoices')::bigint,0)>0 then coalesce((row->>'sales')::numeric,0)/(row->>'invoices')::bigint else 0 end,
 (select (payload->>'dataAsOf')::date from bundle)
from cycle;
$function$;
revoke all on function public.get_staff_evaluation_sales_summary_v1(uuid,date,date) from public;
revoke execute on function public.get_staff_evaluation_sales_summary_v1(uuid,date,date) from anon;
grant execute on function public.get_staff_evaluation_sales_summary_v1(uuid,date,date) to authenticated;
