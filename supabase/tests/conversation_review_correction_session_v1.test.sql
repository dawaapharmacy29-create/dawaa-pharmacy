-- DB behaviour tests for the manager correction (versioning/supersession) contract.
-- Run by scripts/test-db-conversation-review-correction.sh against a throwaway local Postgres after
-- the fixture and the committed migrations. Browser-equivalent calls run as role anon.
\set ON_ERROR_STOP 1
-- test-only helper tables are readable by the roles the tests switch to
alter default privileges in schema public grant select on tables to anon, service_role;

create function public.t_assert(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;
create function public.t_hash(p text) returns text language sql as $$ select encode(public.digest(p,'sha256'),'hex') $$;

-- One correction call exactly as the browser makes it (anon key + staff session token).
create function public.t_call(p_token text, p_review uuid, p_key uuid, p_reason text, p_payload jsonb) returns text
language plpgsql as $$
declare r jsonb; v_detail text;
begin
  r := public.dawaa_correct_conversation_review_session_v1(p_token, p_review, p_key, p_reason, p_payload);
  return 'ok:' || r::text;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return 'err:' || sqlstate || ':' || sqlerrm || ':' || coalesce(v_detail,'');
end $$;
grant execute on function public.t_call(text,uuid,uuid,text,jsonb) to anon;

-- A complete, self-consistent correction payload exactly like Reviews.tsx builds it: every
-- whitelisted key, raw_scores.{criteria,severe_errors,result}, review_items = result.reviewItems,
-- per-criterion scores from the review items and every derived flag from the criteria/severe
-- errors. The flag rules here are written independently of the migration (a separate oracle).
create function public.t_payload(p_staff uuid, p_score numeric, p_impact numeric, p_base numeric, p_extra numeric, p_status text,
  p_criteria jsonb default '{"greeting":{"applies":true,"choice":"official_full"}}'::jsonb,
  p_severe jsonb default '{}'::jsonb, p_items jsonb default null) returns jsonb
language plpgsql as $$
declare
  v_items jsonb := coalesce(p_items, '[{"key":"greeting","applies":true,"pointsEarned":10,"maxPoints":10}]'::jsonb);
  v_earned numeric := round(p_score*0.4);
  v_sev boolean := exists (select 1 from jsonb_each(p_severe) e where e.value='true'::jsonb);
  v_map text[] := array['response_speed_score','first_response_speed','greeting_score','greeting','doctor_name_score','doctor_name',
    'customer_name_score','customer_name','tone_language_score','tone','understanding_score','understanding',
    'follow_up_score','followup_after_wait','consultation_quality_score','consultation_quality',
    'dosage_explanation_score','dosage_explanation','alternative_handling_score','unavailable_items',
    'sales_quality_score','sales_closing','upsell_cross_sell_score','cross_sell_upsell',
    'complaint_handling_score','angry_customer','order_confirmation_score','order_confirmation',
    'closing_message_score','closing_message'];
  v_p jsonb;
  v_n int;
  v_score jsonb;
  v_tone text := case when p_criteria->'tone'->>'applies'='true' then p_criteria->'tone'->>'choice' end;
  v_und text := case when p_criteria->'understanding'->>'applies'='true' then p_criteria->'understanding'->>'choice' end;
  v_alt text := case when p_criteria->'unavailable_items'->>'applies'='true' then p_criteria->'unavailable_items'->>'choice' end;
  v_close text := case when p_criteria->'closing_message'->>'applies'='true' then p_criteria->'closing_message'->>'choice' end;
  v_greet text := case when p_criteria->'greeting'->>'applies'='true' then p_criteria->'greeting'->>'choice' end;
  v_dname text := case when p_criteria->'doctor_name'->>'applies'='true' then p_criteria->'doctor_name'->>'choice' end;
  v_cname text := case when p_criteria->'customer_name'->>'applies'='true' then p_criteria->'customer_name'->>'choice' end;
begin
  v_p := jsonb_build_object(
    'staff_id', p_staff, 'final_score', p_score, 'level', 'جيدة', 'conversation_level', 'جيدة',
    'doctor_points_impact', p_impact, 'base_points_impact', p_base, 'extra_penalty_points', p_extra,
    'impact_status', p_status, 'total_applicable_items', 4, 'total_not_applicable_items', 15,
    'total_applicable_points', 40, 'earned_points', v_earned, 'positive_points', v_earned,
    'negative_points', 40-v_earned, 'severe_error_points', abs(p_extra),
    'main_positive_reason', 'ترحيب', 'main_negative_reason', 'فهم الطلب', 'top_positive_reason', 'ترحيب', 'top_deduction_reason', 'فهم الطلب',
    'forgotten_customer', false, 'missed_sales_opportunity', false, 'missed_sale_opportunity', false,
    'successful_cross_sell', false, 'handled_angry_customer_well', false, 'excellent_case', false,
    'has_critical_error', v_sev, 'repeated_error_type', null,
    'raw_scores', jsonb_build_object('criteria', p_criteria, 'severe_errors', p_severe,
      'result', jsonb_build_object('finalScore', p_score, 'doctorPointsImpact', p_impact, 'baseDoctorImpact', p_base,
        'extraPenaltyPoints', p_extra, 'impactStatus', p_status, 'totalApplicableItems', 4, 'totalNotApplicableItems', 15,
        'totalApplicablePoints', 40, 'earnedPoints', v_earned, 'level', 'جيدة', 'mainPositiveReason', 'ترحيب',
        'mainNegativeReason', 'فهم الطلب', 'forgottenCustomer', false, 'missedSalesOpportunity', false,
        'successfulCrossSell', false, 'handledAngryCustomerWell', false, 'excellentCase', false,
        'hasSevereError', v_sev, 'repeatErrorType', null, 'reviewItems', v_items),
      'manager_edit', jsonb_build_object('reason', 'test')),
    'review_items', v_items,
    'greeting_message_used', case when v_greet is null then null else 'تحية' end,
    'doctor_name_used_in_greeting', coalesce(v_greet in ('official_full','close_with_name'), false),
    'doctor_name_used', coalesce(v_dname <> 'none', false),
    'customer_name_used', coalesce(v_cname = 'used', false),
    'reviewer_notes', 'ملاحظة', 'training_recommendation', 'تدريب', 'evaluation_reason', 'مراجعة عشوائية',
    'has_complaint', coalesce(p_criteria->'angry_customer'->>'applies'='true', false) or coalesce(p_severe->>'insult'='true', false),
    'has_medical_error', coalesce(p_severe->>'medical_error'='true', false)
                         or exists (select 1 from jsonb_array_elements(v_items) x where x->>'errorType'='medical_error'),
    'has_invoice_error', coalesce(p_severe->>'invoice_error'='true', false),
    'has_delivery_issue', coalesce(p_severe->>'delivery_error'='true', false),
    'bad_tone_flag', coalesce(v_tone in ('dry','bad','very_bad','insult'), false),
    'severe_bad_tone_flag', coalesce(v_tone in ('very_bad','insult'), false),
    'rushed_response_flag', coalesce(v_und = 'rushed', false),
    'misunderstood_customer_flag', coalesce(v_und in ('wrong','caused_error'), false),
    'bad_alternative_flag', coalesce(v_alt = 'bad_alternative', false),
    'closing_message_used', coalesce(v_close in ('official','respectful'), false),
    'follow_up_promised', coalesce(p_criteria->'followup_after_wait'->>'applies'='true', false)
  );
  for v_n in 1 .. array_length(v_map,1) / 2 loop
    select case when x->>'applies'='true' then x->'pointsEarned' else 'null'::jsonb end into v_score
    from jsonb_array_elements(v_items) x where x->>'key' = v_map[v_n*2] limit 1;
    v_p := v_p || jsonb_build_object(v_map[v_n*2-1], coalesce(v_score, 'null'::jsonb));
    v_score := null;
  end loop;
  return v_p;
end $$;

-- Ids --------------------------------------------------------------------------------------------
-- accounts: gm (general_manager), mgrA/mgrB (branch_manager), np (no edit permission),
--           off (can_login false), csA (customer_service A with edit_reviews, IS staff doc1)
insert into public.staff_accounts(id,staff_id,username,name,role,branch,active,is_active,can_login,status,permissions) values
 ('a0000000-0000-4000-8000-000000000001','s-mgrA','mgrA','مدير أ','branch_manager','A',true,true,true,'active','{"edit_reviews":true,"view_reviews":true}'),
 ('a0000000-0000-4000-8000-000000000002','s-mgrB','mgrB','مدير ب','branch_manager','B',true,true,true,'active','{"edit_reviews":true,"view_reviews":true}'),
 ('a0000000-0000-4000-8000-000000000003','s-np','np','صيدلي','pharmacist','A',true,true,true,'active','{"view_reviews":true}'),
 ('a0000000-0000-4000-8000-000000000004','s-gm','gm','مدير عام','general_manager',null,true,true,true,'active','{}'),
 ('a0000000-0000-4000-8000-000000000005','s-off','off','موقوف','branch_manager','A',true,true,false,'active','{"edit_reviews":true}'),
 ('a0000000-0000-4000-8000-000000000006','d0000000-0000-4000-8000-000000000001','csA','دكتور 1','customer_service','A',true,true,true,'active','{"edit_reviews":true}');
insert into public.staff_login_sessions(staff_account_id,token_hash,expires_at,revoked_at) values
 ('a0000000-0000-4000-8000-000000000001',public.t_hash('tok-mgrA'),now()+interval '1 hour',null),
 ('a0000000-0000-4000-8000-000000000001',public.t_hash('tok-mgrA-expired'),now()-interval '1 minute',null),
 ('a0000000-0000-4000-8000-000000000001',public.t_hash('tok-mgrA-revoked'),now()+interval '1 hour',now()),
 ('a0000000-0000-4000-8000-000000000002',public.t_hash('tok-mgrB'),now()+interval '1 hour',null),
 ('a0000000-0000-4000-8000-000000000003',public.t_hash('tok-np'),now()+interval '1 hour',null),
 ('a0000000-0000-4000-8000-000000000004',public.t_hash('tok-gm'),now()+interval '1 hour',null),
 ('a0000000-0000-4000-8000-000000000005',public.t_hash('tok-off'),now()+interval '1 hour',null),
 ('a0000000-0000-4000-8000-000000000006',public.t_hash('tok-csA'),now()+interval '1 hour',null);
insert into public.staff values
 ('d0000000-0000-4000-8000-000000000001','دكتور 1','doctor','A',null,true,true),
 ('d0000000-0000-4000-8000-000000000002','دكتور 2','doctor','A',null,true,true),
 ('d0000000-0000-4000-8000-000000000003','دكتور 3','doctor','B',null,true,true);
insert into public.whatsapp_review_sources values
 ('50000000-0000-4000-8000-000000000001','A',null),
 ('50000000-0000-4000-8000-000000000002','A',null),
 ('50000000-0000-4000-8000-000000000003','B',null),
 ('50000000-0000-4000-8000-000000000004','A',null);
insert into public.whatsapp_operational_canonical_sources_v1 values
 ('50000000-0000-4000-8000-000000000001'),('50000000-0000-4000-8000-000000000002'),
 ('50000000-0000-4000-8000-000000000003'),('50000000-0000-4000-8000-000000000004');
insert into public.sales_intelligence_cases(case_id,conversation_id,is_active) values
 ('case-1','50000000-0000-4000-8000-000000000001',true),
 ('case-2','50000000-0000-4000-8000-000000000002',true),
 ('case-3','50000000-0000-4000-8000-000000000003',true),
 ('case-4','50000000-0000-4000-8000-000000000004',true);

-- Automatic reviews are written by the service writer (privileged), exactly like production.
insert into public.conversation_sales_reviews(id,evaluation_kind,conversation_type,staff_id,doctor_id,staff_name,doctor_name,branch,customer_name,customer_code,
  conversation_date,month_cycle,final_score,total_score,doctor_points_impact,point_impact,impact_status,raw_scores,review_items,
  whatsapp_review_source_id,sales_intelligence_case_id,automatic_evaluation_version,automatic_evaluation_json,evidence_coverage_percent,automatic_reliability_percent,manual_clinical_review_required)
select ('e0000000-0000-4000-8000-00000000000'||n)::uuid,'automatic','واتساب',
  case n when 3 then 'd0000000-0000-4000-8000-000000000003'::uuid else 'd0000000-0000-4000-8000-000000000001'::uuid end,
  case n when 3 then 'd0000000-0000-4000-8000-000000000003'::uuid else 'd0000000-0000-4000-8000-000000000001'::uuid end,
  case n when 3 then 'دكتور 3' else 'دكتور 1' end, case n when 3 then 'دكتور 3' else 'دكتور 1' end,
  case n when 3 then 'B' else 'A' end, 'عميل '||n, '24'||n, '2026-10-01 10:00+00'::timestamptz + (n||' hours')::interval, '2026-10',
  50, 50, 0, 0, 'approved', jsonb_build_object('engine','conversation-evaluation-v1','n',n),
  jsonb_build_array(jsonb_build_object('key','greeting','applies',true,'pointsEarned',5)),
  ('50000000-0000-4000-8000-00000000000'||n)::uuid, 'case-'||n, 'conversation-evaluation-v1',
  jsonb_build_object('caseId','case-'||n,'items',jsonb_build_array(1,2,3)), 87.5, 81, true
from generate_series(1,4) n;
-- A human (non-versioned) review keeps the old editor path (reviewer bound from the request identity).
select set_config('request.headers','{"x-dawaa-user-id":"a0000000-0000-4000-8000-000000000001"}',false);
insert into public.conversation_sales_reviews(id,evaluation_kind,staff_id,staff_name,branch,customer_name,conversation_date,final_score,reviewer_id,reviewer_name,review_items,raw_scores)
values ('e0000000-0000-4000-8000-000000000009','واتساب','d0000000-0000-4000-8000-000000000001','دكتور 1','A','عميل يدوي','2026-10-02 09:00+00',80,
        'a0000000-0000-4000-8000-000000000001','مدير أ','[]','{}');
select set_config('request.headers','',false);
-- Pre-existing live points linked to automatic review #2 (+3 for doctor 1): must be reversed exactly once.
insert into public.employee_transactions(staff_id,employee_id,type,points,points_delta,final_points,source,source_id,month_cycle,branch,status,metadata)
values ('d0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','reward',3,3,3,'whatsapp_automatic_review','e0000000-0000-4000-8000-000000000002','2026-10','A','pending','{"rule_code":"__event__"}');

create table public.t_evidence as
select id, to_jsonb(r) - array['is_current','superseded_at','superseded_reason','updated_at'] as evidence
from public.conversation_sales_reviews r;

-- Convenience readers -------------------------------------------------------------------------------
create function public.t_corrections(p_review uuid) returns bigint language sql as $$
  select count(*) from public.conversation_sales_reviews where supersedes_review_id=p_review $$;
create function public.t_current(p_case text) returns setof uuid language sql as $$
  select id from public.conversation_sales_reviews where sales_intelligence_case_id=p_case and is_current $$;
create function public.t_live_points(p_staff uuid) returns numeric language sql as $$
  select coalesce(sum(points_delta),0) from public.employee_transactions
  where staff_id=p_staff and coalesce(status,'active') in ('active','approved','pending') $$;

-- =============================================================================================
-- Grants
-- =============================================================================================
select public.t_assert(has_function_privilege('anon','public.dawaa_correct_conversation_review_session_v1(text,uuid,uuid,text,jsonb)','execute'), 'grant: anon may execute the session command');
select public.t_assert(not has_function_privilege('service_role','public.dawaa_correct_conversation_review_session_v1(text,uuid,uuid,text,jsonb)','execute'), 'grant: service_role has no execute on the session command');
select public.t_assert(not has_function_privilege('anon','public.dawaa_apply_conversation_review_correction_points_v1(text,uuid)','execute'), 'grant: points helper is internal (anon denied)');
select public.t_assert(not has_function_privilege('authenticated','public.dawaa_apply_conversation_review_correction_points_v1(text,uuid)','execute'), 'grant: points helper is internal (authenticated denied)');

-- =============================================================================================
-- A. Automatic review cannot be directly mutated by the browser (RLS lets mgrA update; guard denies)
-- =============================================================================================
set role anon;
select set_config('request.headers','{"x-dawaa-user-id":"a0000000-0000-4000-8000-000000000001"}',false);
do $$ begin
  begin
    update public.conversation_sales_reviews set final_score=95, raw_scores='{}' where id='e0000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: A direct evidence update was accepted';
  exception when others then
    if sqlerrm not like 'automatic_conversation_review_evidence_is_immutable_for_client%' then raise; end if;
  end;
  begin
    update public.conversation_sales_reviews set is_current=false where id='e0000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: A direct supersession by the browser was accepted';
  exception when others then
    if sqlerrm not like 'automatic_conversation_review_evidence_is_immutable_for_client%' then raise; end if;
  end;
  begin
    insert into public.conversation_sales_reviews(evaluation_kind,staff_id,staff_name,branch,customer_name,conversation_date,review_items,raw_scores,
      correction_kind,supersedes_review_id,correction_reason,correction_idempotency_key,reviewer_id)
    values ('manager_correction','d0000000-0000-4000-8000-000000000001','x','A','y',now(),'[]','{}','manager_full_correction',
      'e0000000-0000-4000-8000-000000000001','r',gen_random_uuid(),'a0000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: A browser-forged correction insert was accepted';
  exception when others then
    if sqlerrm not like 'conversation_review_correction_is_command_owned%' then raise; end if;
  end;
end $$;
select set_config('request.headers','',false);
reset role;
select public.t_assert(true, 'A: browser cannot rewrite, supersede or forge versions of automatic evidence');
select public.t_assert((select evidence from public.t_evidence where id='e0000000-0000-4000-8000-000000000001')
  = (select to_jsonb(r) - array['is_current','superseded_at','superseded_reason','updated_at'] from public.conversation_sales_reviews r where id='e0000000-0000-4000-8000-000000000001'),
  'A: automatic row unchanged after the rejected browser writes');

-- =============================================================================================
-- G/H/I/J + validation: every failure is all-or-nothing (N)
-- =============================================================================================
set role anon;
select public.t_assert(public.t_call('tok-mgrA-expired','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')) like 'err:42501:invalid_or_expired_staff_session%', 'G: expired session denied');
select public.t_assert(public.t_call('tok-mgrA-revoked','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')) like 'err:42501:invalid_or_expired_staff_session%', 'G: revoked session denied');
select public.t_assert(public.t_call('tok-off','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')) like 'err:42501:invalid_or_expired_staff_session%', 'G: login-disabled account denied (fail closed)');
select public.t_assert(public.t_call('',              'e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')) like 'err:42501:staff_session_required%', 'G: missing token denied');
select public.t_assert(public.t_call('tok-np','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')) like 'err:42501:not_authorized%', 'H: no edit/approve permission denied');
select public.t_assert(public.t_call('tok-mgrB','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')) like 'err:42501:review_scope_denied%', 'I: outside branch denied');
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000003',70,-3,-3,0,'pending')) like 'err:42501:correction_staff_scope_denied%', 'I: reassignment to staff outside scope denied');
select public.t_assert(public.t_call('tok-csA','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000002',70,-3,-3,0,'pending')) like 'err:42501:self_correction_forbidden%', 'I: staff cannot correct their own review');
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'   ',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')) like 'err:22023:correction_reason_required%', 'J: manager reason required');
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000001',null,'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')) like 'err:22023:idempotency_key_required%', 'explicit idempotency key required');
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')||'{"whatsapp_review_source_id":null}') like 'err:22023:correction_payload_unknown_field:whatsapp_review_source_id%', 'payload cannot touch provenance fields');
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-50,-3,0,'pending')) like 'err:22023:correction_payload_invalid%', 'payload impact out of bounds rejected');
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')||'{"review_items":"x"}') like 'err:22023:correction_payload_invalid%', 'payload review_items must be an array');
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000009',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',70,-3,-3,0,'pending')) like 'err:22023:review_not_versioned%', 'human reviews are not versioned by this command');
reset role;
select public.t_assert((select is_current from public.conversation_sales_reviews where id='e0000000-0000-4000-8000-000000000001')
  and public.t_corrections('e0000000-0000-4000-8000-000000000001')=0
  and (select count(*) from public.conversation_sales_reviews where correction_kind is not null)=0,
  'N: every failed correction left the automatic row current and created nothing');

