-- PREPARED ONLY: canonical, staff-session-authorized attribution correction.
-- No identity migration, backfill, table/column change or workflow reset.
-- The existing browser truth guard remains unchanged; only this checked command can update
-- customer attributes on an already confirmed row. It never chooses an owner or inserts a row.
create or replace function public.dawaa_correct_whatsapp_operation_attribution_session_v1(
  p_session_token text, p_kind text, p_row_id uuid, p_expected_identity text,
  p_expected_customer_id uuid, p_attribution jsonb, p_source_id uuid default null
)
returns jsonb language plpgsql security definer
set search_path = ''
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_action public.whatsapp_conversation_actions%rowtype;
  v_signal public.whatsapp_auto_followup_requests%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_customer jsonb;
  v_customer_id uuid;
  v_code text;
  v_name text;
  v_phone text;
  v_status text;
  v_previous_setting text;
begin
  if nullif(btrim(coalesce(p_session_token,'')),'') is null then
    raise exception 'staff_session_required' using errcode='42501';
  end if;
  select a.* into v_account from public.staff_login_sessions s
    join public.staff_accounts a on a.id=s.staff_account_id
    where s.token_hash=encode(extensions.digest(btrim(p_session_token),'sha256'),'hex')
      and s.revoked_at is null and s.expires_at>now()
      and a.active is true and a.is_active is true and a.can_login is true
      and lower(btrim(coalesce(a.status,'')))='active'
    limit 1;
  if not found then raise exception 'invalid_or_expired_staff_session' using errcode='42501'; end if;
  if lower(btrim(coalesce(v_account.role,''))) not in ('general_manager','admin')
     and not public.dawaa_jsonb_has_true_any(coalesce(public.get_user_permissions(v_account.id),'{}'::jsonb),
       array['approve_reviews','manage_conversation_evaluations']) then
    raise exception 'operation_attribution_permission_denied' using errcode='42501';
  end if;
  if p_kind not in ('action','signal') or p_kind is null or p_row_id is null
     or nullif(btrim(p_expected_identity),'') is null or jsonb_typeof(p_attribution) is distinct from 'object'
     or pg_column_size(p_attribution)>8192 then
    raise exception 'invalid_operation_attribution_input' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_attribution) k where k not in
    ('customer_id','customer_code','customer_name','customer_phone','customer_identity_status')) then
    raise exception 'operation_attribution_fields_only' using errcode='22023';
  end if;
  if p_kind='action' then
    select * into v_action from public.whatsapp_conversation_actions where id=p_row_id for update;
    if not found then raise exception 'operation_not_found' using errcode='P0002'; end if;
    v_before:=to_jsonb(v_action);
    select * into v_source from public.whatsapp_review_sources where id=v_action.source_id for share;
    if not found or p_source_id is distinct from v_action.source_id then
      raise exception 'operation_source_mismatch' using errcode='42501';
    end if;
  else
    select * into v_signal from public.whatsapp_auto_followup_requests where id=p_row_id for update;
    if not found then raise exception 'operation_not_found' using errcode='P0002'; end if;
    v_before:=to_jsonb(v_signal);
    -- Signals have file/session provenance rather than a source FK. Require exactly one
    -- existing source covering their stored evidence; no caller-selected source is trusted.
    if (select count(*) from public.whatsapp_review_sources s
      where s.source_filename=v_signal.source_file_name
        and s.conversation_started_at<=v_signal.evidence_timestamp
        and s.conversation_ended_at>=v_signal.evidence_timestamp)<>1 then
      raise exception 'operation_source_ambiguous' using errcode='42501';
    end if;
    select * into v_source from public.whatsapp_review_sources s
      where s.source_filename=v_signal.source_file_name
        and s.conversation_started_at<=v_signal.evidence_timestamp
        and s.conversation_ended_at>=v_signal.evidence_timestamp for share;
    if v_signal.branch is distinct from v_source.branch then
      raise exception 'operation_source_branch_mismatch' using errcode='42501';
    end if;
  end if;
  if v_before->>'followup_identity' is distinct from p_expected_identity then
    raise exception 'operation_identity_changed' using errcode='40001';
  end if;
  if not public.dawaa_can_read_conversation_review_row_v2(v_account.id,v_source.staff_id,null::uuid,v_source.branch,null::uuid) then
    raise exception 'operation_source_access_denied' using errcode='42501';
  end if;
  v_customer_id:=nullif(p_attribution->>'customer_id','')::uuid;
  v_code:=nullif(p_attribution->>'customer_code','');
  v_name:=nullif(p_attribution->>'customer_name','');
  v_phone:=nullif(p_attribution->>'customer_phone','');
  v_status:=coalesce(p_attribution->>'customer_identity_status',case when v_customer_id is null then 'unresolved' else 'resolved' end);
  if v_status not in ('resolved','unresolved','ambiguous','contradicted')
     or (v_status='resolved')<>(v_customer_id is not null)
     or (v_customer_id is null and v_code is not null) then
    raise exception 'invalid_customer_attribution' using errcode='22023';
  end if;
  if v_customer_id is not null then
    select to_jsonb(c) into v_customer from public.customers c where c.id=v_customer_id;
    if not found or coalesce((v_customer->>'is_duplicate')::boolean,false) then
      raise exception 'canonical_customer_required' using errcode='22023';
    end if;
    if v_code is not null and public.normalize_customer_code_v2(v_code) is distinct from
      coalesce(public.normalize_customer_code_v2(v_customer->>'effective_customer_code'),
        public.normalize_customer_code_v2(v_customer->>'customer_code'),public.normalize_customer_code_v2(v_customer->>'code')) then
      raise exception 'canonical_customer_code_mismatch' using errcode='22023';
    end if;
    if not public.dawaa_can_read_conversation_review_row_v2(v_account.id,null::uuid,null::uuid,
      coalesce(nullif(v_customer->>'effective_branch',''),v_customer->>'branch'),null::uuid) then
      raise exception 'customer_attribution_access_denied' using errcode='42501';
    end if;
  end if;
  -- Compare-and-set rejects a write based on an outdated row snapshot. The source guard
  -- below also rejects stale attribution when an old import re-reads the corrected row.
  -- A retry already at the requested attribution is safe and creates no extra audit entry.
  if v_before->>'customer_id' is distinct from p_expected_customer_id::text then
    if v_before->>'customer_id' is not distinct from v_customer_id::text
       and v_before->>'customer_code' is not distinct from v_code
       and v_before->>'customer_name' is not distinct from v_name
       and v_before->>'customer_phone' is not distinct from v_phone
       and (p_kind='action' or v_before->>'customer_identity_status' is not distinct from v_status) then
      return jsonb_build_object('id',p_row_id,'followup_identity',p_expected_identity,'unchanged',true);
    end if;
    raise exception 'operation_attribution_changed' using errcode='40001';
  end if;
  -- CAS alone does not stop an old import that READS the newly corrected row first.
  -- The original durable source is correction authority, not the incoming import snapshot.
  -- Its SHARE lock prevents a concurrent source correction while this mutation commits.
  -- Missing/uncertain authority fails closed; no freshness/confidence framework is invented.
  if v_source.customer_id is distinct from v_customer_id then
    raise exception 'operation_attribution_source_changed' using errcode='40001';
  end if;
  v_previous_setting:=current_setting('dawaa.operation_attribution_command',true);
  perform set_config('dawaa.operation_attribution_command','v1',true);
  if p_kind='action' then
    update public.whatsapp_conversation_actions set customer_id=v_customer_id,customer_code=v_code,
      customer_name=v_name,customer_phone=v_phone,updated_at=now() where id=p_row_id
      returning to_jsonb(whatsapp_conversation_actions.*) into v_after;
  else
    update public.whatsapp_auto_followup_requests set customer_id=v_customer_id,customer_code=v_code,
      customer_name=v_name,customer_phone=v_phone,customer_identity_status=v_status where id=p_row_id
      returning to_jsonb(whatsapp_auto_followup_requests.*) into v_after;
  end if;
  perform set_config('dawaa.operation_attribution_command',coalesce(v_previous_setting,''),true);
  insert into public.whatsapp_review_audit(source_id,action,actor_id,actor_name,actor_role,before_state,after_state,note)
    values(v_source.id,'operation_customer_attribution_corrected',v_account.id::text,
      coalesce(v_account.name,v_account.username),v_account.role,v_before,v_after,
      'Customer attribution corrected in place; operation identity and execution lineage preserved.');
  return jsonb_build_object('id',p_row_id,'followup_identity',v_after->>'followup_identity');
end;
$function$;
revoke all on function public.dawaa_correct_whatsapp_operation_attribution_session_v1(text,text,uuid,text,uuid,jsonb,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.dawaa_correct_whatsapp_operation_attribution_session_v1(text,text,uuid,text,uuid,jsonb,uuid)
  to anon,authenticated;

-- Evaluate the command marker BEFORE entering the existing SECURITY DEFINER trigger.
-- Inside that function current_user is its owner even for an anon caller, so checking
-- privilege there would allow a caller-set marker to bypass legacy resolution.
-- Keep the resolver body unchanged; only the authenticated command's privileged UPDATE
-- may skip it. Ordinary browser writes still run the original legacy resolver.
drop trigger if exists whatsapp_auto_followup_resolve_customer_identity_v1 on public.whatsapp_auto_followup_requests;
create trigger whatsapp_auto_followup_resolve_customer_identity_v1
before insert or update of customer_phone, customer_name, customer_id
on public.whatsapp_auto_followup_requests
for each row
when (not (current_user in ('postgres','service_role','supabase_admin')
  and coalesce(current_setting('dawaa.operation_attribution_command',true),'')='v1'))
execute function public.dawaa_whatsapp_followup_resolve_customer_identity_v1();
