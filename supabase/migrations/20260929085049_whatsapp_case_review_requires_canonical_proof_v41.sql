-- V41: verified_sale review decisions require existing Canonical Sale Proof.
-- This keeps human review as governance, not as an alternate sale-proof source.

create or replace function public.dawaa_review_whatsapp_case_v23(
  p_case_id uuid,
  p_confirmed_outcome text,
  p_confirmed_lost_reason text default null::text,
  p_responsibility_status text default 'unreviewed'::text,
  p_responsibility_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_case public.whatsapp_customer_cases_v22%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_actor_id uuid;
  v_actor_name text;
  v_actor_role text;
begin
  if not dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations']) then
    raise exception 'not_authorized';
  end if;

  if p_confirmed_outcome not in ('verified_sale','order_confirmed_waiting_invoice','customer_reengaged','followup_needed','awaiting_pharmacy','awaiting_customer','lost_opportunity','complaint_resolved','open') then
    raise exception 'invalid_outcome';
  end if;
  if p_responsibility_status not in ('unreviewed','reviewed_no_fault','reviewed_process_issue','reviewed_staff_issue') then
    raise exception 'invalid_responsibility_status';
  end if;

  select * into v_case
  from public.whatsapp_customer_cases_v22
  where id=p_case_id
  for update;
  if not found then raise exception 'case_not_found'; end if;

  if p_confirmed_outcome='verified_sale' then
    if v_case.verified_invoice_id is null then
      raise exception 'verified_sale_requires_invoice';
    end if;
    if coalesce(v_case.case_json #>> '{canonicalSaleProof,state}','') <> 'proven' then
      raise exception 'verified_sale_requires_canonical_proof';
    end if;
  end if;

  if p_confirmed_outcome='lost_opportunity'
     and nullif(trim(coalesce(p_confirmed_lost_reason,'')),'') is null then
    raise exception 'lost_opportunity_requires_reason';
  end if;

  v_before := jsonb_build_object(
    'confirmed_outcome',v_case.confirmed_outcome,
    'confirmed_lost_reason',v_case.confirmed_lost_reason,
    'responsibility_status',v_case.responsibility_status,
    'responsibility_note',v_case.responsibility_note
  );

  v_actor_id := dawaa_current_staff_account_id_strict();
  select coalesce(nullif(trim(staff_name),''),nullif(trim(name),''),nullif(trim(username),''),'مستخدم'), role
    into v_actor_name,v_actor_role
  from public.staff_accounts
  where id=v_actor_id;

  update public.whatsapp_customer_cases_v22
  set confirmed_outcome=p_confirmed_outcome,
      confirmed_lost_reason=nullif(trim(coalesce(p_confirmed_lost_reason,'')),''),
      outcome_reviewed_by=coalesce(v_actor_name,v_actor_id::text),
      outcome_reviewed_at=now(),
      responsibility_status=p_responsibility_status,
      responsibility_note=nullif(trim(coalesce(p_responsibility_note,'')),''),
      updated_at=now()
  where id=p_case_id
  returning jsonb_build_object(
    'confirmed_outcome',confirmed_outcome,
    'confirmed_lost_reason',confirmed_lost_reason,
    'responsibility_status',responsibility_status,
    'responsibility_note',responsibility_note,
    'outcome_reviewed_by',outcome_reviewed_by,
    'outcome_reviewed_at',outcome_reviewed_at
  ) into v_after;

  insert into public.whatsapp_review_audit(
    source_id,action,actor_id,actor_name,actor_role,before_state,after_state,note
  )
  values(
    v_case.root_source_id,'case_outcome_reviewed_v23',v_actor_id::text,
    v_actor_name,v_actor_role,v_before,v_after,p_responsibility_note
  );

  return jsonb_build_object('ok',true,'case_id',p_case_id,'review',v_after);
end;
$function$;