-- =============================================================================================
-- B/C/D/E/K: same-staff correction of automatic review #1
-- =============================================================================================
create table public.t_r1 (k uuid, result text);
insert into public.t_r1 values ('c1000000-0000-4000-8000-000000000001', null);
grant select, update on public.t_r1 to anon;
set role anon;
update public.t_r1 set result = public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','تصحيح بند فهم الطلب',public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'pending'));
reset role;
select public.t_assert((select result from public.t_r1) like 'ok:%"status": "created"%', 'B: correction created: '||(select result from public.t_r1));
create table public.t_c1 as select * from public.conversation_sales_reviews where supersedes_review_id='e0000000-0000-4000-8000-000000000001';
select public.t_assert((select count(*) from public.t_c1)=1, 'B: exactly one new version');
select public.t_assert((select evaluation_kind='manager_correction' and correction_kind='manager_full_correction' and correction_reason='تصحيح بند فهم الطلب'
  and reviewer_id='a0000000-0000-4000-8000-000000000001' and reviewer_name='مدير أ' and reviewer_role='branch_manager' from public.t_c1),
  'B: explicit human provenance (kind, reason, session-bound reviewer, FK lineage)');
select public.t_assert((select final_score=85 and total_score=85 and doctor_points_impact=-3 and point_impact=-3 and impact_status='pending'
  and review_items=jsonb_build_array(jsonb_build_object('key','greeting','applies',true,'pointsEarned',10,'maxPoints',10))
  and raw_scores->'manager_correction'->>'supersedes_review_id'='e0000000-0000-4000-8000-000000000001' from public.t_c1),
  'B: corrected criteria, score, review_items and effective impact stored on the new version');
