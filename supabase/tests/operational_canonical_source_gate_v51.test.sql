-- Integration test for V51 Canonical Operational Source Gate.
-- Runs against the real schema/views inside ONE transaction and always ends with RAISE EXCEPTION,
-- so every fixture row is rolled back. The error message carries {"passed":n,"failures":[...]}.
-- Run: execute this whole file as a single statement batch (Supabase SQL / psql -1).
--
-- The same fixtures are evaluated by the TS Canonical Source Gate in
-- src/lib/__tests__/whatsappOperationalSourceGate.test.ts; both must produce this verdict map:
-- expected-verdicts: {"fx51-fine-a":true,"fx51-fine-b":true,"fx51-exact-coarse":false,"fx51-partial-coarse":false,"fx51-historical":false,"fx51-archived":false,"fx51-ambiguous":false,"fx51-owned-coarse":false,"fx51-fine-c":true}

do $test$
declare
  v_failures text[] := '{}';
  v_passed int := 0;
  v_ids jsonb := '{}'::jsonb;
  v_expected jsonb := '{"fx51-fine-a":true,"fx51-fine-b":true,"fx51-exact-coarse":false,"fx51-partial-coarse":false,"fx51-historical":false,"fx51-archived":false,"fx51-ambiguous":false,"fx51-owned-coarse":false,"fx51-fine-c":true}';
  v_key text;
  v_id uuid;
  v_story uuid;
  v_actions_before int;
  v_facts_before int;
  v_events_before int;
  v_ok boolean;
  v_t0 timestamptz := timestamptz '2026-01-10 10:00:00+00';
  r record;
