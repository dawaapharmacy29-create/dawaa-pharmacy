-- WhatsApp operational action lifecycle: `ready` is a proposal, `created` is a materialized
-- operational record. NOT APPLIED automatically — apply through the reviewed migration path only.
--
-- 1. `created` must always name its operational record (target_table + target_id). A row can no
--    longer claim to be executed without lineage; the materializer also asserts it after the core.
-- 2. A canonical complaint follow-up is executable only while the CURRENT published analysis of
--    its own case still holds that unresolved complaint (same evidence messages). This mirrors the
--    existing customer_followup current-projection check; a re-analysis that resolved, removed or
--    re-segmented the complaint makes the stale proposal non-executable instead of creating work.
-- 3. Unchanged: permissions, source/branch access, transaction-branch rule, customer-request
--    approval rules, the source + case-set advisory locks, and the core materializer. The core keeps
--    the per-action idempotency key ('whatsapp-action:<id>'), so a retry or a concurrent second
--    click returns the same target instead of creating a duplicate.
--
-- Rollback: re-run the dawaa_materialize_whatsapp_action_v1 definition from
-- 20261020153000_whatsapp_source_attribution_correction_v1.sql and
-- `alter table public.whatsapp_conversation_actions drop constraint if exists
--  whatsapp_conversation_actions_created_requires_target_ck;`.

alter table public.whatsapp_conversation_actions
  drop constraint if exists whatsapp_conversation_actions_created_requires_target_ck;
alter table public.whatsapp_conversation_actions
  add constraint whatsapp_conversation_actions_created_requires_target_ck
  check (status is distinct from 'created' or (nullif(btrim(target_table), '') is not null and nullif(btrim(target_id), '') is not null))
  not valid;
-- Production had zero `created` rows without a target when this was written; validation proves it.
alter table public.whatsapp_conversation_actions
  validate constraint whatsapp_conversation_actions_created_requires_target_ck;

create or replace function public.dawaa_materialize_whatsapp_action_v1(p_action_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_action public.whatsapp_conversation_actions%rowtype;
  v_after public.whatsapp_conversation_actions%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
  v_source_id uuid;
  v_case record;
  v_staff_refusal text;
  v_result jsonb;
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
  -- New operational work is never created in account-wide scope / an unknown branch. A completed
  -- customer-request retry is a read of existing lineage and keeps its own target check below.
  if v_action.action_type in ('customer_request','customer_followup','recommendation_followup','complaint_followup')
     and v_action.status<>'created'
     and not public.dawaa_is_transaction_branch_v1(v_action.branch) then
    raise exception 'whatsapp_action_transaction_branch_required';
  end if;
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
  if v_action.created_by='si-canonical-complaint-projection-v1'
     and v_action.action_type='complaint_followup'
     and v_action.target_table is null and v_action.target_id is null then
    if v_action.status<>'ready'
       or coalesce(v_action.payload->>'canonicalLifecycle','active')<>'active'
       or v_action.branch is distinct from v_source.branch
       or (v_source.customer_id is not null and v_action.customer_id is distinct from v_source.customer_id)
       or jsonb_typeof(v_action.payload->'complaintMessageIds') is distinct from 'array'
       or jsonb_array_length(v_action.payload->'complaintMessageIds')=0
       or not exists(select 1 from public.whatsapp_operational_canonical_sources_v1 where source_id=v_source_id)
       or not exists (
         select 1 from public.sales_intelligence_cases c
         join public.sales_intelligence_case_analyses a
           on a.analysis_id=c.published_analysis_id and a.case_id=c.case_id
         where c.case_id=v_action.payload->>'caseId' and c.conversation_id=v_source_id and c.is_active
           and a.is_current and a.superseded_at is null
           and (select count(*) from public.sales_intelligence_case_analyses a2
             where a2.case_id=c.case_id and a2.is_current)=1
           and a.evidence_snapshot #>> '{canonicalComplaintAssessment,caseId}'=c.case_id
           and a.evidence_snapshot #>> '{canonicalComplaintAssessment,state}'
             in ('detected','recovery_attempted','unresolved')
           and coalesce(a.evidence_snapshot #> '{canonicalComplaintAssessment,complaintMessageIds}','[]'::jsonb)
             @> (v_action.payload->'complaintMessageIds')
       ) then raise exception 'canonical_complaint_requires_current_projection'; end if;
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
    elsif v_action.created_by='si-canonical-customer-request-projection-v1'
       and not public.dawaa_canonical_request_is_current_v1(
         v_source_id, v_action.payload->>'caseId', v_action.payload->>'requestKey', v_action.product_id
       ) then
      -- An approval made before a re-analysis withdrew the qualification is no longer executable.
      raise exception 'customer_request_requires_current_qualification';
    elsif v_action.created_by='si-canonical-customer-request-projection-v1' then
      v_staff_refusal := public.dawaa_canonical_request_staff_refusal_v1(
        v_source_id, v_action.payload->>'caseId', v_action.staff_id, v_action.branch);
      if v_staff_refusal is not null then raise exception '%', v_staff_refusal; end if;
      if v_action.staff_id is distinct from v_source.staff_id
         or public.dawaa_customer_request_branch_key(v_action.branch)
           is distinct from public.dawaa_customer_request_branch_key(v_source.branch) then
        raise exception 'customer_request_action_source_attribution_changed';
      end if;
    end if;
  end if;
  v_result := public.dawaa_materialize_whatsapp_action_core_v2(p_action_id);
  -- Postcondition: success means a materialized action with operational lineage, never a bare
  -- status flip. Raising rolls the whole command back (including any record the core created).
  select * into v_after from public.whatsapp_conversation_actions where id=p_action_id;
  if v_after.status is distinct from 'created'
     or nullif(btrim(coalesce(v_after.target_table,'')),'') is null
     or nullif(btrim(coalesce(v_after.target_id,'')),'') is null then
    raise exception 'whatsapp_action_materialization_without_target';
  end if;
  return v_result;
end;
$function$;
revoke all on function public.dawaa_materialize_whatsapp_action_v1(uuid) from public;
grant execute on function public.dawaa_materialize_whatsapp_action_v1(uuid) to anon,authenticated,service_role;