select public.t_assert((select c.whatsapp_review_source_id=o.whatsapp_review_source_id and c.sales_intelligence_case_id=o.sales_intelligence_case_id
  and c.automatic_evaluation_version=o.automatic_evaluation_version and c.automatic_evaluation_json=o.automatic_evaluation_json
  and c.evidence_coverage_percent=o.evidence_coverage_percent and c.automatic_reliability_percent=o.automatic_reliability_percent
  and c.customer_name=o.customer_name and c.conversation_date=o.conversation_date and c.branch=o.branch and c.month_cycle=o.month_cycle
  from public.t_c1 c join public.conversation_sales_reviews o on o.id=c.supersedes_review_id),
  'B: canonical provenance preserved on the new version');
select public.t_assert((select evidence from public.t_evidence where id='e0000000-0000-4000-8000-000000000001')
  = (select to_jsonb(r) - array['is_current','superseded_at','superseded_reason','updated_at'] from public.conversation_sales_reviews r where id='e0000000-0000-4000-8000-000000000001'),
  'C: original automatic evidence is byte-for-byte evidence-equivalent');
select public.t_assert((select is_current=false and superseded_at is not null and superseded_reason='manager_correction: تصحيح بند فهم الطلب'
  from public.conversation_sales_reviews where id='e0000000-0000-4000-8000-000000000001'), 'D: original is non-current with supersession metadata');
