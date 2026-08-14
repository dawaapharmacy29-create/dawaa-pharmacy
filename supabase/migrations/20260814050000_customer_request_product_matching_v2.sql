create extension if not exists pg_trgm;

alter table public.customer_requests add column if not exists canonical_product_name text;
alter table public.customer_requests add column if not exists product_match_method text;
alter table public.customer_requests add column if not exists product_match_score numeric;
alter table public.customer_requests add column if not exists product_matched_at timestamptz;

create table if not exists public.product_name_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  alias_name text not null,
  normalized_alias text not null,
  source text not null default 'customer_request',
  usage_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(product_id, normalized_alias)
);

create index if not exists product_name_aliases_normalized_idx on public.product_name_aliases(normalized_alias);
create index if not exists products_normalized_name_trgm_idx on public.products using gin (normalized_name gin_trgm_ops);
create index if not exists customer_requests_open_product_idx on public.customer_requests(product_id,status,branch,requested_at);

create or replace function public.reconcile_customer_request_products_v2(p_limit int default 1000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_linked_code int := 0;
  v_linked_exact int := 0;
  v_linked_alias int := 0;
  v_linked_fuzzy int := 0;
begin
  if auth.uid() is null and coalesce(current_setting('request.headers', true),'') = '' then
    raise exception 'not_authorized';
  end if;

  with candidates as (
    select cr.id, p.id as product_id, p.product_code, p.name
    from public.customer_requests cr
    join public.products p on upper(btrim(p.product_code)) = upper(btrim(cr.product_code))
    where cr.product_id is null and nullif(btrim(cr.product_code),'') is not null
    order by coalesce(cr.requested_at,cr.created_at) desc nulls last
    limit greatest(1,least(coalesce(p_limit,1000),5000))
  )
  update public.customer_requests cr
  set product_id=c.product_id, product_code=c.product_code, canonical_product_name=c.name,
      product_match_method='code', product_match_score=1, product_matched_at=now(), updated_at=now()
  from candidates c where cr.id=c.id;
  get diagnostics v_linked_code = row_count;

  with unique_names as (
    select normalized_name,min(id) product_id,min(product_code) product_code,min(name) name
    from public.products where normalized_name is not null
    group by normalized_name having count(*)=1
  ), candidates as (
    select cr.id,u.product_id,u.product_code,u.name
    from public.customer_requests cr join unique_names u
      on public.normalize_product_name(cr.medicine_name)=u.normalized_name
    where cr.product_id is null
    order by coalesce(cr.requested_at,cr.created_at) desc nulls last
    limit greatest(1,least(coalesce(p_limit,1000),5000))
  )
  update public.customer_requests cr
  set product_id=c.product_id, product_code=c.product_code, canonical_product_name=c.name,
      product_match_method='exact_name', product_match_score=1, product_matched_at=now(), updated_at=now()
  from candidates c where cr.id=c.id;
  get diagnostics v_linked_exact = row_count;

  with alias_unique as (
    select normalized_alias,min(product_id) product_id from public.product_name_aliases
    group by normalized_alias having count(distinct product_id)=1
  ), candidates as (
    select cr.id,a.product_id,p.product_code,p.name
    from public.customer_requests cr
    join alias_unique a on public.normalize_product_name(cr.medicine_name)=a.normalized_alias
    join public.products p on p.id=a.product_id
    where cr.product_id is null
    order by coalesce(cr.requested_at,cr.created_at) desc nulls last
    limit greatest(1,least(coalesce(p_limit,1000),5000))
  )
  update public.customer_requests cr
  set product_id=c.product_id, product_code=c.product_code, canonical_product_name=c.name,
      product_match_method='alias', product_match_score=.99, product_matched_at=now(), updated_at=now()
  from candidates c where cr.id=c.id;
  get diagnostics v_linked_alias = row_count;

  with todo as (
    select id,medicine_name,public.normalize_product_name(medicine_name) n
    from public.customer_requests
    where product_id is null and nullif(public.normalize_product_name(medicine_name),'') is not null
    order by coalesce(requested_at,created_at) desc nulls last
    limit greatest(1,least(coalesce(p_limit,1000),2000))
  ), ranked as (
    select t.id,p.id product_id,p.product_code,p.name,
           similarity(t.n,p.normalized_name) score,
           lead(similarity(t.n,p.normalized_name)) over(partition by t.id order by similarity(t.n,p.normalized_name) desc) second_score,
           row_number() over(partition by t.id order by similarity(t.n,p.normalized_name) desc) rn
    from todo t
    join lateral (
      select id,product_code,name,normalized_name from public.products
      where normalized_name % t.n
      order by similarity(normalized_name,t.n) desc
      limit 2
    ) p on true
  ), best as (
    select * from ranked where rn=1 and score >= .78 and (second_score is null or score-second_score >= .10)
  )
  update public.customer_requests cr
  set product_id=b.product_id, product_code=b.product_code, canonical_product_name=b.name,
      product_match_method='fuzzy_high_confidence', product_match_score=round(b.score::numeric,4), product_matched_at=now(), updated_at=now()
  from best b where cr.id=b.id;
  get diagnostics v_linked_fuzzy = row_count;

  insert into public.product_name_aliases(product_id,alias_name,normalized_alias,source,usage_count,last_seen_at)
  select cr.product_id, min(cr.medicine_name), public.normalize_product_name(cr.medicine_name), 'customer_request', count(*)::int, now()
  from public.customer_requests cr
  where cr.product_id is not null and nullif(public.normalize_product_name(cr.medicine_name),'') is not null
  group by cr.product_id, public.normalize_product_name(cr.medicine_name)
  on conflict(product_id,normalized_alias) do update set
    usage_count=greatest(public.product_name_aliases.usage_count,excluded.usage_count),
    last_seen_at=now();

  return jsonb_build_object(
    'linked_by_code',v_linked_code,
    'linked_by_exact_name',v_linked_exact,
    'linked_by_alias',v_linked_alias,
    'linked_by_fuzzy',v_linked_fuzzy,
    'linked_total',v_linked_code+v_linked_exact+v_linked_alias+v_linked_fuzzy
  );
end;
$$;

create or replace function public.customer_request_unfulfilled_products_v1(p_branch text default 'all')
returns table(
  product_id uuid,
  product_code text,
  canonical_name text,
  requested_names text[],
  request_count bigint,
  total_quantity numeric,
  urgent_count bigint,
  customer_count bigint,
  branches text[],
  first_requested_at timestamptz,
  last_requested_at timestamptz,
  oldest_age_days int,
  match_quality text
)
language sql
security definer
set search_path=public
stable
as $$
  with open_requests as (
    select cr.* from public.customer_requests cr
    where coalesce(cr.status,'new') not in ('available','arrived','customer_contacted','delivered','closed','cancelled')
      and (coalesce(p_branch,'all')='all' or cr.branch=p_branch)
  ), grouped as (
    select
      cr.product_id,
      max(cr.product_code) product_code,
      max(coalesce(cr.canonical_product_name,p.name)) canonical_name,
      array_agg(distinct cr.medicine_name order by cr.medicine_name) requested_names,
      count(*) request_count,
      sum(coalesce(cr.quantity,1)) total_quantity,
      count(*) filter(where coalesce(cr.is_urgent,false) or lower(coalesce(cr.urgency,'')) in ('urgent','عاجل')) urgent_count,
      count(distinct coalesce(cr.customer_id::text,cr.customer_code,cr.customer_phone,cr.customer_name)) customer_count,
      array_agg(distinct coalesce(cr.branch,'غير محدد') order by coalesce(cr.branch,'غير محدد')) branches,
      min(coalesce(cr.requested_at,cr.created_at)) first_requested_at,
      max(coalesce(cr.requested_at,cr.created_at)) last_requested_at,
      floor(extract(epoch from (now()-min(coalesce(cr.requested_at,cr.created_at))))/86400)::int oldest_age_days,
      case when cr.product_id is null then 'غير مربوط' when min(coalesce(cr.product_match_score,0)) >= .95 then 'مؤكد' else 'مطابقة ذكية' end match_quality,
      public.normalize_product_name(cr.medicine_name) fallback_name
    from open_requests cr left join public.products p on p.id=cr.product_id
    group by cr.product_id, case when cr.product_id is null then public.normalize_product_name(cr.medicine_name) else null end, public.normalize_product_name(cr.medicine_name)
  )
  select product_id,product_code,canonical_name,requested_names,request_count,total_quantity,urgent_count,customer_count,branches,first_requested_at,last_requested_at,oldest_age_days,match_quality
  from grouped
  order by urgent_count desc, request_count desc, oldest_age_days desc, canonical_name nulls last;
$$;

revoke all on function public.reconcile_customer_request_products_v2(int) from public;
revoke all on function public.customer_request_unfulfilled_products_v1(text) from public;
grant execute on function public.reconcile_customer_request_products_v2(int) to authenticated,service_role;
grant execute on function public.customer_request_unfulfilled_products_v1(text) to authenticated,service_role;
