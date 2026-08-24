-- Legacy/manual product linking remains available during the V2 rollout, but it
-- must obey the same manage_customer_requests branch scope as request updates.

create or replace function public.link_customer_request_product(
  p_request_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_product public.products%rowtype;
  v_branch text;
begin
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select cr.branch into v_branch
  from public.customer_requests cr
  where cr.id = p_request_id;
  if not found then raise exception 'customer_request_not_found'; end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests', v_branch) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_product from public.products where id = p_product_id;
  if v_product.id is null then raise exception 'product_not_found'; end if;

  update public.customer_requests
  set product_id = v_product.id,
      product_code = v_product.product_code,
      product_price = v_product.price,
      medicine_name = v_product.name,
      updated_at = now()
  where id = p_request_id;

  return jsonb_build_object(
    'linked', found,
    'product_id', v_product.id,
    'product_code', v_product.product_code,
    'price', v_product.price
  );
end;
$$;

revoke execute on function public.link_customer_request_product(uuid, uuid) from public;
grant execute on function public.link_customer_request_product(uuid, uuid) to anon, authenticated, service_role;
