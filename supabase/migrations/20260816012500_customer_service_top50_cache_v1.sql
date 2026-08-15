-- Cache the expensive Customer Service Top-50 analytics for 30 minutes.
-- The cache table is not directly readable by app roles; access stays behind the SECURITY DEFINER RPC.

create table if not exists public.customer_service_analytics_cache_v1 (
  cache_key text primary key,
  payload jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now()
);

alter table public.customer_service_analytics_cache_v1 enable row level security;
revoke all on table public.customer_service_analytics_cache_v1 from anon, authenticated;

create or replace function public.get_customer_service_recent_top50_v2(
  p_days integer default 90,
  p_actor_id uuid default null
)
returns table(
  customer_rank integer,
  branch text,
  customer_code text,
  customer_name text,
  customer_phone text,
  recent_sales numeric,
  invoice_count bigint,
  active_months integer,
  avg_invoice numeric,
  last_purchase date,
  importance_score numeric
)
language plpgsql
volatile
security definer
set search_path=public,pg_catalog
as $$
declare
  v_scope text;
  v_key text;
  v_payload jsonb;
begin
  v_scope := public.dawaa_customer_service_queue_scope_v3(p_actor_id);
  v_key := 'top50|' || coalesce(v_scope,'ALL') || '|' || greatest(coalesce(p_days,90),1)::text || '|' || current_date::text;

  select c.payload into v_payload
  from public.customer_service_analytics_cache_v1 c
  where c.cache_key=v_key
    and c.computed_at >= now()-interval '30 minutes';

  if v_payload is null then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.branch,q.customer_rank),'[]'::jsonb)
      into v_payload
    from public.get_customer_service_recent_top50_core(greatest(coalesce(p_days,90),1),v_scope) q;

    insert into public.customer_service_analytics_cache_v1(cache_key,payload,computed_at)
    values(v_key,v_payload,now())
    on conflict(cache_key) do update set payload=excluded.payload,computed_at=excluded.computed_at;
  end if;

  return query
  select x.customer_rank,x.branch,x.customer_code,x.customer_name,x.customer_phone,
         x.recent_sales,x.invoice_count,x.active_months,x.avg_invoice,x.last_purchase,x.importance_score
  from jsonb_to_recordset(v_payload) as x(
    customer_rank integer,
    branch text,
    customer_code text,
    customer_name text,
    customer_phone text,
    recent_sales numeric,
    invoice_count bigint,
    active_months integer,
    avg_invoice numeric,
    last_purchase date,
    importance_score numeric
  )
  order by x.branch,x.customer_rank;
end;
$$;

grant execute on function public.get_customer_service_recent_top50_v2(integer,uuid) to anon,authenticated;
