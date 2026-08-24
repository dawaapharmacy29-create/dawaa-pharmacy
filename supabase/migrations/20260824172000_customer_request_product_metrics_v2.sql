-- Focused product metrics for the currently visible Customer Requests page.
-- Avoid loading the full operational-insights payload just to render per-product fulfillment rates.

create or replace function public.get_customer_request_product_metrics_v2(
  p_product_codes text[],
  p_branch text default null,
  p_days integer default 90
)
returns table(
  product_code text,
  requests_count bigint,
  fulfilled_count bigint,
  fulfillment_rate numeric
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with normalized as (
    select distinct nullif(trim(code),'') as product_code
    from unnest(coalesce(p_product_codes,array[]::text[])) code
    where nullif(trim(code),'') is not null
    limit 100
  ),
  scoped as (
    select cr.product_code, cr.status
    from public.customer_requests cr
    join normalized n on n.product_code=cr.product_code
    where coalesce(cr.requested_at,cr.created_at,now()) >= now() - make_interval(days => greatest(1,least(coalesce(p_days,90),365)))
      and (
        p_branch is null
        or trim(coalesce(p_branch,''))=''
        or lower(trim(p_branch))='all'
        or public.dawaa_customer_request_branch_key(cr.branch)=public.dawaa_customer_request_branch_key(p_branch)
      )
      and public.dawaa_can_access_customer_request_branch('view_customer_requests',cr.branch)
  )
  select
    s.product_code,
    count(*)::bigint as requests_count,
    count(*) filter (where s.status in ('available','arrived','customer_contacted','delivered','closed'))::bigint as fulfilled_count,
    case when count(*)>0
      then round(100.0 * count(*) filter (where s.status in ('available','arrived','customer_contacted','delivered','closed')) / count(*),2)
      else null end as fulfillment_rate
  from scoped s
  group by s.product_code
  order by count(*) desc;
$$;

revoke all on function public.get_customer_request_product_metrics_v2(text[],text,integer) from public;
grant execute on function public.get_customer_request_product_metrics_v2(text[],text,integer)
  to anon, authenticated, service_role;

comment on function public.get_customer_request_product_metrics_v2(text[],text,integer) is
  'Branch-authorized focused fulfillment metrics for visible Customer Request product codes.';
