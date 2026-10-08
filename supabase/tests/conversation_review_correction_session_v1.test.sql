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

create function public.t_payload(p_staff uuid, p_score numeric, p_impact numeric, p_base numeric, p_extra numeric, p_status text) returns jsonb
language sql as $$
  select jsonb_build_object(
    'staff_id', p_staff, 'final_score', p_score, 'level', 'جيدة', 'conversation_level', 'جيدة',
    'doctor_points_impact', p_impact, 'base_points_impact', p_base, 'extra_penalty_points', p_extra,
    'impact_status', p_status, 'total_applicable_items', 4, 'total_not_applicable_items', 15,
    'total_applicable_points', 40, 'earned_points', round(p_score*0.4), 'positive_points', round(p_score*0.4),
    'negative_points', 40-round(p_score*0.4), 'severe_error_points', abs(p_extra),
    'main_positive_reason', 'ترحيب', 'main_negative_reason', 'فهم الطلب', 'top_positive_reason', 'ترحيب', 'top_deduction_reason', 'فهم الطلب',
    'raw_scores', jsonb_build_object('criteria', jsonb_build_object('greeting', jsonb_build_object('applies', true, 'choice', 'official_full'))),
    'review_items', jsonb_build_array(jsonb_build_object('key','greeting','applies',true,'pointsEarned',10,'maxPoints',10)),
    'greeting_score', 10, 'understanding_score', 5, 'reviewer_notes', 'ملاحظة', 'training_recommendation', 'تدريب', 'evaluation_reason', 'مراجعة عشوائية'
  )
$$;

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

select public.t_assert(true, 'ALL CORRECTION COMMAND TESTS PASSED');
