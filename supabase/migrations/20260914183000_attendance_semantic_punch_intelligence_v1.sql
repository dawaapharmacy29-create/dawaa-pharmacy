-- Smart biometric semantics: keep every raw event, but only promote one reliable semantic punch.

create table if not exists public.biometric_semantic_decisions (
  biometric_log_id uuid primary key references public.biometric_attendance_logs(id) on delete cascade,
  staff_id uuid,
  raw_type text,
  semantic_type text,
  decision text not null,
  confidence numeric,
  reason text,
  schedule_date date,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  duplicate_of_log_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.biometric_semantic_decisions enable row level security;

create or replace function public.dawaa_biometric_semantic_decision_v1(
  p_staff_id uuid,
  p_event_time timestamptz,
  p_raw_type text,
  p_biometric_log_id uuid default null
) returns jsonb
language plpgsql stable security definer
set search_path=public,pg_catalog
as $$
declare
  v_event_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_sched_date date;
  v_raw text:=case lower(trim(coalesce(p_raw_type,''))) when 'check_in' then 'check_in' when 'in' then 'check_in' when 'check_out' then 'check_out' when 'out' then 'check_out' else null end;
  v_type text; v_reason text; v_conf numeric:=0.50; v_dup uuid; v_mid timestamptz;
begin
  if p_staff_id is null or p_event_time is null then
    return jsonb_build_object('decision','review','semantic_type',v_raw,'confidence',0.20,'reason','missing_staff_or_time');
  end if;

  select l.biometric_source_log_id into v_dup
  from public.staff_attendance_logs l
  where l.staff_id=p_staff_id and l.biometric_method='fingerprint_terminal' and l.status='accepted'
    and l.biometric_source_log_id is not null
    and (l.recorded_at < p_event_time or (l.recorded_at=p_event_time and p_biometric_log_id is not null and l.biometric_source_log_id::text < p_biometric_log_id::text))
    and p_event_time-l.recorded_at between interval '0 seconds' and interval '120 seconds'
  order by l.recorded_at desc,l.id desc limit 1;
  if v_dup is not null then
    return jsonb_build_object('decision','duplicate','semantic_type',null,'confidence',0.99,'reason','same_employee_within_120_seconds','duplicate_of_log_id',v_dup);
  end if;

  v_event_date:=(p_event_time at time zone 'Africa/Cairo')::date;
  with candidate_dates as (select v_event_date d union all select v_event_date-1), schedules as (
    select d.d schedule_date, ss.*,
      case when trim(coalesce(ss.shift_start,''))~'^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then trim(ss.shift_start)::time else ss.start_time end st,
      case when trim(coalesce(ss.shift_end,''))~'^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then trim(ss.shift_end)::time else ss.end_time end et
    from candidate_dates d
    join lateral (
      select x.* from public.shift_schedules x
      where x.staff_id=p_staff_id and (coalesce(x.shift_date,x.date)=d.d or (x.shift_date is null and x.date is null and trim(coalesce(x.day_name,''))=case extract(dow from d.d)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end))
      order by (coalesce(x.shift_date,x.date)=d.d) desc,coalesce(x.updated_at,x.created_at) desc nulls last,x.id desc limit 1
    ) ss on true
  ), windows as (
    select schedule_date,(schedule_date::timestamp+st) at time zone 'Africa/Cairo' s_at,
      (((schedule_date + case when et<=st then 1 else 0 end)::timestamp+et) at time zone 'Africa/Cairo') e_at
    from schedules where st is not null and et is not null and not coalesce(is_off,false) and not coalesce(is_day_off,false)
  )
  select schedule_date,s_at,e_at into v_sched_date,v_start,v_end from windows
  where p_event_time between s_at-interval '4 hours' and e_at+interval '6 hours'
  order by least(abs(extract(epoch from (p_event_time-s_at))),abs(extract(epoch from (p_event_time-e_at)))) limit 1;

  if v_start is null or v_end is null then
    return jsonb_build_object('decision',case when v_raw is null then 'review' else 'accepted' end,'semantic_type',v_raw,'confidence',case when v_raw is null then 0.20 else 0.45 end,'reason','no_matching_schedule_fallback_to_raw');
  end if;

  v_mid:=v_start+((v_end-v_start)/2);
  if p_event_time <= v_start+interval '4 hours' then v_type:='check_in'; v_reason:='schedule_start_window'; v_conf:=0.96;
  elsif p_event_time >= v_end-interval '4 hours' then v_type:='check_out'; v_reason:='schedule_end_window'; v_conf:=0.96;
  elsif p_event_time < v_mid then v_type:='check_in'; v_reason:='closer_to_shift_start'; v_conf:=0.82;
  else v_type:='check_out'; v_reason:='closer_to_shift_end'; v_conf:=0.82; end if;

  return jsonb_build_object('decision','accepted','semantic_type',v_type,'confidence',v_conf,'reason',v_reason,'schedule_date',v_sched_date,'scheduled_start_at',v_start,'scheduled_end_at',v_end,'raw_type',v_raw);
end;
$$;

create or replace function public.attendance_sync_complete_through_v1(p_provider text default null)
returns timestamptz language sql stable security definer set search_path=public,pg_catalog as $$
  select max(w.complete_through) from public.biometric_sync_watermarks w
  where p_provider is null or w.provider=p_provider or (p_provider='fingerprint_vendor_primary' and w.provider like 'zk_%_direct_bridge');
$$;

grant execute on function public.dawaa_biometric_semantic_decision_v1(uuid,timestamptz,text,uuid) to authenticated,service_role;
grant execute on function public.attendance_sync_complete_through_v1(text) to anon,authenticated,service_role;
notify pgrst,'reload schema';