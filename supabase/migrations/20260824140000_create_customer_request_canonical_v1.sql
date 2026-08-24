-- Atomic canonical Customer Request creation boundary.
-- Validates customer/product/staff identity, authorizes the app actor, prevents a
-- 24-hour open duplicate and inserts the request + audit event in one transaction.

create or replace function public.create_customer_request_canonical_v1(
  p_customer_id uuid,
  p_product_id uuid,
  p_doctor_id uuid,
  p_branch text,
  p_quantity numeric default 1,
  p_urgency text default 'normal',
  p_request_type text default 'missing_medicine',
  p_channel text default null,
  p_needed_by_date date default null,
  p_expected_fulfillment_days integer default null,
  p_supplier_hint text default null,
  p_notes text default null,
  p_image_url text default null,
  p_image_path text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_identifier text := public.dawaa_request_staff_identifier();
  v_account public.staff_accounts%rowtype;
  v_customer public.customers%rowtype;
  v_product public.products%rowtype;
  v_doctor public.staff%rowtype;
  v_request public.customer_requests%rowtype;
  v_duplicate public.customer_requests%rowtype;
  v_effective_branch text;
  v_role text;
  v_actor_staff_id uuid;
  v_manager_role boolean := false;
  v_branch_limited boolean := false;
  v_account_branch text;
begin
  if v_identifier is null then raise exception 'not_authorized'; end if;

  select * into v_account
  from public.staff_accounts sa
  where sa.id::text = v_identifier
    and coalesce(sa.active,true)=true
    and coalesce(sa.can_login,true)=true
  limit 1;
  if not found then raise exception 'not_authorized'; end if;

  begin
    v_actor_staff_id := nullif(trim(coalesce(v_account.staff_id,'')),'')::uuid;
  exception when others then
    v_actor_staff_id := null;
  end;

  v_role := lower(trim(coalesce(v_account.role,'')));
  v_manager_role := v_role in ('general_manager','executive_manager','branches_manager','customer_service_manager','branch_manager');
  v_branch_limited := v_role in ('branch_manager','customer_service_manager');
  v_account_branch := nullif(trim(coalesce(v_account.branch,'')),'');

  if p_customer_id is null or p_product_id is null or p_doctor_id is null then
    raise exception 'canonical_identity_required';
  end if;
  if coalesce(p_quantity,0) <= 0 then raise exception 'invalid_quantity'; end if;

  select * into v_customer from public.customers c where c.id=p_customer_id;
  if not found or nullif(trim(coalesce(v_customer.customer_code,'')),'') is null then
    raise exception 'customer_not_canonical';
  end if;

  select * into v_product from public.products p where p.id=p_product_id;
  if not found or nullif(trim(coalesce(v_product.product_code,'')),'') is null then
    raise exception 'product_not_canonical';
  end if;

  select * into v_doctor from public.staff s
  where s.id=p_doctor_id and coalesce(s.is_active,true)=true and coalesce(s.active,true)=true;
  if not found then raise exception 'doctor_not_active_staff'; end if;

  if not v_manager_role then
    if v_actor_staff_id is null or v_actor_staff_id <> p_doctor_id then
      raise exception 'cannot_attribute_request_to_other_staff';
    end if;
  elsif v_branch_limited and v_account_branch is not null and v_account_branch <> 'كل الفروع' then
    if nullif(trim(coalesce(v_doctor.branch,'')),'') is distinct from v_account_branch then
      raise exception 'doctor_outside_actor_branch';
    end if;
  end if;

  -- Operational branch belongs to the doctor when available. The customer's
  -- reference branch remains unchanged in customers.
  v_effective_branch := coalesce(nullif(trim(coalesce(v_doctor.branch,'')),''),nullif(trim(coalesce(p_branch,'')),''),nullif(trim(coalesce(v_customer.branch,'')),''));
  if v_effective_branch is null or v_effective_branch='كل الفروع' then
    v_effective_branch := nullif(trim(coalesce(p_branch,'')), '');
  end if;
  if v_effective_branch is null then raise exception 'request_branch_required'; end if;

  select cr.* into v_duplicate
  from public.customer_requests cr
  where cr.customer_id=p_customer_id::text
    and cr.product_code=v_product.product_code
    and cr.branch=v_effective_branch
    and cr.status in ('new','purchasing_review','searching_suppliers','needs_customer_confirmation','customer_confirmed','sourcing','available','arrived','customer_contacted','not_available')
    and coalesce(cr.created_at,cr.requested_at,now()) >= now() - interval '24 hours'
  order by coalesce(cr.created_at,cr.requested_at) desc nulls last
  limit 1;

  if found then
    return jsonb_build_object('request',to_jsonb(v_duplicate),'duplicate',true);
  end if;

  insert into public.customer_requests(
    customer_id,customer_code,customer_name,customer_phone,branch,
    medicine_name,medicine_image_url,item_image_url,item_image_path,
    product_id,product_code,product_price,quantity,urgency,priority,is_urgent,
    status,request_type,source_request_channel,needed_by_date,expected_fulfillment_days,
    doctor_id,doctor_name,doctor_notes,supplier_hint,
    created_by,created_by_name,requested_at,created_at,updated_at
  ) values(
    v_customer.id::text,v_customer.customer_code,v_customer.name,coalesce(v_customer.phone,v_customer.mobile),v_effective_branch,
    v_product.name,p_image_url,p_image_url,p_image_path,
    v_product.id,v_product.product_code,v_product.price,p_quantity,
    coalesce(nullif(trim(p_urgency),''),'normal'),
    case when lower(coalesce(p_urgency,'')) in ('urgent','high') then 'high' else 'medium' end,
    lower(coalesce(p_urgency,'')) in ('urgent','high'),
    'new',coalesce(nullif(trim(p_request_type),''),'missing_medicine'),nullif(trim(coalesce(p_channel,'')),''),p_needed_by_date,p_expected_fulfillment_days,
    v_doctor.id,v_doctor.name,nullif(trim(coalesce(p_notes,'')),''),nullif(trim(coalesce(p_supplier_hint,'')),''),
    v_account.id::text,coalesce(nullif(trim(coalesce(v_account.staff_name,'')),''),nullif(trim(coalesce(v_account.name,'')),''),v_doctor.name),now(),now(),now()
  ) returning * into v_request;

  insert into public.customer_request_events(request_id,old_status,new_status,action,notes,created_by,created_by_name,created_at)
  values(
    v_request.id,null,'new','إنشاء طلب عميل',
    coalesce(nullif(trim(coalesce(p_notes,'')),''),'تم تسجيل طلب صنف: '||v_product.name),
    v_account.id::text,coalesce(nullif(trim(coalesce(v_account.staff_name,'')),''),nullif(trim(coalesce(v_account.name,'')),''),v_doctor.name),now()
  );

  return jsonb_build_object('request',to_jsonb(v_request),'duplicate',false);
end;
$$;

revoke all on function public.create_customer_request_canonical_v1(uuid,uuid,uuid,text,numeric,text,text,text,date,integer,text,text,text,text) from public;
grant execute on function public.create_customer_request_canonical_v1(uuid,uuid,uuid,text,numeric,text,text,text,date,integer,text,text,text,text) to anon,authenticated,service_role;
