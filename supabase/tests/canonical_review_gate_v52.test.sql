-- Integration test for V52 Canonical Review Gate.
-- Runs against the real schema, views and reader functions inside ONE transaction and always ends
-- with RAISE EXCEPTION, so every fixture row is rolled back. The error message carries
-- {"passed":n,"failures":[...]}. Run as a single statement batch (Supabase SQL / psql -1).

do $test$
declare
  v_failures text[] := '{}';
  v_passed int := 0;
  v_staff uuid := '3b2f682d-be41-4374-a0b8-25411ee6e8d3';
  v_t0 timestamptz := now() - interval '2 days';
  v_canon_source uuid;
  v_legacy_source uuid;
  v_canon_review uuid;
  v_legacy_review uuid;
  v_manual_review uuid;
  v_quality_before bigint;
  v_quality_after bigint;
begin
  insert into public.whatsapp_review_sources(source_hash, raw_text, customer_code, branch, source_filename, review_status, conversation_started_at, conversation_ended_at)
  values ('fx52-canon-' || gen_random_uuid(), 'X1: canonical conversation', 'ZZV52', 'فرع شكري', 'fx52-a.zip', 'ready_detailed', v_t0, v_t0 + interval '5 minutes')
  returning id into v_canon_source;
  insert into public.whatsapp_customer_cases_v22(case_key, root_source_id, source_ids, customer_code, branch, case_type, case_state, started_at, last_event_at, proposed_outcome, outcome_confidence)
  values ('fx52-case', v_canon_source, array[v_canon_source], 'ZZV52', 'فرع شكري', 'order', 'awaiting_customer', v_t0, v_t0, 'awaiting_customer', 90);
  -- Legacy summary-only import: no raw text body worth a case, no V22 ownership.
  insert into public.whatsapp_review_sources(source_hash, raw_text, customer_code, branch, source_filename, review_status, conversation_started_at, conversation_ended_at, analysis_json)
  values ('fx52-legacy-' || gen_random_uuid(), 'L1: legacy summary import', 'ZZV52', 'فرع شكري', 'fx52-b.zip', 'ready_detailed', v_t0, v_t0 + interval '5 minutes', jsonb_build_object('primaryType', 'complaint'))
  returning id into v_legacy_source;

  select coalesce(sum(q.review_count), 0) into v_quality_before
  from public.get_doctor_conversation_quality_summary('فرع شكري', 30) q where q.doctor_id = v_staff;

  insert into public.conversation_sales_reviews(staff_id, doctor_id, staff_name, branch, customer_code, evaluation_kind, conversation_date, review_date, total_score, final_score, whatsapp_review_source_id)
  values (v_staff, v_staff, 'fx52', 'فرع شكري', 'ZZV52-C', 'automatic', v_t0, current_date, 90, 90, v_canon_source) returning id into v_canon_review;
  insert into public.conversation_sales_reviews(staff_id, doctor_id, staff_name, branch, customer_code, evaluation_kind, conversation_date, review_date, total_score, final_score, whatsapp_review_source_id)
  values (v_staff, v_staff, 'fx52', 'فرع شكري', 'ZZV52-L', 'automatic', v_t0 + interval '1 minute', current_date, 94, 94, v_legacy_source) returning id into v_legacy_review;
  insert into public.conversation_sales_reviews(staff_id, doctor_id, staff_name, branch, customer_code, evaluation_kind, conversation_date, review_date, total_score, final_score)
  -- A review with no WhatsApp source link (the reviewer-binding trigger requires a session for
  -- human kinds, so the fixture uses the automatic kind; eligibility depends only on the source).
  values (v_staff, v_staff, 'fx52', 'فرع شكري', 'ZZV52-M', 'automatic', v_t0 + interval '2 minutes', current_date, 80, 80) returning id into v_manual_review;

  -- T7. The legacy review stays stored (history).
  if exists (select 1 from public.conversation_sales_reviews where id = v_legacy_review)
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T7 legacy review stored'::text; end if;

  -- T8. The legacy review is not official.
  if not exists (select 1 from public.conversation_sales_reviews_official_v1 where id = v_legacy_review)
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T8 excluded from official'::text; end if;

  -- T11. The canonical review and the manual (non-WhatsApp-source) review are official exactly once.
  if (select count(*) from public.conversation_sales_reviews_official_v1 where id = v_canon_review) = 1
     and (select count(*) from public.conversation_sales_reviews_official_v1 where id = v_manual_review) = 1
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T11 canonical counted once'::text; end if;

  -- T9. The incentive reader reads official reviews only.
  if pg_get_functiondef('public.get_doctor_incentive_breakdown(uuid)'::regprocedure) like '%conversation_sales_reviews_official_v1%'
     and pg_get_functiondef('public.get_doctor_incentive_breakdown(uuid)'::regprocedure) !~ '\mconversation_sales_reviews\M(?!_official_v1)'
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T9 incentive reader gated'::text; end if;

  -- T10. Doctor quality counts the canonical + manual reviews, never the legacy one.
  select coalesce(sum(q.review_count), 0) into v_quality_after
  from public.get_doctor_conversation_quality_summary('فرع شكري', 30) q where q.doctor_id = v_staff;
  if v_quality_after - v_quality_before = 2
  then v_passed := v_passed + 1; else v_failures := v_failures || ('T10 quality reader gated delta=' || (v_quality_after - v_quality_before)); end if;

  -- The 30-day KPI view reads official reviews only.
  if pg_get_viewdef('public.employee_kpi_30d_summary'::regclass, true) like '%conversation_sales_reviews_official_v1%'
     and pg_get_viewdef('public.employee_kpi_30d_summary'::regclass, true) !~ '\mconversation_sales_reviews\M(?!_official_v1)'
  then v_passed := v_passed + 1; else v_failures := v_failures || 'T8b kpi view gated'::text; end if;

  raise exception 'V52_TEST_RESULT %', jsonb_build_object('passed', v_passed, 'failures', to_jsonb(v_failures));
end
$test$;
