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
    select 'فرع الشامي'::text branch, complete_through, reported_at from public.biometric_sync_watermarks where provider='zk_shami_direct_bridge'
    union all
    select 'فرع شكري'::text branch, complete_through, reported_at from public.biometric_sync_watermarks where provider='zk_shokry_direct_bridge'
  ),
  branch_data as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'branch',x.branch,
      'events',x.events,
      'mapped',x.mapped,
      'unmapped',x.unmapped,
      'last_ingested_at',x.last_ingested_at,
      'watermark_complete_through',bw.complete_through,
      'watermark_reported_at',bw.reported_at,
      'branch_sync_status',case
        when bw.reported_at is null then 'offline'
        when v_now-bw.reported_at<=interval '15 minutes' then 'healthy'
        when v_now-bw.reported_at<=interval '2 hours' then 'delayed'
        when v_now-bw.reported_at<=interval '24 hours' then 'stale'
        else 'offline' end
    ) order by x.branch),'[]'::jsonb) value
    from (
      select
        coalesce(nullif(trim(public.dawaa_biometric_source_branch_v1(raw_payload,branch)),''),'غير محدد') branch,
        count(*) events,
        count(*) filter(where staff_id is not null) mapped,
        count(*) filter(where staff_id is null) unmapped,
        max(ingested_at) last_ingested_at
      from scoped_logs
      group by 1
    ) x
    left join branch_watermarks bw on bw.branch=x.branch
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
$function$


CREATE OR REPLACE FUNCTION public.list_biometric_event_log_v2(p_start date, p_end date, p_branch text DEFAULT NULL::text, p_mapping_status text DEFAULT NULL::text, p_search text DEFAULT ''::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, provider text, external_event_id text, biometric_user_id text, staff_id uuid, staff_name text, branch text, punch_time timestamp with time zone, punch_type text, ingested_at timestamp with time zone, ingestion_lag_seconds integer, mapping_status text, device_id text, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_branch text:=nullif(trim(coalesce(p_branch,'')),'');
  v_status text:=lower(nullif(trim(coalesce(p_mapping_status,'')),''));
  v_search text:=trim(coalesce(p_search,''));
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501',message='not authorized to view biometric operations';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_biometric_event_range' using errcode='22023';
  end if;

  return query
  select
    b.id,
    b.provider,
    b.external_event_id,
    b.biometric_user_id,
    b.staff_id,
    coalesce(nullif(trim(s.name),''),nullif(trim(b.staff_name_snapshot),''),'غير مربوط'),
    public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch),
    public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time),
    b.punch_type,
    b.ingested_at,
    case
      when b.ingested_at is null then null
      else greatest(0,extract(epoch from(
        b.ingested_at-public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
      ))::int)
    end,
    case when b.staff_id is null then 'unmapped' else 'mapped' end,
    b.device_id::text,
    count(*) over()
  from public.biometric_attendance_logs b
  left join public.staff s on s.id=b.staff_id
  where (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
          at time zone 'Africa/Cairo')::date between p_start and p_end
    and (v_branch is null or trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))=v_branch)
    and (
      v_status is null
      or (v_status='mapped' and b.staff_id is not null)
      or (v_status='unmapped' and b.staff_id is null)
    )
    and (
      v_search=''
      or coalesce(b.biometric_user_id,'') ilike '%'||v_search||'%'
      or coalesce(b.staff_name_snapshot,'') ilike '%'||v_search||'%'
      or coalesce(s.name,'') ilike '%'||v_search||'%'
      or coalesce(b.external_event_id,'') ilike '%'||v_search||'%'
    )
  order by b.ingested_at desc nulls last,b.id desc
  limit greatest(1,least(coalesce(p_limit,100),200))
  offset greatest(0,coalesce(p_offset,0));
end;
$function$


grant execute on function public.attendance_sync_health_v3(date,date) to anon,authenticated,service_role;
grant execute on function public.list_biometric_event_log_v2(date,date,text,text,text,integer,integer) to anon,authenticated,service_role;
