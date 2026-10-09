-- Captured from read-only Production catalogs; no rows copied. Business logic unchanged.
-- Internal helpers: called by the canonical SECURITY DEFINER story writer; no direct client RPC.

CREATE OR REPLACE FUNCTION public.dawaa_sync_whatsapp_story_product_events_v16(p_story_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  r record;
  j jsonb;
  accepted_event jsonb;
  v_name text;
  v_code text;
  v_product_id uuid;
  v_conf numeric;
  v_event_key text;
begin
  for r in
    select distinct src.id as source_id, src.conversation_ended_at, src.staff_id, src.staff_name, src.analysis_json
    from public.whatsapp_customer_journeys cj
    join public.whatsapp_customer_journey_sessions cjs on cjs.journey_id=cj.id
    join public.whatsapp_review_sources src on src.id=cjs.source_id
    where cj.story_id=p_story_id
      and jsonb_typeof(src.analysis_json #> '{operational,productJourney,journeys}')='array'
  loop
    for j in select value from jsonb_array_elements(r.analysis_json #> '{operational,productJourney,journeys}')
    loop
      if coalesce((j->>'followupCandidate')::boolean,false) is not true then continue; end if;
      select value into accepted_event
      from jsonb_array_elements(coalesce(j->'events','[]'::jsonb))
      where value->>'stage'='accepted'
      order by coalesce((value->>'confidence')::numeric,0) desc
      limit 1;
      if accepted_event is null then continue; end if;
      v_conf := coalesce((accepted_event->>'confidence')::numeric,0);
      if v_conf < 90 then continue; end if;
      v_name := nullif(j->>'productName','');
      v_code := nullif(j->>'productCode','');
      begin v_product_id := nullif(j->>'productId','')::uuid; exception when others then v_product_id := null; end;
      v_event_key := 'recommendation-accepted:' || r.source_id::text || ':' || md5(coalesce(v_product_id::text,v_code,v_name,'unknown'));
      insert into public.whatsapp_customer_story_events(
        story_id,event_key,event_type,event_at,source_id,staff_id,staff_name,product_id,product_code,product_name,confidence,title,detail,payload
      ) values(
        p_story_id,v_event_key,'recommendation_accepted',coalesce(r.conversation_ended_at,now()),r.source_id,r.staff_id,r.staff_name,v_product_id,v_code,v_name,v_conf,
        case when v_name is not null then 'العميل وافق على ترشيح: '||v_name else 'العميل وافق على ترشيح' end,
        'قبول مرتبط برحلة صنف محددة وبـ followupCandidate؛ لا يعتمد على كلمة موافقة عامة منفصلة عن الصنف.',
        jsonb_build_object('productJourney',j,'acceptedEvidence',accepted_event)
      ) on conflict(story_id,event_key) do update set confidence=excluded.confidence,event_at=excluded.event_at,payload=excluded.payload,product_name=excluded.product_name,product_code=excluded.product_code,product_id=excluded.product_id;
      accepted_event := null;
    end loop;
  end loop;
end
$function$
;
revoke all on function public.dawaa_sync_whatsapp_story_product_events_v16(uuid) from public, anon, authenticated;
grant execute on function public.dawaa_sync_whatsapp_story_product_events_v16(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.dawaa_sync_whatsapp_story_reengagement_events_v16(p_story_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
begin
  insert into public.whatsapp_customer_story_events(
    story_id,event_key,event_type,event_at,journey_id,title,detail,confidence,payload
  )
  select
    p_story_id,
    'customer-reengaged:'||j.id::text,
    'customer_reengaged',
    coalesce(j.journey_ended_at,j.journey_started_at,now()),
    j.id,
    'العميل عاد للتفاعل',
    'عاد العميل للرد/التفاعل بعد مشكلة أو صمت. لا يُعتبر استرجاع بيع حتى تظهر فاتورة مؤكدة.',
    90,
    jsonb_build_object('customerState',j.customer_state,'journeySummary',j.summary)
  from public.whatsapp_customer_journeys j
  where j.story_id=p_story_id
    and j.customer_state='reengaged'
  on conflict(story_id,event_key) do update set event_at=excluded.event_at,detail=excluded.detail,payload=excluded.payload;
end
$function$
;
revoke all on function public.dawaa_sync_whatsapp_story_reengagement_events_v16(uuid) from public, anon, authenticated;
grant execute on function public.dawaa_sync_whatsapp_story_reengagement_events_v16(uuid) to service_role;

-- The only application RPC caller of story refresh is the authorized server refresh service.
-- Its old authenticated grant would let clients bypass the helpers' internal-only boundary.
-- Keep the existing service_role/owner entry path; no function body/business logic changes.
revoke all on function public.dawaa_refresh_whatsapp_customer_story_v16(uuid) from authenticated;
