-- Source-only candidate. Apply through the approved database release process BEFORE deploying
-- the corresponding refresh runtime. No backfill and no automatic materialization.
-- The semantic owner remains Sales Intelligence; these commands consume its persisted facts.
create or replace function public.dawaa_reconcile_canonical_followup_actions_v1(
  p_source_id uuid, p_analysis_ids jsonb, p_rows jsonb
) returns jsonb
language plpgsql security invoker
set search_path to 'public','pg_catalog'
as $function$
declare
  v_source public.whatsapp_review_sources%rowtype;
  v_case record;
  v_expected jsonb;
  v_opportunities jsonb := '[]';
  v_followup jsonb;
  v_row jsonb;
  v_op jsonb;
  v_action public.whatsapp_conversation_actions%rowtype;
  v_payload jsonb;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_updated integer := 0;
  v_withdrawn integer := 0;
begin
  if jsonb_typeof(p_analysis_ids) is distinct from 'object'
     or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'canonical_followup_invalid_snapshot';
  end if;
  -- Same lock order as reconcile_case_set_v2: source row -> source advisory -> case advisory.
  select * into v_source from public.whatsapp_review_sources where id=p_source_id for update;
  if not found then raise exception 'canonical_followup_source_missing'; end if;
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:' || p_source_id::text));
  if not exists(select 1 from public.whatsapp_operational_canonical_sources_v1 where source_id=p_source_id) then
    raise exception 'canonical_followup_source_not_canonical';
  end if;
  for v_case in select case_id from public.sales_intelligence_cases
    where conversation_id=p_source_id order by case_id
  loop
    perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:' || v_case.case_id));
  end loop;
  select coalesce(jsonb_object_agg(case_id,published_analysis_id::text),'{}') into v_expected
  from public.sales_intelligence_cases where conversation_id=p_source_id and is_active;
  if v_expected is distinct from p_analysis_ids then
    raise exception 'canonical_followup_stale_publication';
  end if;
  for v_case in
    select c.case_id,c.published_analysis_id,a.evidence_snapshot
    from public.sales_intelligence_cases c
    left join public.sales_intelligence_case_analyses a
      on a.analysis_id=c.published_analysis_id and a.case_id=c.case_id
      and a.is_current and a.superseded_at is null
    where c.conversation_id=p_source_id and c.is_active order by c.case_id
  loop
    if v_case.evidence_snapshot is null or
       (select count(*) from public.sales_intelligence_case_analyses
         where case_id=v_case.case_id and is_current) <> 1 then
      raise exception 'canonical_followup_current_analysis_mismatch';
    end if;
    v_followup := coalesce(v_case.evidence_snapshot #> '{caseIntelligence,followUp}',
                           v_case.evidence_snapshot->'followUp');
    if jsonb_typeof(v_followup->'opportunities') is distinct from 'array' then
      raise exception 'canonical_followup_evidence_incomplete';
    end if;
    for v_op in select value from jsonb_array_elements(v_followup->'opportunities') loop
      if v_op->>'status'='actionable' and nullif(v_op->>'blocker','') is null then
        v_opportunities := v_opportunities || jsonb_build_array(v_op || jsonb_build_object(
          'caseId',v_case.case_id,'analysisId',v_case.published_analysis_id::text));
      end if;
    end loop;
  end loop;
  -- Exact set, not a partial caller-selected subset. Missing evidence never retracts tasks.
  if jsonb_array_length(v_opportunities) <> jsonb_array_length(p_rows)
     or (select count(distinct value->>'followup_identity') from jsonb_array_elements(p_rows))
        <> jsonb_array_length(p_rows) then
    raise exception 'canonical_followup_incomplete_projection';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    select value into v_op from jsonb_array_elements(v_opportunities)
      where value->>'followUpKey'=v_row->>'followup_identity'
        and value->>'caseId'=v_row #>> '{payload,caseId}';
    if not found or v_row #>> '{payload,canonicalAnalysisId}' is distinct from v_op->>'analysisId'
       or v_row->>'source_id' is distinct from p_source_id::text
       or v_row->>'action_type' is distinct from 'customer_followup'
       or v_row->>'action_key' is distinct from ('canonical-followup:' || (v_op->>'followUpKey'))
       or v_row->>'created_by' is distinct from 'si-canonical-followup-projection-v1'
       or v_row #>> '{payload,canonicalProjectionVersion}' is distinct from 'si-canonical-followup-projection-v1'
       or v_row->>'branch' is distinct from v_source.branch
       or nullif(v_row->>'customer_id','') is distinct from nullif(v_op->>'customerId','')
       or (v_source.customer_id is not null and nullif(v_row->>'customer_id','') is distinct from v_source.customer_id::text)
       or v_row #>> '{payload,canonicalReason}' is distinct from v_op->>'reason' then
      raise exception 'canonical_followup_projection_mismatch';
    end if;
    if nullif(trim(v_source.customer_name),'') is null or nullif(trim(v_source.branch),'') is null then
      raise exception 'canonical_followup_metadata_incomplete';
    end if;
  end loop;
  -- Validate everything before touching the action queue. A collision rolls back the source set.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    select * into v_action from public.whatsapp_conversation_actions
      where followup_identity=v_row->>'followup_identity' for update;
    v_payload := (v_row->'payload') || jsonb_build_object('canonicalLifecycle','active');
    if found then
      if v_action.source_id is distinct from p_source_id
         or v_action.payload->>'caseId' is distinct from v_row #>> '{payload,caseId}'
         or v_action.created_by is distinct from 'si-canonical-followup-projection-v1' then
        raise exception 'canonical_followup_identity_collision';
      end if;
      v_existing := v_existing + 1;
      -- Human dismissals, assignments, execution and target lineage are immutable here.
      if v_action.target_table is not null or v_action.target_id is not null
         or v_action.work_status is distinct from 'unassigned'
         or v_action.assigned_at is not null or v_action.started_at is not null
         or v_action.completed_at is not null or v_action.outcome is not null
         or v_action.outcome_note is not null or coalesce(v_action.followup_attempts,0)>0
         or v_action.last_followup_at is not null or v_action.next_followup_at is not null
         or v_action.recovered_at is not null or v_action.recovered_invoice_id is not null
         or not (v_action.status='ready' or
           (v_action.status='dismissed' and v_action.payload->>'canonicalLifecycle'='withdrawn')) then
        continue;
      end if;
      if v_action.branch is distinct from v_source.branch then
        raise exception 'canonical_followup_stored_branch_mismatch';
      end if;
      update public.whatsapp_conversation_actions set
        status='ready',auto_eligible=false,
        customer_id=nullif(v_row->>'customer_id','')::uuid,
        customer_code=v_source.customer_code,customer_name=v_source.customer_name,
        customer_phone=v_row->>'customer_phone',
        product_id=nullif(v_row->>'product_id','')::uuid,product_name=v_row->>'product_name',
        quantity=(v_row->>'quantity')::numeric,due_at=(v_row->>'due_at')::timestamptz,
        reason=v_row->>'reason',evidence=v_row->'evidence',payload=v_payload,
        assigned_to_id=nullif(v_row->>'assigned_to_id','')::uuid,
        assigned_to_name=v_row->>'assigned_to_name',updated_at=now()
      where id=v_action.id and (
        to_jsonb(v_action) @> jsonb_build_object(
          'status','ready','auto_eligible',false,'customer_id',v_row->'customer_id',
          'customer_code',v_source.customer_code,'customer_name',v_source.customer_name,
          'customer_phone',v_row->'customer_phone','product_id',v_row->'product_id',
          'product_name',v_row->'product_name','quantity',v_row->'quantity',
          'reason',v_row->'reason','evidence',v_row->'evidence','payload',v_payload,
          'assigned_to_id',v_row->'assigned_to_id','assigned_to_name',v_row->'assigned_to_name')
        is not true or v_action.due_at is distinct from (v_row->>'due_at')::timestamptz
        or v_action.payload is distinct from v_payload);
      if found then v_updated := v_updated + 1; end if;
    else
      insert into public.whatsapp_conversation_actions(
        source_id,action_key,action_type,status,work_status,auto_eligible,branch,
        customer_id,customer_code,customer_name,customer_phone,product_id,product_name,
        quantity,due_at,reason,evidence,payload,followup_identity,assigned_to_id,assigned_to_name,created_by
      ) values (
        p_source_id,v_row->>'action_key','customer_followup','ready','unassigned',false,v_source.branch,
        nullif(v_row->>'customer_id','')::uuid,v_source.customer_code,v_source.customer_name,
        v_row->>'customer_phone',nullif(v_row->>'product_id','')::uuid,v_row->>'product_name',
        (v_row->>'quantity')::numeric,(v_row->>'due_at')::timestamptz,v_row->>'reason',
        v_row->'evidence',v_payload,v_row->>'followup_identity',
        nullif(v_row->>'assigned_to_id','')::uuid,v_row->>'assigned_to_name','si-canonical-followup-projection-v1'
      );
      v_inserted := v_inserted + 1;
    end if;
  end loop;
  update public.whatsapp_conversation_actions a set
    status='dismissed',auto_eligible=false,
    payload=coalesce(a.payload,'{}') || jsonb_build_object('canonicalLifecycle','withdrawn',
      'canonicalWithdrawalReason','obligation_no_longer_actionable','canonicalPublication',p_analysis_ids),
    updated_at=now()
  where a.source_id=p_source_id and a.action_type='customer_followup'
    and a.created_by='si-canonical-followup-projection-v1'
    and a.payload->>'canonicalProjectionVersion'='si-canonical-followup-projection-v1'
    and a.status='ready' and a.work_status='unassigned'
    and a.target_table is null and a.target_id is null and a.assigned_at is null
    and a.started_at is null and a.completed_at is null and a.outcome is null
    and a.outcome_note is null and coalesce(a.followup_attempts,0)=0
    and a.last_followup_at is null and a.next_followup_at is null
    and a.recovered_at is null and a.recovered_invoice_id is null
    and not exists(select 1 from jsonb_array_elements(p_rows) r where r->>'followup_identity'=a.followup_identity);
  get diagnostics v_withdrawn = row_count;
  return jsonb_build_object('ok',true,'inserted',v_inserted,'existing',v_existing,
    'updated',v_updated,'withdrawn',v_withdrawn);
