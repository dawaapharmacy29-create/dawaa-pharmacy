-- Synthetic regression only, applied to the fresh local staging database and rolled back.
begin;
do $test$
declare n text; r text;
begin
  foreach n in array array['dawaa_sync_whatsapp_story_product_events_v16','dawaa_sync_whatsapp_story_reengagement_events_v16','dawaa_refresh_whatsapp_customer_story_v16'] loop
    if exists (select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=format('public.%s(uuid)',n)::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') then
      raise exception 'PUBLIC execute exposure: %',n;
    end if;
    if n <> 'dawaa_refresh_whatsapp_customer_story_v16' and not exists (select 1 from pg_proc where oid=format('public.%s(uuid)',n)::regprocedure
      and prosecdef and proconfig @> array['search_path=pg_catalog, public, pg_temp']) then
      raise exception 'unsafe security mode/search_path: %',n;
    end if;
    foreach r in array array['anon','authenticated'] loop
      execute format('set local role %I',r);
      begin
        execute format('select public.%I(%L::uuid)',n,'00000000-0000-4000-8000-000000000071');
        raise exception 'direct execution unexpectedly allowed: % / %',r,n;
      exception when insufficient_privilege then null;
      end;
      reset role;
    end loop;
  end loop;
end $test$;

insert into public.whatsapp_customer_stories(id,story_key,story_started_at)
values ('00000000-0000-4000-8000-000000000071','SYN-STORY-SYNC','2026-09-15T06:00:00Z');
insert into public.whatsapp_customer_journeys(id,story_id,journey_key,root_source_id,customer_state,journey_started_at,journey_ended_at)
values ('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000071','SYN-JOURNEY-SYNC',
  '00000000-0000-4000-8000-000000000051','reengaged','2026-09-15T06:00:00Z','2026-09-15T07:00:00Z');
insert into public.whatsapp_customer_journey_sessions(journey_id,source_id,session_id,sequence_no,session_role)
values ('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000051','SYN-SESSION-SYNC',1,'root');
update public.whatsapp_review_sources set conversation_ended_at='2026-09-15T07:00:00Z',analysis_json=
 '{"operational":{"productJourney":{"journeys":[{"followupCandidate":true,"productName":"Synthetic Product","productCode":"SYN-P1","events":[{"stage":"accepted","confidence":95}]},{"followupCandidate":true,"productName":"Low Confidence","events":[{"stage":"accepted","confidence":89}]},{"followupCandidate":false,"productName":"No Followup","events":[{"stage":"accepted","confidence":99}]}]}}}'::jsonb
where id='00000000-0000-4000-8000-000000000051';

set local role service_role;
select public.dawaa_refresh_whatsapp_customer_story_v16('00000000-0000-4000-8000-000000000071');
select public.dawaa_refresh_whatsapp_customer_story_v16('00000000-0000-4000-8000-000000000071');
reset role;
do $test$
declare s public.whatsapp_customer_stories;
begin
  if (select count(*) from public.whatsapp_customer_story_events where story_id='00000000-0000-4000-8000-000000000071') <> 2 then
    raise exception 'expected exactly accepted-product and reengagement events, without retry duplicates';
  end if;
  if not exists(select 1 from public.whatsapp_customer_story_events where story_id='00000000-0000-4000-8000-000000000071'
    and event_type='recommendation_accepted' and product_code='SYN-P1' and confidence=95
    and payload #>> '{acceptedEvidence,stage}'='accepted') then raise exception 'accepted product evidence drift'; end if;
  if not exists(select 1 from public.whatsapp_customer_story_events where story_id='00000000-0000-4000-8000-000000000071'
    and event_type='customer_reengaged' and confidence=90) then raise exception 'reengagement evidence drift'; end if;
  select * into s from public.whatsapp_customer_stories where id='00000000-0000-4000-8000-000000000071';
  if s.accepted_recommendation_count<>1 or s.journey_count<>1 or s.source_count<>1
    or s.status<>'active' or s.risk_level<>'low' then raise exception 'canonical refresh aggregate drift'; end if;
end $test$;
rollback;
