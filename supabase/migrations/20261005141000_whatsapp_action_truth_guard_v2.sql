-- WhatsApp operational actions are proposals, not truth.
-- Browser analysis may suggest an action, but it may not publish execution results, recovered-sale
-- evidence, or auto-eligible customer requests. Customer requests require an explicit approved RPC.

create or replace function public.dawaa_guard_whatsapp_conversation_action_v2()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  v_privileged boolean := current_user in ('postgres','service_role','supabase_admin');
  v_actor uuid;
  v_approved_customer_request boolean := false;
begin
  if v_privileged then return new; end if;

  v_actor := public.dawaa_current_staff_account_id_strict();
  if v_actor is null then raise exception 'not_authorized' using errcode='42501'; end if;

  if tg_op='INSERT' then
    new.created_by := v_actor::text;
    new.target_table := null;
    new.target_id := null;
    new.completed_at := null;
    new.outcome := null;
    new.outcome_note := null;
    new.recovered_invoice_id := null;
    new.recovered_invoice_number := null;
    new.recovered_invoice_value := null;
    new.recovered_at := null;
    new.last_error := null;

    if new.action_type='customer_request' then
      new.status := 'proposed';
      new.auto_eligible := false;
      new.work_status := coalesce(nullif(new.work_status,''),'unassigned');
    elsif new.status='created' then
      new.status := 'proposed';
    end if;
    return new;
  end if;

  -- A client may work an operational task, but cannot rewrite its analysis identity or publish
  -- materialization/recovery truth directly. Dedicated command RPCs own those fields.
  if new.source_id is distinct from old.source_id
     or new.action_key is distinct from old.action_key
     or new.action_type is distinct from old.action_type
     or new.customer_id is distinct from old.customer_id
     or new.customer_code is distinct from old.customer_code
     or new.staff_id is distinct from old.staff_id
     or new.product_id is distinct from old.product_id
     or new.product_code is distinct from old.product_code
     or new.branch is distinct from old.branch
     or new.evidence is distinct from old.evidence
  then
    raise exception 'whatsapp_action_identity_is_system_owned' using errcode='42501';
  end if;

  if new.target_table is distinct from old.target_table
     or new.target_id is distinct from old.target_id
     or new.recovered_invoice_id is distinct from old.recovered_invoice_id
     or new.recovered_invoice_number is distinct from old.recovered_invoice_number
     or new.recovered_invoice_value is distinct from old.recovered_invoice_value
     or new.recovered_at is distinct from old.recovered_at
     or new.completed_at is distinct from old.completed_at
     or new.outcome is distinct from old.outcome
     or new.outcome_note is distinct from old.outcome_note
     or new.last_error is distinct from old.last_error
  then
    raise exception 'whatsapp_action_execution_truth_is_command_owned' using errcode='42501';
  end if;

  if old.action_type='customer_request' then
    v_approved_customer_request :=
      old.status='ready'
      and coalesce(old.auto_eligible,false)
      and coalesce(old.payload->>'approvalSource','')='human_review_v2';

    if new.auto_eligible is distinct from old.auto_eligible and coalesce(new.auto_eligible,false) then
      raise exception 'customer_request_action_requires_approval' using errcode='42501';
    end if;
    if new.status is distinct from old.status and new.status in ('ready','created') then
      raise exception 'customer_request_action_requires_approval' using errcode='42501';
    end if;

    -- Once a manager approves the request, every value used by materialization is frozen.
    -- The SECURITY DEFINER approval/materialization commands bypass this client-only guard.
    if v_approved_customer_request and (
      new.status is distinct from old.status
      or new.auto_eligible is distinct from old.auto_eligible
      or new.confidence is distinct from old.confidence
      or new.customer_name is distinct from old.customer_name
      or new.customer_phone is distinct from old.customer_phone
      or new.staff_name is distinct from old.staff_name
      or new.product_name is distinct from old.product_name
      or new.quantity is distinct from old.quantity
      or new.due_at is distinct from old.due_at
      or new.reason is distinct from old.reason
      or new.payload is distinct from old.payload
    ) then
      raise exception 'approved_customer_request_action_is_immutable_for_client' using errcode='42501';
    end if;
  end if;

  new.created_by := old.created_by;
  return new;
