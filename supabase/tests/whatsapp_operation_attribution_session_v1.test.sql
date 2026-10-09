-- Run after the isolated fixture, the real v2 action guard, and the prepared migration.
create schema test;
create function test.assert(p_value boolean,p_message text) returns void language plpgsql as $$
begin if p_value is not true then raise exception 'assertion failed: %',p_message; end if; end $$;
insert into public.staff_accounts values
 ('00000000-0000-4000-8000-000000000001','Manager','manager','admin','active',true,true,true,'A','{}'),
 ('00000000-0000-4000-8000-000000000002','Staff','staff','staff','active',true,true,true,'A','{}'),
 ('00000000-0000-4000-8000-000000000003','Reviewer','reviewer','reviewer','active',true,true,true,'A','{"approve_reviews":true}'),
 ('00000000-0000-4000-8000-000000000004','Disabled','disabled','admin','active',true,null,true,'A','{}');
insert into public.staff_login_sessions values
 ('00000000-0000-4000-8000-000000000001',encode(extensions.digest('synthetic-manager-session-token-000001','sha256'),'hex'),null,now()+interval '1 hour'),
 ('00000000-0000-4000-8000-000000000002',encode(extensions.digest('synthetic-staff-session-token-00000002','sha256'),'hex'),null,now()+interval '1 hour'),
 ('00000000-0000-4000-8000-000000000003',encode(extensions.digest('synthetic-reviewer-session-token-00003','sha256'),'hex'),null,now()+interval '1 hour'),
 ('00000000-0000-4000-8000-000000000004',encode(extensions.digest('synthetic-disabled-session-token-00004','sha256'),'hex'),null,now()+interval '1 hour'),
 ('00000000-0000-4000-8000-000000000001',encode(extensions.digest('synthetic-expired-session-token-000001','sha256'),'hex'),null,now()-interval '1 hour');
insert into public.customers(id,customer_code,name,branch,is_duplicate) values
 ('00000000-0000-4000-8000-00000000000a','A','Customer A','A',false),
 ('00000000-0000-4000-8000-00000000000b','B','Customer B','B',false),
 ('00000000-0000-4000-8000-00000000000d','D','Duplicate','A',true);
insert into public.whatsapp_review_sources values
 ('00000000-0000-4000-8000-000000000010',null,'A','chat.txt','2026-09-15 06:00Z','2026-09-15 07:00Z','synthetic chat'),
 ('00000000-0000-4000-8000-000000000011',null,'B','other.txt','2026-09-15 06:00Z','2026-09-15 07:00Z','other chat');
insert into public.whatsapp_conversation_actions(id,source_id,action_key,action_type,followup_identity,customer_id,
 customer_code,customer_name,branch,evidence,payload,status,work_status,target_table,target_id,updated_at)
 values('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','request:0','customer_request',
 'fu1|customer:old-A|episode|customer-request|product','00000000-0000-4000-8000-00000000000a','A','Customer A','A',
 '["synthetic-message"]','{"approvalSource":"human_review_v2","unrelated":"preserved"}','ready','assigned','customer_requests','request-one',now());
insert into public.whatsapp_auto_followup_requests values
 ('00000000-0000-4000-8000-000000000021','fu1|chat:signal|episode|signal|product',
 '00000000-0000-4000-8000-00000000000a','A','Customer A',null,'resolved','A','chat.txt','session-one','request','product',
 '2026-09-15 06:05Z','original evidence','قيد المتابعة');
alter table public.whatsapp_conversation_actions enable row level security;
create policy fixture_read on public.whatsapp_conversation_actions for select to anon using(true);
create policy fixture_update on public.whatsapp_conversation_actions for update to anon using(true) with check(true);
alter table public.whatsapp_auto_followup_requests enable row level security;
create policy fixture_signal_read on public.whatsapp_auto_followup_requests for select to anon using(true);
create policy fixture_signal_update on public.whatsapp_auto_followup_requests for update to anon using(true) with check(true);
grant usage on schema public,test,extensions to anon;
grant select,update on public.whatsapp_conversation_actions,public.whatsapp_auto_followup_requests to anon;
grant select on public.customers,public.staff_accounts,public.whatsapp_review_sources to anon;
select test.assert(not has_function_privilege('public','public.dawaa_correct_whatsapp_operation_attribution_session_v1(text,text,uuid,text,uuid,jsonb,uuid)','execute'),'PUBLIC execute revoked');
set local role anon;
-- The actual v2 guard still denies direct customer changes even with a spoofed GUC/header actor.
do $$ begin
 perform set_config('dawaa.operation_attribution_command','v1',true);
 begin
   update public.whatsapp_conversation_actions set customer_id='00000000-0000-4000-8000-00000000000b'
    where id='00000000-0000-4000-8000-000000000020';
   raise exception 'direct update unexpectedly succeeded';
 exception when sqlstate '42501' then null; end;
 update public.whatsapp_auto_followup_requests set customer_id=null
  where id='00000000-0000-4000-8000-000000000021';
 perform test.assert((select customer_id='00000000-0000-4000-8000-00000000000a'::uuid
  from public.whatsapp_auto_followup_requests),'spoofed anon marker cannot suppress legacy signal resolver');
 perform set_config('dawaa.operation_attribution_command','',true);
