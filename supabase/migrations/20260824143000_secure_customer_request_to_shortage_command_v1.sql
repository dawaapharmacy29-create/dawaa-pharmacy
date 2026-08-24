-- Secure, idempotent Customer Request -> Shortage command.
-- The caller only needs manage_customer_requests for the request branch; the command
-- does not grant broad manage_shortages access to pharmacists or other request actors.

create unique index if not exists uq_shortage_items_customer_request_source
  on public.shortage_items(source_customer_request_id)
  where source_customer_request_id is not null;

create or replace function public.move_customer_request_to_shortage_v1(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_request public.customer_requests%rowtype;
  v_shortage public.shortage_items%rowtype;
  v_actor_account_id uuid;
  v_actor_staff_id uuid;
  v_actor_name text;
  v_next_status text;
  v_now timestamptz := now();
begin
  v_actor_account_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_account_id is null then
    raise exception 'not_authorized';
  end if;

  select * into v_request
  from public.customer_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'customer_request_not_found';
  end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests', v_request.branch) then
    raise exception 'not_authorized';
  end if;

  v_actor_staff_id := public.dawaa_current_staff_subject_uuid_v1();
  select coalesce(s.name, sa.username, sa.role, 'system')
    into v_actor_name
  from public.staff_accounts sa
  left join public.staff s on s.id = v_actor_staff_id
  where sa.id = v_actor_account_id;

  if v_request.shortage_item_id is not null then
    select * into v_shortage
    from public.shortage_items
    where id = v_request.shortage_item_id
    limit 1;
    if found then
      return jsonb_build_object(
        'request_id', v_request.id,
        'shortage_item_id', v_shortage.id,
        'created', false,
        'status', v_request.status
      );
    end if;
  end if;

  select * into v_shortage
  from public.shortage_items
  where source_customer_request_id = v_request.id
  limit 1;

  if not found then
    insert into public.shortage_items(
      item_name,
      branch,
      requested_qty,
      priority,
      status,
      responsible_staff_id,
      responsible_staff_name,
      notes,
      source_module,
      created_by,
      registered_by_staff_id,
      registered_by_staff_name,
      created_by_name,
      source_customer_request_id,
      source_customer_name,
      source_customer_code,
      source_customer_phone,
      source_request_status,
      source_request_details,
      moved_from_customer_request_at,
      product_id,
      created_at,
      updated_at
    ) values (
      v_request.medicine_name,
      v_request.branch,
      greatest(coalesce(v_request.quantity, 1), 1),
      coalesce(nullif(v_request.priority, ''), nullif(v_request.urgency, ''), 'medium'),
      'shortage',
      v_actor_staff_id,
      v_actor_name,
      concat_ws(' | ',
        case when nullif(v_request.customer_name, '') is not null then 'طلب عميل: ' || v_request.customer_name end,
        case when nullif(v_request.customer_code, '') is not null then 'كود العميل: ' || v_request.customer_code end,
        case when nullif(v_request.customer_phone, '') is not null then 'الهاتف: ' || v_request.customer_phone end,
        nullif(v_request.doctor_notes, ''),
        nullif(v_request.purchasing_notes, '')
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
        'customer_request_id', v_request.id,
        'medicine_name', v_request.medicine_name,
        'product_code', v_request.product_code,
        'quantity', coalesce(v_request.quantity, 1),
        'urgency', v_request.urgency,
        'request_type', v_request.request_type
      ),
      v_now,
      v_request.product_id,
      v_now,
      v_now
    )
    on conflict (source_customer_request_id) where source_customer_request_id is not null
    do update set updated_at = excluded.updated_at
    returning * into v_shortage;
  end if;

  v_next_status := case when coalesce(v_request.status, 'new') = 'new' then 'searching_suppliers' else v_request.status end;

  update public.customer_requests
  set shortage_item_id = v_shortage.id,
      moved_to_shortage_at = coalesce(moved_to_shortage_at, v_now),
      status = v_next_status,
      updated_at = v_now
  where id = v_request.id;

  insert into public.customer_request_events(
    request_id,
    old_status,
    new_status,
    action,
    notes,
    created_by,
    created_by_name,
    created_at
  ) values (
    v_request.id,
    v_request.status,
    v_next_status,
    'نقل طلب العميل إلى النواقص',
    'تم إنشاء/ربط سجل نواقص آمن من طلب العميل',
    v_actor_account_id::text,
    v_actor_name,
    v_now
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'shortage_item_id', v_shortage.id,
    'created', true,
    'status', v_next_status
  );
end;
$$;

revoke all on function public.move_customer_request_to_shortage_v1(uuid) from public;
grant execute on function public.move_customer_request_to_shortage_v1(uuid) to anon, authenticated, service_role;