begin
  -- Sources: export A (fine + exact coarse + partial coarse), B (historical/archived/ambiguous), C.
  for r in select * from (values
    ('fx51-fine-a', 'fx51-a.zip', 'ready_detailed', 'A1: hello' || chr(10) || 'A2: order', 0, 5),
    ('fx51-fine-b', 'fx51-a.zip', 'ready_detailed', 'B1: evening', 480, 485),
    ('fx51-exact-coarse', 'fx51-a.zip', 'ready_detailed', 'A1: hello' || chr(10) || 'A2: order' || chr(10) || 'B1: evening', 0, 485),
    ('fx51-partial-coarse', 'fx51-a.zip', 'ready_detailed', 'A1: hello' || chr(10) || 'A2: order' || chr(10) || 'You: extra outbound', 0, 30),
    ('fx51-historical', 'fx51-b.zip', 'needs_context', 'H1: old context', 0, 5),
    ('fx51-archived', 'fx51-b.zip', 'archived', 'R1: archived copy', 100, 105),
    ('fx51-ambiguous', 'fx51-b.zip', 'ready_detailed', 'M1: two owners', 200, 205),
    ('fx51-fine-c', 'fx51-c.zip', 'ready_detailed', 'C1: fine inside', 10, 15),
    ('fx51-owned-coarse', 'fx51-c.zip', 'ready_detailed', 'C0: before' || chr(10) || 'C1: fine inside', 0, 20)
  ) t(k, fname, status, raw, start_min, end_min) loop
    insert into public.whatsapp_review_sources(source_hash, raw_text, customer_code, branch, source_filename, review_status,
      conversation_started_at, conversation_ended_at, analysis_json)
    values ('fx51-' || gen_random_uuid(), r.raw, 'ZZV51', 'فرع شكري', r.fname, r.status,
      v_t0 + make_interval(mins => r.start_min), v_t0 + make_interval(mins => r.end_min),
      jsonb_build_object('operational', jsonb_build_object('productJourney', jsonb_build_object('journeys',
        jsonb_build_array(jsonb_build_object('productName', 'fx51-product', 'currentStage', 'requested'))))))
    returning id into v_id;
    v_ids := v_ids || jsonb_build_object(r.k, v_id);
  end loop;

  -- Customer Case V22 ownership.
  insert into public.whatsapp_customer_cases_v22(case_key, root_source_id, source_ids, customer_code, branch, case_type, case_state, started_at, last_event_at, proposed_outcome, outcome_confidence)
  select 'fx51-case-' || k, (v_ids ->> k)::uuid, array[(v_ids ->> k)::uuid], 'ZZV51', 'فرع شكري', 'order', 'awaiting_customer', v_t0, v_t0, 'awaiting_customer', 90
  from unnest(array['fx51-fine-a', 'fx51-fine-b', 'fx51-archived', 'fx51-ambiguous', 'fx51-fine-c', 'fx51-owned-coarse']) k;
  insert into public.whatsapp_customer_cases_v22(case_key, root_source_id, source_ids, customer_code, branch, case_type, case_state, started_at, last_event_at, proposed_outcome, outcome_confidence)
  values ('fx51-case-ambiguous-2', (v_ids ->> 'fx51-ambiguous')::uuid, array[(v_ids ->> 'fx51-ambiguous')::uuid], 'ZZV51', 'فرع شكري', 'order', 'awaiting_customer', v_t0, v_t0, 'awaiting_customer', 90);

  -- Operational dependents on a fine source and on the exact coarse source.
  insert into public.whatsapp_customer_stories(story_key, customer_code, branch, status) values ('fx51-story', 'ZZV51', 'فرع شكري', 'active') returning id into v_story;
  foreach v_key in array array['fx51-fine-a', 'fx51-exact-coarse', 'fx51-historical'] loop
    insert into public.whatsapp_conversation_actions(source_id, action_key, action_type, status, work_status, customer_code, branch)
    values ((v_ids ->> v_key)::uuid, 'customer-followup', 'customer_followup', 'ready', 'unassigned', 'ZZV51', 'فرع شكري');
    insert into public.whatsapp_evidence_facts_v17(source_id, fact_key, fact_type, fact_at, customer_code, branch, confidence, evidence_kind, review_state, official_eligible)
    values ((v_ids ->> v_key)::uuid, 'fx51-request', 'customer_request', v_t0, 'ZZV51', 'فرع شكري', 80, 'message', 'proposed', false);
    insert into public.whatsapp_customer_story_events(story_id, event_key, event_type, event_at, source_id)
    values (v_story, 'fx51-' || v_key, 'recovery_attempt', v_t0, (v_ids ->> v_key)::uuid);
  end loop;
  select count(*) into v_actions_before from public.whatsapp_conversation_actions where customer_code = 'ZZV51';
  select count(*) into v_facts_before from public.whatsapp_evidence_facts_v17 where customer_code = 'ZZV51';
  select count(*) into v_events_before from public.whatsapp_customer_story_events where story_id = v_story;

  -- 1-6. Owner verdicts (exact, partial, historical, fine, archived, ambiguous, owned coarse).
  v_ok := true;
  for v_key in select jsonb_object_keys(v_expected) loop
    if (exists (select 1 from public.whatsapp_operational_canonical_sources_v1 o where o.source_id = (v_ids ->> v_key)::uuid))
       is distinct from (v_expected ->> v_key)::boolean then
      v_ok := false;
      v_failures := v_failures || ('owner verdict ' || v_key);
    end if;
  end loop;
  if v_ok then v_passed := v_passed + 1; end if;

  -- 7. Raw history is untouched by the gate.
  if (select count(*) from public.whatsapp_conversation_actions where customer_code = 'ZZV51') = v_actions_before
     and (select count(*) from public.whatsapp_evidence_facts_v17 where customer_code = 'ZZV51') = v_facts_before
     and (select count(*) from public.whatsapp_review_sources where customer_code = 'ZZV51') = 9
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T7 raw history'::text; end if;

  -- 8. Story historical evidence preserved (every event listed, non-operational ones flagged).
  if (select jsonb_array_length(recent_events) from public.whatsapp_customer_story_360_v1 where id = v_story) = v_events_before
     and (select count(*) from public.whatsapp_customer_story_360_v1 s, jsonb_array_elements(s.recent_events) e
          where s.id = v_story and (e ->> 'operational')::boolean = false) = 2
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T8 story history'::text; end if;

  -- 9. Current story counts operational actions only.
  if (select open_action_count from public.whatsapp_customer_story_360_v1 where id = v_story) = 1
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T9 current story open actions=' || (select open_action_count from public.whatsapp_customer_story_360_v1 where id = v_story)); end if;

  -- 10. Recovery queue canonical-only.
  if (select array_agg(source_id) from public.whatsapp_recovery_work_queue_v2 where customer_code = 'ZZV51') = array[(v_ids ->> 'fx51-fine-a')::uuid]
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T10 recovery queue'::text; end if;

  -- 11. Doctor/product evidence (product journey detail) canonical-only.
  if (select array_agg(source_id order by source_id) from public.whatsapp_product_journey_detail_v1 where customer_code = 'ZZV51')
     = (select array_agg(x order by x) from unnest(array[(v_ids ->> 'fx51-fine-a')::uuid, (v_ids ->> 'fx51-fine-b')::uuid, (v_ids ->> 'fx51-fine-c')::uuid]) x)
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T11 doctor product evidence'::text; end if;

  -- 12. Current order lifecycle canonical-only.
  if (select array_agg(u) from public.whatsapp_order_lifecycle_v19 l, unnest(l.source_ids) u where l.customer_code = 'ZZV51')
     = array[(v_ids ->> 'fx51-fine-a')::uuid]
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T12 lifecycle'::text; end if;

  raise exception 'V51_TEST_RESULT %', jsonb_build_object('passed', v_passed, 'failures', to_jsonb(v_failures));
end
$test$;