select public.t_assert((select array_agg(x) from public.t_current('case-1') x)=array[(select id from public.t_c1)], 'E: new version is the only current row for the case');
select public.t_assert((select array_agg(id) from public.conversation_sales_reviews_canonical_v2 where sales_intelligence_case_id='case-1')=array[(select id from public.t_c1)], 'E: canonical view resolves only the new version');
select public.t_assert((select array_agg(id) from public.conversation_sales_reviews_official_v1 where whatsapp_review_source_id='50000000-0000-4000-8000-000000000001')=array[(select id from public.t_c1)], 'E: official view resolves only the new version');
select public.t_assert((select supersedes_review_id from public.conversation_sales_reviews_canonical_v2 where sales_intelligence_case_id='case-1')='e0000000-0000-4000-8000-000000000001', 'E/Q: canonical row exposes the lineage to the superseded evidence');
select public.t_assert((select count(*) from public.employee_transactions where source='conversation_evaluation' and source_id=(select id from public.t_c1) and points_delta=-3 and status='pending' and staff_id='d0000000-0000-4000-8000-000000000001')=1
  and public.t_live_points('d0000000-0000-4000-8000-000000000001')=-3+3, 'K: same-staff impact applied once (doctor 1 live = -3 new + 3 from review #2)');

-- F: retry with the same key ------------------------------------------------------------------
set role anon;
update public.t_r1 set result = public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','تصحيح بند فهم الطلب',public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'pending'));
reset role;
select public.t_assert((select result from public.t_r1) like 'ok:%"status": "already_applied"%' and (select result from public.t_r1) like '%'||(select id from public.t_c1)::text||'%', 'F: retry returns the same version');
select public.t_assert(public.t_corrections('e0000000-0000-4000-8000-000000000001')=1
  and (select count(*) from public.employee_transactions where source_id=(select id from public.t_c1))=1, 'F: retry created no second version and no second points row');
-- A different attempt against the superseded id is told which version replaced it.
set role anon;
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000001',gen_random_uuid(),'سبب آخر',public.t_payload('d0000000-0000-4000-8000-000000000001',90,3,3,0,'approved'))
  like 'err:55000:review_version_not_current:'||(select id from public.t_c1)::text, 'F: stale editor on a superseded id cannot fork; detail names the current version');
-- The same key reused for another review is rejected.
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000001','سبب',public.t_payload('d0000000-0000-4000-8000-000000000001',90,3,3,0,'approved'))
  like 'err:23505:idempotency_key_conflict%', 'F: idempotency key cannot be replayed against a different review');
reset role;

-- Q: superseded evidence stays queryable for audit, hidden from the current client surface -------
select public.t_assert((select count(*) from public.conversation_sales_reviews where id='e0000000-0000-4000-8000-000000000001')=1, 'Q: superseded automatic evidence remains in the table');
set role anon;
select set_config('request.headers','{"x-dawaa-user-id":"a0000000-0000-4000-8000-000000000001"}',false);
select public.t_assert((select count(*) from public.conversation_sales_reviews where id='e0000000-0000-4000-8000-000000000001')=0
  and (select count(*) from public.conversation_sales_reviews where id=(select id from public.t_c1))=1, 'Q/E: client current surface shows the correction, not the superseded row');
select set_config('request.headers','',false);
reset role;

-- Frozen superseded version: even the privileged service writer cannot revive or rewrite it -------
set role service_role;
do $$ begin
  begin
    update public.conversation_sales_reviews set is_current=true, superseded_at=null, superseded_reason=null where id='e0000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: superseded automatic row was revived';
  exception when others then
    if sqlerrm not like 'conversation_review_version_superseded_is_frozen%' then raise; end if;
  end;
  begin
    update public.conversation_sales_reviews set final_score=10, raw_scores='{}' where id='e0000000-0000-4000-8000-000000000001';
    raise exception 'FAIL: superseded automatic row was rewritten';
  exception when others then
    if sqlerrm not like 'conversation_review_version_superseded_is_frozen%' then raise; end if;
  end;
end $$;
reset role;
select public.t_assert(true, 'C: superseded evidence is frozen for every role (service writer re-analysis cannot revive it)');

-- =============================================================================================
-- L: staff reassignment on review #2 (has +3 live for doctor 1) -> doctor 2 with +6
-- =============================================================================================
set role anon;
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','المحادثة تخص دكتور 2',public.t_payload('d0000000-0000-4000-8000-000000000002',98,6,6,0,'approved')) like 'ok:%"created"%', 'L: reassignment correction created');
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000002','c2000000-0000-4000-8000-000000000001','المحادثة تخص دكتور 2',public.t_payload('d0000000-0000-4000-8000-000000000002',98,6,6,0,'approved')) like 'ok:%"already_applied"%', 'L: reassignment retry is a replay');
reset role;
select public.t_assert((select count(*) from public.employee_transactions where source_id='e0000000-0000-4000-8000-000000000002' and status='cancelled')=1
  and (select count(*) from public.employee_transactions where source_id='e0000000-0000-4000-8000-000000000002' and status<>'cancelled')=0, 'L: previous staff impact reversed exactly once');
select public.t_assert((select count(*) from public.employee_transactions et join public.conversation_sales_reviews c on c.id=et.source_id
  where c.supersedes_review_id='e0000000-0000-4000-8000-000000000002' and et.staff_id='d0000000-0000-4000-8000-000000000002' and et.points_delta=6 and et.status='approved')=1,
  'L: new staff impact applied exactly once');
select public.t_assert(public.t_live_points('d0000000-0000-4000-8000-000000000001')=-3 and public.t_live_points('d0000000-0000-4000-8000-000000000002')=6, 'L: live totals after reassignment + retry (doctor 1 = -3, doctor 2 = +6)');

-- Correction of a correction (chain) back to doctor 1 with +3
create table public.t_c2 as select id from public.conversation_sales_reviews where supersedes_review_id='e0000000-0000-4000-8000-000000000002';
set role anon;
select public.t_assert(public.t_call('tok-gm',(select id from public.t_c2),'c2000000-0000-4000-8000-000000000002','إعادة الإسناد لدكتور 1',public.t_payload('d0000000-0000-4000-8000-000000000001',92,3,3,0,'approved')) like 'ok:%"created"%', 'L: a correction can itself be corrected (chain)');
reset role;
select public.t_assert(public.t_live_points('d0000000-0000-4000-8000-000000000002')=0 and public.t_live_points('d0000000-0000-4000-8000-000000000001')=-3+3, 'L: chain reverses doctor 2 once and applies doctor 1 once');
select public.t_assert((select count(*) from public.t_current('case-2'))=1 and (select count(*) from public.conversation_sales_reviews where sales_intelligence_case_id='case-2')=3, 'L/Q: chain keeps 3 versions with exactly one current');

-- =============================================================================================
-- M: points failure rolls back the version switch; the retry converges
-- =============================================================================================
delete from public.whatsapp_operational_canonical_sources_v1 where source_id='50000000-0000-4000-8000-000000000003';
set role anon;
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000001','تصحيح',public.t_payload('d0000000-0000-4000-8000-000000000003',82,-6,-6,0,'pending')) like 'err:23514:conversation_review_points_require_official_review%', 'M: points failure surfaces as the command error');
reset role;
select public.t_assert((select is_current from public.conversation_sales_reviews where id='e0000000-0000-4000-8000-000000000003') and public.t_corrections('e0000000-0000-4000-8000-000000000003')=0
  and (select count(*) from public.employee_transactions where staff_id='d0000000-0000-4000-8000-000000000003')=0, 'M/N: failed points left the automatic row current, no version, no points');
