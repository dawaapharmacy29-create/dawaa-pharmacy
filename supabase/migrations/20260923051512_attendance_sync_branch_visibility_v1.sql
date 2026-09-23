CREATE OR REPLACE FUNCTION public.attendance_sync_health_v3(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_now timestamptz:=now();
  v_payload jsonb;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to view biometric sync health' using errcode='42501';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_sync_health_range' using errcode='22023';
  end if;

  with scoped_logs as (
    select *
    from public.biometric_attendance_logs b
    where (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
           at time zone 'Africa/Cairo')::date between p_start and p_end
  ),
  cycle_stats as (
    select
      count(*) raw_events,
      count(*) filter(where staff_id is not null) mapped_events,
      count(*) filter(where staff_id is null) unmapped_events,
      count(distinct biometric_user_id) filter(where staff_id is null) unmapped_codes,
      max(ingested_at) last_ingested_at,
      max(public.dawaa_fingerprint_effective_time_v1(provider,raw_payload,punch_time)) last_punch_time
    from scoped_logs
  ),
  history_stats as (
    select
      count(*) raw_events,
      count(*) filter(where staff_id is not null) mapped_events,
      count(*) filter(where staff_id is null) unmapped_events
    from public.biometric_attendance_logs
    where (public.dawaa_fingerprint_effective_time_v1(provider,raw_payload,punch_time)
           at time zone 'Africa/Cairo')::date < p_start
  ),
  recent_stats as (
    select
      count(*) filter(where ingested_at>=v_now-interval '24 hours') events_24h,
      count(*) filter(where staff_id is null and ingested_at>=v_now-interval '24 hours') unmapped_24h,
      count(*) filter(where ingested_at>=v_now-interval '1 hour') events_1h,
      count(*) filter(where ingested_at>=v_now-interval '7 days') events_7d,
      max(ingested_at) last_ingested_at,
      max(public.dawaa_fingerprint_effective_time_v1(provider,raw_payload,punch_time)) last_punch_time
    from public.biometric_attendance_logs
  ),
  client_stats as (
    select max(last_seen_at) client_last_seen_at,
      max(last_request_at) endpoint_last_request_at,
      max(last_success_at) endpoint_last_success_at,
      count(*) filter(where active) active_clients
    from public.biometric_api_clients
  ),
  watermark as (
    select max(complete_through) complete_through,max(reported_at) reported_at
    from public.biometric_sync_watermarks
  ),
  branch_watermarks as (
    select expected.branch,w.complete_through,w.reported_at
    from (values ('فرع الشامي'::text,'zk_shami_direct_bridge'::text),
      ('فرع شكري'::text,'zk_shokry_direct_bridge'::text)) expected(branch,provider)
    left join lateral (
      select max(complete_through) complete_through,max(reported_at) reported_at
      from public.biometric_sync_watermarks where provider=expected.provider
    ) w on true
  ),
  branch_events as (
    select coalesce(nullif(trim(public.dawaa_biometric_source_branch_v1(raw_payload,branch)),''),'غير محدد') branch,
      count(*) events,count(*) filter(where staff_id is not null) mapped,
      count(*) filter(where staff_id is null) unmapped,max(ingested_at) last_ingested_at
    from scoped_logs group by 1
  ),
  branch_data as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'branch',coalesce(bw.branch,x.branch),'events',coalesce(x.events,0),
      'mapped',coalesce(x.mapped,0),'unmapped',coalesce(x.unmapped,0),
      'last_ingested_at',x.last_ingested_at,
      'watermark_complete_through',bw.complete_through,'watermark_reported_at',bw.reported_at,
      'branch_sync_status',case
        when bw.reported_at is null then 'offline'
        when v_now-bw.reported_at<=interval '15 minutes' then 'healthy'
        when v_now-bw.reported_at<=interval '2 hours' then 'delayed'
        when v_now-bw.reported_at<=interval '24 hours' then 'stale'
        else 'offline' end
    ) order by coalesce(bw.branch,x.branch)),'[]'::jsonb) value
    from branch_watermarks bw full join branch_events x on x.branch=bw.branch
  )
  select jsonb_build_object(
    'range_start',p_start,
    'range_end',p_end,
    'raw_events',coalesce(cs.raw_events,0),
    'mapped_events',coalesce(cs.mapped_events,0),
    'unmapped_events',coalesce(cs.unmapped_events,0),
    'unmapped_codes',coalesce(cs.unmapped_codes,0),
    'mapped_ratio',case when coalesce(cs.raw_events,0)=0 then 0 else round(cs.mapped_events::numeric*100/cs.raw_events,1) end,
    'historical_raw_events',coalesce(hs.raw_events,0),
    'historical_mapped_events',coalesce(hs.mapped_events,0),
    'historical_unmapped_events',coalesce(hs.unmapped_events,0),
    'events_last_24h',coalesce(rs.events_24h,0),
    'unmapped_last_24h',coalesce(rs.unmapped_24h,0),
    'events_last_hour',coalesce(rs.events_1h,0),
    'events_last_7d',coalesce(rs.events_7d,0),
    'last_ingested_at',rs.last_ingested_at,
    'last_punch_time',rs.last_punch_time,
    'client_last_seen_at',cl.client_last_seen_at,
    'endpoint_last_request_at',cl.endpoint_last_request_at,
    'endpoint_last_success_at',cl.endpoint_last_success_at,
    'active_clients',coalesce(cl.active_clients,0),
    'watermark_complete_through',w.complete_through,
    'watermark_reported_at',w.reported_at,
    'branch_breakdown',bd.value,
    'checked_at',v_now,
    'sync_status',case
      when coalesce(cl.endpoint_last_success_at,cl.client_last_seen_at,rs.last_ingested_at) is null then 'never_connected'
      when coalesce(cl.endpoint_last_success_at,cl.client_last_seen_at,rs.last_ingested_at)>=v_now-interval '5 minutes' then 'healthy'
      when coalesce(cl.endpoint_last_success_at,cl.client_last_seen_at,rs.last_ingested_at)>=v_now-interval '30 minutes' then 'delayed'
      when coalesce(cl.endpoint_last_success_at,cl.client_last_seen_at,rs.last_ingested_at)>=v_now-interval '3 hours' then 'stale'
      else 'offline' end
  ) into v_payload
  from cycle_stats cs cross join history_stats hs cross join recent_stats rs cross join client_stats cl
  cross join watermark w cross join branch_data bd;

  return v_payload;
end;
$function$;