end;
$function$;
revoke all on function public.dawaa_reconcile_canonical_followup_actions_v1(uuid,jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.dawaa_reconcile_canonical_followup_actions_v1(uuid,jsonb,jsonb) to service_role;

-- Browser workflow updates cannot forge a fresh canonical analysis or a projector withdrawal.
-- The existing truth guard still owns all other identity/execution fields.
create or replace function public.dawaa_guard_canonical_followup_provenance_v1()
returns trigger language plpgsql security invoker
set search_path to 'public','pg_catalog'
as $function$
declare v_key text;
begin
  if current_user in ('postgres','service_role','supabase_admin') then return new; end if;
  if old.created_by='si-canonical-followup-projection-v1' then
    foreach v_key in array array['canonicalProjectionVersion','caseId','followUpKey',
      'canonicalReason','canonicalAnalysisId','canonicalLifecycle','canonicalPublication','canonicalWithdrawalReason']
    loop
      if new.payload->v_key is distinct from old.payload->v_key then
        raise exception 'canonical_followup_provenance_is_system_owned' using errcode='42501';
      end if;
    end loop;
  end if;
  return new;
end;
$function$;
revoke all on function public.dawaa_guard_canonical_followup_provenance_v1() from public,anon,authenticated;
grant execute on function public.dawaa_guard_canonical_followup_provenance_v1() to service_role;
drop trigger if exists canonical_followup_provenance_guard_v1 on public.whatsapp_conversation_actions;
create trigger canonical_followup_provenance_guard_v1 before update on public.whatsapp_conversation_actions
for each row execute function public.dawaa_guard_canonical_followup_provenance_v1();

-- Preserve the public authorized command and all existing staff/branch/approval checks.
-- Lock source before action, then reject stale canonical follow-up proposals at execution time.
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
    if v_action.status<>'ready' or not coalesce(v_action.auto_eligible,false)
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
notify pgrst,'reload schema';
