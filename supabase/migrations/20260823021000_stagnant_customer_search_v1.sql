create or replace function public.search_stagnant_customers_v1(
  p_search text,
  p_branch text default null,
  p_limit integer default 50
)
returns table(
  customer_id text,
  customer_name text,
  customer_code text,
  customer_phone text,
  branch text,
  last_invoice_date timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
with p as (
  select nullif(btrim(coalesce(p_search,'')),'') as q,
         regexp_replace(coalesce(p_search,''),'\D','','g') as digits
)
select
  c.id::text,
  coalesce(nullif(c.customer_name,''),c.name)::text,
  coalesce(nullif(c.customer_code,''),nullif(c.code,''))::text,
  coalesce(nullif(c.customer_phone,''),nullif(c.phone,''),nullif(c.whatsapp_phone,''),nullif(c.mobile,''),nullif(c.whatsapp,''))::text,
  coalesce(nullif(c.effective_branch,''),nullif(c.corrected_branch,''),nullif(c.branch_name,''),c.branch)::text,
  c.last_order_date::timestamptz
from public.customers c cross join p
where p.q is not null
  and (
    p_branch is null or btrim(p_branch)='' or p_branch in ('الكل','كل الفروع','all')
    or coalesce(nullif(c.effective_branch,''),nullif(c.corrected_branch,''),nullif(c.branch_name,''),c.branch)=p_branch
  )
  and (
    coalesce(c.customer_name,c.name,'') ilike '%' || p.q || '%'
    or coalesce(c.customer_phone,c.phone,c.whatsapp_phone,'') ilike '%' || p.q || '%'
    or coalesce(c.customer_code,c.code,'') = p.q
    or (length(p.digits)>=4 and regexp_replace(coalesce(c.phone,c.mobile,c.whatsapp,''),'\D','','g') like '%' || p.digits)
  )
order by c.last_order_date desc nulls last,c.name
limit least(100,greatest(1,coalesce(p_limit,50)));
$$;

revoke all on function public.search_stagnant_customers_v1(text,text,integer) from public;
grant execute on function public.search_stagnant_customers_v1(text,text,integer) to authenticated;
