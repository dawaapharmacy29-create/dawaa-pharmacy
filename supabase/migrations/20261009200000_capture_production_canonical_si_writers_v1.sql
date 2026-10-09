-- Source-control capture of the Production-only canonical Sale Truth / SI persistence writers.
--
-- Captured 2026-10-09 from dawaa-pharmacy-os with read-only catalog introspection only
-- (pg_get_functiondef, pg_get_viewdef, pg_proc/pg_class ACLs and comments, pg_get_triggerdef).
-- No function was executed and no table data was read.
--
-- Every definition below is copied byte-for-byte from Production; behaviour is unchanged.
-- md5 of each captured definition (pg_get_functiondef / pg_get_viewdef output):
--   sales_intelligence_write_case_analysis            c5e1bc70df8f8a904f970ae2b448d5e9
--   sales_intelligence_write_attribution              3704ff5f6439e84b605c55c552726252
--   sales_intelligence_write_basket_invoice_match     e775f7ebb405a1fc64984592de160cc5
--   sales_intelligence_write_policy_evaluation        cc7ed067e6e4f67fce13f40464811b38
--   dawaa_reconcile_sales_intelligence_case_v22_v1    28e9b90458d00f395a0c45d7d7b996d9
--   dawaa_revoke_whatsapp_canonical_sale_proof_v46    9e524b78fe42982c228ff77a765753b5
--   dawaa_capture_whatsapp_canonical_purchase_v36     ce65a4ab91789412483e281f42e04d55
--   dawaa_refresh_whatsapp_customer_story_v16         8323cdb192e31a1630e944830dafe83e
--   view sales_intelligence_invoice_staff_truth_v1    96742b4f5cf09aeb3ffd3cee5c69ae1c
--
-- Forward-only and idempotent: on Production it re-creates identical objects with identical
-- privileges, and the trigger is created only when missing. Not applied by this change.

