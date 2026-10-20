-- Rollback for 20261020153000_whatsapp_source_attribution_correction_v1.sql. NOT APPLIED.
-- Restores the exact previous approve/materialize bodies (20261005141100 lines 123-232,
-- 20261019093000 lines 4-89) and removes only objects added by the forward migration.
-- It does not restore data: applied corrections stay audited in whatsapp_review_audit and
-- retired proposals stay dismissed. Run in one transaction during a quiesced window.
begin;
drop trigger if exists whatsapp_source_attribution_guard_v1 on public.whatsapp_review_sources;
drop function if exists public.dawaa_guard_whatsapp_source_attribution_v1();
drop function if exists public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text);
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
create or replace function public.dawaa_materialize_whatsapp_action_v1(p_action_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_action public.whatsapp_conversation_actions%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
  v_source_id uuid;
  v_case record;
begin
  if v_actor is null then raise exception 'not_authorized' using errcode='42501'; end if;
  if not public.dawaa_current_actor_can(array[
    'add_reviews','reviews.action.create','edit_reviews','manage_conversation_evaluations'
  ]) then raise exception 'whatsapp_action_execute_permission_denied' using errcode='42501'; end if;
  select source_id into v_source_id from public.whatsapp_conversation_actions where id=p_action_id;
  if not found then raise exception 'whatsapp_action_not_found'; end if;
  select * into v_source from public.whatsapp_review_sources where id=v_source_id for update;
  if not found then raise exception 'whatsapp_source_not_found'; end if;
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:' || v_source_id::text));
  for v_case in select case_id from public.sales_intelligence_cases
    where conversation_id=v_source_id order by case_id
  loop
    perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:' || v_case.case_id));
  end loop;
  select * into v_action from public.whatsapp_conversation_actions where id=p_action_id for update;
  if not found or v_action.source_id is distinct from v_source_id then
    raise exception 'whatsapp_action_source_changed';
  end if;
  if not public.dawaa_can_read_conversation_review_row_v2(
    v_actor,v_source.staff_id,null::uuid,v_source.branch,null::uuid
  ) then raise exception 'whatsapp_action_access_denied' using errcode='42501'; end if;
  if v_action.created_by='si-canonical-followup-projection-v1'
     and v_action.action_type='customer_followup'
     and v_action.target_table is null and v_action.target_id is null then
    if v_action.status<>'ready'
       or v_action.payload->>'canonicalLifecycle' is distinct from 'active'
       or v_action.branch is distinct from v_source.branch
       or (v_source.customer_id is not null and v_action.customer_id is distinct from v_source.customer_id)
       or not exists(select 1 from public.whatsapp_operational_canonical_sources_v1 where source_id=v_source_id)
       or not exists (
         select 1 from public.sales_intelligence_cases c
         join public.sales_intelligence_case_analyses a
           on a.analysis_id=c.published_analysis_id and a.case_id=c.case_id
         cross join lateral jsonb_array_elements(coalesce(
           a.evidence_snapshot #> '{caseIntelligence,followUp,opportunities}',
           a.evidence_snapshot #> '{followUp,opportunities}','[]')) o
         where c.case_id=v_action.payload->>'caseId' and c.conversation_id=v_source_id and c.is_active
           and c.published_analysis_id::text=v_action.payload->>'canonicalAnalysisId'
           and a.is_current and a.superseded_at is null
           and (select count(*) from public.sales_intelligence_case_analyses a2
             where a2.case_id=c.case_id and a2.is_current)=1
           and o->>'followUpKey'=v_action.followup_identity and o->>'status'='actionable'
           and nullif(o->>'blocker','') is null
           and nullif(o->>'customerId','') is not distinct from v_action.customer_id::text
           and o->>'reason'=v_action.payload->>'canonicalReason'
       ) then raise exception 'canonical_followup_requires_current_projection'; end if;
  end if;
  if v_action.action_type='customer_request' then
    if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_action.branch) then
      raise exception 'customer_request_materialization_permission_denied' using errcode='42501';
    end if;
    if v_action.status='created' then
      -- Retry is a read of the completed operation, not a new approval or insertion.
      -- Require a real target belonging to the same operational identities.
      if v_action.target_table is distinct from 'customer_requests'
         or v_action.target_id is null or not exists (
           select 1 from public.customer_requests r
           where r.id=v_action.target_id::uuid
             and r.customer_id::text=v_action.customer_id::text
             and r.product_id=v_action.product_id and r.doctor_id=v_action.staff_id
             and public.dawaa_customer_request_branch_key(r.branch)
               =public.dawaa_customer_request_branch_key(v_action.branch)
         ) then raise exception 'customer_request_created_target_mismatch'; end if;
    elsif v_action.status<>'ready' or not coalesce(v_action.auto_eligible,false)
       or coalesce(v_action.payload->>'approvalSource','')<>'human_review_v2'
       or nullif(v_action.payload->>'approvedBy','') is null
       or nullif(v_action.payload->>'approvedAt','') is null then
      raise exception 'customer_request_requires_explicit_approval';
    end if;
  end if;
  return public.dawaa_materialize_whatsapp_action_core_v2(p_action_id);
end;
$function$;
revoke all on function public.dawaa_materialize_whatsapp_action_v1(uuid) from public;
grant execute on function public.dawaa_materialize_whatsapp_action_v1(uuid) to anon,authenticated,service_role;
drop function if exists public.dawaa_canonical_request_is_current_v1(uuid,text,text,uuid);
drop function if exists public.dawaa_is_transaction_branch_v1(text);
notify pgrst,'reload schema';
commit;