insert into public.whatsapp_operational_canonical_sources_v1 values ('50000000-0000-4000-8000-000000000003');
set role anon;
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000001','تصحيح',public.t_payload('d0000000-0000-4000-8000-000000000003',82,-6,-6,0,'pending')) like 'ok:%"created"%', 'M: retry with the same key succeeds');
reset role;
-- Simulate a version whose points link is missing (e.g. an earlier partial deploy): replay converges.
delete from public.employee_transactions where staff_id='d0000000-0000-4000-8000-000000000003';
set role anon;
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000001','تصحيح',public.t_payload('d0000000-0000-4000-8000-000000000003',82,-6,-6,0,'pending')) like 'ok:%"already_applied"%', 'M: replay of an existing version');
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000001','تصحيح',public.t_payload('d0000000-0000-4000-8000-000000000003',82,-6,-6,0,'pending')) like 'ok:%"already_linked"%', 'M: second replay sees the link');
reset role;
select public.t_assert(public.t_corrections('e0000000-0000-4000-8000-000000000003')=1 and public.t_live_points('d0000000-0000-4000-8000-000000000003')=-6
  and (select count(*) from public.employee_transactions where staff_id='d0000000-0000-4000-8000-000000000003')=1, 'M: converged to one version and one points row');

-- =============================================================================================
-- Case lifecycle: retiring the SI case retires the correction head; reactivation restores it
-- =============================================================================================
update public.sales_intelligence_cases set is_active=false where case_id='case-1';
select public.t_assert((select count(*) from public.t_current('case-1'))=0, 'lifecycle: retired case has no current review version');
update public.sales_intelligence_cases set is_active=true where case_id='case-1';
select public.t_assert((select array_agg(x) from public.t_current('case-1') x)=array[(select id from public.t_c1)], 'lifecycle: reactivation restores the correction head, never the superseded automatic row');

-- One current version per case is a hard invariant.
do $$ begin
  begin
    update public.conversation_sales_reviews set is_current=true where id='e0000000-0000-4000-8000-000000000004'; -- no-op on current row
    insert into public.conversation_sales_reviews(evaluation_kind,staff_id,branch,whatsapp_review_source_id,sales_intelligence_case_id,review_items,raw_scores)
      values ('automatic','d0000000-0000-4000-8000-000000000001','A','50000000-0000-4000-8000-000000000004','case-4','[]','{}');
    raise exception 'FAIL: duplicate current case row accepted';
  exception when unique_violation then null;
  end;
end $$;
select public.t_assert(true, 'invariant: a second current row for the same case is rejected');

-- =============================================================================================
-- Fix A: staff reassignment keeps the canonical conversation/source branch
-- =============================================================================================
insert into public.whatsapp_review_sources values
 ('50000000-0000-4000-8000-000000000005','A',null),('50000000-0000-4000-8000-000000000006','A',null),
 ('50000000-0000-4000-8000-000000000007','A',null),('50000000-0000-4000-8000-000000000008','A',null);
insert into public.whatsapp_operational_canonical_sources_v1 values
 ('50000000-0000-4000-8000-000000000005'),('50000000-0000-4000-8000-000000000006'),
 ('50000000-0000-4000-8000-000000000007'),('50000000-0000-4000-8000-000000000008');
insert into public.sales_intelligence_cases(case_id,conversation_id,is_active) values
 ('case-5','50000000-0000-4000-8000-000000000005',true),('case-6','50000000-0000-4000-8000-000000000006',true),
 ('case-7','50000000-0000-4000-8000-000000000007',true),('case-8','50000000-0000-4000-8000-000000000008',true);
-- Automatic rows 5..8 carry STALE derived values on purpose (every flag true, every score 99), so a
-- correction that inherits anything from them would be visible.
insert into public.conversation_sales_reviews(id,evaluation_kind,conversation_type,staff_id,doctor_id,staff_name,doctor_name,branch,branch_id,customer_name,
  conversation_date,month_cycle,final_score,total_score,doctor_points_impact,point_impact,impact_status,raw_scores,review_items,
  whatsapp_review_source_id,sales_intelligence_case_id,automatic_evaluation_version,
  has_complaint,has_medical_error,has_invoice_error,has_delivery_issue,bad_tone_flag,severe_bad_tone_flag,rushed_response_flag,
  misunderstood_customer_flag,bad_alternative_flag,closing_message_used,follow_up_promised,has_critical_error,forgotten_customer,
  missed_sales_opportunity,missed_sale_opportunity,successful_cross_sell,handled_angry_customer_well,excellent_case,
  response_speed_score,greeting_score,doctor_name_score,customer_name_score,tone_language_score,understanding_score,follow_up_score,
  consultation_quality_score,dosage_explanation_score,alternative_handling_score,sales_quality_score,upsell_cross_sell_score,
  complaint_handling_score,order_confirmation_score,closing_message_score,repeated_error_type,level,conversation_level,
  first_response_minutes,follow_up_delay_minutes,repeat_count,repeat_multiplier,converted_to_sale)
select ('e0000000-0000-4000-8000-00000000000'||n)::uuid,'automatic','واتساب',
  'd0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','دكتور 1','دكتور 1','A',
  'b0000000-0000-4000-8000-00000000000a'::uuid,'عميل '||n,'2026-10-03 10:00+00'::timestamptz + (n||' hours')::interval,'2026-10',
  20,20,0,0,'approved',jsonb_build_object('engine','conversation-evaluation-v1','n',n),
  jsonb_build_array(jsonb_build_object('key','tone','applies',true,'pointsEarned',0,'errorType','medical_error')),
  ('50000000-0000-4000-8000-00000000000'||n)::uuid,'case-'||n,'conversation-evaluation-v1',
  true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,
  99,99,99,99,99,99,99,99,99,99,99,99,99,99,99,'poor_tone','ضعيفة','ضعيفة',
  17,33,2,1.5,true
from generate_series(5,8) n;
create table public.t_evidence_58 as
select id, to_jsonb(r) - array['is_current','superseded_at','superseded_reason','updated_at'] as evidence
from public.conversation_sales_reviews r where sales_intelligence_case_id in ('case-5','case-6','case-7','case-8');

create function public.t_head(p_case text) returns uuid language sql security definer as $$
  select id from public.conversation_sales_reviews where sales_intelligence_case_id=p_case and is_current $$;
grant execute on function public.t_head(text) to anon;

set role anon;
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000006',gen_random_uuid(),'المحادثة تخص دكتور 3 من فرع ب',
  public.t_payload('d0000000-0000-4000-8000-000000000003',85,-3,-3,0,'approved')) like 'ok:%"created"%', 'A: global manager may reassign to a staff member of another branch');
select public.t_assert(public.t_call('tok-mgrA','e0000000-0000-4000-8000-000000000007',gen_random_uuid(),'نقل لفرع ب',
  public.t_payload('d0000000-0000-4000-8000-000000000003',85,-3,-3,0,'approved')) like 'err:42501:correction_staff_scope_denied%', 'A: branch manager cannot reassign outside their scope (explicit rejection)');
reset role;
select public.t_assert((select branch='A' and branch_id='b0000000-0000-4000-8000-00000000000a' and staff_id='d0000000-0000-4000-8000-000000000003'
  and doctor_id='d0000000-0000-4000-8000-000000000003' and staff_name='دكتور 3'
  from public.conversation_sales_reviews where supersedes_review_id='e0000000-0000-4000-8000-000000000006'),
  'A: cross-branch reassignment keeps the source branch A (and branch_id) while the staff belongs to branch B');
select public.t_assert((select count(*) from public.employee_transactions et join public.conversation_sales_reviews c on c.id=et.source_id
  where c.supersedes_review_id='e0000000-0000-4000-8000-000000000006' and et.staff_id='d0000000-0000-4000-8000-000000000003'
    and et.branch='A' and et.points_delta=-3 and et.status='approved')=1,
  'A: the reassigned points row is posted once, to the new staff, on the source branch A');
