-- Applied to Production as migration 20261024113355_v48_proof_ownership_provenance_guard.
-- This changes the global canonical proof writer; see the approved V48 ownership review. Built from the live definition of
-- public.dawaa_reconcile_sales_intelligence_case_v22_v1(text) (md5 28e9b90458d00f395a0c45d7d7b996d9,
-- byte-identical to supabase/migrations/20261009200000_capture_production_canonical_si_writers_v1.sql).
--
-- Defects in the live function:
--   1. Ownership defaults to the caller: coalesce(salesCaseId, p_sales_case_id) = p_sales_case_id
--      makes ANY case the owner of a proven proof whose salesCaseId is missing — it may then revoke,
--      replace or keep that proof as its own.
--   2. The 'already_reconciled' early return never checks ownership. One V22 envelope is shared by
--      every SI case of a conversation, so a sibling case attributing the same invoice was told
--      'already_reconciled' and the refresh treats it as proof-accepted.
--   3. That early return never refreshes provenance: after a re-analysis the proof keeps naming
--      the superseded analysis.
-- Changes (only these): explicit ownership (salesCaseId present, non-blank, equal to the caller);
-- a proven proof without an owner returns canonical_proof_owner_unknown_requires_review and writes
-- nothing; a sibling-owned proof returns canonical_proof_owned_by_other_case with the owner and
-- writes nothing; the explicit owner refreshes provenance once (ledger, outcome, story untouched).
-- Every other statement is byte-identical to the live function.
-- Production today (2026-10-24, read-only): 10 proven proofs, all with salesCaseId; 0 ownerless.
-- Rollback: re-run the CREATE OR REPLACE from the captured 20261009200000 migration.

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
  v_proof_state text;
  v_proof_owner text;
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

  -- v48: ownership is explicit. One envelope is shared by every SI case of a conversation, so a
  -- proven proof belongs to the case named in salesCaseId — never to whichever case asks. A proven
  -- proof without an owner is ambiguous: nobody owns it, nothing is written, a human reviews it.
  v_proof_state := coalesce(v_v22.case_json #>> '{canonicalSaleProof,state}', '');
  v_proof_owner := nullif(btrim(coalesce(v_v22.case_json #>> '{canonicalSaleProof,salesCaseId}', '')), '');
  v_owns_proof := v_proof_state = 'proven' and v_proof_owner is not null and v_proof_owner = p_sales_case_id;
  if v_proof_state = 'proven' and v_proof_owner is null then
    return jsonb_build_object('ok', false, 'status', 'canonical_proof_owner_unknown_requires_review',
      'salesCaseId', p_sales_case_id, 'v22CaseId', v_v22.id,
      'existingInvoiceId', v_v22.verified_invoice_id);
  end if;

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
    -- v48: the same invoice proven by a sibling case is not "already reconciled" for this case;
    -- callers must never treat this case as proof-accepted. The envelope is not touched.
    if not v_owns_proof then
      return jsonb_build_object('ok', false, 'status', 'canonical_proof_owned_by_other_case',
        'salesCaseId', p_sales_case_id, 'v22CaseId', v_v22.id,
        'ownerSalesCaseId', v_proof_owner,
        'invoiceId', v_attr.selected_invoice_id);
    end if;
    -- v48: explicit owner, same invoice, newer analysis — move the audit provenance only. The
    -- ledger (verified_*), outcome and story columns stay untouched, so the purchase trigger does
    -- not fire, and the original reconciledAt is kept.
    if v_v22.case_json #>> '{canonicalSaleProof,analysisId}' is distinct from v_analysis.analysis_id::text then
      v_before := jsonb_build_object('canonicalSaleProof', v_v22.case_json -> 'canonicalSaleProof');
      update public.whatsapp_customer_cases_v22
      set
        case_json = jsonb_set(
          case_json,
          '{canonicalSaleProof}',
          (case_json -> 'canonicalSaleProof') || jsonb_build_object(
            'analysisId', v_analysis.analysis_id,
            'analysisVersion', v_analysis.analysis_version,
            'pipelineVersion', v_analysis.pipeline_version,
            'salesOutcome', v_outcome ->> 'outcome',
            'saleProofState', v_outcome ->> 'saleProofState',
            'reasonCodes', coalesce(v_outcome -> 'reasonCodes', '[]'::jsonb),
            'previousAnalysisId', case_json #>> '{canonicalSaleProof,analysisId}',
            'provenanceRefreshedAt', now()
          ),
          true
        ),
        updated_at = now()
      where id = v_v22.id
      returning jsonb_build_object('canonicalSaleProof', case_json -> 'canonicalSaleProof') into v_after;
      insert into public.whatsapp_review_audit(
        source_id, action, actor_id, actor_name, actor_role, before_state, after_state, note
      )
      values (
        v_v22.root_source_id,
        'canonical_sale_proof_provenance_refreshed_v48',
        null, 'sales_intelligence', 'system', v_before, v_after,
        'Proof provenance moved to the current analysis ' || v_analysis.analysis_id::text || '; ledger unchanged.'
      );
      return jsonb_build_object('ok', true, 'status', 'already_reconciled', 'provenanceRefreshed', true,
        'salesCaseId', p_sales_case_id, 'analysisId', v_analysis.analysis_id,
        'v22CaseId', v_v22.id, 'invoiceId', v_attr.selected_invoice_id);
    end if;
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