end;
$function$;

revoke all on function public.dawaa_guard_whatsapp_conversation_action_v2()
  from public,anon,authenticated;
grant execute on function public.dawaa_guard_whatsapp_conversation_action_v2()
  to service_role;

drop trigger if exists whatsapp_conversation_action_truth_guard_v2
  on public.whatsapp_conversation_actions;
create trigger whatsapp_conversation_action_truth_guard_v2
before insert or update
on public.whatsapp_conversation_actions
for each row
execute function public.dawaa_guard_whatsapp_conversation_action_v2();

-- Existing unmaterialized browser-ready customer requests are demoted once, preserving evidence.
update public.whatsapp_conversation_actions
set status='proposed',auto_eligible=false,updated_at=now()
where action_type='customer_request'
  and target_id is null
  and status='ready';

create or replace function public.dawaa_approve_whatsapp_customer_request_action_v2(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_action public.whatsapp_conversation_actions%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
  v_actor_name text;
  v_actor_role text;
  v_product_code text;
begin
  if v_actor is null
     or not public.dawaa_current_actor_can(array['approve_reviews','manage_conversation_evaluations','manage_customer_requests']) then
    raise exception 'not_authorized' using errcode='42501';
  end if;

  select * into v_action
  from public.whatsapp_conversation_actions
  where id=p_action_id
  for update;
  if not found then raise exception 'whatsapp_action_not_found'; end if;
  if v_action.action_type<>'customer_request' then raise exception 'customer_request_action_required'; end if;
  if v_action.status not in ('proposed','ready') then raise exception 'customer_request_action_not_approvable'; end if;
  if v_action.customer_id is null or v_action.product_id is null or v_action.staff_id is null then
    raise exception 'customer_request_action_canonical_identity_required';
  end if;
  if coalesce(v_action.confidence,0) < 80 then raise exception 'customer_request_action_confidence_too_low'; end if;

  select s.* into v_source
  from public.whatsapp_review_sources s
  join public.whatsapp_operational_canonical_sources_v1 c on c.source_id=s.id
  where s.id=v_action.source_id;
  if not found then raise exception 'customer_request_action_source_not_canonical'; end if;

  if v_source.customer_id is null or v_action.customer_id is distinct from v_source.customer_id then
    raise exception 'customer_request_action_customer_mismatch';
  end if;
  if v_source.staff_id is null or v_action.staff_id is distinct from v_source.staff_id then
    raise exception 'customer_request_action_staff_mismatch';
  end if;
  if public.dawaa_customer_request_branch_key(v_action.branch)
       is distinct from public.dawaa_customer_request_branch_key(v_source.branch) then
    raise exception 'customer_request_action_branch_mismatch';
  end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_action.branch) then
    raise exception 'customer_request_action_branch_denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.customers c where c.id=v_action.customer_id) then
    raise exception 'customer_not_found';
  end if;

  select nullif(trim(p.product_code),'') into v_product_code
  from public.products p
  where p.id=v_action.product_id;
  if v_product_code is null then raise exception 'canonical_product_required'; end if;
  if nullif(trim(coalesce(v_action.product_code,'')),'') is null
     or trim(v_action.product_code)<>v_product_code then
    raise exception 'customer_request_action_product_identity_mismatch';
  end if;

  if not exists(
    select 1 from public.staff s
    where s.id=v_action.staff_id and coalesce(s.active,s.is_active,true)=true
  ) then raise exception 'active_staff_required'; end if;

  select coalesce(nullif(trim(sa.name),''),nullif(trim(sa.staff_name),''),nullif(trim(sa.username),''),'مستخدم'),
         lower(trim(coalesce(sa.role,'')))
  into v_actor_name,v_actor_role
  from public.staff_accounts sa where sa.id=v_actor;

  update public.whatsapp_conversation_actions
  set status='ready',
      auto_eligible=true,
      payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
        'approvalSource','human_review_v2',
        'approvedBy',v_actor::text,
        'approvedByName',v_actor_name,
        'approvedAt',now()
      ),
      updated_at=now()
  where id=p_action_id;

  insert into public.whatsapp_review_audit(source_id,action,actor_id,actor_name,actor_role,before_state,after_state,note)
  values(v_action.source_id,'customer_request_action_approved_v2',v_actor::text,v_actor_name,v_actor_role,
    to_jsonb(v_action),
    jsonb_build_object(
      'action_id',p_action_id,
      'status','ready',
      'auto_eligible',true,
      'customer_id',v_action.customer_id,
      'staff_id',v_action.staff_id,
      'product_id',v_action.product_id,
      'product_code',v_product_code,
      'branch',v_action.branch,
      'quantity',v_action.quantity,
      'confidence',v_action.confidence
    ),
    'تم اعتماد تسجيل طلب العميل بعد مراجعة الهوية والصنف والمصدر القانوني.');

  return jsonb_build_object('ok',true,'action_id',p_action_id,'status','ready');