select public.t_assert(public.t_corrections('e0000000-0000-4000-8000-000000000007')=0
  and (select is_current from public.conversation_sales_reviews where id='e0000000-0000-4000-8000-000000000007'),
  'A: the rejected reassignment wrote nothing');

-- =============================================================================================
-- Fix B: the correction row carries no stale derived field
-- =============================================================================================
-- (1) contract: every column is classified exactly once as evaluation (whitelisted + checked),
--     server-bound, or copied provenance. A new column fails this test until it is classified.
create table public.t_cols (kind text, col text);
insert into public.t_cols select 'eval', unnest(array[
  'level','conversation_level','final_score','doctor_points_impact','base_points_impact','extra_penalty_points','impact_status',
  'total_applicable_items','total_not_applicable_items','total_applicable_points','earned_points','positive_points','negative_points',
  'severe_error_points','main_positive_reason','main_negative_reason','top_positive_reason','top_deduction_reason','forgotten_customer',
  'missed_sales_opportunity','missed_sale_opportunity','successful_cross_sell','handled_angry_customer_well','excellent_case',
  'has_critical_error','repeated_error_type','raw_scores','review_items','response_speed_score','greeting_score','greeting_message_used',
  'doctor_name_used_in_greeting','doctor_name_used','doctor_name_score','customer_name_used','customer_name_score','tone_language_score',
  'bad_tone_flag','understanding_score','follow_up_score','consultation_quality_score','dosage_explanation_score',
  'alternative_handling_score','sales_quality_score','upsell_cross_sell_score','complaint_handling_score','order_confirmation_score',
  'closing_message_score','reviewer_notes','training_recommendation','evaluation_reason','has_complaint','has_medical_error',
  'has_invoice_error','has_delivery_issue','severe_bad_tone_flag','rushed_response_flag','misunderstood_customer_flag',
  'bad_alternative_flag','closing_message_used','follow_up_promised']);
insert into public.t_cols select 'server', unnest(array[
  'id','created_at','updated_at','reviewed_at','evaluation_kind','correction_kind','supersedes_review_id','correction_reason',
  'correction_idempotency_key','reviewer_id','reviewer_name','reviewer_role','reviewer_message','branch','branch_id','staff_id',
  'doctor_id','staff_name','doctor_name','staff_role','total_score','point_impact','is_current','superseded_at','superseded_reason',
  'manager_review_score','manager_review_notes','manager_reviewed_by','manager_reviewed_at','submission_fingerprint']);
insert into public.t_cols select 'provenance', unnest(array[
  'customer_id','customer_name','customer_code','customer_phone','invoice_number','invoice_time','conversation_date','conversation_type',
  'month_cycle','review_date','first_customer_message_at','first_staff_reply_at','first_response_minutes','follow_up_delay_minutes',
  'repeat_count','repeat_multiplier','base_score','converted_to_sale','whatsapp_review_source_id','sales_intelligence_case_id',
  'automatic_evaluation_version','automatic_evaluation_json','evidence_coverage_percent','automatic_reliability_percent',
  'manual_clinical_review_required']);
select public.t_assert((select count(*) from public.t_cols)=(select count(distinct col) from public.t_cols)
  and not exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='conversation_sales_reviews'
                  and c.column_name not in (select col from public.t_cols))
  and not exists (select 1 from public.t_cols t where not exists (select 1 from information_schema.columns c
                  where c.table_schema='public' and c.table_name='conversation_sales_reviews' and c.column_name=t.col)),
  'B: every conversation_sales_reviews column is classified exactly once (eval / server-bound / provenance)');
select public.t_assert((select count(*) from public.t_cols where kind='eval')=61, 'B: 61 evaluation columns are whitelisted');

-- (2) strict whitelist: a missing key is rejected, never inherited
set role anon;
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') - 'has_complaint') like 'err:22023:correction_payload_missing_field:has_complaint%', 'B: missing derived flag rejected (never inherited)');
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') - 'greeting_score') like 'err:22023:correction_payload_missing_field:greeting_score%', 'B: missing score column rejected');

