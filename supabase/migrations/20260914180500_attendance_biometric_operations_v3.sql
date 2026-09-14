create or replace function public.attendance_biometric_operations_v3()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_now timestamptz := now();
  v_clients jsonb := '[]'::jsonb;
  v_watermarks jsonb := '[]'::jsonb;
  v_devices jsonb := '[]'::jsonb;
  v_hourly jsonb := '[]'::jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_latest_activity timestamptz;
  v_latest_punch timestamptz;
  v_latest_ingested timestamptz;
  v_latest_watermark timestamptz;
  v_latest_reported timestamptz;
  v_status text;
  v_lag_minutes numeric;
  v_today bigint := 0;
  v_24h bigint := 0;
  v_hour bigint := 0;
  v_mapped bigint := 0;
  v_unmapped bigint := 0;
  v_distinct_staff bigint := 0;
  v_active_clients bigint := 0;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to view biometric operations';
  end if;

  select max(coalesce(c.last_success_at,c.last_seen_at,c.last_request_at)),
         count(*) filter (where c.active=true)
    into v_latest_activity,v_active_clients
  from public.biometric_api_clients c;

  select max(b.punch_time), max(b.ingested_at),
         count(*) filter (where (b.punch_time at time zone 'Africa/Cairo')::date = (v_now at time zone 'Africa/Cairo')::date),
         count(*) filter (where b.ingested_at >= v_now - interval '24 hours'),
         count(*) filter (where b.ingested_at >= v_now - interval '1 hour'),
         count(*) filter (where b.staff_id is not null and b.ingested_at >= v_now - interval '24 hours'),
         count(*) filter (where b.staff_id is null and b.ingested_at >= v_now - interval '24 hours'),
         count(distinct b.staff_id) filter (where b.staff_id is not null and b.ingested_at >= v_now - interval '24 hours')
    into v_latest_punch,v_latest_ingested,v_today,v_24h,v_hour,v_mapped,v_unmapped,v_distinct_staff
  from public.biometric_attendance_logs b;

  select max(w.complete_through), max(w.reported_at)
    into v_latest_watermark,v_latest_reported
  from public.biometric_sync_watermarks w;

  v_latest_activity := greatest(v_latest_activity,v_latest_ingested,v_latest_reported);
  v_lag_minutes := case when v_latest_activity is null then null else greatest(0,extract(epoch from (v_now-v_latest_activity))/60) end;
  v_status := case
    when v_latest_activity is null then 'never_connected'
    when v_lag_minutes <= 10 then 'healthy'
    when v_lag_minutes <= 20 then 'delayed'
    when v_lag_minutes <= 60 then 'stale'
    else 'offline'
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,
      'name',c.name,
      'provider',c.provider,
      'active',c.active,
      'allowed_branches',c.allowed_branches,
      'last_seen_at',c.last_seen_at,
      'last_request_at',c.last_request_at,
      'last_success_at',c.last_success_at,
      'last_error_at',c.last_error_at,
      'last_error_code',c.last_error_code,
      'last_error_message',c.last_error_message,
      'last_http_status',c.last_http_status,
      'total_requests',c.total_requests,
      'total_received',c.total_received,
      'total_accepted',c.total_accepted,
      'total_duplicates',c.total_duplicates,
      'total_rejected',c.total_rejected,
      'age_minutes',case when coalesce(c.last_success_at,c.last_seen_at,c.last_request_at) is null then null else round(extract(epoch from (v_now-coalesce(c.last_success_at,c.last_seen_at,c.last_request_at)))/60,1) end,
      'status',case
        when coalesce(c.active,false)=false then 'disabled'
        when coalesce(c.last_success_at,c.last_seen_at,c.last_request_at) is null then 'never_connected'
        when v_now-coalesce(c.last_success_at,c.last_seen_at,c.last_request_at) <= interval '10 minutes' then 'healthy'
        when v_now-coalesce(c.last_success_at,c.last_seen_at,c.last_request_at) <= interval '20 minutes' then 'delayed'
        else 'offline' end
    ) order by coalesce(c.last_success_at,c.last_seen_at,c.last_request_at) desc nulls last),'[]'::jsonb)
    into v_clients
  from public.biometric_api_clients c;

  select coalesce(jsonb_agg(jsonb_build_object(
      'provider',w.provider,
      'scope_key',w.scope_key,
      'complete_through',w.complete_through,
      'reported_at',w.reported_at,
      'client_id',w.client_id,
      'metadata',w.metadata,
      'report_age_minutes',case when w.reported_at is null then null else round(extract(epoch from (v_now-w.reported_at))/60,1) end,
      'coverage_lag_minutes',case when w.complete_through is null then null else round(extract(epoch from (v_now-w.complete_through))/60,1) end
    ) order by w.reported_at desc nulls last),'[]'::jsonb)
    into v_watermarks
  from public.biometric_sync_watermarks w;

  select coalesce(jsonb_agg(x order by x.last_ingested_at desc nulls last),'[]'::jsonb)
    into v_devices
  from (
    select jsonb_build_object(
      'device_id',coalesce(b.device_id,'غير محدد'),
      'provider',coalesce(b.provider,'غير محدد'),
      'branch',coalesce(nullif(trim(b.branch),''),'غير محدد'),
      'last_punch_time',max(b.punch_time),
      'last_ingested_at',max(b.ingested_at),
      'events_24h',count(*) filter(where b.ingested_at >= v_now-interval '24 hours'),
      'mapped_24h',count(*) filter(where b.staff_id is not null and b.ingested_at >= v_now-interval '24 hours'),
      'unmapped_24h',count(*) filter(where b.staff_id is null and b.ingested_at >= v_now-interval '24 hours'),
      'status',case
        when max(b.ingested_at) is null then 'never_connected'
        when v_now-max(b.ingested_at) <= interval '10 minutes' then 'healthy'
        when v_now-max(b.ingested_at) <= interval '20 minutes' then 'delayed'
        when v_now-max(b.ingested_at) <= interval '60 minutes' then 'stale'
        else 'offline' end
    ) as x,
    max(b.ingested_at) as last_ingested_at
    from public.biometric_attendance_logs b
    group by coalesce(b.device_id,'غير محدد'),coalesce(b.provider,'غير محدد'),coalesce(nullif(trim(b.branch),''),'غير محدد')
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object('hour',h,'events',events,'mapped',mapped,'unmapped',unmapped) order by h),'[]'::jsonb)
    into v_hourly
  from (
    select date_trunc('hour',b.ingested_at) h,
           count(*) events,
           count(*) filter(where b.staff_id is not null) mapped,
           count(*) filter(where b.staff_id is null) unmapped
    from public.biometric_attendance_logs b
    where b.ingested_at >= v_now-interval '12 hours'
    group by 1
  ) z;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'detected_at',a.detected_at,'last_activity_at',a.last_activity_at,
      'minutes_stale',a.minutes_stale,'resolved',a.resolved,'severity',a.severity,'details',a.details
    ) order by a.resolved asc,a.detected_at desc),'[]'::jsonb)
    into v_alerts
  from public.sync_health_alerts a
  where a.sync_name='biometrics'
  limit 20;

  return jsonb_build_object(
    'checked_at',v_now,
    'status',v_status,
    'lag_minutes',case when v_lag_minutes is null then null else round(v_lag_minutes,1) end,
    'latest_activity_at',v_latest_activity,
    'latest_punch_time',v_latest_punch,
    'latest_ingested_at',v_latest_ingested,
    'latest_complete_through',v_latest_watermark,
    'latest_reported_at',v_latest_reported,
    'events_today',coalesce(v_today,0),
    'events_24h',coalesce(v_24h,0),
    'events_last_hour',coalesce(v_hour,0),
    'mapped_24h',coalesce(v_mapped,0),
    'unmapped_24h',coalesce(v_unmapped,0),
    'distinct_staff_24h',coalesce(v_distinct_staff,0),
    'active_clients',coalesce(v_active_clients,0),
    'clients',v_clients,
    'watermarks',v_watermarks,
    'devices',v_devices,
    'hourly_activity',v_hourly,
    'alerts',v_alerts
  );
end;
$$;

revoke all on function public.attendance_biometric_operations_v3() from public;
grant execute on function public.attendance_biometric_operations_v3() to authenticated,service_role;
notify pgrst,'reload schema';