end;
$function$;

revoke all on function public.dawaa_approve_whatsapp_customer_request_action_v2(uuid) from public;
grant execute on function public.dawaa_approve_whatsapp_customer_request_action_v2(uuid)
  to anon,authenticated,service_role;

-- Keep the public RPC name used by the app, but move the old implementation behind a guarded
-- service-only core. This closes the old read-only-user -> materialize privilege gap.
do $do$
begin
  if to_regprocedure('public.dawaa_materialize_whatsapp_action_core_v2(uuid)') is null then
    alter function public.dawaa_materialize_whatsapp_action_v1(uuid)
      rename to dawaa_materialize_whatsapp_action_core_v2;
  end if;
end;
$do$;

revoke all on function public.dawaa_materialize_whatsapp_action_core_v2(uuid)
  from public,anon,authenticated;
grant execute on function public.dawaa_materialize_whatsapp_action_core_v2(uuid)
  to service_role;

create or replace function public.dawaa_materialize_whatsapp_action_v1(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_action public.whatsapp_conversation_actions%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
begin
  if v_actor is null then raise exception 'not_authorized' using errcode='42501'; end if;
  if not public.dawaa_current_actor_can(array[
    'add_reviews','reviews.action.create','edit_reviews','manage_conversation_evaluations'
  ]) then
    raise exception 'whatsapp_action_execute_permission_denied' using errcode='42501';
  end if;

  select * into v_action
  from public.whatsapp_conversation_actions
  where id=p_action_id
  for update;
  if not found then raise exception 'whatsapp_action_not_found'; end if;

  select * into v_source
  from public.whatsapp_review_sources
  where id=v_action.source_id;
  if not found then raise exception 'whatsapp_source_not_found'; end if;

  if not public.dawaa_can_read_conversation_review_row_v2(
    v_actor,v_source.staff_id,null::uuid,v_source.branch,null::uuid
  ) then
    raise exception 'whatsapp_action_access_denied' using errcode='42501';
  end if;

  if v_action.action_type='customer_request' then
    if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_action.branch) then
      raise exception 'customer_request_materialization_permission_denied' using errcode='42501';
    end if;
    if v_action.status<>'ready'
       or not coalesce(v_action.auto_eligible,false)
       or coalesce(v_action.payload->>'approvalSource','')<>'human_review_v2'
       or nullif(v_action.payload->>'approvedBy','') is null
       or nullif(v_action.payload->>'approvedAt','') is null then
      raise exception 'customer_request_requires_explicit_approval';
    end if;
  end if;

  return public.dawaa_materialize_whatsapp_action_core_v2(p_action_id);
end;
$function$;

revoke all on function public.dawaa_materialize_whatsapp_action_v1(uuid)
  from public;
grant execute on function public.dawaa_materialize_whatsapp_action_v1(uuid)
  to anon,authenticated,service_role;

comment on function public.dawaa_guard_whatsapp_conversation_action_v2() is
  'Client actions are proposals only. Identity/materialization/recovery truth is command-owned; approved customer-request payloads are immutable.';
comment on function public.dawaa_materialize_whatsapp_action_v1(uuid) is
  'Guarded public action command. Requires action execution permission; customer requests additionally require branch management permission and explicit approval.';
comment on function public.dawaa_materialize_whatsapp_action_core_v2(uuid) is
  'Internal service-only implementation of WhatsApp action materialization.';

notify pgrst,'reload schema';
