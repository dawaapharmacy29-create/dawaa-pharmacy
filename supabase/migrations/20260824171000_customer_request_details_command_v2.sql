-- Atomic editable-details command for Customer Requests V2.
-- Canonical customer/product/doctor identity is intentionally immutable here.

create or replace function public.update_customer_request_details_v2(
  p_request_id uuid,
  p_quantity numeric,
  p_urgency text,
  p_request_type text,
  p_channel text default null,
  p_customer_phone text default null,
  p_doctor_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account_id uuid;
  v_actor_subject uuid;
  v_actor_name text;
  v_request public.customer_requests%rowtype;
  v_updated public.customer_requests%rowtype;
  v_urgency text := lower(trim(coalesce(p_urgency,'')));
  v_request_type text := lower(trim(coalesce(p_request_type,'')));
  v_channel text := nullif(trim(coalesce(p_channel,'')),'');
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then raise exception 'staff_context_required'; end if;

  v_actor_subject := public.dawaa_current_staff_subject_uuid_v1();
  select coalesce(nullif(trim(sa.staff_name),''),nullif(trim(sa.name),''),nullif(trim(sa.username),''),'موظف')
    into v_actor_name
  from public.staff_accounts sa
  where sa.id=v_account_id and coalesce(sa.active,false) and coalesce(sa.can_login,false);
  if v_actor_name is null then raise exception 'staff_context_required'; end if;

  select * into v_request
  from public.customer_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'customer_request_not_found'; end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_request.branch) then
    raise exception 'customer_request_manage_forbidden';
  end if;

  if coalesce(p_quantity,0)<=0 then raise exception 'customer_request_invalid_quantity'; end if;
  if v_urgency not in ('normal','high','urgent') then raise exception 'customer_request_invalid_urgency'; end if;
  if v_request_type not in ('missing_medicine','normal_request','urgent_request','inquiry') then
    raise exception 'customer_request_invalid_type';
  end if;
  if v_channel is not null and v_channel not in ('داخل الصيدلية','واتساب','مكالمة هاتفية') then
    raise exception 'customer_request_invalid_channel';
  end if;

  update public.customer_requests
  set quantity=p_quantity,
      urgency=v_urgency,
      priority=case when v_urgency in ('high','urgent') then 'high' else 'medium' end,
      is_urgent=(v_urgency='urgent'),
      request_type=v_request_type,
      source_request_channel=v_channel,
      customer_phone=nullif(trim(coalesce(p_customer_phone,'')),''),
      doctor_notes=nullif(trim(coalesce(p_doctor_notes,'')),''),
      last_action_at=now(),
      updated_at=now()
  where id=p_request_id
  returning * into v_updated;

  insert into public.customer_request_events(
    request_id,old_status,new_status,action,notes,created_by,created_by_name,created_at
  ) values (
    p_request_id,v_request.status,v_request.status,'تعديل بيانات طلب عميل',
    'تم تعديل تفاصيل التنفيذ بدون تغيير هوية العميل أو الصنف أو الدكتور',
    v_actor_subject::text,v_actor_name,now()
  );

  return to_jsonb(v_updated);
end;
$$;

revoke all on function public.update_customer_request_details_v2(uuid,numeric,text,text,text,text,text) from public;
grant execute on function public.update_customer_request_details_v2(uuid,numeric,text,text,text,text,text)
  to anon, authenticated, service_role;

comment on function public.update_customer_request_details_v2(uuid,numeric,text,text,text,text,text) is
  'Atomic branch-scoped editable details command; canonical request identity remains immutable.';
