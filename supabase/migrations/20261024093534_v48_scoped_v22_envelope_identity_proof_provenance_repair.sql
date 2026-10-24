-- V48 scoped data repair — exactly ONE Customer Case V22 envelope, no other row.
--
-- whatsapp_customer_cases_v22 c2c36ff4-c063-46e0-a79a-f42fedfbca84 is the operation-level envelope
-- of source ee4f79b9-7a32-48c6-93b8-ecdfa01b6aed (three Sales Intelligence cases: customer service,
-- the medicine order, the nursing request). Two of its fields disagree with the current canonical
-- facts, without any revenue effect:
--   1. customer_id is NULL. The envelope copies the root source's customer_id when the import
--      writes it; the approved manual identity link of 2026-10-22 (audit
--      customer_identity_link_manual_approved_v1) set the source and invoice 74938 only.
--   2. case_json.canonicalSaleProof still names analysis b561fcd2 (V45, superseded). The proof
--      writer returns 'already_reconciled' for an unchanged invoice without refreshing provenance,
--      so the V48 re-analysis left the audit pointer on the old analysis.
--
-- Deliberately NOT changed: verified_invoice_id/number, verified_revenue, verified_sale_at,
-- proposed/confirmed outcome (the countable ledger — 849 counted once, owned by
-- ...:interaction:0:session:2), branch («المخزن», the source-level envelope value), story/journey,
-- the source row (matched_invoice_* stays NULL: a source-level invoice link would put the order
-- invoice on the whole multi-case conversation), invoice 74938, the customer, staff, and every
-- whatsapp_conversation_actions row. Because no verified_* / outcome / story column changes,
-- trg_whatsapp_story_canonical_purchase_v36 does not fire.
--
-- Fail-closed: every precondition is asserted; any mismatch raises and nothing changes.
-- Idempotent: a second run finds nothing to change and writes nothing (no second audit row).
-- Rollback: the audit row's before_state holds the exact previous customer_id and proof object.
do $$
declare
  c_v22 constant uuid := 'c2c36ff4-c063-46e0-a79a-f42fedfbca84';
  c_source constant uuid := 'ee4f79b9-7a32-48c6-93b8-ecdfa01b6aed';
  c_customer constant uuid := '39e278d3-3840-49ba-a9c6-658a44fcba81';
  c_customer_code constant text := '18663';
  c_sales_case constant text := 'ee4f79b9-7a32-48c6-93b8-ecdfa01b6aed:interaction:0:session:2';
  c_invoice constant text := '323d09e9-3adb-46c9-b67b-cdd1bee98ae8';
  v_row public.whatsapp_customer_cases_v22%rowtype;
  v_analysis public.sales_intelligence_case_analyses%rowtype;
  v_proof jsonb;
  v_attr_count integer;
  v_needs_customer boolean;
  v_needs_provenance boolean;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_row from public.whatsapp_customer_cases_v22 where id = c_v22 for update;
  if not found then
    raise exception 'v48_repair_v22_case_not_found';
  end if;
  if v_row.root_source_id is distinct from c_source
     or v_row.customer_code is distinct from c_customer_code then
    raise exception 'v48_repair_v22_scope_mismatch';
  end if;
  if v_row.customer_id is not null and v_row.customer_id <> c_customer then
    raise exception 'v48_repair_v22_customer_conflict';
  end if;
  if not exists (
    select 1 from public.whatsapp_review_sources s
    where s.id = c_source and s.customer_id = c_customer and s.customer_code = c_customer_code
  ) then
    raise exception 'v48_repair_source_customer_mismatch';
  end if;
  if not exists (select 1 from public.customers c where c.id = c_customer) then
    raise exception 'v48_repair_customer_not_found';
  end if;

  v_proof := v_row.case_json -> 'canonicalSaleProof';
  if coalesce(v_proof ->> 'state', '') <> 'proven'
     or v_proof ->> 'salesCaseId' is distinct from c_sales_case
     or v_proof ->> 'invoiceId' is distinct from c_invoice
     or v_row.verified_invoice_id is distinct from c_invoice then
    raise exception 'v48_repair_proof_scope_mismatch';
  end if;

  select * into v_analysis
  from public.sales_intelligence_case_analyses
  where case_id = c_sales_case and is_current = true
  order by analyzed_at desc
  limit 1;
  if not found
     or coalesce(v_analysis.evidence_snapshot #>> '{canonicalSalesOutcome,outcome}', '') <> 'sale_proven'
     or coalesce(v_analysis.evidence_snapshot #>> '{canonicalSalesOutcome,saleProofState}', '') <> 'proven'
     or coalesce((v_analysis.evidence_snapshot #>> '{canonicalSalesOutcome,isRevenueCountable}')::boolean, false) is not true then
    raise exception 'v48_repair_current_analysis_not_proven';
  end if;
  select count(*) into v_attr_count
  from public.sales_intelligence_attributions
  where analysis_id = v_analysis.analysis_id
    and is_current_evaluation = true
    and attribution_level = 'proven'
    and selected_invoice_id = c_invoice;
  if v_attr_count <> 1 then
    raise exception 'v48_repair_current_attribution_not_unique';
  end if;

  v_needs_customer := v_row.customer_id is null;
  v_needs_provenance := v_proof ->> 'analysisId' is distinct from v_analysis.analysis_id::text;
  if not v_needs_customer and not v_needs_provenance then
    raise notice 'v48_repair_noop: envelope already consistent';
    return;
  end if;

  v_before := jsonb_build_object(
    'customer_id', v_row.customer_id,
    'canonicalSaleProof', v_proof,
    'verified_invoice_id', v_row.verified_invoice_id,
    'verified_revenue', v_row.verified_revenue,
    'branch', v_row.branch,
    'updated_at', v_row.updated_at
  );

  update public.whatsapp_customer_cases_v22
  set
    customer_id = coalesce(customer_id, c_customer),
    case_json = case
      when v_needs_provenance then jsonb_set(
        case_json,
        '{canonicalSaleProof}',
        v_proof || jsonb_build_object(
          'analysisId', v_analysis.analysis_id,
          'analysisVersion', v_analysis.analysis_version,
          'pipelineVersion', v_analysis.pipeline_version,
          'salesOutcome', v_analysis.evidence_snapshot #>> '{canonicalSalesOutcome,outcome}',
          'saleProofState', v_analysis.evidence_snapshot #>> '{canonicalSalesOutcome,saleProofState}',
          'reasonCodes', coalesce(v_analysis.evidence_snapshot #> '{canonicalSalesOutcome,reasonCodes}', '[]'::jsonb),
          'previousAnalysisId', v_proof ->> 'analysisId',
          'provenanceRefreshedAt', now()
        ),
        true
      )
      else case_json
    end,
    updated_at = now()
  where id = c_v22
  returning jsonb_build_object(
    'customer_id', customer_id,
    'canonicalSaleProof', case_json -> 'canonicalSaleProof',
    'verified_invoice_id', verified_invoice_id,
    'verified_revenue', verified_revenue,
    'branch', branch,
    'updated_at', updated_at
  ) into v_after;

  insert into public.whatsapp_review_audit(
    source_id, action, actor_id, actor_name, actor_role, before_state, after_state, note
  ) values (
    c_source,
    'v22_envelope_identity_and_proof_provenance_repair_v48',
    null, 'migration_20261024100000', 'system', v_before, v_after,
    'Scoped repair of envelope c2c36ff4 only: customer_id synced to the approved source customer; canonicalSaleProof provenance moved to the current V48 analysis. Ledger (verified_*), branch, source, invoice, customer and actions unchanged.'
  );
end
$$;
