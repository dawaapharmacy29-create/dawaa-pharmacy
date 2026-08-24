-- Preserve stable source staff UUIDs established by the canonical source boundary.
-- The older enrichment trigger used name resolution on every source_payload update
-- and could overwrite an explicit recorded_staff_id with NULL.

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
    select p.product_code,p.price,p.name
      into v_product
    from public.products p
    where p.id=new.product_id;

    if found then
      new.product_code := v_product.product_code;
      new.product_price := v_product.price;
    end if;
  else
    new.product_code := null;
    new.product_price := null;
  end if;

  if new.source_system='dawaawael'
     and new.source_entity='CustomerOrder' then
    v_assigned_name := nullif(trim(coalesce(
      new.source_payload->>'assigned_employee',
      new.source_assigned_employee,
      ''
    )), '');

    v_recorded_name := nullif(trim(coalesce(
      new.source_payload->>'recorded_by',
      new.created_by_name,
      ''
    )), '');

    if new.source_assigned_staff_id is null then
      new.source_assigned_staff_id :=
        public.customer_request_resolve_staff_id_v1(v_assigned_name);
    end if;

    if new.source_recorded_staff_id is null then
      new.source_recorded_staff_id :=
        public.customer_request_resolve_staff_id_v1(v_recorded_name);
    end if;
  end if;

  return new;
end;
$$;

comment on function public.customer_request_enrich_product_staff_v1() is
  'Enriches product metadata and fills missing source staff IDs without overwriting stable UUIDs already supplied by the canonical source boundary.';
