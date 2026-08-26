begin;

create or replace function public.dawaa_customer_cashback_fast_page_v1(
  p_cycle_start date,
  p_cycle_end date,
  p_branch text default null,
  p_status text default null,
  p_quick_filter text default 'all',
  p_search text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $function$
with params as (
  select
    public.dawaa_customer_points_allowed_branches_v1(false) as allowed_branches,
    nullif(trim(coalesce(p_branch,'')), '') as requested_branch,
    nullif(trim(coalesce(p_status,'')), '') as requested_status,
    lower(trim(coalesce(p_quick_filter,'all'))) as quick_filter,
    nullif(trim(coalesce(p_search,'')), '') as search_text,
    greatest(1, least(coalesce(p_limit,100), 200)) as page_limit,
    greatest(0, coalesce(p_offset,0)) as page_offset
), base as (
  select c.*
  from public.customer_cashback_cycles c
  cross join params p
  where c.cycle_start = p_cycle_start
    and c.cycle_end = p_cycle_end
    and c.branch = any(p.allowed_branches)
    and (p.requested_branch is null or p.requested_branch in ('__all__','كل الفروع') or c.branch = p.requested_branch)
    and (p.requested_status is null or p.requested_status in ('__all__','all') or coalesce(c.status,'calculated') = p.requested_status)
    and (
      p.search_text is null
      or coalesce(c.customer_name,'') ilike (case when p.search_text like '%*%' then replace(p.search_text,'*','%') else '%'||p.search_text||'%' end)
      or coalesce(c.customer_code,'') ilike (case when p.search_text like '%*%' then replace(p.search_text,'*','%') else '%'||p.search_text||'%' end)
      or coalesce(c.customer_phone,'') ilike (case when p.search_text like '%*%' then replace(p.search_text,'*','%') else '%'||p.search_text||'%' end)
    )
), filtered as (
  select b.*
  from base b
  cross join params p
  where case p.quick_filter
    when 'pending' then coalesce(b.status,'calculated') = 'calculated'
    when 'available' then greatest(0,coalesce(b.cashback_value,0)-coalesce(b.redeemed_value,0)) > 0
    when 'notified' then coalesce(b.status,'') = any(array['notified','bconnect_updated','partially_redeemed','settled'])
    when 'bconnect' then coalesce(b.status,'') = 'bconnect_updated'
    when 'partial' then coalesce(b.redeemed_value,0) > 0 and coalesce(b.status,'') <> 'settled'
    when 'settled' then coalesce(b.status,'') = 'settled'
    when 'rate3' then coalesce(b.cashback_rate,0) = 3
    when 'rate5' then coalesce(b.cashback_rate,0) = 5
    when 'systemlog' then coalesce(trim(b.notes),'') <> '' or b.notified_at is not null or b.bconnect_updated_at is not null or b.settled_at is not null or coalesce(b.redeemed_value,0) > 0
    else true
  end
), summary as (
  select jsonb_build_object(
    'total', count(*),
    'available', count(*) filter (where greatest(0,coalesce(cashback_value,0)-coalesce(redeemed_value,0)) > 0),
    'pending', count(*) filter (where coalesce(status,'calculated')='calculated'),
    'notified', count(*) filter (where coalesce(status,'') = any(array['notified','bconnect_updated','partially_redeemed','settled'])),
    'bconnect', count(*) filter (where coalesce(status,'')='bconnect_updated'),
    'partial', count(*) filter (where coalesce(redeemed_value,0)>0 and coalesce(status,'')<>'settled'),
    'settled', count(*) filter (where coalesce(status,'')='settled'),
    'rate3', count(*) filter (where coalesce(cashback_rate,0)=3),
    'rate5', count(*) filter (where coalesce(cashback_rate,0)=5),
    'systemLog', count(*) filter (where coalesce(trim(notes),'')<>'' or notified_at is not null or bconnect_updated_at is not null or settled_at is not null or coalesce(redeemed_value,0)>0)
  ) as value
  from base
), totals as (
  select jsonb_build_object(
    'count', count(*),
    'spent', coalesce(sum(total_spent),0),
    'cashback', coalesce(sum(cashback_value),0),
    'remaining', coalesce(sum(greatest(0,coalesce(cashback_value,0)-coalesce(redeemed_value,0))),0)
  ) as value
  from filtered
), page as (
  select f.*
  from filtered f
  cross join params p
  order by f.cashback_value desc nulls last, f.customer_name nulls last, f.id
  limit (select page_limit from params)
  offset (select page_offset from params)
), page_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,
    'customer_code',customer_code,
    'customer_name',customer_name,
    'customer_phone',customer_phone,
    'branch',branch,
    'cycle_label',cycle_label,
    'cycle_start',cycle_start,
    'cycle_end',cycle_end,
    'total_spent',total_spent,
    'cashback_rate',cashback_rate,
    'cashback_value',cashback_value,
    'redeemed_value',redeemed_value,
    'remaining_value',greatest(0,coalesce(cashback_value,0)-coalesce(redeemed_value,0)),
    'status',status,
    'notified_at',notified_at,
    'bconnect_updated_at',bconnect_updated_at,
    'settled_at',settled_at,
    'notes',notes
  ) order by cashback_value desc nulls last, customer_name nulls last, id), '[]'::jsonb) as value
  from page
)
select jsonb_build_object(
  'rows', page_json.value,
  'summary', summary.value,
  'totals', totals.value,
  'limit', (select page_limit from params),
  'offset', (select page_offset from params)
)
from page_json, summary, totals;
$function$;

revoke all on function public.dawaa_customer_cashback_fast_page_v1(date,date,text,text,text,text,integer,integer) from public;
grant execute on function public.dawaa_customer_cashback_fast_page_v1(date,date,text,text,text,text,integer,integer) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
