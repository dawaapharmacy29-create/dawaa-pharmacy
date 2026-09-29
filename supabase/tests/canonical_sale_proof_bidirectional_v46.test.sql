-- Integration test for V46 bidirectional Canonical Sale Proof.
-- Runs against the real schema/triggers inside ONE transaction and always ends with
-- RAISE EXCEPTION, so every fixture row (and anything the functions write) is rolled back.
-- The last line of the error message is the JSON result: {"passed":n,"failures":[...]}.
-- Run: execute this whole file as a single statement batch (e.g. Supabase SQL / psql -1).

create function pg_temp.v46_set_analysis(
  p_case text, p_version int, p_outcome text, p_state text, p_invoice text
) returns void language plpgsql as $$
declare
  v_analysis uuid;
  v_attr uuid;
  v_level text := case
    when p_state = 'proven' then 'proven'
    when p_invoice is not null then 'strongly_inferred'
    else 'unknown' end;
begin
  update public.sales_intelligence_case_analyses set is_current = false, superseded_at = now()
  where case_id = p_case and is_current;
  insert into public.sales_intelligence_case_analyses(
    case_id, analysis_version, pipeline_version, engine_version_case_segmentation,
    engine_version_historical_closure, engine_version_commercial_confirmation,
    engine_version_protocol_applicability, semantic_source_hash, case_type, case_status,
    pipeline_status, overall_evidence_level, case_started_at, historical_closure_level,
    commercial_confirmation_state, protocol_applicability, attribution_level,
    integrity_evaluation_scope, evidence_snapshot
  ) values (
    p_case, p_version, 'v46-test', 't', 't', 't', 't', 'hash-' || p_version, 'sales_opportunity', 'invoiced',
    'analyzed', 'high', now() - interval '10 days', 'explicit', 'customer_confirmed', 'applicable', v_level,
    'header_only',
    jsonb_build_object('canonicalSalesOutcome', jsonb_build_object(
      'outcome', p_outcome, 'saleProofState', p_state,
      'isSaleCountable', p_outcome = 'sale_proven', 'isRevenueCountable', p_outcome = 'sale_proven',
      'reasonCodes', '[]'::jsonb))
  ) returning analysis_id into v_analysis;

  insert into public.sales_intelligence_attributions(
    analysis_id, case_id, evaluation_version, attribution_engine_version, attribution_input_hash,
    attribution_level, confidence_score, selected_invoice_id
  ) values (v_analysis, p_case, 1, 't', 'h', v_level, 0.99, p_invoice)
  returning id into v_attr;

  insert into public.sales_intelligence_basket_invoice_matches(
    analysis_id, case_id, attribution_row_id, evaluation_version, matching_engine_version,
    total_match, item_match, quantity_match, overall_match, header_evidence_ready, item_evidence_ready,
    integrity_evaluation_scope, matching_input_hash, invoice_id
  ) values (
    v_analysis, p_case, v_attr, 1, 't',
    case when p_invoice is null then 'insufficient_data' else 'exact' end,
    'insufficient_data', 'insufficient_data',
    case when p_invoice is null then 'insufficient_data' else 'exact' end,
    p_invoice is not null, false,
    case when p_invoice is null then 'insufficient' else 'header_only' end,
    'h', p_invoice
  );
end $$;

do $test$
declare
  v_failures text[] := '{}';
  v_passed int := 0;
  v_inv_a text;
  v_inv_b text;
  v_inv_a_at timestamptz;
  v_source uuid;
  v_story uuid;
  v_journey uuid;
  v_v22 uuid;
  v_action uuid;
  v_case text := 'v46-test-case';
  v_case_other text := 'v46-test-case-other';
  r jsonb;
  v_audit_before int;
  v_events_before int;
  v_attempts_before int;
  v_n int;
  c record;
