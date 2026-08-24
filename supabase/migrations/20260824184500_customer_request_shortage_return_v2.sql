-- Atomic reverse handoff from shortage_items back to the canonical Customer Request.
-- Request fulfillment, shortage resolution and the timeline event commit together.

create or replace function public.return_shortage_to_customer_request_v2(
  p_shortage_item_id uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_actor_staff_id uuid;
  v_actor_name text;
  v_shortage public.shortage_items%rowtype;
  v_request public.customer_requests%rowtype;
  v_updated public.customer_requests%rowtype;
  v_status text;
  v_note text := nullif(trim(coalesce(p_notes,'')),'');
  v_now timestamptz := now();
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then raise exception 'staff_context_required'; end if;

  if not public.user_has_permission(v_account_id,'manage_shortages') then
    raise exception 'shortage_manage_forbidden';
  end if;

  select * into v_shortage
  from public.shortage_items
  where id=p_shortage_item_id
  for update;
  if not found then raise exception 'shortage_item_not_found'; end if;
  if v_shortage.source_customer_request_id is null then
    raise exception 'shortage_not_linked_to_customer_request';
  end if;

  select * into v_request
  from public.customer_requests
  where id=v_shortage.source_customer_request_id
  for update;
  if not found then raise exception 'customer_request_not_found'; end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_request.branch) then
    raise exception 'customer_request_manage_forbidden';
  end if;

  if public.dawaa_customer_request_branch_key(v_shortage.branch) is not null
     and public.dawaa_customer_request_branch_key(v_request.branch) is distinct from public.dawaa_customer_request_branch_key(v_shortage.branch) then
    raise exception 'shortage_request_branch_mismatch';
  end if;

  v_actor_staff_id := public.dawaa_current_staff_subject_uuid_v1();
  select coalesce(nullif(trim(s.name),''),nullif(trim(sa.staff_name),''),nullif(trim(sa.username),''),'موظف')
    into v_actor_name
  from public.staff_accounts sa
  left join public.staff s on s.id=v_actor_staff_id
  where sa.id=v_account_id;

  v_status := lower(trim(coalesce(v_request.status,'new')));

  -- Already fulfilled/closed: make the shortage side idempotently resolved without
  -- rewinding the Customer Request to an earlier state.
  if v_status in ('available','arrived','customer_contacted','delivered','closed') then
    update public.shortage_items
    set status='resolved',
        returned_to_customer_request_at=coalesce(returned_to_customer_request_at,v_now),
        source_request_status=v_request.status,
        updated_at=v_now
    where id=v_shortage.id
    returning * into v_shortage;

    return jsonb_build_object(
      'request',to_jsonb(v_request),
      'shortage',to_jsonb(v_shortage),
      'changed',false,
      'idempotent',true
    );
  end if;

  if v_status='cancelled' then raise exception 'customer_request_cancelled'; end if;
  if v_status='needs_customer_confirmation' then raise exception 'customer_request_confirmation_required'; end if;
  if v_status in ('new','purchasing_review') then raise exception 'customer_request_search_not_started'; end if;
  if v_status not in ('searching_suppliers','customer_confirmed','sourcing','not_available') then
    raise exception 'customer_request_shortage_return_invalid_status';
  end if;

  v_note := coalesce(
    v_note,
    'تم توفير الصنف من النواقص: '||coalesce(nullif(trim(v_shortage.item_name),''),coalesce(v_request.medicine_name,'الصنف'))
  );

  update public.customer_requests
  set status='available',
      provided_by_name=v_actor_name,
      purchasing_assignee=coalesce(purchasing_assignee,v_actor_name),
      purchasing_notes=v_note,
      unavailable_since=null,
      last_action_at=v_now,
      updated_at=v_now
  where id=v_request.id
  returning * into v_updated;

  update public.shortage_items
  set status='resolved',
      returned_to_customer_request_at=coalesce(returned_to_customer_request_at,v_now),
      source_request_status=v_updated.status,
      updated_at=v_now
  where id=v_shortage.id
  returning * into v_shortage;

  insert into public.customer_request_events(
    request_id,old_status,new_status,action,notes,created_by,created_by_name,created_at
  ) values (
    v_request.id,
    v_request.status,
    v_updated.status,
    'إعادة الطلب من النواقص بعد التوفير',
    v_note,
    coalesce(v_actor_staff_id::text,v_account_id::text),
    v_actor_name,
    v_now
  );

  return jsonb_build_object(
    'request',to_jsonb(v_updated),
    'shortage',to_jsonb(v_shortage),
    'changed',true,
    'idempotent',false
  );
end;
$$;

revoke all on function public.return_shortage_to_customer_request_v2(uuid,text) from public;
grant execute on function public.return_shortage_to_customer_request_v2(uuid,text)
  to anon, authenticated, service_role;

comment on function public.return_shortage_to_customer_request_v2(uuid,text) is
  'Atomic shortage resolution + canonical Customer Request fulfillment with branch and permission checks.';
