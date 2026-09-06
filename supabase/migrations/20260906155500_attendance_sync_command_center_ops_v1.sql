create or replace function public.list_biometric_event_log_v1(
  p_branch text default null,
  p_mapping_status text default null,
  p_search text default '',
  p_limit integer default 100,
  p_offset integer default 0
)
returns table(
  id uuid,
  provider text,
  external_event_id text,
  biometric_user_id text,
  staff_id uuid,
  staff_name text,
  branch text,
  punch_time timestamptz,
  punch_type text,
  ingested_at timestamptz,
  ingestion_lag_seconds integer,
  mapping_status text,
  device_id uuid,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
declare
  v_branch text := nullif(trim(coalesce(p_branch,'')),'');
  v_status text := lower(nullif(trim(coalesce(p_mapping_status,'')),''));
  v_search text := trim(coalesce(p_search,''));
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='not authorized to view biometric operations';
  end if;

  return query
  select
    b.id,
    b.provider,
    b.external_event_id,
    b.biometric_user_id,
    b.staff_id,
    coalesce(nullif(trim(s.name),''),nullif(trim(b.staff_name_snapshot),''),'غير مربوط') as staff_name,
    coalesce(nullif(trim(b.branch),''),nullif(trim(s.branch),'')) as branch,
    public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) as punch_time,
    b.punch_type,
    b.ingested_at,
    case
      when b.ingested_at is null or public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) is null then null
      else greatest(0, extract(epoch from (b.ingested_at-public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)))::int)
    end as ingestion_lag_seconds,
    case when b.staff_id is null then 'unmapped' else 'mapped' end as mapping_status,
    b.device_id,
    count(*) over() as total_count
  from public.biometric_attendance_logs b
  left join public.staff s on s.id=b.staff_id
  where (v_branch is null or public.dawaa_normalize_branch(coalesce(b.branch,s.branch))=public.dawaa_normalize_branch(v_branch))
    and (v_status is null or (v_status='mapped' and b.staff_id is not null) or (v_status='unmapped' and b.staff_id is null))
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
$$;

revoke all on function public.list_biometric_event_log_v1(text,text,text,integer,integer) from public;
grant execute on function public.list_biometric_event_log_v1(text,text,text,integer,integer) to anon,authenticated,service_role;

create or replace function public.list_sync_health_alerts_v1(p_limit integer default 20)
returns table(
  id uuid,
  detected_at timestamptz,
  sync_name text,
  last_activity_at timestamptz,
  minutes_stale numeric,
  severity text,
  resolved boolean,
  resolved_at timestamptz,
  details jsonb
)
language plpgsql
stable
security definer
set search_path=public,pg_catalog
as $$
begin
  if not public.dawaa_can_manage_biometric_mapping_v1() then
    raise exception using errcode='42501', message='not authorized to view sync alerts';
  end if;

  return query
  select a.id,a.detected_at,a.sync_name,a.last_activity_at,a.minutes_stale,a.severity,a.resolved,a.resolved_at,a.details
  from public.sync_health_alerts a
  order by a.resolved asc,a.detected_at desc
  limit greatest(1,least(coalesce(p_limit,20),100));
end;
$$;

revoke all on function public.list_sync_health_alerts_v1(integer) from public;
grant execute on function public.list_sync_health_alerts_v1(integer) to anon,authenticated,service_role;

create index if not exists idx_biometric_attendance_logs_ingested_desc on public.biometric_attendance_logs(ingested_at desc);
create index if not exists idx_biometric_attendance_logs_branch_ingested_desc on public.biometric_attendance_logs(branch,ingested_at desc);
create index if not exists idx_sync_health_alerts_open_detected_desc on public.sync_health_alerts(resolved,detected_at desc);

notify pgrst,'reload schema';
