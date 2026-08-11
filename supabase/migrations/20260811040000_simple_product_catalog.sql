alter table public.products add column if not exists product_code text;
alter table public.products add column if not exists normalized_name text;
alter table public.products add column if not exists updated_at timestamp without time zone default now();
alter table public.products add column if not exists source text default 'catalog_import';

create unique index if not exists products_product_code_uidx on public.products (lower(product_code)) where product_code is not null;
create unique index if not exists products_product_code_plain_uidx on public.products(product_code) where product_code is not null;
create index if not exists products_normalized_name_idx on public.products(normalized_name);

alter table public.customer_requests add column if not exists product_id uuid references public.products(id) on delete set null;
create index if not exists customer_requests_product_id_idx on public.customer_requests(product_id);
alter table public.purchase_order_items_v13 add column if not exists product_id uuid references public.products(id) on delete set null;
create index if not exists purchase_order_items_v13_product_id_idx on public.purchase_order_items_v13(product_id);
alter table public.shortage_items add column if not exists product_id uuid references public.products(id) on delete set null;
create index if not exists shortage_items_product_id_idx on public.shortage_items(product_id);

create or replace function public.normalize_product_name(p_name text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(lower(coalesce(p_name,'')), '[^a-z0-9\u0600-\u06ff]+', ' ', 'g')), '');
$$;

create or replace function public.import_products_catalog(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_code text; v_name text; v_price numeric; v_count int := 0;
begin
  if not public.is_app_admin() then raise exception 'not_authorized'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows_must_be_array'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_code := upper(trim(r->>'code'));
    v_name := trim(r->>'name');
    begin v_price := nullif(r->>'price','')::numeric; exception when others then v_price := null; end;
    if coalesce(v_code,'') = '' or coalesce(v_name,'') = '' then continue; end if;
    insert into public.products(product_code,name,normalized_name,price,source,updated_at)
    values(v_code,v_name,public.normalize_product_name(v_name),v_price,'catalog_import',now())
    on conflict (product_code) where product_code is not null
    do update set name=excluded.name,normalized_name=excluded.normalized_name,price=excluded.price,source='catalog_import',updated_at=now();
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('processed',v_count);
end;
$$;

create or replace function public.search_products_catalog(p_query text,p_limit int default 20)
returns table(id uuid,product_code text,name text,price numeric)
language sql security definer set search_path = public stable as $$
  select p.id,p.product_code,p.name,p.price from public.products p
  where auth.uid() is not null and (trim(coalesce(p_query,''))='' or p.product_code ilike '%'||trim(p_query)||'%' or p.name ilike '%'||trim(p_query)||'%')
  order by case when upper(p.product_code)=upper(trim(p_query)) then 0 when lower(p.name)=lower(trim(p_query)) then 1 when p.name ilike trim(p_query)||'%' then 2 else 3 end,p.name
  limit least(greatest(coalesce(p_limit,20),1),50);
$$;

create or replace function public.auto_link_customer_request_products()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  if not public.is_app_admin() then raise exception 'not_authorized'; end if;
  with unique_products as (
    select normalized_name,min(id) as id from public.products where normalized_name is not null group by normalized_name having count(*)=1
  )
  update public.customer_requests cr set product_id=up.id from unique_products up
  where cr.product_id is null and public.normalize_product_name(cr.medicine_name)=up.normalized_name;
  get diagnostics v_count = row_count;
  return jsonb_build_object('linked',v_count);
end;
$$;

create or replace function public.products_catalog_summary()
returns jsonb language sql security definer set search_path = public stable as $$
  select case when auth.uid() is null then '{}'::jsonb else jsonb_build_object(
    'total',count(*),'with_price',count(*) filter(where price is not null and price>0),'last_updated_at',max(updated_at)
  ) end from public.products;
$$;

revoke all on function public.normalize_product_name(text) from public;
revoke all on function public.import_products_catalog(jsonb) from public;
revoke all on function public.search_products_catalog(text,int) from public;
revoke all on function public.auto_link_customer_request_products() from public;
revoke all on function public.products_catalog_summary() from public;
grant execute on function public.normalize_product_name(text) to authenticated,service_role;
grant execute on function public.import_products_catalog(jsonb) to authenticated,service_role;
grant execute on function public.search_products_catalog(text,int) to authenticated,service_role;
grant execute on function public.auto_link_customer_request_products() to authenticated,service_role;
grant execute on function public.products_catalog_summary() to authenticated,service_role;