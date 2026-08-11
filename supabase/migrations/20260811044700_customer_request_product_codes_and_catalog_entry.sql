alter table public.customer_requests add column if not exists product_id uuid null references public.products(id) on delete set null;
alter table public.customer_requests add column if not exists product_code text null;
alter table public.customer_requests add column if not exists product_price numeric null;

create index if not exists idx_customer_requests_product_id on public.customer_requests(product_id);
create index if not exists idx_customer_requests_product_code on public.customer_requests(product_code);

create or replace function public.dawaa_has_active_app_session()
returns boolean
language sql
stable security definer
set search_path to 'public','pg_catalog'
as $$
  select exists (
    select 1
    from public.staff_accounts sa
    where sa.id::text = coalesce(
      nullif(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id',''),
      nullif(auth.uid()::text,'')
    )
      and coalesce(sa.active,true)=true
      and coalesce(sa.can_login,true)=true
  );
$$;

create or replace function public.search_products_catalog(p_query text, p_limit integer default 20)
returns table(id uuid, product_code text, name text, price numeric)
language sql
stable security definer
set search_path to 'public'
as $$
  select p.id,p.product_code,p.name,p.price
  from public.products p
  where (auth.uid() is not null or public.dawaa_has_active_app_session())
    and (trim(coalesce(p_query,'')) = ''
      or p.product_code ilike '%'||trim(p_query)||'%'
      or p.name ilike '%'||trim(p_query)||'%')
  order by
    case when upper(p.product_code)=upper(trim(p_query)) then 0
         when lower(p.name)=lower(trim(p_query)) then 1
         when p.name ilike trim(p_query)||'%' then 2 else 3 end,
    p.name
  limit least(greatest(coalesce(p_limit,20),1),50);
$$;

create or replace function public.create_product_catalog_item(p_code text, p_name text, p_price numeric default null)
returns table(id uuid, product_code text, name text, price numeric)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_code text := upper(trim(coalesce(p_code,'')));
  v_name text := trim(coalesce(p_name,''));
  v_id uuid;
begin
  if not (auth.uid() is not null or public.dawaa_has_active_app_session()) then raise exception 'not_authorized'; end if;
  if v_code = '' then raise exception 'product_code_required'; end if;
  if v_name = '' then raise exception 'product_name_required'; end if;

  insert into public.products(product_code,name,normalized_name,price,source,updated_at)
  values(v_code,v_name,public.normalize_product_name(v_name),p_price,'manual_request_entry',now())
  on conflict (product_code) where product_code is not null
  do update set
    name = case when excluded.name <> '' then excluded.name else public.products.name end,
    normalized_name = public.normalize_product_name(case when excluded.name <> '' then excluded.name else public.products.name end),
    price = coalesce(excluded.price, public.products.price),
    updated_at = now()
  returning products.id into v_id;

  return query select p.id,p.product_code,p.name,p.price from public.products p where p.id=v_id;
end;
$$;

create or replace function public.link_customer_request_product(p_request_id uuid, p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare p public.products%rowtype;
begin
  if not (auth.uid() is not null or public.dawaa_has_active_app_session()) then raise exception 'not_authorized'; end if;
  select * into p from public.products where id=p_product_id;
  if p.id is null then raise exception 'product_not_found'; end if;

  update public.customer_requests
  set product_id=p.id, product_code=p.product_code, product_price=p.price, medicine_name=p.name, updated_at=now()
  where id=p_request_id;

  return jsonb_build_object('linked',found,'product_id',p.id,'product_code',p.product_code,'price',p.price);
end;
$$;

grant execute on function public.search_products_catalog(text,integer) to anon, authenticated, service_role;
grant execute on function public.create_product_catalog_item(text,text,numeric) to anon, authenticated, service_role;
grant execute on function public.link_customer_request_product(uuid,uuid) to anon, authenticated, service_role;
