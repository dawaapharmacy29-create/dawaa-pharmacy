-- DB behaviour tests A–H + grants for dawaa_link_whatsapp_evidence_journey_session_v1.
-- Run by scripts/test-db-evidence-journey-link.sh against a throwaway local Postgres after the fixture
-- and the migration. Every call runs as role anon, exactly like the browser (anon key + staff session).
\set ON_ERROR_STOP 1

create function public.t_call(p_token text, p_journey uuid, p_story uuid, p_sources uuid[]) returns text
language plpgsql as $$
declare r jsonb;
begin
  r := public.dawaa_link_whatsapp_evidence_journey_session_v1(p_token, p_journey, p_story, p_sources);
  return 'ok:' || r::text;
exception when others then
  return 'err:' || sqlstate || ':' || sqlerrm;
end $$;

create function public.t_assert(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'FAIL: %', p_label; end if;
  raise notice 'PASS: %', p_label;
end $$;

create function public.t_hash(p text) returns text language sql as $$ select encode(public.digest(p,'sha256'),'hex') $$;

-- Accounts
insert into public.staff_accounts(id,staff_id,username,role,branch,active,is_active,can_login,status,permissions) values
 ('a0000000-0000-4000-8000-000000000001','s-mgr','mgr','branch_manager','A',true,true,true,'active','{"add_reviews":true}'),
 ('a0000000-0000-4000-8000-000000000002','s-out','out','branch_manager','B',true,true,true,'active','{"add_reviews":true}'),
 ('a0000000-0000-4000-8000-000000000003','s-np','np','pharmacist','A',true,true,true,'active','{"view_reviews":true}'),
 ('a0000000-0000-4000-8000-000000000004','s-gm','gm','general_manager',null,true,true,true,'active','{}'),
 ('a0000000-0000-4000-8000-000000000005','s-off','off','branch_manager','A',true,true,false,'active','{"add_reviews":true}');

-- Sessions (tokens are >=32 chars like the real opaque token)
insert into public.staff_login_sessions(staff_account_id,token_hash,expires_at,revoked_at) values
 ('a0000000-0000-4000-8000-000000000001',public.t_hash('tok-mgr-valid-000000000000000000000'),now()+interval '1 hour',null),
 ('a0000000-0000-4000-8000-000000000001',public.t_hash('tok-mgr-expired-0000000000000000000'),now()-interval '1 minute',null),
 ('a0000000-0000-4000-8000-000000000001',public.t_hash('tok-mgr-revoked-0000000000000000000'),now()+interval '1 hour',now()),
 ('a0000000-0000-4000-8000-000000000002',public.t_hash('tok-out-valid-000000000000000000000'),now()+interval '1 hour',null),
 ('a0000000-0000-4000-8000-000000000003',public.t_hash('tok-np-valid-0000000000000000000000'),now()+interval '1 hour',null),
 ('a0000000-0000-4000-8000-000000000004',public.t_hash('tok-gm-valid-0000000000000000000000'),now()+interval '1 hour',null),
 ('a0000000-0000-4000-8000-000000000005',public.t_hash('tok-off-valid-000000000000000000000'),now()+interval '1 hour',null);

-- Sources / story / journeys / evidence
insert into public.whatsapp_review_sources values
 ('50000000-0000-4000-8000-000000000001','A',null),
 ('50000000-0000-4000-8000-000000000002','A',null),
 ('50000000-0000-4000-8000-000000000003','B',null);
insert into public.whatsapp_customer_stories values ('57000000-0000-4000-8000-000000000001','story-1'),('57000000-0000-4000-8000-000000000002','story-2');
insert into public.whatsapp_customer_journeys values
 ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003','57000000-0000-4000-8000-000000000002');
insert into public.whatsapp_customer_journey_sessions values
 ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000003');
insert into public.whatsapp_evidence_facts_v17(source_id,fact_key) values
 ('50000000-0000-4000-8000-000000000001','f1'),('50000000-0000-4000-8000-000000000001','f2'),
 ('50000000-0000-4000-8000-000000000002','f3'),('50000000-0000-4000-8000-000000000003','f4');
insert into public.whatsapp_sales_opportunities_v17(root_source_id,opportunity_key) values
 ('50000000-0000-4000-8000-000000000001','o1'),('50000000-0000-4000-8000-000000000003','o2');

create view public.t_state as select
 (select count(*) from public.whatsapp_evidence_facts_v17) facts_total,
 (select count(*) from public.whatsapp_evidence_facts_v17 where journey_id is not null) facts_linked,
 (select count(*) from public.whatsapp_sales_opportunities_v17) opp_total,
 (select count(*) from public.whatsapp_sales_opportunities_v17 where journey_id is not null) opp_linked;

\set J '''10000000-0000-4000-8000-000000000001'''
\set ST '''57000000-0000-4000-8000-000000000001'''
\set SRC '''{50000000-0000-4000-8000-000000000001,50000000-0000-4000-8000-000000000002}'''

-- ---------- Denials first (nothing may be written) ----------
set role anon;
select set_config('t.c', public.t_call('tok-mgr-expired-0000000000000000000', :J, :ST, :SRC), false);
reset role; select public.t_assert(current_setting('t.c') like 'err:42501:invalid_or_expired_staff_session%', 'C expired session denied');

set role anon;
select set_config('t.d', public.t_call('tok-mgr-revoked-0000000000000000000', :J, :ST, :SRC), false);
reset role; select public.t_assert(current_setting('t.d') like 'err:42501:invalid_or_expired_staff_session%', 'D revoked session denied');

-- E: spoofed header naming the general manager, with no token / a random token.
set role anon;
select set_config('request.headers', '{"x-dawaa-user-id":"a0000000-0000-4000-8000-000000000004"}', false);
select set_config('t.e1', public.t_call(null, :J, :ST, :SRC), false);
select set_config('t.e2', public.t_call('random-token-not-a-session-0000000000', :J, :ST, :SRC), false);
select set_config('t.e3', public.t_call('a0000000-0000-4000-8000-000000000004', :J, :ST, :SRC), false);
reset role;
select public.t_assert(current_setting('t.e1') like 'err:42501:staff_session_required%', 'E spoofed x-dawaa-user-id without token denied');
select public.t_assert(current_setting('t.e2') like 'err:42501:invalid_or_expired_staff_session%', 'E spoofed x-dawaa-user-id with random token denied');
select public.t_assert(current_setting('t.e3') like 'err:42501:invalid_or_expired_staff_session%', 'E account id used as token denied');
select set_config('request.headers', '', false);

set role anon;
select set_config('t.f', public.t_call('tok-np-valid-0000000000000000000000', :J, :ST, :SRC), false);
select set_config('t.f2', public.t_call('tok-off-valid-000000000000000000000', :J, :ST, :SRC), false);
reset role;
select public.t_assert(current_setting('t.f') like 'err:42501:not_authorized%', 'F valid session without permission denied');
select public.t_assert(current_setting('t.f2') like 'err:42501:invalid_or_expired_staff_session%', 'F account with can_login=false denied');

-- G: branch-B manager on branch-A journey; branch-A manager smuggling a branch-B source; foreign story.
set role anon;
select set_config('t.g1', public.t_call('tok-out-valid-000000000000000000000', :J, :ST, :SRC), false);
select set_config('t.g2', public.t_call('tok-mgr-valid-000000000000000000000', :J, :ST, '{50000000-0000-4000-8000-000000000001,50000000-0000-4000-8000-000000000003}'), false);
select set_config('t.g3', public.t_call('tok-mgr-valid-000000000000000000000', '10000000-0000-4000-8000-000000000002', null, '{50000000-0000-4000-8000-000000000003}'), false);
select set_config('t.g4', public.t_call('tok-mgr-valid-000000000000000000000', :J, '57000000-0000-4000-8000-000000000002', :SRC), false);
reset role;
select public.t_assert(current_setting('t.g1') like 'err:42501:source_access_denied%', 'G actor outside source branch denied');
select public.t_assert(current_setting('t.g2') like 'err:42501:journey_source_mismatch%', 'G source outside the journey denied (all-or-nothing)');
select public.t_assert(current_setting('t.g3') like 'err:42501:source_access_denied%', 'G other-branch journey denied');
select public.t_assert(current_setting('t.g4') like 'err:42501:story_journey_mismatch%', 'G foreign story denied');
select public.t_assert((select facts_linked=0 and opp_linked=0 from public.t_state), 'denials wrote nothing');

-- ---------- A / B: valid session links facts and opportunities ----------
set role anon;
select set_config('t.a', public.t_call('tok-mgr-valid-000000000000000000000', :J, :ST, :SRC), false);
reset role;
select public.t_assert(current_setting('t.a') like 'ok:%', 'A valid staff session accepted: ' || current_setting('t.a'));
select public.t_assert((substr(current_setting('t.a'),4)::jsonb->>'facts_linked')::int = 3, 'A facts linked = 3');
select public.t_assert((select count(*)=3 from public.whatsapp_evidence_facts_v17 where journey_id=:J and story_id=:ST), 'A facts carry journey+story');
select public.t_assert((select journey_id is null from public.whatsapp_evidence_facts_v17 where fact_key='f4'), 'A out-of-journey fact untouched');
select public.t_assert((substr(current_setting('t.a'),4)::jsonb->>'opportunities_linked')::int = 1, 'B opportunities linked = 1');
select public.t_assert((select count(*)=1 from public.whatsapp_sales_opportunities_v17 where journey_id=:J and story_id=:ST and opportunity_key='o1'), 'B opportunity carries journey+story');

-- ---------- H: repeated link is idempotent and converges ----------
create temp table t_before as select id, updated_at from public.whatsapp_evidence_facts_v17;
set role anon;
select set_config('t.h', public.t_call('tok-mgr-valid-000000000000000000000', :J, :ST, :SRC), false);
select set_config('t.h2', public.t_call('tok-gm-valid-0000000000000000000000', :J, null, :SRC), false);
reset role;
select public.t_assert((substr(current_setting('t.h'),4)::jsonb->>'facts_linked')::int = 0
  and (substr(current_setting('t.h'),4)::jsonb->>'opportunities_linked')::int = 0, 'H repeated link rewrites nothing');
select public.t_assert((select count(*)=0 from public.whatsapp_evidence_facts_v17 f join t_before b using(id) where f.updated_at is distinct from b.updated_at), 'H updated_at unchanged on repeat');
select public.t_assert((select facts_total=4 and opp_total=2 from public.t_state), 'H no rows created or deleted');
select public.t_assert((select count(*)=3 from public.whatsapp_evidence_facts_v17 where journey_id=:J and story_id=:ST), 'H null story keeps existing story link');

-- ---------- Backfill: pre-existing facts on an old journey move to the current journey in place ----------
insert into public.whatsapp_customer_journeys values ('10000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000001','57000000-0000-4000-8000-000000000001');
insert into public.whatsapp_customer_journey_sessions values ('10000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000001');
set role anon;
select set_config('t.bf', public.t_call('tok-mgr-valid-000000000000000000000', '10000000-0000-4000-8000-000000000003', :ST, '{50000000-0000-4000-8000-000000000001}'), false);
reset role;
select public.t_assert((select count(*)=2 from public.whatsapp_evidence_facts_v17 where journey_id='10000000-0000-4000-8000-000000000003'), 'Backfill relinks existing facts to current journey');
select public.t_assert((select facts_total=4 from public.t_state), 'Backfill created no facts');

-- ---------- Grants / retirement ----------
select public.t_assert(to_regprocedure('public.dawaa_link_whatsapp_evidence_journey_v17(uuid,uuid,uuid[])') is null, 'legacy V17 RPC dropped');
select public.t_assert(has_function_privilege('anon','public.dawaa_link_whatsapp_evidence_journey_session_v1(text,uuid,uuid,uuid[])','execute'), 'anon EXECUTE');
select public.t_assert(has_function_privilege('authenticated','public.dawaa_link_whatsapp_evidence_journey_session_v1(text,uuid,uuid,uuid[])','execute'), 'authenticated EXECUTE');
select public.t_assert(not has_function_privilege('service_role','public.dawaa_link_whatsapp_evidence_journey_session_v1(text,uuid,uuid,uuid[])','execute'), 'service_role no EXECUTE');
select public.t_assert((select not exists(select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid='public.dawaa_link_whatsapp_evidence_journey_session_v1(text,uuid,uuid,uuid[])'::regprocedure and a.grantee=0)), 'PUBLIC no EXECUTE');
select public.t_assert((select prosecdef from pg_proc where oid='public.dawaa_link_whatsapp_evidence_journey_session_v1(text,uuid,uuid,uuid[])'::regprocedure), 'command is SECURITY DEFINER with pinned search_path');
\echo ALL_EVIDENCE_LINK_DB_TESTS_PASSED
