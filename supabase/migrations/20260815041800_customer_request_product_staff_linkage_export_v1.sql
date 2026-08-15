alter table public.customer_requests
  add column if not exists source_assigned_staff_id uuid references public.staff(id) on delete set null,
  add column if not exists source_recorded_staff_id uuid references public.staff(id) on delete set null;

create or replace function public.customer_request_resolve_staff_id_v1(p_name text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_norm text := lower(regexp_replace(trim(coalesce(p_name,'')), '\s+', ' ', 'g'));
  v_ids uuid[];
begin
  if v_norm = '' then return null; end if;

  select array_agg(distinct staff_id) into v_ids
  from (
    select s.id as staff_id
    from public.staff s
    where coalesce(s.is_active,true)=true
      and lower(regexp_replace(trim(coalesce(s.name,'')), '\s+', ' ', 'g')) = v_norm
    union
    select a.staff_id
    from public.staff_identity_aliases a
    join public.staff s on s.id=a.staff_id
    where coalesce(a.active,true)=true
      and coalesce(s.is_active,true)=true
      and lower(regexp_replace(trim(coalesce(a.alias_name,'')), '\s+', ' ', 'g')) = v_norm
  ) q;

  if coalesce(array_length(v_ids,1),0)=1 then return v_ids[1]; end if;
  return null;
end;
$$;

revoke all on function public.customer_request_resolve_staff_id_v1(text) from public, anon, authenticated;

create or replace function public.customer_request_enrich_product_staff_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assigned_name text;
  v_recorded_name text;
  v_product record;
begin
  if new.product_id is not null then
    select p.product_code,p.price,p.name into v_product
    from public.products p where p.id=new.product_id;
    if found then
      new.product_code := v_product.product_code;
      new.product_price := v_product.price;
    end if;
  else
    new.product_code := null;
    new.product_price := null;
  end if;

  if new.source_system='dawaawael' and new.source_entity='CustomerOrder' then
    v_assigned_name := nullif(trim(coalesce(new.source_payload->>'assigned_employee', new.source_assigned_employee, '')), '');
    v_recorded_name := nullif(trim(coalesce(new.source_payload->>'recorded_by', new.created_by_name, '')), '');
    new.source_assigned_staff_id := public.customer_request_resolve_staff_id_v1(v_assigned_name);
    new.source_recorded_staff_id := public.customer_request_resolve_staff_id_v1(v_recorded_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customer_request_enrich_product_staff_v1 on public.customer_requests;
create trigger trg_customer_request_enrich_product_staff_v1
before insert or update of product_id,source_system,source_entity,source_payload,source_assigned_employee,created_by_name
on public.customer_requests
for each row execute function public.customer_request_enrich_product_staff_v1();

update public.customer_requests
set product_id=product_id, source_payload=source_payload
where source_system='dawaawael' and source_entity='CustomerOrder';

create or replace function public.get_customer_request_product_staff_audit_v1(p_branch text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with base as (
  select * from public.customer_requests cr
  where cr.source_system='dawaawael' and cr.source_entity='CustomerOrder'
    and (p_branch is null or p_branch='' or p_branch='all' or cr.branch=p_branch)
), counts as (
  select
    count(*)::int total,
    count(*) filter(where product_id is not null)::int product_linked,
    count(*) filter(where product_id is not null and coalesce(trim(product_code),'')<>'')::int product_code_ready,
    count(*) filter(where product_id is not null and product_price is not null)::int product_price_ready,
    count(*) filter(where product_id is null)::int product_unlinked,
    count(*) filter(where coalesce(trim(source_assigned_employee),'')<>'')::int source_employee_named,
    count(*) filter(where source_assigned_staff_id is not null)::int source_employee_linked,
    count(*) filter(where coalesce(trim(source_payload->>'recorded_by'),'')<>'')::int source_recorded_named,
    count(*) filter(where source_recorded_staff_id is not null)::int source_recorded_linked,
    count(*) filter(where branch is null or trim(branch)='')::int no_branch,
    count(*) filter(where sync_conflict)::int sync_conflicts
  from base
), unlinked as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'order_number',source_order_number,'medicine_name',medicine_name,'quantity',quantity,
    'branch',branch,'employee',source_assigned_employee,'requested_at',requested_at
  ) order by requested_at desc) filter(where rn<=30),'[]'::jsonb) rows
  from (select b.*,row_number() over(order by requested_at desc nulls last) rn from base b where product_id is null) q
)
select jsonb_build_object('summary',to_jsonb(counts),'unlinked_products',unlinked.rows)
from counts cross join unlinked;
$$;

grant execute on function public.get_customer_request_product_staff_audit_v1(text) to authenticated, service_role;

create or replace function public.get_customer_request_supplier_export_v1(p_branch text default null)
returns table(
  product_id uuid,
  product_code text,
  product_name text,
  reference_price numeric,
  total_quantity numeric,
  requests_count bigint,
  branches text,
  linkage_status text
)
language sql
stable
security definer
set search_path = public
as $$
with base as (
  select cr.*, p.product_code as catalog_code,p.name as catalog_name,p.price as catalog_price
  from public.customer_requests cr
  left join public.products p on p.id=cr.product_id
  where cr.source_system='dawaawael' and cr.source_entity='CustomerOrder'
    and cr.status not in ('closed','delivered','cancelled','not_available')
    and (p_branch is null or p_branch='' or p_branch='all' or cr.branch=p_branch)
), grouped as (
  select
    product_id,
    max(coalesce(catalog_code,product_code)) product_code,
    case when product_id is not null then max(coalesce(catalog_name,medicine_name)) else max(medicine_name) end product_name,
    max(coalesce(catalog_price,product_price,source_selling_price)) reference_price,
    sum(greatest(coalesce(quantity,1),0)) total_quantity,
    count(*) requests_count,
    string_agg(distinct coalesce(branch,'بدون فرع'),'، ' order by coalesce(branch,'بدون فرع')) branches,
    case when product_id is not null and max(coalesce(catalog_code,product_code)) is not null then 'verified' else 'needs_link' end linkage_status,
    coalesce(product_id::text, public.normalize_product_name(medicine_name)) group_key
  from base
  group by product_id, coalesce(product_id::text, public.normalize_product_name(medicine_name))
)
select product_id,product_code,product_name,reference_price,total_quantity,requests_count,branches,linkage_status
from grouped
order by (linkage_status='verified') desc, product_name;
$$;

grant execute on function public.get_customer_request_supplier_export_v1(text) to authenticated, service_role;