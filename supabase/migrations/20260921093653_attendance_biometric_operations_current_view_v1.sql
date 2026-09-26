-- Keep only current operational bridges/devices and current alerts in the command center.
CREATE OR REPLACE FUNCTION public.attendance_biometric_operations_v3()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_now timestamptz:=now();
  v_clients jsonb:='[]'::jsonb;
  v_watermarks jsonb:='[]'::jsonb;
  v_devices jsonb:='[]'::jsonb;
  v_alerts jsonb:='[]'::jsonb;
  v_latest_activity timestamptz;
  v_latest_punch timestamptz;
  v_latest_ingested timestamptz;
  v_latest_watermark timestamptz;
  v_latest_reported timestamptz;
  v_status text;
  v_lag_minutes numeric;
  v_today bigint:=0;
  v_24h bigint:=0;
  v_hour bigint:=0;
  v_mapped bigint:=0;
  v_unmapped bigint:=0;
  v_distinct_staff bigint:=0;
  v_active_clients bigint:=0;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to view biometric operations' using errcode='42501';
  end if;

  select max(coalesce(c.last_success_at,c.last_seen_at,c.last_request_at)),
         count(*) filter(where c.active=true)
  into v_latest_activity,v_active_clients
  from public.biometric_api_clients c;

  select
    max(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)),
    max(b.ingested_at),
    count(*) filter(where (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) at time zone 'Africa/Cairo')::date=(v_now at time zone 'Africa/Cairo')::date),
    count(*) filter(where b.ingested_at>=v_now-interval '24 hours'),
    count(*) filter(where b.ingested_at>=v_now-interval '1 hour'),
    count(*) filter(where b.staff_id is not null and b.ingested_at>=v_now-interval '24 hours'),
    count(*) filter(where b.staff_id is null and b.ingested_at>=v_now-interval '24 hours'),
    count(distinct b.staff_id) filter(where b.staff_id is not null and b.ingested_at>=v_now-interval '24 hours')
  into v_latest_punch,v_latest_ingested,v_today,v_24h,v_hour,v_mapped,v_unmapped,v_distinct_staff
  from public.biometric_attendance_logs b;

  select max(w.complete_through),max(w.reported_at)
  into v_latest_watermark,v_latest_reported
  from public.biometric_sync_watermarks w;

  v_latest_activity:=greatest(v_latest_activity,v_latest_ingested,v_latest_reported);
  v_lag_minutes:=case when v_latest_activity is null then null else greatest(0,extract(epoch from(v_now-v_latest_activity))/60) end;
  v_status:=case
    when v_latest_activity is null then 'never_connected'
    when v_lag_minutes<=10 then 'healthy'
    when v_lag_minutes<=20 then 'delayed'
    when v_lag_minutes<=60 then 'stale'
    else 'offline' end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,
    'name',c.name,
    'provider',c.provider,
    'active',c.active,
    'last_seen_at',c.last_seen_at,
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
    'status',case
      when coalesce(c.active,false)=false then 'disabled'
      when coalesce(c.last_success_at,c.last_seen_at,c.last_request_at) is null then 'never_connected'
      when v_now-coalesce(c.last_success_at,c.last_seen_at,c.last_request_at)<=interval '10 minutes' then 'healthy'
      when v_now-coalesce(c.last_success_at,c.last_seen_at,c.last_request_at)<=interval '20 minutes' then 'delayed'
      else 'offline' end
  ) order by coalesce(c.last_success_at,c.last_seen_at,c.last_request_at) desc nulls last),'[]'::jsonb)
  into v_clients
  from public.biometric_api_clients c
  where c.active=true
     or coalesce(c.last_success_at,c.last_seen_at,c.last_request_at)>=v_now-interval '7 days';

  select coalesce(jsonb_agg(jsonb_build_object(
    'provider',w.provider,
    'complete_through',w.complete_through,
    'reported_at',w.reported_at,
    'metadata',w.metadata,
    'report_age_minutes',case when w.reported_at is null then null else round(extract(epoch from(v_now-w.reported_at))/60,1) end,
    'coverage_lag_minutes',case when w.complete_through is null then null else round(extract(epoch from(v_now-w.complete_through))/60,1) end
  ) order by w.reported_at desc nulls last),'[]'::jsonb)
  into v_watermarks
  from public.biometric_sync_watermarks w;

  select coalesce(jsonb_agg(q.payload order by q.last_ingested_at desc nulls last),'[]'::jsonb)
  into v_devices
  from (
    select
      jsonb_build_object(
        'device_id',coalesce(nullif(b.device_id,''),nullif(b.raw_payload->>'external_device_id',''),nullif(b.raw_payload->>'device_id',''),'غير محدد'),
        'provider',coalesce(b.provider,'غير محدد'),
        'branch',coalesce(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch),'غير محدد'),
        'last_punch_time',max(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)),
        'last_ingested_at',max(b.ingested_at),
        'events_24h',count(*) filter(where b.ingested_at>=v_now-interval '24 hours'),
        'mapped_24h',count(*) filter(where b.staff_id is not null and b.ingested_at>=v_now-interval '24 hours'),
        'unmapped_24h',count(*) filter(where b.staff_id is null and b.ingested_at>=v_now-interval '24 hours'),
        'status',case
          when max(b.ingested_at) is null then 'never_connected'
          when v_now-max(b.ingested_at)<=interval '10 minutes' then 'healthy'
          when v_now-max(b.ingested_at)<=interval '20 minutes' then 'delayed'
          when v_now-max(b.ingested_at)<=interval '60 minutes' then 'stale'
          else 'offline' end
      ) payload,
      max(b.ingested_at) last_ingested_at
    from public.biometric_attendance_logs b
    group by
      coalesce(nullif(b.device_id,''),nullif(b.raw_payload->>'external_device_id',''),nullif(b.raw_payload->>'device_id',''),'غير محدد'),
      coalesce(b.provider,'غير محدد'),
      coalesce(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch),'غير محدد')
    having max(b.ingested_at)>=v_now-interval '7 days'
  ) q;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,
    'detected_at',a.detected_at,
    'last_activity_at',a.last_activity_at,
    'minutes_stale',a.minutes_stale,
    'resolved',a.resolved,
    'severity',a.severity
  ) order by a.resolved asc,a.detected_at desc),'[]'::jsonb)
  into v_alerts
  from (
    select *
    from public.sync_health_alerts
    where sync_name='biometrics'
      and (resolved=false or detected_at>=v_now-interval '2 hours')
    order by resolved asc,detected_at desc
    limit 8
  ) a;

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
    'alerts',v_alerts
  );
end;
$function$