begin
  select id::text, coalesce(invoice_datetime, now()) into v_inv_a, v_inv_a_at
  from public.sales_invoices where invoice_datetime is not null order by invoice_datetime desc limit 1;
  select id::text into v_inv_b
  from public.sales_invoices where invoice_datetime is not null and id::text <> v_inv_a
  order by invoice_datetime desc limit 1;

  insert into public.whatsapp_review_sources(source_hash, raw_text, customer_code, branch)
  values ('v46-test-' || gen_random_uuid(), 'x: test', 'ZZV46', 'فرع شكري') returning id into v_source;
  insert into public.whatsapp_customer_stories(story_key, customer_code, branch, status, recovery_started_at)
  values ('v46-test-story', 'ZZV46', 'فرع شكري', 'recovery', v_inv_a_at - interval '1 day') returning id into v_story;
  insert into public.whatsapp_customer_journeys(journey_key, root_source_id, story_id, journey_started_at, lifecycle_status)
  values ('v46-test-journey', v_source, v_story, v_inv_a_at - interval '1 day', 'recovery') returning id into v_journey;
  insert into public.whatsapp_customer_story_events(story_id, event_key, event_type, event_at)
  values (v_story, 'v46-test-attempt', 'recovery_attempt', v_inv_a_at - interval '1 hour');
  insert into public.whatsapp_customer_cases_v22(
    case_key, root_source_id, source_ids, story_id, journey_id, customer_code, branch, case_type, case_state,
    started_at, last_event_at, proposed_outcome, outcome_confidence
  ) values (
    'v46-test-v22', v_source, array[v_source], v_story, v_journey, 'ZZV46', 'فرع شكري', 'order', 'awaiting_customer',
    v_inv_a_at - interval '2 hours', v_inv_a_at, 'awaiting_customer', 95
  ) returning id into v_v22;
  insert into public.whatsapp_conversation_actions(
    source_id, action_key, action_type, status, work_status, customer_code, branch, created_at, followup_attempts
  ) values (v_source, 'recovery:v46-test', 'customer_followup', 'created', 'assigned', 'ZZV46', 'فرع شكري',
    v_inv_a_at - interval '2 hours', 2)
  returning id into v_action;
  insert into public.whatsapp_conversation_actions(
    source_id, action_key, action_type, status, work_status, outcome, target_table, target_id, payload
  ) values (v_source, 'request:1:v46', 'customer_request', 'dismissed', 'completed', 'sold', 'sales_invoices', v_inv_a,
    jsonb_build_object('canonical_sale', jsonb_build_object('invoice_id', v_inv_a)));
  insert into public.sales_intelligence_cases(case_id, conversation_id, case_started_at, source_case_id_v22)
  values (v_case, v_source, v_inv_a_at - interval '2 hours', v_v22::text),
         (v_case_other, v_source, v_inv_a_at - interval '2 hours', v_v22::text);

  -- 1. not_proven -> proven
  perform pg_temp.v46_set_analysis(v_case, 1, 'sale_proven', 'proven', v_inv_a);
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case);
  select * into c from public.whatsapp_customer_cases_v22 where id = v_v22;
  if r ->> 'status' = 'reconciled' and c.verified_invoice_id = v_inv_a
     and c.case_json #>> '{canonicalSaleProof,state}' = 'proven'
     and exists (select 1 from public.whatsapp_customer_story_events where story_id = v_story
                 and event_type = 'verified_purchase' and invoice_id = v_inv_a)
     and (select last_verified_purchase_at is not null from public.whatsapp_customer_stories where id = v_story)
     and (select recovered_invoice_id = v_inv_a from public.whatsapp_conversation_actions where id = v_action)
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T1 not_proven->proven: ' || r::text); end if;

  -- 2. proven -> proven same invoice is idempotent (no new audit row, no new events)
  select count(*) into v_audit_before from public.whatsapp_review_audit where source_id = v_source;
  select count(*) into v_events_before from public.whatsapp_customer_story_events where story_id = v_story;
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case);
  if r ->> 'status' = 'already_reconciled'
     and (select count(*) from public.whatsapp_review_audit where source_id = v_source) = v_audit_before
     and (select count(*) from public.whatsapp_customer_story_events where story_id = v_story) = v_events_before
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T2 idempotent: ' || r::text); end if;

  -- another SI case of the same V22 case that is not proven never revokes this proof
  perform pg_temp.v46_set_analysis(v_case_other, 1, 'open_opportunity', 'unknown', null);
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case_other);
  if r ->> 'status' = 'not_proven_no_change'
     and (select case_json #>> '{canonicalSaleProof,state}' from public.whatsapp_customer_cases_v22 where id = v_v22) = 'proven'
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T2b other case cannot revoke: ' || r::text); end if;

  -- 3. proven invoice A -> proven invoice B
  select followup_attempts into v_attempts_before from public.whatsapp_conversation_actions where id = v_action;
  perform pg_temp.v46_set_analysis(v_case, 2, 'sale_proven', 'proven', v_inv_b);
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case);
  select * into c from public.whatsapp_customer_cases_v22 where id = v_v22;
  if r ->> 'status' = 'reconciled' and r #>> '{revokedPrevious,status}' = 'revoked'
     and c.verified_invoice_id = v_inv_b
     and exists (select 1 from public.whatsapp_customer_story_events where story_id = v_story
                 and event_type = 'verified_purchase_revoked' and invoice_id = v_inv_a)
     and not exists (select 1 from public.whatsapp_customer_story_events where story_id = v_story
                 and event_type = 'verified_purchase' and invoice_id = v_inv_a)
     and exists (select 1 from public.whatsapp_customer_story_events where story_id = v_story
                 and event_type = 'verified_purchase' and invoice_id = v_inv_b)
     and not exists (select 1 from public.whatsapp_conversation_actions where recovered_invoice_id = v_inv_a)
     and (select followup_attempts from public.whatsapp_conversation_actions where id = v_action) = v_attempts_before
     and (select status = 'ready' and outcome is null and payload ? 'revokedCanonicalSale'
          from public.whatsapp_conversation_actions where action_key = 'request:1:v46')
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T3 A->B: ' || r::text); end if;

  -- 4. proven -> contradicted
  update public.whatsapp_customer_cases_v22 set confirmed_outcome = 'verified_sale' where id = v_v22;
  perform pg_temp.v46_set_analysis(v_case, 3, 'needs_review', 'contradicted', v_inv_b);
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case);
  select * into c from public.whatsapp_customer_cases_v22 where id = v_v22;
  if r ->> 'status' = 'revoked'
     and c.case_json #>> '{canonicalSaleProof,state}' = 'revoked'
     and c.verified_invoice_id is null and c.verified_revenue is null
     and c.proposed_outcome = 'awaiting_customer'
     and c.confirmed_outcome is null
     and c.case_json #>> '{canonicalSaleProof,revokedConfirmation,confirmedOutcome}' = 'verified_sale'
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T4 proven->contradicted: ' || r::text); end if;

  -- 8. no official KPI / story / recovery keeps the sale after downgrade
  if not exists (select 1 from public.whatsapp_customer_story_events where story_id = v_story
                 and event_type in ('verified_purchase', 'customer_recovered'))
     and (select last_verified_purchase_at is null and coalesce(status, '') <> 'recovered' and recovered_invoice_id is null
          from public.whatsapp_customer_stories where id = v_story)
     and (select coalesce(lifecycle_status, '') <> 'recovered' from public.whatsapp_customer_journeys where id = v_journey)
     and coalesce((select coalesce(confirmed_outcome, proposed_outcome) from public.whatsapp_customer_cases_v22 where id = v_v22), '') <> 'verified_sale'
     and (public.dawaa_whatsapp_story_truth_health_v39() ->> 'ok')::boolean
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T8 downstream after downgrade: ' || (public.dawaa_whatsapp_story_truth_health_v39())::text); end if;

  -- 9. repeated reconcile of a not-proven case writes nothing
  select count(*) into v_audit_before from public.whatsapp_review_audit where source_id = v_source;
  select count(*) into v_events_before from public.whatsapp_customer_story_events where story_id = v_story;
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case);
  if r ->> 'status' = 'not_proven_no_change'
     and (select count(*) from public.whatsapp_review_audit where source_id = v_source) = v_audit_before
     and (select count(*) from public.whatsapp_customer_story_events where story_id = v_story) = v_events_before
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T9 repeated reconcile: ' || r::text); end if;

  -- 5. proven -> unknown
  perform pg_temp.v46_set_analysis(v_case, 4, 'sale_proven', 'proven', v_inv_a);
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case);
  perform pg_temp.v46_set_analysis(v_case, 5, 'unknown', 'unknown', null);
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case);
  if r ->> 'status' = 'revoked'
     and (select case_json #>> '{canonicalSaleProof,state}' from public.whatsapp_customer_cases_v22 where id = v_v22) = 'revoked'
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T5 proven->unknown: ' || r::text); end if;

  -- 5b. re-proof of a previously revoked invoice creates a live purchase event again
  perform pg_temp.v46_set_analysis(v_case, 8, 'sale_proven', 'proven', v_inv_a);
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case);
  if r ->> 'status' = 'reconciled'
     and exists (select 1 from public.whatsapp_customer_story_events where story_id = v_story
                 and event_type = 'verified_purchase' and invoice_id = v_inv_a)
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T5b re-proof after revoke: ' || r::text); end if;

  -- 6. proven -> strongly_supported
  perform pg_temp.v46_set_analysis(v_case, 9, 'order_confirmed_unproven', 'strongly_supported', v_inv_a);
  r := public.dawaa_reconcile_sales_intelligence_case_v22_v1(v_case);
  if r ->> 'status' = 'revoked'
     and (select verified_invoice_id is null from public.whatsapp_customer_cases_v22 where id = v_v22)
     and not exists (select 1 from public.whatsapp_customer_story_events where story_id = v_story and event_type = 'verified_purchase')
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T6 proven->strongly_supported: ' || r::text); end if;

  -- 7. history remains auditable: every promote/revoke audited, revoked events kept (not deleted)
  select count(*) into v_n from public.whatsapp_review_audit
  where source_id = v_source and action in ('canonical_sale_proof_reconciled_v44', 'canonical_sale_proof_revoked_v46');
  if v_n = 8 -- promote A, revoke A+promote B, revoke B, promote A+revoke, re-promote A+revoke
     and (select count(*) from public.whatsapp_customer_story_events where story_id = v_story and event_type like '%\_revoked') >= 3
     and (select case_json #> '{canonicalSaleProof,revokedProof,invoiceId}' is not null from public.whatsapp_customer_cases_v22 where id = v_v22)
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T7 history audit rows=' || v_n); end if;

  raise exception 'V46_TEST_RESULT %', jsonb_build_object('passed', v_passed, 'failures', to_jsonb(v_failures));
end
$test$;
