-- V44: narrow bridge from persisted Sales Intelligence canonical truth into Customer Case V22.
-- The function never derives a sale from a conversation or statistical invoice match.
-- It only reconciles when the persisted canonicalSalesOutcome says sale_proven/proven/countable,
-- the current attribution is proven, the persisted match points to the same invoice, and that
-- invoice exists. Non-proven/ambiguous/conflicting cases are no-ops.

create or replace function public.dawaa_reconcile_sales_intelligence_case_v22_v1(
  p_sales_case_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
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
begin
  select * into v_case
  from public.sales_intelligence_cases
  where case_id = p_sales_case_id;

  if not found then
    return jsonb_build_object('ok',false,'status','sales_intelligence_case_not_found','salesCaseId',p_sales_case_id);
  end if;

  if nullif(trim(coalesce(v_case.source_case_id_v22,'')),'') is null then
    return jsonb_build_object('ok',false,'status','v22_case_not_linked','salesCaseId',p_sales_case_id);
  end if;

  select * into v_analysis
  from public.sales_intelligence_case_analyses
  where case_id = p_sales_case_id and is_current = true
  order by analyzed_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'status','current_analysis_not_found','salesCaseId',p_sales_case_id);
  end if;

  v_outcome := v_analysis.evidence_snapshot -> 'canonicalSalesOutcome';

  if v_outcome is null then
    return jsonb_build_object(
      'ok',false,'status','canonical_outcome_not_persisted',
      'salesCaseId',p_sales_case_id,'analysisId',v_analysis.analysis_id
    );
  end if;

  if coalesce(v_outcome->>'outcome','') <> 'sale_proven'
     or coalesce(v_outcome->>'saleProofState','') <> 'proven'
     or coalesce((v_outcome->>'isSaleCountable')::boolean,false) is not true
     or coalesce((v_outcome->>'isRevenueCountable')::boolean,false) is not true
  then
    return jsonb_build_object(
      'ok',true,'status','not_proven_no_change',
      'salesCaseId',p_sales_case_id,'analysisId',v_analysis.analysis_id,
      'canonicalSalesOutcome',v_outcome
    );
  end if;

  select count(*) into v_attr_count
  from public.sales_intelligence_attributions
  where analysis_id=v_analysis.analysis_id and is_current_evaluation=true;

  if v_attr_count <> 1 then
    return jsonb_build_object(
      'ok',false,'status','current_attribution_not_unique',
      'salesCaseId',p_sales_case_id,'analysisId',v_analysis.analysis_id,'count',v_attr_count
    );
  end if;

  select * into v_attr
  from public.sales_intelligence_attributions
  where analysis_id=v_analysis.analysis_id and is_current_evaluation=true
  limit 1;

  if coalesce(v_attr.attribution_level,'') <> 'proven'
     or nullif(trim(coalesce(v_attr.selected_invoice_id,'')),'') is null
  then
    return jsonb_build_object(
      'ok',false,'status','proven_outcome_without_proven_attribution',
      'salesCaseId',p_sales_case_id,'analysisId',v_analysis.analysis_id
    );
  end if;

  select count(*) into v_match_count
  from public.sales_intelligence_basket_invoice_matches
  where analysis_id=v_analysis.analysis_id and is_current_evaluation=true;

  if v_match_count <> 1 then
    return jsonb_build_object(
      'ok',false,'status','current_invoice_match_not_unique',
      'salesCaseId',p_sales_case_id,'analysisId',v_analysis.analysis_id,'count',v_match_count
    );
  end if;

  select * into v_match
  from public.sales_intelligence_basket_invoice_matches
  where analysis_id=v_analysis.analysis_id and is_current_evaluation=true
  limit 1;

  if v_match.attribution_row_id is distinct from v_attr.id
     or coalesce(v_match.invoice_id,'') <> coalesce(v_attr.selected_invoice_id,'')
  then
    return jsonb_build_object(
      'ok',false,'status','persisted_invoice_chain_mismatch',
      'salesCaseId',p_sales_case_id,'analysisId',v_analysis.analysis_id
    );
  end if;

  select * into v_invoice
  from public.sales_invoices
  where id=v_attr.selected_invoice_id
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok',false,'status','selected_invoice_not_found',
      'salesCaseId',p_sales_case_id,'analysisId',v_analysis.analysis_id,
      'invoiceId',v_attr.selected_invoice_id
    );
  end if;

  select * into v_v22
  from public.whatsapp_customer_cases_v22
  where id::text=v_case.source_case_id_v22
  for update;

  if not found then
    return jsonb_build_object(
      'ok',false,'status','linked_v22_case_not_found',
      'salesCaseId',p_sales_case_id,'v22CaseId',v_case.source_case_id_v22
    );
  end if;

  if v_v22.confirmed_outcome is not null
     and v_v22.confirmed_outcome <> 'verified_sale'
  then
    return jsonb_build_object(
      'ok',false,'status','human_outcome_conflict',
      'salesCaseId',p_sales_case_id,'v22CaseId',v_v22.id,
      'confirmedOutcome',v_v22.confirmed_outcome
    );
  end if;

  if coalesce(v_v22.case_json #>> '{canonicalSaleProof,state}','')='proven'
     and nullif(trim(coalesce(v_v22.verified_invoice_id,'')),'') is not null
     and v_v22.verified_invoice_id <> v_attr.selected_invoice_id
  then
    return jsonb_build_object(
      'ok',false,'status','existing_canonical_invoice_conflict',
      'salesCaseId',p_sales_case_id,'v22CaseId',v_v22.id,
      'existingInvoiceId',v_v22.verified_invoice_id,
      'selectedInvoiceId',v_attr.selected_invoice_id
    );
  end if;

  if coalesce(v_v22.case_json #>> '{canonicalSaleProof,state}','')='proven'
     and v_v22.verified_invoice_id=v_attr.selected_invoice_id
     and coalesce(v_v22.proposed_outcome,'')='verified_sale'
  then
    return jsonb_build_object(
      'ok',true,'status','already_reconciled',
      'salesCaseId',p_sales_case_id,'analysisId',v_analysis.analysis_id,
      'v22CaseId',v_v22.id,'invoiceId',v_attr.selected_invoice_id
    );
  end if;

  v_invoice_number := coalesce(
    nullif(trim(v_attr.selected_invoice_number),''),
    nullif(trim(v_invoice.invoice_number),''),
    nullif(trim(v_invoice.invoice_no),'')
  );
  v_invoice_value := coalesce(
    v_invoice.net_amount,v_invoice.total_amount,v_invoice.amount,v_invoice.gross_amount,0
  );
  v_invoice_at := coalesce(
    v_invoice.invoice_datetime,
    v_invoice.invoice_date,
    v_invoice.sale_date::timestamp at time zone 'Africa/Cairo',
    v_analysis.analyzed_at
  );

  v_before := jsonb_build_object(
    'proposed_outcome',v_v22.proposed_outcome,
    'confirmed_outcome',v_v22.confirmed_outcome,
    'verified_invoice_id',v_v22.verified_invoice_id,
    'verified_invoice_number',v_v22.verified_invoice_number,
    'verified_revenue',v_v22.verified_revenue,
    'verified_sale_at',v_v22.verified_sale_at,
    'canonicalSaleProof',v_v22.case_json->'canonicalSaleProof'
  );

  update public.whatsapp_customer_cases_v22
  set
    proposed_outcome='verified_sale',
    outcome_confidence=100,
    verified_invoice_id=v_attr.selected_invoice_id,
    verified_invoice_number=v_invoice_number,
    verified_revenue=v_invoice_value,
    verified_sale_at=v_invoice_at,
    case_json=jsonb_set(
      coalesce(case_json,'{}'::jsonb),
      '{canonicalSaleProof}',
      jsonb_build_object(
        'state','proven',
        'source','sales_intelligence',
        'salesCaseId',p_sales_case_id,
        'analysisId',v_analysis.analysis_id,
        'analysisVersion',v_analysis.analysis_version,
        'pipelineVersion',v_analysis.pipeline_version,
        'salesOutcome',v_outcome->>'outcome',
        'saleProofState',v_outcome->>'saleProofState',
        'invoiceId',v_attr.selected_invoice_id,
        'invoiceNumber',v_invoice_number,
        'reasonCodes',coalesce(v_outcome->'reasonCodes','[]'::jsonb),
        'reconciledAt',now()
      ),
      true
    ),
    updated_at=now()
  where id=v_v22.id
  returning jsonb_build_object(
    'proposed_outcome',proposed_outcome,
    'confirmed_outcome',confirmed_outcome,
    'verified_invoice_id',verified_invoice_id,
    'verified_invoice_number',verified_invoice_number,
    'verified_revenue',verified_revenue,
    'verified_sale_at',verified_sale_at,
    'canonicalSaleProof',case_json->'canonicalSaleProof'
  ) into v_after;

  insert into public.whatsapp_review_audit(
    source_id,action,actor_id,actor_name,actor_role,before_state,after_state,note
  )
  values(
    v_v22.root_source_id,
    'canonical_sale_proof_reconciled_v44',
    null,'sales_intelligence','system',v_before,v_after,
    'Canonical sale proof reconciled from persisted Sales Intelligence analysis ' || v_analysis.analysis_id::text
  );

  return jsonb_build_object(
    'ok',true,'status','reconciled',
    'salesCaseId',p_sales_case_id,'analysisId',v_analysis.analysis_id,
    'v22CaseId',v_v22.id,'invoiceId',v_attr.selected_invoice_id,
    'invoiceNumber',v_invoice_number,'revenue',v_invoice_value,'saleAt',v_invoice_at
  );
end;
$function$;

revoke all on function public.dawaa_reconcile_sales_intelligence_case_v22_v1(text)
from public, anon, authenticated;

grant execute on function public.dawaa_reconcile_sales_intelligence_case_v22_v1(text)
to service_role;