end $$;
-- A -> unresolved -> B -> A uses one row and keeps the legacy key and workflow.
select public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','action',
 '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',
 '00000000-0000-4000-8000-00000000000a','{"customer_id":null,"customer_code":null,"customer_name":"Customer","customer_phone":null}',
 '00000000-0000-4000-8000-000000000010');
select test.assert((select customer_id is null from public.whatsapp_conversation_actions),'A to NULL');
select public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','action',
 '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',null,
 '{"customer_id":"00000000-0000-4000-8000-00000000000b","customer_code":"B","customer_name":"Customer B","customer_phone":null}',
 '00000000-0000-4000-8000-000000000010');
-- Lost-response retry from NULL to B must be idempotent.
select public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','action',
 '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',null,
 '{"customer_id":"00000000-0000-4000-8000-00000000000b","customer_code":"B","customer_name":"Customer B","customer_phone":null}',
 '00000000-0000-4000-8000-000000000010');
select public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','action',
 '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',
 '00000000-0000-4000-8000-00000000000b',
 '{"customer_id":"00000000-0000-4000-8000-00000000000a","customer_code":"A","customer_name":"Customer A","customer_phone":null}',
 '00000000-0000-4000-8000-000000000010');
-- A stale B correction cannot overwrite A, and invalid tokens/permissions are rejected.
do $$ declare token text; begin
 foreach token in array array['','bad-token','synthetic-expired-session-token-000001','synthetic-disabled-session-token-00004','synthetic-staff-session-token-00000002'] loop
  begin
   perform public.dawaa_correct_whatsapp_operation_attribution_session_v1(token,'action',
    '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',null,
    '{"customer_id":null,"customer_code":null}','00000000-0000-4000-8000-000000000010');
   raise exception 'invalid session/permission unexpectedly succeeded';
  exception when sqlstate '42501' then null; end;
 end loop;
 begin
   perform public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','action',
    '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',
    '00000000-0000-4000-8000-00000000000b','{"customer_id":null,"customer_code":null}',
    '00000000-0000-4000-8000-000000000010');
   raise exception 'stale correction unexpectedly succeeded';
 exception when sqlstate '40001' then null; end;
end $$;
-- Identity tampering, source substitution and execution-field injection cannot authorize a write.
do $$ begin
 begin
  perform public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','action',
   '00000000-0000-4000-8000-000000000020','different-identity','00000000-0000-4000-8000-00000000000a',
   '{"customer_id":null,"customer_code":null}','00000000-0000-4000-8000-000000000010');
  raise exception 'identity substitution succeeded';
 exception when sqlstate '40001' then null; end;
 begin
  perform public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','action',
   '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',
   '00000000-0000-4000-8000-00000000000a','{"customer_id":null,"customer_code":null}',
   '00000000-0000-4000-8000-000000000011');
  raise exception 'source substitution succeeded';
 exception when sqlstate '42501' then null; end;
 begin
  perform public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','action',
   '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',
   '00000000-0000-4000-8000-00000000000a','{"customer_id":null,"target_id":"tamper"}',
   '00000000-0000-4000-8000-000000000010');
  raise exception 'execution injection succeeded';
 exception when sqlstate '22023' then null; end;
 begin
  perform public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-reviewer-session-token-00003','action',
   '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',
   '00000000-0000-4000-8000-00000000000a','{"customer_id":"00000000-0000-4000-8000-00000000000b"}',
   '00000000-0000-4000-8000-000000000010');
  raise exception 'cross-branch target succeeded';
 exception when sqlstate '42501' then null; end;
 begin
  perform public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','action',
   '00000000-0000-4000-8000-000000000020','fu1|customer:old-A|episode|customer-request|product',
   '00000000-0000-4000-8000-00000000000a','{"customer_id":"00000000-0000-4000-8000-00000000000d"}',
   '00000000-0000-4000-8000-000000000010');
  raise exception 'duplicate customer accepted';
 exception when sqlstate '22023' then null; end;
end $$;
-- Clearing a signal must not be undone by the existing legacy guessing trigger.
select public.dawaa_correct_whatsapp_operation_attribution_session_v1('synthetic-manager-session-token-000001','signal',
 '00000000-0000-4000-8000-000000000021','fu1|chat:signal|episode|signal|product',
 '00000000-0000-4000-8000-00000000000a',
 '{"customer_id":null,"customer_code":null,"customer_name":"Customer A","customer_phone":null,"customer_identity_status":"unresolved"}',null);
select test.assert((select customer_id is null and customer_code is null and customer_identity_status='unresolved'
 and status='قيد المتابعة' and evidence_quote='original evidence' from public.whatsapp_auto_followup_requests),'signal clear preserves evidence/workflow');
select test.assert((select count(*)=1 from public.whatsapp_conversation_actions),'one action');
select test.assert((select followup_identity='fu1|customer:old-A|episode|customer-request|product'
 and customer_id='00000000-0000-4000-8000-00000000000a' and status='ready' and work_status='assigned'
 and target_id='request-one' and payload->>'unrelated'='preserved' and evidence='["synthetic-message"]'::jsonb
 from public.whatsapp_conversation_actions),'immutable identity and lineage');
reset role;
select test.assert((select count(*)=4 from public.whatsapp_review_audit),'three action corrections and one signal correction; retry/denials unaudited');
select test.assert(coalesce(current_setting('dawaa.operation_attribution_command',true),'')='','privileged trigger marker reset');
rollback;
