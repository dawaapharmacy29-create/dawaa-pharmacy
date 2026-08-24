-- Atomic customer-identity repair for Customer Requests V2.
-- The client supplies only canonical IDs; display fields are copied from customers inside the DB.

create or replace function public.repair_customer_request_customer_v2(
  p_request_id uuid,
  p_customer_id uuid,
  p_keep_request_branch boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_account_id uuid;
  v_actor_staff_id uuid;
  v_actor_name text;
  v_request public.customer_requests%rowtype;
  v_updated public.customer_requests%rowtype;
  v_customer public.customers%rowtype;
  v_customer_code text;
  v_customer_name text;
  v_customer_phone text;
  v_customer_branch text;
  v_target_branch text;
begin
  v_actor_account_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_account_id is null then raise exception 'staff_context_required'; end if;

  select * into v_request
  from public.customer_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'customer_request_not_found'; end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_request.branch) then
    raise exception 'customer_request_manage_forbidden';
  end if;

  select * into v_customer
  from public.customers
  where id=p_customer_id;
  if not found then raise exception 'customer_not_found'; end if;

  if coalesce(v_customer.is_duplicate,false) or v_customer.merged_into_customer_id is not null then
    raise exception 'customer_identity_not_canonical';
  end if;

  v_customer_code := coalesce(
    nullif(trim(v_customer.effective_customer_code),''),
    nullif(trim(v_customer.customer_code),''),
    nullif(trim(v_customer.code),'')
  );
  v_customer_name := coalesce(
    nullif(trim(v_customer.display_name),''),
    nullif(trim(v_customer.name),''),
    nullif(trim(v_customer.customer_name),'')
  );
  v_customer_phone := coalesce(
    nullif(trim(v_customer.phone),''),
    nullif(trim(v_customer.customer_phone),''),
    nullif(trim(v_customer.mobile),''),
    nullif(trim(v_customer.whatsapp_phone),''),
    nullif(trim(v_customer.whatsapp),'')
  );
  v_customer_branch := coalesce(
    nullif(trim(v_customer.effective_branch),''),
    nullif(trim(v_customer.corrected_branch),''),
    nullif(trim(v_customer.branch),''),
    nullif(trim(v_customer.branch_name),'')
  );

  if v_customer_code is null then raise exception 'customer_code_missing'; end if;
  if v_customer_name is null then raise exception 'customer_name_missing'; end if;

  v_target_branch := v_request.branch;
  if not coalesce(p_keep_request_branch,true) then
    if public.dawaa_customer_request_branch_key(v_customer_branch) is null then
      raise exception 'customer_branch_invalid';
    end if;
    v_target_branch := case public.dawaa_customer_request_branch_key(v_customer_branch)
      when 'shokry' then 'فرع شكري'
      when 'elshamy' then 'فرع الشامي'
      else v_customer_branch
    end;
    if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_target_branch) then
      raise exception 'customer_request_target_branch_forbidden';
    end if;
  end if;

  v_actor_staff_id := public.dawaa_current_staff_subject_uuid_v1();
  select coalesce(nullif(trim(s.name),''),nullif(trim(sa.staff_name),''),nullif(trim(sa.username),''),'موظف')
    into v_actor_name
  from public.staff_accounts sa
  left join public.staff s on s.id=v_actor_staff_id
  where sa.id=v_actor_account_id;

  update public.customer_requests
  set customer_id=v_customer.id::text,
      customer_code=v_customer_code,
      customer_name=v_customer_name,
      customer_phone=v_customer_phone,
      branch=v_target_branch,
      last_action_at=now(),
      updated_at=now()
  where id=v_request.id
  returning * into v_updated;

  insert into public.customer_request_events(
    request_id,old_status,new_status,action,notes,created_by,created_by_name,created_at
  ) values (
    v_request.id,
    v_request.status,
    v_updated.status,
    'إصلاح ربط العميل',
    concat_ws(' | ',
      'تم اعتماد العميل من السجل المعياري',
      'الكود: '||v_customer_code,
      case when v_request.customer_id is distinct from v_customer.id::text then 'تم تحديث هوية العميل' end,
      case when v_request.branch is distinct from v_target_branch then 'تم تحديث الفرع إلى '||v_target_branch end
    ),
    coalesce(v_actor_staff_id::text,v_actor_account_id::text),
    v_actor_name,
    now()
  );

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.repair_customer_request_customer_v2(uuid,uuid,boolean) from public;
grant execute on function public.repair_customer_request_customer_v2(uuid,uuid,boolean)
  to anon, authenticated, service_role;

comment on function public.repair_customer_request_customer_v2(uuid,uuid,boolean) is
  'Atomic branch-authorized Customer Request customer repair using canonical customers data only.';