-- (3) consistency: every derived column must agree with raw_scores / review_items
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') || '{"has_medical_error":true}') like 'err:22023:correction_payload_inconsistent:has_medical_error%', 'B: medical flag without a medical error rejected');
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') || '{"has_complaint":true}') like 'err:22023:correction_payload_inconsistent:has_complaint%', 'B: complaint flag without complaint rejected');
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') || '{"bad_tone_flag":"false"}') like 'err:22023:correction_payload_inconsistent:bad_tone_flag%', 'B: flags must be JSON booleans');
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') || '{"final_score":86}') like 'err:22023:correction_payload_inconsistent:final_score%', 'B: score must equal raw_scores.result');
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') || '{"doctor_points_impact":-2}') like 'err:22023:correction_payload_inconsistent:doctor_points_impact%', 'B: points impact must equal raw_scores.result');
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') || '{"greeting_score":7}') like 'err:22023:correction_payload_inconsistent:greeting_score%', 'B: criterion score must equal its review item');
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') || '{"review_items":[{"key":"greeting","applies":true,"pointsEarned":5}]}') like 'err:22023:correction_payload_inconsistent:review_items%', 'B: review_items must equal raw_scores.result.reviewItems');
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'سبب',
  jsonb_set(public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved'),'{raw_scores}','{"criteria":{}}')) like 'err:22023:correction_payload_inconsistent:raw_scores.severe_errors%', 'B: raw_scores must carry criteria, severe_errors and result');
reset role;
select public.t_assert(public.t_corrections('e0000000-0000-4000-8000-000000000005')=0, 'B: every rejected payload wrote nothing');

-- (4) a clean correction over the stale automatic row: nothing stale survives
create table public.t_p5 as select public.t_payload('d0000000-0000-4000-8000-000000000001',85,-3,-3,0,'approved') as p;
grant select on public.t_p5 to anon;
set role anon;
select public.t_assert(public.t_call('tok-gm','e0000000-0000-4000-8000-000000000005',gen_random_uuid(),'تصحيح كامل',(select p from public.t_p5)) like 'ok:%"created"%', 'B: clean correction of the stale automatic row created');
reset role;
create table public.t_c5 as select * from public.conversation_sales_reviews where supersedes_review_id='e0000000-0000-4000-8000-000000000005';
select public.t_assert(not exists (
    select 1 from public.t_cols t, public.t_c5 c, public.t_p5 p
    where t.kind='eval' and t.col<>'raw_scores'
      and coalesce(to_jsonb(c)->t.col,'null'::jsonb) is distinct from coalesce(p.p->t.col,'null'::jsonb)),
  'B: every persisted evaluation column equals the payload built from the same recalculation');
select public.t_assert((select c.raw_scores - 'manager_correction' = p.p->'raw_scores' from public.t_c5 c, public.t_p5 p),
  'B: raw_scores equals the payload (plus only the server manager_correction stamp)');
select public.t_assert((select not (has_complaint or has_medical_error or has_invoice_error or has_delivery_issue or bad_tone_flag
    or severe_bad_tone_flag or rushed_response_flag or misunderstood_customer_flag or bad_alternative_flag or closing_message_used
    or follow_up_promised or has_critical_error or forgotten_customer or missed_sales_opportunity or excellent_case)
  and greeting_score=10 and tone_language_score is null and understanding_score is null and closing_message_score is null
  and repeated_error_type is null and level='جيدة' and total_score=final_score and point_impact=doctor_points_impact
  and review_items=raw_scores->'result'->'reviewItems' and final_score=(raw_scores->'result'->>'finalScore')::numeric
  and doctor_points_impact=(raw_scores->'result'->>'doctorPointsImpact')::numeric from public.t_c5),
  'B: no stale flag/score from the automatic row survives; raw_scores, review_items, flags, score and points agree');
select public.t_assert((select c.first_response_minutes=17 and c.follow_up_delay_minutes=33 and c.repeat_count=2 and c.repeat_multiplier=1.5
  and c.converted_to_sale and c.customer_name='عميل 5' and c.branch='A' from public.t_c5 c), 'B: only provenance/timing facts are copied');
select public.t_assert((select count(*) from public.employee_transactions where source_id=(select id from public.t_c5) and points_delta=-3 and status='approved')=1,
  'B: points posted from the same corrected impact');

-- (5) flag matrix through a correction chain on case-8: each step derives its own flags
create function public.t_correct8(p_reason text, p_criteria jsonb, p_severe jsonb, p_items jsonb default null) returns text language plpgsql as $$
declare r text;
begin
  r := public.t_call('tok-gm', public.t_head('case-8'), gen_random_uuid(), p_reason,
    public.t_payload('d0000000-0000-4000-8000-000000000002',60,-6,-6,0,'approved',p_criteria,p_severe,p_items));
  if r not like 'ok:%' then raise notice 't_correct8 % -> %', p_reason, r; end if;
  return r;
end $$;
grant execute on function public.t_correct8(text,jsonb,jsonb,jsonb) to anon;
create function public.t_flags8() returns jsonb language sql as $$
  select jsonb_build_object('complaint',has_complaint,'medical',has_medical_error,'invoice',has_invoice_error,'delivery',has_delivery_issue,
    'tone',bad_tone_flag,'severe_tone',severe_bad_tone_flag,'rushed',rushed_response_flag,'misunderstood',misunderstood_customer_flag,
    'alternative',bad_alternative_flag,'closing',closing_message_used,'followup',follow_up_promised,'critical',has_critical_error)
  from public.conversation_sales_reviews where sales_intelligence_case_id='case-8' and is_current $$;
set role anon;
select public.t_assert(public.t_correct8('خطأ طبي', '{"greeting":{"applies":true,"choice":"official_full"}}', '{"medical_error":true}') like 'ok:%', 'B: medical on (severe) accepted');
reset role;
select public.t_assert(public.t_flags8() = '{"complaint":false,"medical":true,"invoice":false,"delivery":false,"tone":false,"severe_tone":false,"rushed":false,"misunderstood":false,"alternative":false,"closing":false,"followup":false,"critical":true}', 'B: medical_error ON -> has_medical_error and has_critical_error only: '||public.t_flags8()::text);
set role anon;
select public.t_assert(public.t_correct8('لا يوجد خطأ طبي', '{"greeting":{"applies":true,"choice":"official_full"}}', '{}') like 'ok:%', 'B: medical off accepted');
reset role;
select public.t_assert(public.t_flags8() = '{"complaint":false,"medical":false,"invoice":false,"delivery":false,"tone":false,"severe_tone":false,"rushed":false,"misunderstood":false,"alternative":false,"closing":false,"followup":false,"critical":false}', 'B: medical_error OFF clears it on the new version: '||public.t_flags8()::text);
set role anon;
select public.t_assert(public.t_correct8('خطأ طبي في بند', '{"consultation_quality":{"applies":true,"choice":"wrong"}}', '{}',
  '[{"key":"consultation_quality","applies":true,"pointsEarned":0,"errorType":"medical_error"}]') like 'ok:%', 'B: medical via review item accepted');
reset role;
select public.t_assert((public.t_flags8()->>'medical')::boolean and not (public.t_flags8()->>'critical')::boolean, 'B: has_medical_error derived from a medical review item');
set role anon;
select public.t_assert(public.t_correct8('فاتورة وتوصيل', '{"greeting":{"applies":true,"choice":"official_full"}}', '{"invoice_error":true,"delivery_error":true}') like 'ok:%', 'B: invoice/delivery accepted');
reset role;
select public.t_assert(public.t_flags8() = '{"complaint":false,"medical":false,"invoice":true,"delivery":true,"tone":false,"severe_tone":false,"rushed":false,"misunderstood":false,"alternative":false,"closing":false,"followup":false,"critical":true}', 'B: invoice_error / delivery_error flags: '||public.t_flags8()::text);
set role anon;
select public.t_assert(public.t_correct8('شكوى ونبرة', '{"angry_customer":{"applies":true,"choice":"calm"},"tone":{"applies":true,"choice":"bad"}}', '{}') like 'ok:%', 'B: complaint/tone accepted');
reset role;
select public.t_assert(public.t_flags8() = '{"complaint":true,"medical":false,"invoice":false,"delivery":false,"tone":true,"severe_tone":false,"rushed":false,"misunderstood":false,"alternative":false,"closing":false,"followup":false,"critical":false}', 'B: complaint + bad tone (not severe): '||public.t_flags8()::text);
set role anon;
select public.t_assert(public.t_correct8('إهانة', '{"tone":{"applies":true,"choice":"insult"}}', '{"insult":true}') like 'ok:%', 'B: insult accepted');
reset role;
select public.t_assert(public.t_flags8() = '{"complaint":true,"medical":false,"invoice":false,"delivery":false,"tone":true,"severe_tone":true,"rushed":false,"misunderstood":false,"alternative":false,"closing":false,"followup":false,"critical":true}', 'B: insult -> complaint + severe tone: '||public.t_flags8()::text);
set role anon;
select public.t_assert(public.t_correct8('بديل وفهم وإغلاق ومتابعة', '{"unavailable_items":{"applies":true,"choice":"bad_alternative"},"understanding":{"applies":true,"choice":"rushed"},"closing_message":{"applies":true,"choice":"official"},"followup_after_wait":{"applies":true,"choice":"done"}}', '{}') like 'ok:%', 'B: alternative/understanding accepted');
reset role;
select public.t_assert(public.t_flags8() = '{"complaint":false,"medical":false,"invoice":false,"delivery":false,"tone":false,"severe_tone":false,"rushed":true,"misunderstood":false,"alternative":true,"closing":true,"followup":true,"critical":false}', 'B: bad alternative / rushed / closing / follow-up: '||public.t_flags8()::text);
set role anon;
select public.t_assert(public.t_correct8('سوء فهم', '{"understanding":{"applies":false,"choice":"wrong"},"unavailable_items":{"applies":true,"choice":"good_alternative"}}', '{}') like 'ok:%', 'B: not-applying criterion accepted');
reset role;
select public.t_assert(public.t_flags8() = '{"complaint":false,"medical":false,"invoice":false,"delivery":false,"tone":false,"severe_tone":false,"rushed":false,"misunderstood":false,"alternative":false,"closing":false,"followup":false,"critical":false}', 'B: a non-applying criterion raises no flag: '||public.t_flags8()::text);
select public.t_assert((select count(*) from public.conversation_sales_reviews where sales_intelligence_case_id='case-8')=9
  and (select count(*) from public.t_current('case-8'))=1, 'B: flag matrix chain = 8 corrections + original, one current');
select public.t_assert(public.t_live_points('d0000000-0000-4000-8000-000000000002')=-6, 'B: the chain left exactly one live points row for its staff (-6)');

-- (6) the stale automatic rows themselves never changed
select public.t_assert(not exists (select 1 from public.t_evidence_58 e join public.conversation_sales_reviews r on r.id=e.id
  where e.evidence is distinct from to_jsonb(r) - array['is_current','superseded_at','superseded_reason','updated_at']),
  'B/C: superseded automatic evidence rows 5..8 are unchanged');

-- =============================================================================================
-- Fix C: record_conversation_review_points_v1 is fail-closed, contract and grants unchanged
-- =============================================================================================
create function public.t_points(p_token text, p_review uuid) returns text language plpgsql as $$
declare r jsonb;
begin
  r := public.record_conversation_review_points_v1(p_token, p_review);
  return 'ok:' || r::text;
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;
grant execute on function public.t_points(text,uuid) to anon;
insert into public.staff_accounts(id,staff_id,username,name,role,branch,active,is_active,can_login,status,permissions) values
 ('a0000000-0000-4000-8000-000000000011','s-n1','n1','null active','general_manager',null,null,true,true,'active','{}'),
 ('a0000000-0000-4000-8000-000000000012','s-n2','n2','null is_active','general_manager',null,true,null,true,'active','{}'),
 ('a0000000-0000-4000-8000-000000000013','s-n3','n3','null can_login','general_manager',null,true,true,null,'active','{}'),
 ('a0000000-0000-4000-8000-000000000014','s-n4','n4','null status','general_manager',null,true,true,true,null,'{}'),
 ('a0000000-0000-4000-8000-000000000015','s-n5','n5','blank status','general_manager',null,true,true,true,'  ','{}'),
 ('a0000000-0000-4000-8000-000000000016','s-n6','n6','Active status','general_manager',null,true,true,true,' Active ','{}');
insert into public.staff_login_sessions(staff_account_id,token_hash,expires_at) values
 ('a0000000-0000-4000-8000-000000000011',public.t_hash('tok-n1'),now()+interval '1 hour'),
 ('a0000000-0000-4000-8000-000000000012',public.t_hash('tok-n2'),now()+interval '1 hour'),
 ('a0000000-0000-4000-8000-000000000013',public.t_hash('tok-n3'),now()+interval '1 hour'),
 ('a0000000-0000-4000-8000-000000000014',public.t_hash('tok-n4'),now()+interval '1 hour'),
 ('a0000000-0000-4000-8000-000000000015',public.t_hash('tok-n5'),now()+interval '1 hour'),
 ('a0000000-0000-4000-8000-000000000016',public.t_hash('tok-n6'),now()+interval '1 hour');
-- Production caller path: a human review saved by mgrA (reviewer bound from the request identity),
-- then its points posted through the session command exactly like Reviews.tsx does.
select set_config('request.headers','{"x-dawaa-user-id":"a0000000-0000-4000-8000-000000000001"}',false);
insert into public.conversation_sales_reviews(id,evaluation_kind,staff_id,staff_name,branch,customer_name,conversation_date,final_score,
  doctor_points_impact,point_impact,impact_status,month_cycle,reviewer_id,reviewer_name,review_items,raw_scores)
values ('e0000000-0000-4000-8000-0000000000a1','واتساب','d0000000-0000-4000-8000-000000000002','دكتور 2','A','عميل نقاط','2026-10-04 09:00+00',70,
        -2,-2,'approved','2026-10','a0000000-0000-4000-8000-000000000001','مدير أ','[]','{}');
select set_config('request.headers','',false);
set role anon;
select public.t_assert(public.t_points('tok-n1','e0000000-0000-4000-8000-0000000000a1') like 'err:42501:invalid_or_expired_staff_session%', 'C: NULL active denied');
select public.t_assert(public.t_points('tok-n2','e0000000-0000-4000-8000-0000000000a1') like 'err:42501:invalid_or_expired_staff_session%', 'C: NULL is_active denied');
select public.t_assert(public.t_points('tok-n3','e0000000-0000-4000-8000-0000000000a1') like 'err:42501:invalid_or_expired_staff_session%', 'C: NULL can_login denied');
select public.t_assert(public.t_points('tok-n4','e0000000-0000-4000-8000-0000000000a1') like 'err:42501:invalid_or_expired_staff_session%', 'C: NULL status denied');
select public.t_assert(public.t_points('tok-n5','e0000000-0000-4000-8000-0000000000a1') like 'err:42501:invalid_or_expired_staff_session%', 'C: blank status denied');
select public.t_assert(public.t_points('tok-off','e0000000-0000-4000-8000-0000000000a1') like 'err:42501:invalid_or_expired_staff_session%', 'C: can_login=false still denied');
select public.t_assert(public.t_points('tok-mgrA-expired','e0000000-0000-4000-8000-0000000000a1') like 'err:42501:invalid_or_expired_staff_session%', 'C: expired session still denied');
select public.t_assert(public.t_call('tok-n1','e0000000-0000-4000-8000-000000000007',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000002',85,-3,-3,0,'approved')) like 'err:42501:invalid_or_expired_staff_session%'
  and public.t_call('tok-n4','e0000000-0000-4000-8000-000000000007',gen_random_uuid(),'سبب',public.t_payload('d0000000-0000-4000-8000-000000000002',85,-3,-3,0,'approved')) like 'err:42501:invalid_or_expired_staff_session%',
  'C: the correction command denies the same NULL account states');
reset role;
select public.t_assert((select count(*) from public.employee_transactions where source_id='e0000000-0000-4000-8000-0000000000a1')=0, 'C: denied calls posted nothing');
set role anon;
select public.t_assert(public.t_points('tok-n6','e0000000-0000-4000-8000-0000000000a1') like 'err:42501:review_author_session_mismatch%', 'C: case/space-normalized "Active" status authenticates (then the author binding applies)');
select public.t_assert(public.t_points('tok-mgrA','e0000000-0000-4000-8000-0000000000a1') like 'ok:%"session_authorized": true%', 'C: a valid session still posts normal review points (Production caller)');
select public.t_assert(public.t_points('tok-mgrA','e0000000-0000-4000-8000-0000000000a1') like 'ok:%', 'C: Production caller retry stays compatible');
reset role;
select public.t_assert((select count(*) from public.employee_transactions where source='conversation_evaluation' and source_id='e0000000-0000-4000-8000-0000000000a1'
  and staff_id='d0000000-0000-4000-8000-000000000002' and points_delta=-2 and status='approved' and branch='A'
  and metadata->>'session_command'='record_conversation_review_points_v1')=1, 'C: exactly one normal review points row (-2, approved, branch A)');
select public.t_assert((select b.acl = p.proacl::text and b.proowner=p.proowner and b.prosecdef=p.prosecdef and b.cfg=p.proconfig::text
    and b.res=pg_get_function_result(p.oid) and b.args=pg_get_function_identity_arguments(p.oid)
  from public.t_points_v1_before b, pg_proc p where p.oid='public.record_conversation_review_points_v1(text,uuid)'::regprocedure),
  'C: signature, result, owner, SECURITY DEFINER, search_path and ACL unchanged: '||(select proacl::text from pg_proc where oid='public.record_conversation_review_points_v1(text,uuid)'::regprocedure));
select public.t_assert(has_function_privilege('anon','public.record_conversation_review_points_v1(text,uuid)','execute')
  and has_function_privilege('authenticated','public.record_conversation_review_points_v1(text,uuid)','execute')
  and has_function_privilege('service_role','public.record_conversation_review_points_v1(text,uuid)','execute'), 'C: existing callers keep execute (anon, authenticated, service_role)');
select public.t_assert((select regexp_replace(b.prosrc, '\n\s*and coalesce\(a\.active,true\)=true.*?limit 1;', ' <ACCOUNT_STATE> limit 1;')
    = regexp_replace(p.prosrc, '\n\s*-- Fail closed[^\n]*\n\s*and a\.active is true.*?limit 1;', ' <ACCOUNT_STATE> limit 1;')
    and p.prosrc like '%and a.active is true and a.is_active is true and a.can_login is true and lower(btrim(coalesce(a.status,'''')))=''active''%'
    and p.prosrc not like '%coalesce(a.active,true)%'
  from public.t_points_v1_before b, pg_proc p where p.oid='public.record_conversation_review_points_v1(text,uuid)'::regprocedure),
  'C: the live body changed ONLY in its account-state predicate (now fail-closed)');
select public.t_assert(not has_function_privilege('anon','public.dawaa_conversation_review_chose_v1(jsonb,text,text[])','execute'), 'grant: criterion predicate is internal');

select public.t_assert(true, 'ALL CORRECTION COMMAND TESTS PASSED');
