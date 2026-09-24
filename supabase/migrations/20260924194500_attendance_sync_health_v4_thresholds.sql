-- Attendance sync health V4: separate bridge liveness from punch watermark freshness.
-- A branch is not "delayed" merely because nobody has punched recently.
-- Connection status is based on provider-specific API heartbeat; watermark lag is reported separately.

create or replace function public.attendance_sync_health_v4(p_start date,p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
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
    select count(*) raw_events,
           count(*) filter(where staff_id is not null) mapped_events,
           count(*) filter(where staff_id is null) unmapped_events,
           count(distinct biometric_user_id) filter(where staff_id is null) unmapped_codes,
           max(ingested_at) last_ingested_at,
           max(public.dawaa_fingerprint_effective_time_v1(provider,raw_payload,punch_time)) last_punch_time
    from scoped_logs
  ),
  recent_stats as (
    select count(*) filter(where ingested_at>=v_now-interval '24 hours') events_24h,
           count(*) filter(where staff_id is null and ingested_at>=v_now-interval '24 hours') unmapped_24h,
           count(*) filter(where ingested_at>=v_now-interval '1 hour') events_1h,
           count(*) filter(where ingested_at>=v_now-interval '7 days') events_7d,
           max(ingested_at) last_ingested_at,
           max(public.dawaa_fingerprint_effective_time_v1(provider,raw_payload,punch_time)) last_punch_time
    from public.biometric_attendance_logs
  ),
  history_stats as (
    select count(*) raw_events,
           count(*) filter(where staff_id is not null) mapped_events,
           count(*) filter(where staff_id is null) unmapped_events
    from public.biometric_attendance_logs
    where (public.dawaa_fingerprint_effective_time_v1(provider,raw_payload,punch_time)
           at time zone 'Africa/Cairo')::date<p_start
  ),
  branch_expected as (
    select * from (values
      ('فرع الشامي'::text,'zk_shami_direct_bridge'::text),
      ('فرع شكري'::text,'zk_shokry_direct_bridge'::text)
    ) v(branch,provider)
  ),
  branch_events as (
    select coalesce(nullif(trim(public.dawaa_biometric_source_branch_v1(raw_payload,branch)),''),'غير محدد') branch,
           count(*) events,
           count(*) filter(where staff_id is not null) mapped,
           count(*) filter(where staff_id is null) unmapped,
           max(ingested_at) last_ingested_at,
           max(public.dawaa_fingerprint_effective_time_v1(provider,raw_payload,punch_time)) last_punch_time
    from scoped_logs
    group by 1
  ),
  branch_watermarks as (
    select e.branch,e.provider,
           max(w.complete_through) complete_through,
           max(w.reported_at) reported_at
    from branch_expected e
    left join public.biometric_sync_watermarks w on w.provider=e.provider
    group by e.branch,e.provider
  ),
  branch_clients as (
    select e.branch,e.provider,
           max(c.last_seen_at) last_seen_at,
           max(c.last_request_at) last_request_at,
           max(c.last_success_at) last_success_at,
           count(*) filter(where c.active) active_clients
    from branch_expected e
    left join public.biometric_api_clients c on c.provider=e.provider
    group by e.branch,e.provider
  ),
  branch_data as (
    select jsonb_agg(jsonb_build_object(
      'branch',e.branch,
      'provider',e.provider,
      'events',coalesce(be.events,0),
      'mapped',coalesce(be.mapped,0),
      'unmapped',coalesce(be.unmapped,0),
      'mapped_ratio',case when coalesce(be.events,0)=0 then 0
                          else round(coalesce(be.mapped,0)::numeric*100/be.events,1) end,
      'last_ingested_at',be.last_ingested_at,
      'last_punch_time',be.last_punch_time,
      'client_last_seen_at',bc.last_seen_at,
      'endpoint_last_request_at',bc.last_request_at,
      'endpoint_last_success_at',bc.last_success_at,
      'active_clients',coalesce(bc.active_clients,0),
      'watermark_complete_through',bw.complete_through,
      'watermark_reported_at',bw.reported_at,
      'watermark_lag_minutes',case when bw.complete_through is null then null
         else greatest(0,round(extract(epoch from (v_now-bw.complete_through))/60.0)::int) end,
      'connection_status',case
        when coalesce(bc.last_success_at,bc.last_seen_at) is null then 'never_connected'
        when coalesce(bc.last_success_at,bc.last_seen_at) >=v_now-interval '20 minutes' then 'healthy'
        when coalesce(bc.last_success_at,bc.last_seen_at) >=v_now-interval '45 minutes' then 'delayed'
        when coalesce(bc.last_success_at,bc.last_seen_at) >=v_now-interval '3 hours' then 'stale'
        else 'offline' end,
      'data_status',case
        when bw.complete_through is null then 'unknown'
        when bw.reported_at>=v_now-interval '20 minutes' then 'current_report'
        when coalesce(bc.last_success_at,bc.last_seen_at) >=v_now-interval '20 minutes' then 'bridge_live_no_new_watermark'
        else 'watermark_stale' end
    ) order by e.branch) value
    from branch_expected e
    left join branch_events be on be.branch=e.branch
    left join branch_watermarks bw on bw.branch=e.branch
    left join branch_clients bc on bc.branch=e.branch
  ),
  global_client as (
    select max(last_seen_at) client_last_seen_at,
           max(last_request_at) endpoint_last_request_at,
           max(last_success_at) endpoint_last_success_at,
           count(*) filter(where active) active_clients
    from public.biometric_api_clients
    where provider in ('zk_shami_direct_bridge','zk_shokry_direct_bridge')
  ),
  global_watermark as (
    select max(complete_through) complete_through,max(reported_at) reported_at
    from public.biometric_sync_watermarks
    where provider in ('zk_shami_direct_bridge','zk_shokry_direct_bridge')
  )
  select jsonb_build_object(
    'range_start',p_start,'range_end',p_end,
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
    'client_last_seen_at',gc.client_last_seen_at,
    'endpoint_last_request_at',gc.endpoint_last_request_at,
    'endpoint_last_success_at',gc.endpoint_last_success_at,
    'active_clients',coalesce(gc.active_clients,0),
    'watermark_complete_through',gw.complete_through,
    'watermark_reported_at',gw.reported_at,
    'branch_breakdown',bd.value,
    'checked_at',v_now,
    'sync_status',case
      when coalesce(gc.endpoint_last_success_at,gc.client_last_seen_at) is null then 'never_connected'
      when coalesce(gc.endpoint_last_success_at,gc.client_last_seen_at) >=v_now-interval '20 minutes' then 'healthy'
      when coalesce(gc.endpoint_last_success_at,gc.client_last_seen_at) >=v_now-interval '45 minutes' then 'delayed'
      when coalesce(gc.endpoint_last_success_at,gc.client_last_seen_at) >=v_now-interval '3 hours' then 'stale'
      else 'offline' end
  ) into v_payload
  from cycle_stats cs cross join history_stats hs cross join recent_stats rs
  cross join global_client gc cross join global_watermark gw cross join branch_data bd;

  return v_payload;
end;
$$;

revoke execute on function public.attendance_sync_health_v4(date,date) from public;
grant execute on function public.attendance_sync_health_v4(date,date) to anon,authenticated,service_role;
