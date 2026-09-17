-- WhatsApp follow-up queue v2
-- Isolates customer-service follow-up authorization from biometric administration.
-- This migration is committed only on whatsapp-review-integration-test until the feature is approved.

create or replace function public.dawaa_can_manage_whatsapp_followups_v1()
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_account public.staff_accounts%rowtype;
  v_subject uuid;
begin
  select * into v_account
  from public.staff_accounts a
  where a.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(a.active, a.is_active, true) = true
    and coalesce(a.can_login, true) = true
  limit 1;

  if v_account.id is null then
    return false;
  end if;

  v_subject := public.dawaa_current_staff_subject_uuid_v1();
  return public.dawaa_is_customer_service_evaluator_v1(
    v_subject,
    lower(trim(coalesce(v_account.role, '')))
  );
end;
$$;

revoke all on function public.dawaa_can_manage_whatsapp_followups_v1() from public, anon;
grant execute on function public.dawaa_can_manage_whatsapp_followups_v1() to authenticated, service_role;

create or replace function public.whatsapp_auto_followup_list_v2(
  p_status text default null,
  p_signal_type text default null
)
returns setof public.whatsapp_auto_followup_requests
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  if not public.dawaa_can_manage_whatsapp_followups_v1() then
    raise exception using errcode = '42501', message = 'صلاحية متابعة محادثات واتساب مطلوبة';
  end if;

  return query
  select r.*
  from public.whatsapp_auto_followup_requests r
  where (nullif(trim(coalesce(p_status, '')), '') is null or r.status = p_status)
    and (nullif(trim(coalesce(p_signal_type, '')), '') is null or r.signal_type = p_signal_type)
  order by
    case r.status
      when 'جديد' then 0
      when 'قيد المتابعة' then 1
      when 'لم يتم الرد' then 2
      when 'تم التواصل' then 3
      when 'تم البيع' then 4
      when 'ملغى' then 5
      else 6
    end,
    coalesce(r.evidence_timestamp, r.created_at) desc,
    r.created_at desc;
end;
$$;

revoke all on function public.whatsapp_auto_followup_list_v2(text, text) from public, anon;
grant execute on function public.whatsapp_auto_followup_list_v2(text, text) to authenticated, service_role;

create or replace function public.whatsapp_auto_followup_update_status_v2(
  p_id uuid,
  p_status text,
  p_notes text default null,
  p_assigned_to text default null
)
returns public.whatsapp_auto_followup_requests
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_row public.whatsapp_auto_followup_requests%rowtype;
  v_actor public.staff_accounts%rowtype;
  v_allowed_statuses constant text[] := array['جديد','قيد المتابعة','تم التواصل','تم البيع','لم يتم الرد','ملغى'];
begin
  if not public.dawaa_can_manage_whatsapp_followups_v1() then
    raise exception using errcode = '42501', message = 'صلاحية متابعة محادثات واتساب مطلوبة';
  end if;

  if not (p_status = any(v_allowed_statuses)) then
    raise exception using errcode = '22023', message = 'حالة المتابعة غير صالحة';
  end if;

  select * into v_actor
  from public.staff_accounts a
  where a.id = public.dawaa_current_staff_account_id_strict()
  limit 1;

  update public.whatsapp_auto_followup_requests r
  set
    status = p_status,
    followup_notes = case when p_notes is null then r.followup_notes else nullif(trim(p_notes), '') end,
    assigned_to = case when p_assigned_to is null then r.assigned_to else nullif(trim(p_assigned_to), '') end,
    updated_at = now(),
    resolved_at = case
      when p_status in ('تم البيع','تم التواصل','ملغى') then coalesce(r.resolved_at, now())
      else null
    end,
    resolved_by = case
      when p_status in ('تم البيع','تم التواصل','ملغى') then coalesce(v_actor.staff_name, v_actor.name, v_actor.username)
      else null
    end
  where r.id = p_id
  returning r.* into v_row;

  if v_row.id is null then
    raise exception using errcode = 'P0002', message = 'طلب المتابعة غير موجود';
  end if;

  return v_row;
end;
$$;

revoke all on function public.whatsapp_auto_followup_update_status_v2(uuid, text, text, text) from public, anon;
grant execute on function public.whatsapp_auto_followup_update_status_v2(uuid, text, text, text) to authenticated, service_role;

comment on function public.dawaa_can_manage_whatsapp_followups_v1() is
  'Canonical authorization boundary for WhatsApp smart-review follow-up operations; deliberately independent of biometric permissions.';
comment on function public.whatsapp_auto_followup_list_v2(text, text) is
  'Authorized WhatsApp follow-up queue read endpoint.';
comment on function public.whatsapp_auto_followup_update_status_v2(uuid, text, text, text) is
  'Authorized WhatsApp follow-up workflow update endpoint with validated statuses and actor-derived resolution identity.';
