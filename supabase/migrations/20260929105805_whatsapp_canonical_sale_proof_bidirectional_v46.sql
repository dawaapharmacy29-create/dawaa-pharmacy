-- V46: Canonical Sale Proof is bidirectional current truth with preserved history.
--
-- The current Sales Intelligence analysis decides the V22 Canonical Sale Proof:
--   * sale_proven + proven + consistent persisted chain -> promote (V44 behaviour, now also A -> B)
--   * anything else, for a proof this Sales Intelligence case wrote -> revoke
-- Revocation never deletes rows. Current truth is withdrawn, history stays auditable:
--   * V22: verified_* cleared, proposed_outcome restored, canonicalSaleProof.state='revoked'
--          with the previous proof kept in canonicalSaleProof.revokedProof. A human
--          confirmed_outcome='verified_sale' (only allowed with proof since V41) is withdrawn too
--          and kept in canonicalSaleProof.revokedConfirmation, because the official KPI views
--          count coalesce(confirmed_outcome, proposed_outcome)='verified_sale'.
--   * story events: verified_purchase / customer_recovered for the invoice become *_revoked
--     under a new event_key (…:revoked:<revocationId>), so the history row is kept and the
--     canonical key is freed for a later re-proof
--   * stories: last_verified_purchase recomputed from remaining proven events; recovery that
--              depended on the revoked invoice returns to 'recovery'
--   * journeys / follow-up actions / customer-request closures that depended on the invoice
--     are reopened with the revoked evidence kept in payload
--   * whatsapp_review_audit gets an append-only row for every promote and revoke
-- Proof written by another Sales Intelligence case of the same V22 case is never revoked here.

create or replace function public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(
  p_v22_case_id uuid,
  p_reason text,
  p_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
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

  -- Downstream only when no other case still proves the same invoice.
  if v_invoice is not null and not exists (
    select 1 from public.whatsapp_customer_cases_v22 c
    where c.id <> v_case.id
      and c.verified_invoice_id = v_invoice
      and coalesce(c.case_json #>> '{canonicalSaleProof,state}', '') = 'proven'
  ) then
    with revoked as (
      update public.whatsapp_customer_story_events e
      set
        -- New key keeps the revoked row as history and frees the canonical key, so a later
        -- re-proof of the same invoice inserts a fresh live event (the V36 upsert does not
        -- reset event_type on conflict).
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

    -- Stories: purchase truth from remaining proven purchase events; recovery that depended on
    -- the revoked invoice is withdrawn.
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

    -- Follow-up / complaint actions closed by the canonical recovery: reopen, keep evidence.
    -- The recovery workflow trigger counts an outcome change as a follow-up attempt; a proof
    -- revocation is not an attempt, so the counters are restored in a second statement.
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

    -- Customer requests closed as sold by the refresh follower of this proof: reopen.
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

revoke all on function public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(uuid, text, jsonb)
from public, anon, authenticated;
grant execute on function public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(uuid, text, jsonb)
to service_role;

-- V44 reconciler, now bidirectional. Same name and signature: still the only writer.
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

  -- The proof on V22 belongs to this Sales Intelligence case when it wrote it (or it has no owner).
  v_owns_proof := coalesce(v_v22.case_json #>> '{canonicalSaleProof,state}', '') = 'proven'
    and coalesce(v_v22.case_json #>> '{canonicalSaleProof,salesCaseId}', p_sales_case_id) = p_sales_case_id;

  -- 1. Evaluate the CURRENT persisted analysis. Any failure means "not proven now".
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

  -- 2. Not proven now: withdraw the proof this case wrote; never touch another case's proof.
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

  -- 3. Proven now.
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
      -- Another Sales Intelligence case of this V22 case proves a different invoice.
      return jsonb_build_object('ok', false, 'status', 'existing_canonical_invoice_conflict',
        'salesCaseId', p_sales_case_id, 'v22CaseId', v_v22.id,
        'existingInvoiceId', v_v22.verified_invoice_id, 'selectedInvoiceId', v_attr.selected_invoice_id);
    end if;
    -- Same case now proves invoice B: withdraw A (history kept), then promote B.
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

revoke all on function public.dawaa_reconcile_sales_intelligence_case_v22_v1(text)
from public, anon, authenticated;
grant execute on function public.dawaa_reconcile_sales_intelligence_case_v22_v1(text)
to service_role;
