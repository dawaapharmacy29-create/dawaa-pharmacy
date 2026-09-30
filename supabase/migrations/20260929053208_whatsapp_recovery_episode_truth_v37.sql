-- Recovery episode truth V37.
-- Derive recovery_started_at from actual recovery activity, not an old long-lived journey start.
-- Also remove legacy journey recovery metadata that has no Canonical Sale Proof.

create or replace function public.dawaa_refresh_whatsapp_customer_story_v16(p_story_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_story public.whatsapp_customer_stories%rowtype;
  v_open_requests int := 0;
  v_open_complaints int := 0;
  v_accepted int := 0;
  v_attempts int := 0;
  v_sources int := 0;
  v_last timestamptz;
  v_risk text := 'low';
  v_status text := 'active';
  v_journey_recovery_start timestamptz;
  v_recovery_event_start timestamptz;
  v_episode_start timestamptz;
begin
  select * into v_story
  from public.whatsapp_customer_stories
  where id=p_story_id;
  if not found then return; end if;

  perform public.dawaa_sync_whatsapp_story_product_events_v16(p_story_id);
  perform public.dawaa_sync_whatsapp_story_reengagement_events_v16(p_story_id);

  select
    count(*) filter (where coalesce(j.unresolved_order,false))::int,
    count(*) filter (where coalesce(j.unresolved_complaint,false))::int,
    coalesce(sum(j.recovery_attempts),0)::int,
    max(j.journey_ended_at),
    case
      when bool_or(j.customer_risk='critical') then 'critical'
      when bool_or(j.customer_risk='high') then 'high'
      when bool_or(j.customer_risk='medium') then 'medium'
      else 'low'
    end,
    min(j.journey_started_at) filter (
      where (
        j.lifecycle_status='recovery'
        or coalesce(j.unresolved_order,false)
        or coalesce(j.unresolved_complaint,false)
        or coalesce(j.recovery_attempts,0)>0
      )
      and (v_story.recovered_at is null or j.journey_started_at>v_story.recovered_at)
    )
  into
    v_open_requests,v_open_complaints,v_attempts,v_last,v_risk,v_journey_recovery_start
  from public.whatsapp_customer_journeys j
  where j.story_id=p_story_id
    and coalesce(j.lifecycle_status,'open') in ('open','recovery');

  select min(e.event_at)
  into v_recovery_event_start
  from public.whatsapp_customer_story_events e
  where e.story_id=p_story_id
    and e.event_type in ('recovery_attempt','apology_recovery','service_followup','complaint_followup')
    and (v_story.recovered_at is null or e.event_at>v_story.recovered_at);

  v_episode_start := coalesce(v_recovery_event_start,v_journey_recovery_start);

  select count(distinct js.source_id)::int
  into v_sources
  from public.whatsapp_customer_journeys j
  join public.whatsapp_customer_journey_sessions js on js.journey_id=j.id
  where j.story_id=p_story_id;

  select count(*)::int
  into v_accepted
  from public.whatsapp_customer_story_events e
  where e.story_id=p_story_id
    and e.event_type='recommendation_accepted';

  if v_episode_start is not null then
    v_status := 'recovery';
  elsif v_story.recovered_at is not null then
    v_status := 'recovered';
  elsif v_open_requests>0 or v_open_complaints>0 or v_attempts>0 then
    v_status := 'recovery';
  elsif coalesce(v_last,v_story.last_activity_at)<now()-interval '45 days' then
    v_status := 'dormant';
  else
    v_status := 'active';
  end if;

  update public.whatsapp_customer_stories
  set
    status=v_status,
    risk_level=v_risk,
    open_request_count=v_open_requests,
    open_complaint_count=v_open_complaints,
    accepted_recommendation_count=v_accepted,
    recovery_attempts=v_attempts,
    journey_count=(select count(*)::int from public.whatsapp_customer_journeys where story_id=p_story_id),
    source_count=v_sources,
    last_activity_at=greatest(coalesce(v_last,'epoch'::timestamptz),coalesce(last_activity_at,'epoch'::timestamptz)),
    recovery_started_at=case
      when v_status='recovery' and v_episode_start is not null then v_episode_start
      when v_status='recovery' then coalesce(recovery_started_at,story_started_at,created_at)
      else recovery_started_at
    end,
    updated_at=now()
  where id=p_story_id;
end
$$;

revoke all on function public.dawaa_refresh_whatsapp_customer_story_v16(uuid) from public, anon;
grant execute on function public.dawaa_refresh_whatsapp_customer_story_v16(uuid) to authenticated, service_role;

update public.whatsapp_customer_journeys j
set
  lifecycle_status=case when j.lifecycle_status='recovered' then 'open' else j.lifecycle_status end,
  recovered_at=null,
  recovered_invoice_id=null,
  recovered_invoice_number=null,
  recovered_invoice_value=null,
  updated_at=now()
where (
    j.recovered_at is not null
    or j.recovered_invoice_id is not null
    or j.recovered_invoice_number is not null
    or j.recovered_invoice_value is not null
  )
  and not exists (
    select 1
    from public.whatsapp_customer_cases_v22 c
    where c.story_id=j.story_id
      and c.verified_invoice_id is not null
      and c.verified_invoice_id::text=j.recovered_invoice_id
      and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
      and (
        c.confirmed_outcome='verified_sale'
        or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
      )
  );

do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.whatsapp_customer_stories loop
    perform public.dawaa_refresh_whatsapp_customer_story_v16(v_id);
  end loop;
end
$$;
