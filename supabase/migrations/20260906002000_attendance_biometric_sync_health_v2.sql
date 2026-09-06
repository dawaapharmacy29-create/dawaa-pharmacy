create index if not exists idx_biometric_attendance_logs_ingested_at_desc on public.biometric_attendance_logs (ingested_at desc);
create index if not exists idx_biometric_attendance_logs_provider_ingested_at_desc on public.biometric_attendance_logs (provider, ingested_at desc);
create index if not exists idx_biometric_attendance_logs_staff_id_ingested_at_desc on public.biometric_attendance_logs (staff_id, ingested_at desc);

create or replace function public.attendance_sync_health_v2()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_last_ingested timestamptz;
  v_last_punch timestamptz;
  v_last_client_seen timestamptz;
  v_watermark timestamptz;
  v_now timestamptz := now();
  v_raw bigint := 0;
  v_mapped bigint := 0;
  v_unmapped bigint := 0;
  v_24h bigint := 0;
  v_1h bigint := 0;
  v_7d bigint := 0;
  v_unmapped_24h bigint := 0;
  v_provider_count bigint := 0;
  v_active_clients bigint := 0;
  v_lag_minutes numeric;
  v_watermark_lag numeric;
  v_status text;
  v_branch_breakdown jsonb := '[]'::jsonb;
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception 'not authorized to view biometric sync health';
  end if;

  select count(*),
         count(*) filter (where b.staff_id is not null),
         count(*) filter (where b.staff_id is null),
         max(b.ingested_at),
         max(public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)),
         count(*) filter (where b.ingested_at >= v_now - interval '24 hours'),
         count(*) filter (where b.ingested_at >= v_now - interval '1 hour'),
         count(*) filter (where b.ingested_at >= v_now - interval '7 days'),
         count(*) filter (where b.staff_id is null and b.ingested_at >= v_now - interval '24 hours'),
         count(distinct b.provider)
    into v_raw,v_mapped,v_unmapped,v_last_ingested,v_last_punch,v_24h,v_1h,v_7d,v_unmapped_24h,v_provider_count
  from public.biometric_attendance_logs b;

  select max(c.last_seen_at), count(*) filter (where c.active = true)
    into v_last_client_seen, v_active_clients
  from public.biometric_api_clients c;

  select max(w.complete_through)
    into v_watermark
  from public.biometric_sync_watermarks w;

  v_lag_minutes := case when coalesce(v_last_client_seen,v_last_ingested) is null then null else extract(epoch from (v_now - coalesce(v_last_client_seen,v_last_ingested))) / 60 end;
  v_watermark_lag := case when v_watermark is null then null else extract(epoch from (v_now - v_watermark)) / 60 end;
  v_status := case
    when coalesce(v_last_client_seen,v_last_ingested) is null then 'never_connected'
    when v_lag_minutes <= 5 then 'healthy'
    when v_lag_minutes <= 30 then 'delayed'
    when v_lag_minutes <= 180 then 'stale'
    else 'offline'
  end;

  select coalesce(jsonb_agg(x order by x->>'branch'),'[]'::jsonb)
    into v_branch_breakdown
  from (
    select jsonb_build_object(
      'branch', coalesce(nullif(trim(b.branch),''),'غير محدد'),
      'events', count(*),
      'mapped', count(*) filter (where b.staff_id is not null),
      'unmapped', count(*) filter (where b.staff_id is null),
      'last_ingested_at', max(b.ingested_at)
    ) as x
    from public.biometric_attendance_logs b
    where b.ingested_at >= v_now - interval '7 days'
    group by coalesce(nullif(trim(b.branch),''),'غير محدد')
  ) s;

  return jsonb_build_object(
    'raw_events',coalesce(v_raw,0),
    'mapped_events',coalesce(v_mapped,0),
    'unmapped_events',coalesce(v_unmapped,0),
    'mapped_ratio',case when coalesce(v_raw,0)=0 then 0 else round((v_mapped::numeric/v_raw::numeric)*100,1) end,
    'last_ingested_at',v_last_ingested,
    'last_punch_time',v_last_punch,
    'events_last_24h',coalesce(v_24h,0),
    'events_last_hour',coalesce(v_1h,0),
    'events_last_7d',coalesce(v_7d,0),
    'unmapped_last_24h',coalesce(v_unmapped_24h,0),
    'provider_count',coalesce(v_provider_count,0),
    'active_clients',coalesce(v_active_clients,0),
    'client_last_seen_at',v_last_client_seen,
    'sync_lag_minutes',case when v_lag_minutes is null then null else round(v_lag_minutes,1) end,
    'sync_status',v_status,
    'watermark_complete_through',v_watermark,
    'watermark_lag_minutes',case when v_watermark_lag is null then null else round(v_watermark_lag,1) end,
    'branch_breakdown',v_branch_breakdown,
    'checked_at',v_now
  );
end;
$$;

grant execute on function public.attendance_sync_health_v2() to anon, authenticated;
notify pgrst, 'reload schema';