CREATE OR REPLACE FUNCTION public.sales_intelligence_write_case_analysis(p_case_id text, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing public.sales_intelligence_case_analyses;
  v_new public.sales_intelligence_case_analyses;
  v_new_id uuid := gen_random_uuid();
  v_found boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:' || p_case_id));

  select * into v_existing
  from public.sales_intelligence_case_analyses
  where case_id = p_case_id and is_current = true
  for update;
  v_found := found;

  if v_found
     and v_existing.semantic_source_hash = (p_row->>'semantic_source_hash')
     and v_existing.pipeline_version = (p_row->>'pipeline_version')
     and v_existing.engine_version_case_segmentation = (p_row->>'engine_version_case_segmentation')
     and v_existing.engine_version_historical_closure = (p_row->>'engine_version_historical_closure')
     and v_existing.engine_version_commercial_confirmation = (p_row->>'engine_version_commercial_confirmation')
     and v_existing.engine_version_protocol_applicability = (p_row->>'engine_version_protocol_applicability')
  then
    return jsonb_build_object('is_new', false) || to_jsonb(v_existing);
  end if;

  v_new := jsonb_populate_record(null::public.sales_intelligence_case_analyses, p_row);
  v_new.analysis_id := v_new_id;
  v_new.case_id := p_case_id;
  v_new.analysis_version := coalesce(v_existing.analysis_version, 0) + 1;
  v_new.is_current := false;
  v_new.superseded_at := null;
  v_new.superseded_by_analysis_id := null;
  v_new.analyzed_at := coalesce(v_new.analyzed_at, now());
  v_new.needs_human_review := coalesce(v_new.needs_human_review, false);
  v_new.human_review_reasons := coalesce(v_new.human_review_reasons, '{}');
  v_new.failure_reasons := coalesce(v_new.failure_reasons, '{}');
  v_new.pipeline_warnings := coalesce(v_new.pipeline_warnings, '{}');
  v_new.evidence_snapshot := coalesce(v_new.evidence_snapshot, '{}'::jsonb);

  insert into public.sales_intelligence_case_analyses select (v_new).*;

  if v_found then
    update public.sales_intelligence_case_analyses
    set is_current = false, superseded_at = now(), superseded_by_analysis_id = v_new_id
    where analysis_id = v_existing.analysis_id;
  end if;

  update public.sales_intelligence_case_analyses
  set is_current = true
  where analysis_id = v_new_id;
  v_new.is_current := true;

  return jsonb_build_object('is_new', true) || to_jsonb(v_new);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sales_intelligence_write_attribution(p_analysis_id uuid, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing public.sales_intelligence_attributions;
  v_new public.sales_intelligence_attributions;
  v_new_id uuid := gen_random_uuid();
  v_found boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_attributions:' || p_analysis_id::text));

  select * into v_existing
  from public.sales_intelligence_attributions
  where analysis_id = p_analysis_id and is_current_evaluation = true
  for update;
  v_found := found;

  if v_found
     and v_existing.attribution_input_hash = (p_row->>'attribution_input_hash')
     and v_existing.attribution_engine_version = (p_row->>'attribution_engine_version')
  then
    return jsonb_build_object('is_new', false) || to_jsonb(v_existing);
  end if;

  v_new := jsonb_populate_record(null::public.sales_intelligence_attributions, p_row);
  v_new.id := v_new_id;
  v_new.analysis_id := p_analysis_id;
  v_new.evaluation_version := coalesce(v_existing.evaluation_version, 0) + 1;
  v_new.is_current_evaluation := false;
  v_new.superseded_at := null;
  v_new.superseded_by_evaluation_version := null;
  v_new.evaluated_at := coalesce(v_new.evaluated_at, now());
  v_new.is_official_for_staff_evaluation := coalesce(v_new.is_official_for_staff_evaluation, false);
  v_new.competing_case_ids := coalesce(v_new.competing_case_ids, '{}');
  v_new.ambiguity_status := coalesce(v_new.ambiguity_status, 'none');
  v_new.identity_conflict := coalesce(v_new.identity_conflict, 'none');
  v_new.branch_conflict := coalesce(v_new.branch_conflict, false);
  v_new.candidate_count := coalesce(v_new.candidate_count, 0);
  v_new.primary_evidence := coalesce(v_new.primary_evidence, '[]'::jsonb);
  v_new.contradictions := coalesce(v_new.contradictions, '{}');
  v_new.rule_ids := coalesce(v_new.rule_ids, '{}');
  v_new.legacy_evidence_used := coalesce(v_new.legacy_evidence_used, false);

  insert into public.sales_intelligence_attributions select (v_new).*;

  if v_found then
    update public.sales_intelligence_attributions
    set is_current_evaluation = false, superseded_at = now(), superseded_by_evaluation_version = v_new.evaluation_version
    where id = v_existing.id;
  end if;

  update public.sales_intelligence_attributions
  set is_current_evaluation = true
  where id = v_new_id;
  v_new.is_current_evaluation := true;

  return jsonb_build_object('is_new', true) || to_jsonb(v_new);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sales_intelligence_write_basket_invoice_match(p_analysis_id uuid, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing public.sales_intelligence_basket_invoice_matches;
  v_new public.sales_intelligence_basket_invoice_matches;
  v_new_id uuid := gen_random_uuid();
  v_found boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_basket_invoice_matches:' || p_analysis_id::text));

  select * into v_existing
  from public.sales_intelligence_basket_invoice_matches
  where analysis_id = p_analysis_id and is_current_evaluation = true
  for update;
  v_found := found;

  if v_found
     and v_existing.attribution_row_id = (p_row->>'attribution_row_id')::uuid
     and v_existing.matching_input_hash = (p_row->>'matching_input_hash')
     and v_existing.matching_engine_version = (p_row->>'matching_engine_version')
  then
    return jsonb_build_object('is_new', false) || to_jsonb(v_existing);
  end if;

  v_new := jsonb_populate_record(null::public.sales_intelligence_basket_invoice_matches, p_row);
  v_new.id := v_new_id;
  v_new.analysis_id := p_analysis_id;
  v_new.evaluation_version := coalesce(v_existing.evaluation_version, 0) + 1;
  v_new.is_current_evaluation := false;
  v_new.superseded_at := null;
  v_new.superseded_by_evaluation_version := null;
  v_new.evaluated_at := coalesce(v_new.evaluated_at, now());
  v_new.header_evidence_ready := coalesce(v_new.header_evidence_ready, false);
  v_new.item_evidence_ready := coalesce(v_new.item_evidence_ready, false);
  v_new.differences := coalesce(v_new.differences, '[]'::jsonb);
  v_new.needs_human_review := coalesce(v_new.needs_human_review, false);
  v_new.human_review_reasons := coalesce(v_new.human_review_reasons, '{}');

  insert into public.sales_intelligence_basket_invoice_matches select (v_new).*;

  if v_found then
    update public.sales_intelligence_basket_invoice_matches
    set is_current_evaluation = false, superseded_at = now(), superseded_by_evaluation_version = v_new.evaluation_version
    where id = v_existing.id;
  end if;

  update public.sales_intelligence_basket_invoice_matches
  set is_current_evaluation = true
  where id = v_new_id;
  v_new.is_current_evaluation := true;

  return jsonb_build_object('is_new', true) || to_jsonb(v_new);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sales_intelligence_write_policy_evaluation(p_analysis_id uuid, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_existing public.sales_intelligence_policy_evaluations;
  v_new public.sales_intelligence_policy_evaluations;
  v_new_id uuid := gen_random_uuid();
  v_found boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_policy_evaluations:' || p_analysis_id::text));

  select * into v_existing
  from public.sales_intelligence_policy_evaluations
  where analysis_id = p_analysis_id and is_current = true
  for update;
  v_found := found;

  if v_found
     and v_existing.policy_input_hash = (p_row->>'policy_input_hash')
     and v_existing.policy_config_id = (p_row->>'policy_config_id')::uuid
  then
    return jsonb_build_object('is_new', false) || to_jsonb(v_existing);
  end if;

  v_new := jsonb_populate_record(null::public.sales_intelligence_policy_evaluations, p_row);
  v_new.policy_evaluation_id := v_new_id;
  v_new.analysis_id := p_analysis_id;
  v_new.evaluation_version := coalesce(v_existing.evaluation_version, 0) + 1;
  v_new.is_current := false;
  v_new.superseded_at := null;
  v_new.superseded_by_policy_evaluation_id := null;
  v_new.evaluated_at := coalesce(v_new.evaluated_at, now());

  insert into public.sales_intelligence_policy_evaluations select (v_new).*;

  if v_found then
    update public.sales_intelligence_policy_evaluations
    set is_current = false, superseded_at = now(), superseded_by_policy_evaluation_id = v_new_id
    where policy_evaluation_id = v_existing.policy_evaluation_id;
  end if;

  update public.sales_intelligence_policy_evaluations
  set is_current = true
  where policy_evaluation_id = v_new_id;
  v_new.is_current := true;

  return jsonb_build_object('is_new', true) || to_jsonb(v_new);
end;
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_reconcile_sales_intelligence_case_v22_v1(p_sales_case_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_case public.sales_intelligence_cases%rowtype;
  v_analysis public.sales_intelligence_case_analyses%rowtype;
  v_attr public.sales_intelligence_attributions%rowtype;
  v_match public.sales_intelligence_basket_invoice_matches%rowtype;
  v_v22 public.whatsapp_customer_cases_v22%rowtype;
  v_invoice public.sales_invoices%rowtype;
  v_outcome jsonb;
  v_attr_count integer;
  v_match_count integer;
  v_invoice_number text;
  v_invoice_value numeric;
  v_invoice_at timestamptz;
  v_before jsonb;
  v_after jsonb;
  v_not_proven text := null;
  v_owns_proof boolean;
  v_revoked jsonb := null;
begin
  select * into v_case from public.sales_intelligence_cases where case_id = p_sales_case_id;
  if not found then
    return jsonb_build_object('ok', false, 'status', 'sales_intelligence_case_not_found', 'salesCaseId', p_sales_case_id);
  end if;
  if nullif(trim(coalesce(v_case.source_case_id_v22, '')), '') is null then
    return jsonb_build_object('ok', false, 'status', 'v22_case_not_linked', 'salesCaseId', p_sales_case_id);
  end if;

  select * into v_v22
  from public.whatsapp_customer_cases_v22
  where id::text = v_case.source_case_id_v22
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 'linked_v22_case_not_found',
      'salesCaseId', p_sales_case_id, 'v22CaseId', v_case.source_case_id_v22);
  end if;

  v_owns_proof := coalesce(v_v22.case_json #>> '{canonicalSaleProof,state}', '') = 'proven'
    and coalesce(v_v22.case_json #>> '{canonicalSaleProof,salesCaseId}', p_sales_case_id) = p_sales_case_id;

  select * into v_analysis
  from public.sales_intelligence_case_analyses
  where case_id = p_sales_case_id and is_current = true
  order by analyzed_at desc
  limit 1;

  if not found then
    v_not_proven := 'current_analysis_not_found';
  else
    v_outcome := v_analysis.evidence_snapshot -> 'canonicalSalesOutcome';
    if v_outcome is null then
      v_not_proven := 'canonical_outcome_not_persisted';
    elsif coalesce(v_outcome ->> 'outcome', '') <> 'sale_proven'
       or coalesce(v_outcome ->> 'saleProofState', '') <> 'proven'
       or coalesce((v_outcome ->> 'isSaleCountable')::boolean, false) is not true
       or coalesce((v_outcome ->> 'isRevenueCountable')::boolean, false) is not true then
      v_not_proven := 'current_outcome_not_proven';
    end if;
  end if;

  if v_not_proven is null then
    select count(*) into v_attr_count
    from public.sales_intelligence_attributions
    where analysis_id = v_analysis.analysis_id and is_current_evaluation = true;
    if v_attr_count <> 1 then
      v_not_proven := 'current_attribution_not_unique';
    else
      select * into v_attr
      from public.sales_intelligence_attributions
      where analysis_id = v_analysis.analysis_id and is_current_evaluation = true
      limit 1;
      if coalesce(v_attr.attribution_level, '') <> 'proven'
         or nullif(trim(coalesce(v_attr.selected_invoice_id, '')), '') is null then
        v_not_proven := 'proven_outcome_without_proven_attribution';
      end if;
    end if;
  end if;

  if v_not_proven is null then
    select count(*) into v_match_count
    from public.sales_intelligence_basket_invoice_matches
    where analysis_id = v_analysis.analysis_id and is_current_evaluation = true;
    if v_match_count <> 1 then
      v_not_proven := 'current_invoice_match_not_unique';
    else
      select * into v_match
      from public.sales_intelligence_basket_invoice_matches
      where analysis_id = v_analysis.analysis_id and is_current_evaluation = true
      limit 1;
      if v_match.attribution_row_id is distinct from v_attr.id
         or coalesce(v_match.invoice_id, '') <> coalesce(v_attr.selected_invoice_id, '') then
        v_not_proven := 'persisted_invoice_chain_mismatch';
      end if;
    end if;
  end if;

  if v_not_proven is null then
    select * into v_invoice from public.sales_invoices where id = v_attr.selected_invoice_id limit 1;
    if not found then
      v_not_proven := 'selected_invoice_not_found';
    end if;
  end if;

  if v_not_proven is not null then
    if v_owns_proof then
      return public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(
        v_v22.id,
        v_not_proven,
        jsonb_build_object(
          'salesCaseId', p_sales_case_id,
          'analysisId', v_analysis.analysis_id,
          'salesOutcome', v_outcome ->> 'outcome',
          'saleProofState', v_outcome ->> 'saleProofState'
        )
      ) || jsonb_build_object('salesCaseId', p_sales_case_id, 'notProvenReason', v_not_proven);
    end if;
    return jsonb_build_object('ok', true, 'status', 'not_proven_no_change',
      'salesCaseId', p_sales_case_id, 'reason', v_not_proven,
      'analysisId', v_analysis.analysis_id, 'canonicalSalesOutcome', v_outcome);
  end if;

  if v_v22.confirmed_outcome is not null and v_v22.confirmed_outcome <> 'verified_sale' then
    return jsonb_build_object('ok', false, 'status', 'human_outcome_conflict',
      'salesCaseId', p_sales_case_id, 'v22CaseId', v_v22.id, 'confirmedOutcome', v_v22.confirmed_outcome);
  end if;

  if coalesce(v_v22.case_json #>> '{canonicalSaleProof,state}', '') = 'proven'
     and v_v22.verified_invoice_id = v_attr.selected_invoice_id
     and coalesce(v_v22.proposed_outcome, '') = 'verified_sale' then
    return jsonb_build_object('ok', true, 'status', 'already_reconciled',
      'salesCaseId', p_sales_case_id, 'analysisId', v_analysis.analysis_id,
      'v22CaseId', v_v22.id, 'invoiceId', v_attr.selected_invoice_id);
  end if;

  if coalesce(v_v22.case_json #>> '{canonicalSaleProof,state}', '') = 'proven'
     and nullif(trim(coalesce(v_v22.verified_invoice_id, '')), '') is not null
     and v_v22.verified_invoice_id <> v_attr.selected_invoice_id then
    if not v_owns_proof then
      return jsonb_build_object('ok', false, 'status', 'existing_canonical_invoice_conflict',
        'salesCaseId', p_sales_case_id, 'v22CaseId', v_v22.id,
        'existingInvoiceId', v_v22.verified_invoice_id, 'selectedInvoiceId', v_attr.selected_invoice_id);
    end if;
    v_revoked := public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(
      v_v22.id, 'superseded_by_new_proven_invoice',
      jsonb_build_object('salesCaseId', p_sales_case_id, 'analysisId', v_analysis.analysis_id,
        'newInvoiceId', v_attr.selected_invoice_id));
    select * into v_v22 from public.whatsapp_customer_cases_v22 where id = v_v22.id;
  end if;

  v_invoice_number := coalesce(
    nullif(trim(v_attr.selected_invoice_number), ''),
    nullif(trim(v_invoice.invoice_number), ''),
    nullif(trim(v_invoice.invoice_no), '')
  );
  v_invoice_value := coalesce(v_invoice.net_amount, v_invoice.total_amount, v_invoice.amount, v_invoice.gross_amount, 0);
  v_invoice_at := coalesce(
    v_invoice.invoice_datetime,
    v_invoice.invoice_date,
    v_invoice.sale_date::timestamp at time zone 'Africa/Cairo',
    v_analysis.analyzed_at
  );

  v_before := jsonb_build_object(
    'proposed_outcome', v_v22.proposed_outcome,
    'confirmed_outcome', v_v22.confirmed_outcome,
    'verified_invoice_id', v_v22.verified_invoice_id,
    'verified_invoice_number', v_v22.verified_invoice_number,
    'verified_revenue', v_v22.verified_revenue,
    'verified_sale_at', v_v22.verified_sale_at,
    'canonicalSaleProof', v_v22.case_json -> 'canonicalSaleProof'
  );

  update public.whatsapp_customer_cases_v22
  set
    proposed_outcome = 'verified_sale',
    outcome_confidence = 100,
    verified_invoice_id = v_attr.selected_invoice_id,
    verified_invoice_number = v_invoice_number,
    verified_revenue = v_invoice_value,
    verified_sale_at = v_invoice_at,
    case_json = jsonb_set(
      coalesce(case_json, '{}'::jsonb),
      '{canonicalSaleProof}',
      jsonb_build_object(
        'state', 'proven',
        'source', 'sales_intelligence',
        'salesCaseId', p_sales_case_id,
        'analysisId', v_analysis.analysis_id,
        'analysisVersion', v_analysis.analysis_version,
        'pipelineVersion', v_analysis.pipeline_version,
        'salesOutcome', v_outcome ->> 'outcome',
        'saleProofState', v_outcome ->> 'saleProofState',
        'invoiceId', v_attr.selected_invoice_id,
        'invoiceNumber', v_invoice_number,
        'reasonCodes', coalesce(v_outcome -> 'reasonCodes', '[]'::jsonb),
        'previousProposedOutcome', case when v_v22.proposed_outcome = 'verified_sale' then null else v_v22.proposed_outcome end,
        'previousOutcomeConfidence', case when v_v22.proposed_outcome = 'verified_sale' then null else v_v22.outcome_confidence end,
        'reconciledAt', now()
      ),
      true
    ),
    updated_at = now()
  where id = v_v22.id
  returning jsonb_build_object(
    'proposed_outcome', proposed_outcome,
    'confirmed_outcome', confirmed_outcome,
    'verified_invoice_id', verified_invoice_id,
    'verified_invoice_number', verified_invoice_number,
    'verified_revenue', verified_revenue,
    'verified_sale_at', verified_sale_at,
    'canonicalSaleProof', case_json -> 'canonicalSaleProof'
  ) into v_after;

  insert into public.whatsapp_review_audit(
    source_id, action, actor_id, actor_name, actor_role, before_state, after_state, note
  )
  values (
    v_v22.root_source_id,
    'canonical_sale_proof_reconciled_v44',
    null, 'sales_intelligence', 'system', v_before, v_after,
    'Canonical sale proof reconciled from persisted Sales Intelligence analysis ' || v_analysis.analysis_id::text
  );

  return jsonb_build_object(
    'ok', true, 'status', 'reconciled',
    'salesCaseId', p_sales_case_id, 'analysisId', v_analysis.analysis_id,
    'v22CaseId', v_v22.id, 'invoiceId', v_attr.selected_invoice_id,
    'invoiceNumber', v_invoice_number, 'revenue', v_invoice_value, 'saleAt', v_invoice_at,
    'revokedPrevious', v_revoked
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(p_v22_case_id uuid, p_reason text, p_evidence jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_case public.whatsapp_customer_cases_v22%rowtype;
  v_proof jsonb;
  v_invoice text;
  v_restored_outcome text;
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := now();
  v_revocation_id uuid := gen_random_uuid();
  v_story_ids uuid[] := '{}';
  v_events int := 0;
  v_actions int := 0;
  v_requests int := 0;
  v_story uuid;
begin
  select * into v_case
  from public.whatsapp_customer_cases_v22
  where id = p_v22_case_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'linked_v22_case_not_found', 'v22CaseId', p_v22_case_id);
  end if;

  v_proof := v_case.case_json -> 'canonicalSaleProof';
  if coalesce(v_proof ->> 'state', '') <> 'proven' then
    return jsonb_build_object('ok', true, 'status', 'not_proven_no_change', 'v22CaseId', v_case.id);
  end if;

  v_invoice := coalesce(nullif(trim(v_case.verified_invoice_id), ''), nullif(v_proof ->> 'invoiceId', ''));
  v_restored_outcome := coalesce(
    nullif(v_proof ->> 'previousProposedOutcome', ''),
    case
      when v_case.order_confirmed then 'order_confirmed_waiting_invoice'
      when v_case.customer_reengaged then 'customer_reengaged'
      when v_case.failure_detected or v_case.complaint_detected or v_case.case_state = 'recovery' then 'followup_needed'
      when v_case.case_state = 'awaiting_pharmacy' then 'awaiting_pharmacy'
      when v_case.case_state = 'awaiting_customer' then 'awaiting_customer'
      else 'open'
    end
  );

  v_before := jsonb_build_object(
    'proposed_outcome', v_case.proposed_outcome,
    'confirmed_outcome', v_case.confirmed_outcome,
    'outcome_confidence', v_case.outcome_confidence,
    'verified_invoice_id', v_case.verified_invoice_id,
    'verified_invoice_number', v_case.verified_invoice_number,
    'verified_revenue', v_case.verified_revenue,
    'verified_sale_at', v_case.verified_sale_at,
    'canonicalSaleProof', v_proof
  );

  update public.whatsapp_customer_cases_v22
  set
    proposed_outcome = v_restored_outcome,
    confirmed_outcome = case when confirmed_outcome = 'verified_sale' then null else confirmed_outcome end,
    outcome_confidence = coalesce((v_proof ->> 'previousOutcomeConfidence')::numeric, outcome_confidence),
    verified_invoice_id = null,
    verified_invoice_number = null,
    verified_revenue = null,
    verified_sale_at = null,
    case_json = jsonb_set(
      coalesce(case_json, '{}'::jsonb),
      '{canonicalSaleProof}',
      jsonb_build_object(
        'state', 'revoked',
        'revocationId', v_revocation_id,
        'reason', p_reason,
        'revokedAt', v_now,
        'evidence', coalesce(p_evidence, '{}'::jsonb),
        'revokedProof', v_proof,
        'revokedConfirmation', case when v_case.confirmed_outcome = 'verified_sale' then jsonb_build_object(
          'confirmedOutcome', v_case.confirmed_outcome,
          'reviewedBy', v_case.outcome_reviewed_by,
          'reviewedAt', v_case.outcome_reviewed_at
        ) else null end
      ),
      true
    ),
    updated_at = v_now
  where id = v_case.id
  returning jsonb_build_object(
    'proposed_outcome', proposed_outcome,
    'confirmed_outcome', confirmed_outcome,
    'verified_invoice_id', verified_invoice_id,
    'canonicalSaleProof', case_json -> 'canonicalSaleProof'
  ) into v_after;

  if v_invoice is not null and not exists (
    select 1 from public.whatsapp_customer_cases_v22 c
    where c.id <> v_case.id
      and c.verified_invoice_id = v_invoice
      and coalesce(c.case_json #>> '{canonicalSaleProof,state}', '') = 'proven'
  ) then
    with revoked as (
      update public.whatsapp_customer_story_events e
      set
        event_key = e.event_key || ':revoked:' || v_revocation_id::text,
        event_type = e.event_type || '_revoked',
        payload = coalesce(e.payload, '{}'::jsonb) || jsonb_build_object(
          'revoked', true,
          'revocationId', v_revocation_id,
          'revokedAt', v_now,
          'revokedReason', p_reason,
          'revokedCaseId', v_case.id
        )
      where e.invoice_id = v_invoice
        and e.event_type in ('verified_purchase', 'customer_recovered')
        and e.event_key in ('canonical-verified-invoice:' || v_invoice, 'canonical-recovered:' || v_invoice)
      returning e.story_id
    )
    select coalesce(array_agg(distinct story_id), '{}'), count(*)::int
    into v_story_ids, v_events
    from revoked;

    if v_case.story_id is not null and not (v_case.story_id = any(v_story_ids)) then
      v_story_ids := v_story_ids || v_case.story_id;
    end if;

    update public.whatsapp_customer_stories s
    set
      last_verified_purchase_at = latest.event_at,
      last_verified_purchase_value = latest.invoice_value,
      status = case when s.recovered_invoice_id = v_invoice then 'recovery' else s.status end,
      recovered_at = case when s.recovered_invoice_id = v_invoice then null else s.recovered_at end,
      recovered_invoice_number = case when s.recovered_invoice_id = v_invoice then null else s.recovered_invoice_number end,
      recovered_invoice_value = case when s.recovered_invoice_id = v_invoice then null else s.recovered_invoice_value end,
      recovered_invoice_id = case when s.recovered_invoice_id = v_invoice then null else s.recovered_invoice_id end,
      updated_at = v_now
    from (
      select sid, (
        select jsonb_build_object('at', e.event_at, 'value', e.invoice_value)
        from public.whatsapp_customer_story_events e
        where e.story_id = sid and e.event_type = 'verified_purchase'
        order by e.event_at desc
        limit 1
      ) as last_event
      from unnest(v_story_ids) as sid
    ) x
    cross join lateral (
      select (x.last_event ->> 'at')::timestamptz as event_at, (x.last_event ->> 'value')::numeric as invoice_value
    ) latest
    where s.id = x.sid;

    update public.whatsapp_customer_journeys j
    set
      lifecycle_status = 'recovery',
      recovered_at = null,
      recovered_invoice_id = null,
      recovered_invoice_number = null,
      recovered_invoice_value = null,
      updated_at = v_now
    where j.recovered_invoice_id = v_invoice
      and (j.story_id = any(v_story_ids) or j.id = v_case.journey_id);

    with reopened as (
      update public.whatsapp_conversation_actions a
      set
        outcome = 'followup_needed',
        work_status = 'unassigned',
        completed_at = null,
        outcome_note = case when nullif(a.outcome_note, '') is not null then a.outcome_note || E'\n' else '' end
          || 'تم سحب إثبات البيع Canonical لهذه الفاتورة؛ عادت المتابعة مفتوحة.',
        payload = coalesce(a.payload, '{}'::jsonb) || jsonb_build_object(
          'revokedCanonicalRecovery', jsonb_build_object(
            'invoiceId', a.recovered_invoice_id,
            'invoiceNumber', a.recovered_invoice_number,
            'invoiceValue', a.recovered_invoice_value,
            'recoveredAt', a.recovered_at,
            'previousOutcome', a.outcome,
            'previousWorkStatus', a.work_status,
            'previousFollowupAttempts', a.followup_attempts,
            'previousLastFollowupAt', a.last_followup_at,
            'revocationId', v_revocation_id,
            'revokedAt', v_now,
            'reason', p_reason,
            'v22CaseId', v_case.id
          )
        ),
        recovered_invoice_id = null,
        recovered_invoice_number = null,
        recovered_invoice_value = null,
        recovered_at = null,
        updated_at = v_now
      where a.recovered_invoice_id = v_invoice
      returning a.id
    )
    select count(*)::int into v_actions from reopened;

    update public.whatsapp_conversation_actions a
    set
      followup_attempts = coalesce((a.payload #>> '{revokedCanonicalRecovery,previousFollowupAttempts}')::int, a.followup_attempts),
      last_followup_at = (a.payload #>> '{revokedCanonicalRecovery,previousLastFollowupAt}')::timestamptz
    where a.payload #>> '{revokedCanonicalRecovery,revocationId}' = v_revocation_id::text;

    with reopened as (
      update public.whatsapp_conversation_actions a
      set
        status = 'ready',
        work_status = 'unassigned',
        outcome = null,
        completed_at = null,
        target_table = null,
        target_id = null,
        outcome_note = 'تم سحب إثبات البيع Canonical؛ الطلب لم يعد مغلقًا كمباع.',
        payload = (coalesce(a.payload, '{}'::jsonb) - 'canonical_sale') || jsonb_build_object(
          'revokedCanonicalSale', (a.payload -> 'canonical_sale') || jsonb_build_object(
            'revokedAt', v_now,
            'reason', p_reason,
            'v22CaseId', v_case.id
          )
        ),
        updated_at = v_now
      where a.action_type = 'customer_request'
        and a.payload #>> '{canonical_sale,invoice_id}' = v_invoice
        and (a.source_id = v_case.root_source_id or a.source_id = any(v_case.source_ids))
      returning a.id
    )
    select count(*)::int into v_requests from reopened;

    foreach v_story in array v_story_ids loop
      perform public.dawaa_refresh_whatsapp_customer_story_v16(v_story);
    end loop;
  end if;

  insert into public.whatsapp_review_audit(
    source_id, action, actor_id, actor_name, actor_role, before_state, after_state, note
  )
  values (
    v_case.root_source_id,
    'canonical_sale_proof_revoked_v46',
    null, 'sales_intelligence', 'system', v_before, v_after,
    'Canonical sale proof revoked: ' || coalesce(p_reason, 'unspecified')
  );

  return jsonb_build_object(
    'ok', true,
    'status', 'revoked',
    'revocationId', v_revocation_id,
    'v22CaseId', v_case.id,
    'invoiceId', v_invoice,
    'reason', p_reason,
    'storyEventsRevoked', v_events,
    'storiesRefreshed', coalesce(array_length(v_story_ids, 1), 0),
    'followupActionsReopened', v_actions,
    'customerRequestsReopened', v_requests
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_capture_whatsapp_canonical_purchase_v36()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_story public.whatsapp_customer_stories%rowtype;
  v_invoice_at timestamptz;
  v_invoice_number text;
  v_invoice_value numeric;
  v_journey_id uuid;
  v_effective_outcome text;
  v_is_canonical boolean;
begin
  v_effective_outcome := coalesce(new.confirmed_outcome,new.proposed_outcome);
  v_is_canonical :=
    coalesce(new.case_json #>> '{canonicalSaleProof,state}','')='proven';

  if v_effective_outcome<>'verified_sale'
     or new.verified_invoice_id is null
     or not v_is_canonical
  then
    return new;
  end if;

  if new.story_id is not null then
    select * into v_story
    from public.whatsapp_customer_stories s
    where s.id=new.story_id
    limit 1;
  end if;

  if v_story.id is null then
    select * into v_story
    from public.whatsapp_customer_stories s
    where
      (new.customer_id is not null and s.customer_id=new.customer_id)
      or (
        new.customer_code is not null
        and nullif(trim(new.customer_code),'') is not null
        and s.customer_code=new.customer_code
        and public.dawaa_customer_request_branch_key(s.branch)=public.dawaa_customer_request_branch_key(new.branch)
      )
      or (
        new.customer_phone is not null
        and nullif(regexp_replace(new.customer_phone,'\D','','g'),'') is not null
        and regexp_replace(coalesce(s.customer_phone,''),'\D','','g')=regexp_replace(new.customer_phone,'\D','','g')
        and public.dawaa_customer_request_branch_key(s.branch)=public.dawaa_customer_request_branch_key(new.branch)
      )
    order by
      case when new.customer_id is not null and s.customer_id=new.customer_id then 1
           when new.customer_code is not null and s.customer_code=new.customer_code then 2
           else 3 end,
      s.created_at asc
    limit 1;
  end if;

  if v_story.id is null then return new; end if;

  select
    coalesce(new.verified_sale_at,si.invoice_datetime,new.last_event_at,now()),
    coalesce(new.verified_invoice_number,nullif(trim(si.invoice_number),'')),
    coalesce(new.verified_revenue,si.net_amount,si.total_amount,si.amount,0)
  into v_invoice_at,v_invoice_number,v_invoice_value
  from public.sales_invoices si
  where si.id=new.verified_invoice_id::text
  limit 1;

  v_invoice_at := coalesce(v_invoice_at,new.verified_sale_at,new.last_event_at,now());
  v_invoice_number := coalesce(v_invoice_number,new.verified_invoice_number);
  v_invoice_value := coalesce(v_invoice_value,new.verified_revenue,0);

  select j.id into v_journey_id
  from public.whatsapp_customer_journeys j
  where j.story_id=v_story.id
    and j.journey_started_at<=v_invoice_at
  order by j.journey_started_at desc nulls last
  limit 1;

  insert into public.whatsapp_customer_story_events(
    story_id,event_key,event_type,event_at,journey_id,source_id,
    invoice_id,invoice_number,invoice_value,confidence,title,detail,payload
  )
  values(
    v_story.id,
    'canonical-verified-invoice:'||new.verified_invoice_id::text,
    'verified_purchase',
    v_invoice_at,
    coalesce(new.journey_id,v_journey_id),
    new.root_source_id,
    new.verified_invoice_id::text,
    v_invoice_number,
    v_invoice_value,
    100,
    'شراء مثبت Canonical',
    'تم إثبات الشراء من Customer Case بعد وصول Sale Proof Canonical إلى verified_sale.',
    jsonb_build_object(
      'proofSource','whatsapp_customer_cases_v22',
      'caseId',new.id,
      'canonicalSaleProofState',new.case_json #>> '{canonicalSaleProof,state}'
    )
  )
  on conflict(story_id,event_key) do update set
    event_at=excluded.event_at,
    journey_id=excluded.journey_id,
    source_id=excluded.source_id,
    invoice_number=excluded.invoice_number,
    invoice_value=excluded.invoice_value,
    confidence=excluded.confidence,
    title=excluded.title,
    detail=excluded.detail,
    payload=excluded.payload;

  update public.whatsapp_customer_stories s
  set
    last_verified_purchase_value=case
      when s.last_verified_purchase_at is null or v_invoice_at>=s.last_verified_purchase_at then v_invoice_value
      else s.last_verified_purchase_value
    end,
    last_verified_purchase_at=greatest(coalesce(s.last_verified_purchase_at,'epoch'::timestamptz),v_invoice_at),
    last_activity_at=greatest(coalesce(s.last_activity_at,'epoch'::timestamptz),v_invoice_at),
    updated_at=now()
  where s.id=v_story.id
  returning * into v_story;

  if v_story.status='recovery'
     and v_story.recovery_started_at is not null
     and v_invoice_at>=v_story.recovery_started_at
     and exists (
       select 1
       from public.whatsapp_customer_story_events e
       where e.story_id=v_story.id
         and e.event_type in ('recovery_attempt','apology_recovery','service_followup','complaint_followup')
         and e.event_at<=v_invoice_at
         and e.event_at>=v_invoice_at-interval '45 days'
     )
  then
    update public.whatsapp_customer_stories
    set
      status='recovered',
      recovered_at=v_invoice_at,
      recovered_invoice_id=new.verified_invoice_id::text,
      recovered_invoice_number=v_invoice_number,
      recovered_invoice_value=v_invoice_value,
      updated_at=now()
    where id=v_story.id;

    if coalesce(new.journey_id,v_journey_id) is not null then
      update public.whatsapp_customer_journeys
      set
        lifecycle_status='recovered',
        recovered_at=v_invoice_at,
        recovered_invoice_id=new.verified_invoice_id::text,
        recovered_invoice_number=v_invoice_number,
        recovered_invoice_value=v_invoice_value,
        updated_at=now()
      where id=coalesce(new.journey_id,v_journey_id);
    end if;

    update public.whatsapp_conversation_actions a
    set
      work_status='completed',
      completed_at=coalesce(a.completed_at,v_invoice_at),
      outcome='sold',
      outcome_note=case when nullif(a.outcome_note,'') is not null then a.outcome_note||E'\n' else '' end
        || 'تم تأكيد عودة العميل للشراء من خلال Sale Proof Canonical على Customer Case.',
      recovered_invoice_id=new.verified_invoice_id::text,
      recovered_invoice_number=v_invoice_number,
      recovered_invoice_value=v_invoice_value,
      recovered_at=v_invoice_at,
      updated_at=now()
    where a.work_status not in ('completed','cancelled','failed')
      and a.action_type in ('customer_followup','complaint_followup')
      and (
        a.action_key in ('customer-followup','complaint-followup')
        or a.action_key like 'recovery:%'
        or a.action_key like 'case-rescue:%'
      )
      and (
        (v_story.customer_id is not null and a.customer_id=v_story.customer_id)
        or (
          v_story.customer_code is not null
          and a.customer_code=v_story.customer_code
          and public.dawaa_customer_request_branch_key(a.branch)=public.dawaa_customer_request_branch_key(v_story.branch)
        )
        or (
          v_story.customer_phone is not null
          and regexp_replace(coalesce(a.customer_phone,''),'\D','','g')=regexp_replace(v_story.customer_phone,'\D','','g')
          and public.dawaa_customer_request_branch_key(a.branch)=public.dawaa_customer_request_branch_key(v_story.branch)
        )
      )
      and coalesce(a.created_at,a.due_at,now())>=v_story.recovery_started_at;

    insert into public.whatsapp_customer_story_events(
      story_id,event_key,event_type,event_at,journey_id,source_id,
      invoice_id,invoice_number,invoice_value,confidence,title,detail,payload
    )
    values(
      v_story.id,
      'canonical-recovered:'||new.verified_invoice_id::text,
      'customer_recovered',
      v_invoice_at,
      coalesce(new.journey_id,v_journey_id),
      new.root_source_id,
      new.verified_invoice_id::text,
      v_invoice_number,
      v_invoice_value,
      100,
      'تم استرجاع العميل — Canonical',
      'عاد العميل لشراء مثبت Canonical بعد محاولة متابعة فعلية خلال آخر 45 يومًا. الربط تشغيلي ولا يثبت وحده أن المتابعة هي سبب الشراء.',
      jsonb_build_object(
        'proofSource','whatsapp_customer_cases_v22',
        'caseId',new.id,
        'recoveryWindowRule','recent_recovery_event_within_45_days'
      )
    )
    on conflict(story_id,event_key) do update set
      event_at=excluded.event_at,
      journey_id=excluded.journey_id,
      source_id=excluded.source_id,
      invoice_number=excluded.invoice_number,
      invoice_value=excluded.invoice_value,
      confidence=excluded.confidence,
      title=excluded.title,
      detail=excluded.detail,
      payload=excluded.payload;
  end if;

  perform public.dawaa_refresh_whatsapp_customer_story_v16(v_story.id);
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.dawaa_refresh_whatsapp_customer_story_v16(p_story_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_story public.whatsapp_customer_stories%rowtype;
  v_open_requests int := 0;
  v_open_complaints int := 0;
  v_accepted int := 0;
  v_attempts int := 0;
  v_sources int := 0;
  v_last timestamptz;
  v_risk text := 'low';
  v_status text := 'active';
  v_journey_recovery_start timestamptz;
  v_recovery_event_start timestamptz;
  v_episode_start timestamptz;
begin
  select * into v_story
  from public.whatsapp_customer_stories
  where id=p_story_id;
  if not found then return; end if;

  perform public.dawaa_sync_whatsapp_story_product_events_v16(p_story_id);
  perform public.dawaa_sync_whatsapp_story_reengagement_events_v16(p_story_id);

  select
    count(*) filter (where coalesce(j.unresolved_order,false))::int,
    count(*) filter (where coalesce(j.unresolved_complaint,false))::int,
    coalesce(sum(j.recovery_attempts),0)::int,
    max(j.journey_ended_at),
    case
      when bool_or(j.customer_risk='critical') then 'critical'
      when bool_or(j.customer_risk='high') then 'high'
      when bool_or(j.customer_risk='medium') then 'medium'
      else 'low'
    end,
    min(j.journey_started_at) filter (
      where (
        j.lifecycle_status='recovery'
        or coalesce(j.unresolved_order,false)
        or coalesce(j.unresolved_complaint,false)
        or coalesce(j.recovery_attempts,0)>0
      )
      and (v_story.recovered_at is null or j.journey_started_at>v_story.recovered_at)
    )
  into
    v_open_requests,v_open_complaints,v_attempts,v_last,v_risk,v_journey_recovery_start
  from public.whatsapp_customer_journeys j
  where j.story_id=p_story_id
    and coalesce(j.lifecycle_status,'open') in ('open','recovery');

  select min(e.event_at)
  into v_recovery_event_start
  from public.whatsapp_customer_story_events e
  where e.story_id=p_story_id
    and e.event_type in ('recovery_attempt','apology_recovery','service_followup','complaint_followup')
    and (v_story.recovered_at is null or e.event_at>v_story.recovered_at);

  v_episode_start := coalesce(v_recovery_event_start,v_journey_recovery_start);

  select count(distinct js.source_id)::int
  into v_sources
  from public.whatsapp_customer_journeys j
  join public.whatsapp_customer_journey_sessions js on js.journey_id=j.id
  where j.story_id=p_story_id;

  select count(*)::int
  into v_accepted
  from public.whatsapp_customer_story_events e
  where e.story_id=p_story_id
    and e.event_type='recommendation_accepted';

  if v_episode_start is not null then
    v_status := 'recovery';
  elsif v_story.recovered_at is not null then
    v_status := 'recovered';
  elsif v_open_requests>0 or v_open_complaints>0 or v_attempts>0 then
    v_status := 'recovery';
  elsif coalesce(v_last,v_story.last_activity_at)<now()-interval '45 days' then
    v_status := 'dormant';
  else
    v_status := 'active';
  end if;

  update public.whatsapp_customer_stories
  set
    status=v_status,
    risk_level=v_risk,
    open_request_count=v_open_requests,
    open_complaint_count=v_open_complaints,
    accepted_recommendation_count=v_accepted,
    recovery_attempts=v_attempts,
    journey_count=(select count(*)::int from public.whatsapp_customer_journeys where story_id=p_story_id),
    source_count=v_sources,
    last_activity_at=greatest(coalesce(v_last,'epoch'::timestamptz),coalesce(last_activity_at,'epoch'::timestamptz)),
    recovery_started_at=case
      when v_status='recovery' and v_episode_start is not null then v_episode_start
      when v_status='recovery' then coalesce(recovery_started_at,story_started_at,created_at)
      else recovery_started_at
    end,
    updated_at=now()
  where id=p_story_id;
end
$function$;

-- Privileges as captured: no PUBLIC/anon execute; service_role only, plus authenticated on the story refresh.
revoke all on function public.sales_intelligence_write_case_analysis(text, jsonb) from public, anon, authenticated;
revoke all on function public.sales_intelligence_write_attribution(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sales_intelligence_write_basket_invoice_match(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.sales_intelligence_write_policy_evaluation(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.dawaa_reconcile_sales_intelligence_case_v22_v1(text) from public, anon, authenticated;
revoke all on function public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.dawaa_capture_whatsapp_canonical_purchase_v36() from public, anon, authenticated;
revoke all on function public.dawaa_refresh_whatsapp_customer_story_v16(uuid) from public, anon;
grant execute on function public.sales_intelligence_write_case_analysis(text, jsonb) to service_role;
grant execute on function public.sales_intelligence_write_attribution(uuid, jsonb) to service_role;
grant execute on function public.sales_intelligence_write_basket_invoice_match(uuid, jsonb) to service_role;
grant execute on function public.sales_intelligence_write_policy_evaluation(uuid, jsonb) to service_role;
grant execute on function public.dawaa_reconcile_sales_intelligence_case_v22_v1(text) to service_role;
grant execute on function public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(uuid, text, jsonb) to service_role;
grant execute on function public.dawaa_capture_whatsapp_canonical_purchase_v36() to service_role;
grant execute on function public.dawaa_refresh_whatsapp_customer_story_v16(uuid) to authenticated, service_role;

comment on function public.sales_intelligence_write_case_analysis(text, jsonb) is 'Phase H.1B. Atomic supersede+insert for sales_intelligence_case_analyses, serialized per case_id via pg_advisory_xact_lock. service_role only. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md §26.';
comment on function public.sales_intelligence_write_attribution(uuid, jsonb) is 'Phase H.1B. Atomic supersede+insert for sales_intelligence_attributions, serialized per analysis_id via pg_advisory_xact_lock. Never bumps analysis_version. service_role only. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md §26.';
comment on function public.sales_intelligence_write_basket_invoice_match(uuid, jsonb) is 'Phase H.1B. Atomic supersede+insert for sales_intelligence_basket_invoice_matches, serialized per analysis_id via pg_advisory_xact_lock. References the exact attribution row, never "whichever is current". service_role only. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md §26.';
comment on function public.sales_intelligence_write_policy_evaluation(uuid, jsonb) is 'Phase H.1B. Atomic supersede+insert for sales_intelligence_policy_evaluations, serialized per analysis_id via pg_advisory_xact_lock. Never creates a new semantic analysis. service_role only. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md §26.';

-- Trigger as captured (enabled). Created only when missing so a re-run never drops or re-fires it.
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_whatsapp_story_canonical_purchase_v36'
      and tgrelid = 'public.whatsapp_customer_cases_v22'::regclass
      and not tgisinternal
  ) then
    CREATE TRIGGER trg_whatsapp_story_canonical_purchase_v36 AFTER INSERT OR UPDATE OF proposed_outcome, confirmed_outcome, verified_invoice_id, verified_invoice_number, verified_revenue, verified_sale_at, story_id ON public.whatsapp_customer_cases_v22 FOR EACH ROW EXECUTE FUNCTION dawaa_capture_whatsapp_canonical_purchase_v36();
  end if;
end;
$$;

-- View as captured: security_invoker=true; privileges follow the schema defaults.
create or replace view public.sales_intelligence_invoice_staff_truth_v1
with (security_invoker = true) as
 SELECT a.id AS attribution_row_id,
    a.analysis_id,
    a.case_id,
    a.evaluated_at,
    a.selected_invoice_id,
    a.selected_invoice_number,
    a.attribution_level,
    a.confidence_score,
    a.is_official_for_staff_evaluation,
    i.invoice_datetime,
    i.branch AS invoice_branch,
    COALESCE(i.total_amount, i.amount) AS invoice_amount,
    NULLIF(TRIM(BOTH FROM i.staff_id), ''::text) AS invoice_staff_id_raw,
    NULLIF(TRIM(BOTH FROM i.staff_name), ''::text) AS invoice_staff_name_raw,
    COALESCE(staff_by_id.id, staff_by_name.id) AS canonical_staff_id,
    COALESCE(staff_by_id.name, staff_by_name.name) AS canonical_staff_name,
    COALESCE(staff_by_id.role, staff_by_name.role) AS canonical_staff_role,
    COALESCE(staff_by_id.type, staff_by_name.type) AS canonical_staff_type,
    COALESCE(staff_by_id.branch, staff_by_name.branch) AS canonical_staff_branch,
    COALESCE(staff_by_id.is_active, staff_by_name.is_active) AS canonical_staff_is_active,
        CASE
            WHEN (staff_by_id.id IS NOT NULL) THEN 'resolved_by_staff_id'::text
            WHEN ((name_resolution.match_count = 1) AND (staff_by_name.id IS NOT NULL)) THEN 'resolved_by_unique_name'::text
            WHEN (name_resolution.match_count > 1) THEN 'ambiguous_name'::text
            WHEN ((NULLIF(TRIM(BOTH FROM i.staff_id), ''::text) IS NULL) AND (NULLIF(TRIM(BOTH FROM i.staff_name), ''::text) IS NULL)) THEN 'missing_invoice_staff'::text
            ELSE 'unresolved'::text
        END AS staff_resolution_status,
    (COALESCE(staff_by_id.id, staff_by_name.id) IS NOT NULL) AS is_staff_resolved,
    (EXISTS ( SELECT 1
           FROM sales_invoice_items_v21 item
          WHERE (item.invoice_id = a.selected_invoice_id))) AS item_evidence_available
   FROM ((((sales_intelligence_current_attributions a
     JOIN sales_invoices i ON ((i.id = a.selected_invoice_id)))
     LEFT JOIN staff staff_by_id ON (((staff_by_id.id)::text = NULLIF(TRIM(BOTH FROM i.staff_id), ''::text))))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS match_count,
            (array_agg(s.id ORDER BY s.id))[1] AS candidate_staff_id
           FROM staff s
          WHERE ((NULLIF(TRIM(BOTH FROM i.staff_name), ''::text) IS NOT NULL) AND (dawaa_normalize_staff_name_v1(s.name) = dawaa_normalize_staff_name_v1(i.staff_name)))) name_resolution ON (true))
     LEFT JOIN staff staff_by_name ON (((staff_by_id.id IS NULL) AND (name_resolution.match_count = 1) AND (staff_by_name.id = name_resolution.candidate_staff_id))))
  WHERE ((a.is_official_for_staff_evaluation = true) AND (a.selected_invoice_id IS NOT NULL));

comment on view public.sales_intelligence_invoice_staff_truth_v1 is 'Canonical CURRENT Sales Intelligence invoice attribution joined to B-Connect invoice staff. Direct staff_id wins; unique normalized-name fallback is conservative; superseded analyses are excluded.';
