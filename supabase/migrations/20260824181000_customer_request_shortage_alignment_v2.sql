-- Align shortage handoff with the canonical Customer Request lifecycle and
-- return the updated request in the same round trip.

create or replace function public.move_customer_request_to_shortage_v1(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_request public.customer_requests%rowtype;
  v_updated public.customer_requests%rowtype;
  v_shortage public.shortage_items%rowtype;
  v_actor_account_id uuid;
  v_actor_staff_id uuid;
  v_actor_name text;
  v_next_status text;
  v_now timestamptz := now();
  v_created boolean := false;
begin
  v_actor_account_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_account_id is null then raise exception 'not_authorized'; end if;

  select * into v_request
  from public.customer_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'customer_request_not_found'; end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_request.branch) then
    raise exception 'not_authorized';
  end if;

  v_actor_staff_id := public.dawaa_current_staff_subject_uuid_v1();
  select coalesce(s.name,sa.username,sa.role,'system')
    into v_actor_name
  from public.staff_accounts sa
  left join public.staff s on s.id=v_actor_staff_id
  where sa.id=v_actor_account_id;

  if v_request.shortage_item_id is not null then
    select * into v_shortage
    from public.shortage_items
    where id=v_request.shortage_item_id
    limit 1;
    if found then
      return jsonb_build_object(
        'request_id',v_request.id,
        'shortage_item_id',v_shortage.id,
        'created',false,
        'status',v_request.status,
        'request',to_jsonb(v_request)
      );
    end if;
  end if;

  select * into v_shortage
  from public.shortage_items
  where source_customer_request_id=v_request.id
  limit 1;

  if not found then
    insert into public.shortage_items(
      item_name,branch,requested_qty,priority,status,
      responsible_staff_id,responsible_staff_name,notes,source_module,
      created_by,registered_by_staff_id,registered_by_staff_name,created_by_name,
      source_customer_request_id,source_customer_name,source_customer_code,
      source_customer_phone,source_request_status,source_request_details,
      moved_from_customer_request_at,product_id,created_at,updated_at
    ) values (
      v_request.medicine_name,
      v_request.branch,
      greatest(coalesce(v_request.quantity,1),1),
      coalesce(nullif(v_request.priority,''),nullif(v_request.urgency,''),'medium'),
      'shortage',
      v_actor_staff_id,
      v_actor_name,
      concat_ws(' | ',
        case when nullif(v_request.customer_name,'') is not null then 'طلب عميل: '||v_request.customer_name end,
        case when nullif(v_request.customer_code,'') is not null then 'كود العميل: '||v_request.customer_code end,
        case when nullif(v_request.customer_phone,'') is not null then 'الهاتف: '||v_request.customer_phone end,
        nullif(v_request.doctor_notes,''),
        nullif(v_request.purchasing_notes,'')
      ),
      'customer_requests',
      v_actor_staff_id,
      v_actor_staff_id,
      v_actor_name,
      v_actor_name,
      v_request.id,
      v_request.customer_name,
      v_request.customer_code,
      v_request.customer_phone,
      v_request.status,
      jsonb_build_object(
        'customer_request_id',v_request.id,
        'medicine_name',v_request.medicine_name,
        'product_code',v_request.product_code,
        'quantity',coalesce(v_request.quantity,1),
        'urgency',v_request.urgency,
        'request_type',v_request.request_type
      ),
      v_now,
      v_request.product_id,
      v_now,
      v_now
    )
    on conflict (source_customer_request_id) where source_customer_request_id is not null
    do update set updated_at=excluded.updated_at
    returning * into v_shortage;
    v_created := true;
  end if;

  -- Keep shortage handoff inside the same lifecycle rules used by the V2 command layer.
  v_next_status := case
    when lower(trim(coalesce(v_request.status,'new')))='new' then 'purchasing_review'
    when lower(trim(coalesce(v_request.status,'new')))='purchasing_review' then 'searching_suppliers'
    else v_request.status
  end;

  update public.customer_requests
  set shortage_item_id=v_shortage.id,
      moved_to_shortage_at=coalesce(moved_to_shortage_at,v_now),
      status=v_next_status,
      purchasing_received_by_name=case
        when lower(trim(coalesce(v_request.status,'new')))='new' then v_actor_name
        else purchasing_received_by_name end,
      searching_by_name=case
        when lower(trim(coalesce(v_request.status,'new')))='purchasing_review' then v_actor_name
        else searching_by_name end,
      purchasing_assignee=case
        when lower(trim(coalesce(v_request.status,'new'))) in ('new','purchasing_review')
          then coalesce(v_actor_name,purchasing_assignee)
        else purchasing_assignee end,
      last_action_at=v_now,
      updated_at=v_now
  where id=v_request.id
  returning * into v_updated;

  insert into public.customer_request_events(
    request_id,old_status,new_status,action,notes,created_by,created_by_name,created_at
  ) values (
    v_request.id,
    v_request.status,
    v_next_status,
    'نقل طلب العميل إلى النواقص',
    case
      when lower(trim(coalesce(v_request.status,'new')))='new'
        then 'تم ربط الطلب بالنواقص واستلامه للمراجعة'
      when lower(trim(coalesce(v_request.status,'new')))='purchasing_review'
        then 'تم ربط الطلب بالنواقص وبدء البحث عن الصنف'
      else 'تم إنشاء/ربط سجل نواقص آمن من طلب العميل'
    end,
    v_actor_account_id::text,
    v_actor_name,
    v_now
  );

  return jsonb_build_object(
    'request_id',v_updated.id,
    'shortage_item_id',v_shortage.id,
    'created',v_created,
    'status',v_updated.status,
    'request',to_jsonb(v_updated)
  );
end;
$$;

revoke all on function public.move_customer_request_to_shortage_v1(uuid) from public;
grant execute on function public.move_customer_request_to_shortage_v1(uuid)
  to anon, authenticated, service_role;
