-- Attendance schedule versioning + overtime reconciliation v3
-- Keeps historical weekly schedules intact and makes attendance/overtime resolve the schedule that was effective on the work date.

alter table public.shift_schedules
  add column if not exists effective_from date,
  add column if not exists effective_to date;

update public.shift_schedules
set effective_from = date '1900-01-01'
where effective_from is null;

alter table public.shift_schedules
  alter column effective_from set default date '1900-01-01',
  alter column effective_from set not null;

alter table public.shift_schedules
  drop constraint if exists shift_schedules_effective_range_chk;
alter table public.shift_schedules
  add constraint shift_schedules_effective_range_chk
  check (effective_to is null or effective_to >= effective_from);

drop index if exists public.uq_shift_schedules_staff_day;
create unique index if not exists uq_shift_schedules_staff_day_version
  on public.shift_schedules(staff_id, day_name, effective_from)
  where staff_id is not null and day_name is not null and shift_date is null and date is null;

create index if not exists idx_shift_schedules_staff_effective
  on public.shift_schedules(staff_id, effective_from, effective_to);

-- Preserve Yusuf Maher's old schedule through Sep 17, then start the new 16:00 -> 02:00 schedule on Sep 18.
with target as (
  select id
  from public.staff
  where regexp_replace(trim(name),'\s+',' ','g') = 'يوسف ماهر'
    and branch='فرع الشامي'
    and coalesce(active,false)=true
  order by id
  limit 1
)
update public.shift_schedules ss
set effective_to = date '2026-09-17',
    updated_at = now()
from target t
where ss.staff_id=t.id
  and ss.shift_date is null and ss.date is null
  and ss.effective_from=date '1900-01-01'
  and coalesce(ss.is_off,false)=false
  and coalesce(ss.is_day_off,false)=false;

with target as (
  select id
  from public.staff
  where regexp_replace(trim(name),'\s+',' ','g') = 'يوسف ماهر'
    and branch='فرع الشامي'
    and coalesce(active,false)=true
  order by id
  limit 1
), source_rows as (
  select ss.*
  from public.shift_schedules ss
  join target t on t.id=ss.staff_id
  where ss.shift_date is null and ss.date is null
    and ss.effective_to=date '2026-09-17'
    and coalesce(ss.is_off,false)=false
    and coalesce(ss.is_day_off,false)=false
)
insert into public.shift_schedules(
  id,staff_name,employee_name,role,branch,day_name,shift_start,shift_end,hours,is_off,
  raw_shift,source,created_at,staff_id,day_of_week,is_day_off,updated_at,start_time,end_time,
  is_different,has_custom_time,branch_id,notes,shift_date,date,shift_name,status,effective_from,effective_to
)
select
  gen_random_uuid(),staff_name,employee_name,role,branch,day_name,'16:00:00','02:00:00',10,false,
  '16:00-02:00',coalesce(source,'attendance_schedule_v3'),now(),staff_id,day_of_week,false,now(),
  time '16:00',time '02:00',true,true,branch_id,
  concat_ws(' | ',nullif(notes,''),'تغيير معتمد: يوسف ماهر 16:00 إلى 02:00 اعتبارًا من 2026-09-18'),
  null,null,coalesce(shift_name,'مسائي'),coalesce(status,'active'),date '2026-09-18',null
from source_rows
on conflict (staff_id,day_name,effective_from)
where staff_id is not null and day_name is not null and shift_date is null and date is null
do update set
  shift_start=excluded.shift_start,shift_end=excluded.shift_end,hours=excluded.hours,
  start_time=excluded.start_time,end_time=excluded.end_time,is_off=false,is_day_off=false,
  has_custom_time=true,raw_shift=excluded.raw_shift,notes=excluded.notes,updated_at=now();

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
    and p_event_time-l.recorded_at between interval '0 seconds' and interval '180 seconds'
  order by l.recorded_at desc,l.id desc limit 1;
  if v_dup is not null then
    return jsonb_build_object('decision','duplicate','semantic_type',null,'confidence',0.99,'reason','same_employee_within_180_seconds','duplicate_of_log_id',v_dup);
  end if;

  v_event_date:=(p_event_time at time zone 'Africa/Cairo')::date;
  with candidate_dates as (
    select v_event_date d union all select v_event_date-1 union all select v_event_date+1
  ), schedules as (
    select d.d schedule_date,ss.*,
      case when trim(coalesce(ss.shift_start,''))~'^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then trim(ss.shift_start)::time else ss.start_time end st,
      case when trim(coalesce(ss.shift_end,''))~'^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then trim(ss.shift_end)::time else ss.end_time end et
    from candidate_dates d
    join lateral (
      select x.* from public.shift_schedules x
      where x.staff_id=p_staff_id
        and d.d between x.effective_from and coalesce(x.effective_to,date '9999-12-31')
        and (
          coalesce(x.shift_date,x.date)=d.d
          or (x.shift_date is null and x.date is null and trim(coalesce(x.day_name,''))=
            case extract(dow from d.d)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end)
        )
      order by (coalesce(x.shift_date,x.date)=d.d) desc,x.effective_from desc,coalesce(x.updated_at,x.created_at) desc nulls last,x.id desc
      limit 1
    ) ss on true
  ), windows as (
    select schedule_date,(schedule_date::timestamp+st) at time zone 'Africa/Cairo' s_at,
      (((schedule_date + case when et<=st then 1 else 0 end)::timestamp+et) at time zone 'Africa/Cairo') e_at
    from schedules where st is not null and et is not null and not coalesce(is_off,false) and not coalesce(is_day_off,false)
  )
  select schedule_date,s_at,e_at into v_sched_date,v_start,v_end
  from windows
  where p_event_time between s_at-interval '4 hours' and e_at+interval '6 hours'
  order by least(abs(extract(epoch from (p_event_time-s_at))),abs(extract(epoch from (p_event_time-e_at)))) limit 1;

  if v_start is null or v_end is null then
    return jsonb_build_object('decision','review','semantic_type',v_raw,'confidence',case when v_raw is null then 0.20 else 0.45 end,'reason','no_matching_schedule_review','raw_type',v_raw);
  end if;

  v_mid:=v_start+((v_end-v_start)/2);
  if p_event_time <= v_start+interval '4 hours' then v_type:='check_in'; v_reason:='schedule_start_window'; v_conf:=0.96;
  elsif p_event_time >= v_end-interval '4 hours' then v_type:='check_out'; v_reason:='schedule_end_window'; v_conf:=0.96;
  elsif p_event_time < v_mid then v_type:='check_in'; v_reason:='closer_to_shift_start'; v_conf:=0.82;
  else v_type:='check_out'; v_reason:='closer_to_shift_end'; v_conf:=0.82; end if;

  return jsonb_build_object('decision','accepted','semantic_type',v_type,'confidence',v_conf,'reason',v_reason,'schedule_date',v_sched_date,'scheduled_start_at',v_start,'scheduled_end_at',v_end,'raw_type',v_raw);
end;
$$;

create or replace function public.dawaa_build_attendance_day_resolution_v2(p_staff_id uuid,p_attendance_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_day_ar text;
  v_sched public.shift_schedules%rowtype;
  v_schedule_configs integer:=0;
  v_has_schedule boolean:=false;
  v_is_off boolean:=false;
  v_start_time time;
  v_end_time time;
  v_expected_start timestamptz;
  v_expected_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_sync_complete_through timestamptz;
  v_sync_complete boolean:=false;
  v_timeoff public.staff_time_off_requests%rowtype;
  v_timeoff_count integer:=0;
  v_has_timeoff boolean:=false;
  v_full_day_timeoff boolean:=false;
  v_has_permission boolean:=false;
  v_policy public.attendance_policy_versions%rowtype;
  v_policy_version text:='unconfigured';
  v_grace integer:=15;
  v_very_late integer:=30;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_first_in_id uuid;
  v_last_out_id uuid;
  v_accepted integer:=0;
  v_checkins integer:=0;
  v_checkouts integer:=0;
  v_manual integer:=0;
  v_rejected integer:=0;
  v_candidate numeric:=0;
  v_late integer:=0;
  v_early integer:=0;
  v_status text;
  v_reason text;
  v_system_resolvable boolean:=false;
  v_finalizable boolean:=false;
begin
  if p_staff_id is null or p_attendance_date is null then raise exception 'attendance_resolution_identity_or_date_missing' using errcode='22023'; end if;
  select * into v_staff from public.staff s where s.id=p_staff_id limit 1;
  if not found then raise exception 'attendance_resolution_staff_not_found' using errcode='22023'; end if;

  v_day_ar:=case extract(dow from p_attendance_date)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end;

  select * into v_policy from public.attendance_policy_versions p
  where coalesce(p.active,false)=true and p.effective_from<=p_attendance_date and (p.effective_to is null or p.effective_to>=p_attendance_date)
  order by p.effective_from desc,p.created_at desc limit 1;
  if found then v_policy_version:=v_policy.policy_code; v_grace:=coalesce(v_policy.late_grace_minutes,15); v_very_late:=greatest(v_grace,coalesce(v_policy.very_late_minutes,30)); end if;

  with candidates as (
    select ss.* from public.shift_schedules ss
    where ss.staff_id=p_staff_id
      and p_attendance_date between ss.effective_from and coalesce(ss.effective_to,date '9999-12-31')
      and (coalesce(ss.shift_date,ss.date)=p_attendance_date or (ss.shift_date is null and ss.date is null and trim(coalesce(ss.day_name,''))=v_day_ar))
  ), configs as (
    select distinct coalesce(is_off,false) is_off,coalesce(is_day_off,false) is_day_off,
      coalesce(nullif(trim(shift_start),''),start_time::text,'') start_value,
      coalesce(nullif(trim(shift_end),''),end_time::text,'') end_value
    from candidates
  )
  select count(*) into v_schedule_configs from configs;

  select * into v_sched from public.shift_schedules ss
  where ss.staff_id=p_staff_id
    and p_attendance_date between ss.effective_from and coalesce(ss.effective_to,date '9999-12-31')
    and (coalesce(ss.shift_date,ss.date)=p_attendance_date or (ss.shift_date is null and ss.date is null and trim(coalesce(ss.day_name,''))=v_day_ar))
  order by case when coalesce(ss.shift_date,ss.date)=p_attendance_date then 0 else 1 end,
    ss.effective_from desc,ss.updated_at desc nulls last,ss.created_at desc nulls last,ss.id desc limit 1;
  v_has_schedule:=found;

  if v_has_schedule then
    v_is_off:=coalesce(v_sched.is_off,false) or coalesce(v_sched.is_day_off,false);
    if not v_is_off then
      if coalesce(trim(v_sched.shift_start),'') ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then v_start_time:=trim(v_sched.shift_start)::time; else v_start_time:=v_sched.start_time; end if;
      if coalesce(trim(v_sched.shift_end),'') ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then v_end_time:=trim(v_sched.shift_end)::time; else v_end_time:=v_sched.end_time; end if;
      if v_start_time is not null and v_end_time is not null then
        v_expected_start:=(p_attendance_date::timestamp+v_start_time) at time zone 'Africa/Cairo';
        v_expected_end:=((p_attendance_date+case when v_end_time<=v_start_time then 1 else 0 end)::timestamp+v_end_time) at time zone 'Africa/Cairo';
      end if;
    end if;
  end if;

  select count(*) into v_timeoff_count from public.staff_time_off_requests r
  where r.staff_id=p_staff_id and r.status='approved' and p_attendance_date between r.start_date and r.end_date;
  select * into v_timeoff from public.staff_time_off_requests r
  where r.staff_id=p_staff_id and r.status='approved' and p_attendance_date between r.start_date and r.end_date
  order by r.decided_at desc nulls last,r.created_at desc,r.id desc limit 1;
  v_has_timeoff:=found;
  if v_has_timeoff then v_full_day_timeoff:=v_timeoff.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence'); v_has_permission:=v_timeoff.request_kind='permission'; end if;

  v_sync_complete_through:=public.attendance_sync_complete_through_v1('fingerprint_vendor_primary');
  if v_expected_start is not null and v_expected_end is not null then
    v_window_start:=v_expected_start-interval '4 hours'; v_window_end:=v_expected_end+interval '6 hours';
    v_sync_complete:=v_sync_complete_through is not null and v_sync_complete_through>=v_expected_end;
  else
    v_window_start:=p_attendance_date::timestamp at time zone 'Africa/Cairo';
    v_window_end:=((p_attendance_date+1)::timestamp+interval '6 hours') at time zone 'Africa/Cairo';
    v_sync_complete:=v_sync_complete_through is not null and v_sync_complete_through>=((p_attendance_date+1)::timestamp at time zone 'Africa/Cairo');
  end if;

  select count(*) filter(where a.status='accepted')::integer,
    count(*) filter(where a.status='accepted' and a.attendance_type='check_in')::integer,
    count(*) filter(where a.status='accepted' and a.attendance_type='check_out')::integer,
    count(*) filter(where a.status='manual_review')::integer,
    count(*) filter(where a.status='rejected')::integer,
    min(a.recorded_at) filter(where a.status='accepted' and a.attendance_type='check_in'),
    max(a.recorded_at) filter(where a.status='accepted' and a.attendance_type='check_out')
  into v_accepted,v_checkins,v_checkouts,v_manual,v_rejected,v_first_in,v_last_out
  from public.staff_attendance_logs a
  where a.staff_id=p_staff_id and a.recorded_at>=v_window_start and a.recorded_at<v_window_end;

  if v_first_in is not null then select a.id into v_first_in_id from public.staff_attendance_logs a where a.staff_id=p_staff_id and a.status='accepted' and a.attendance_type='check_in' and a.recorded_at=v_first_in order by a.id limit 1; end if;
  if v_last_out is not null then select a.id into v_last_out_id from public.staff_attendance_logs a where a.staff_id=p_staff_id and a.status='accepted' and a.attendance_type='check_out' and a.recorded_at=v_last_out order by a.id desc limit 1; end if;

  if v_first_in is not null and v_last_out is not null and v_last_out>v_first_in then v_candidate:=round((extract(epoch from (v_last_out-v_first_in))/3600.0)::numeric,2); end if;
  if v_expected_start is not null and v_first_in is not null then v_late:=greatest(0,floor(extract(epoch from (v_first_in-v_expected_start))/60.0)::integer); end if;
  if v_expected_end is not null and v_last_out is not null then v_early:=greatest(0,floor(extract(epoch from (v_expected_end-v_last_out))/60.0)::integer); end if;

  if v_timeoff_count>1 then v_status:='time_off_conflict'; v_reason:='multiple_approved_time_off_requests'; v_finalizable:=true;
  elsif v_schedule_configs>1 then v_status:='schedule_conflict'; v_reason:='multiple_conflicting_schedule_configs'; v_finalizable:=true;
  elsif v_has_timeoff and v_timeoff.request_kind='shift_swap' then v_status:='shift_swap_requires_schedule'; v_reason:='approved_shift_swap_must_be_reflected_in_canonical_schedule'; v_finalizable:=true;
  elsif v_full_day_timeoff and coalesce(v_accepted,0)=0 and coalesce(v_manual,0)=0 then v_status:='approved_time_off'; v_reason:=v_timeoff.request_kind; v_system_resolvable:=true; v_finalizable:=true;
  elsif v_full_day_timeoff then v_status:='time_off_with_events'; v_reason:='attendance_events_exist_during_approved_time_off'; v_finalizable:=true;
  elsif not v_has_schedule then v_status:='no_schedule'; v_reason:='no_canonical_staff_schedule'; v_finalizable:=true;
  elsif v_is_off and coalesce(v_accepted,0)=0 and coalesce(v_manual,0)=0 and coalesce(v_rejected,0)=0 then v_status:='off_day'; v_system_resolvable:=true; v_finalizable:=true;
  elsif v_is_off then v_status:='worked_on_off'; v_reason:='attendance_events_on_scheduled_off_day'; v_finalizable:=true;
  elsif v_expected_start is null or v_expected_end is null then v_status:='invalid_schedule_time'; v_reason:='schedule_time_missing_or_invalid'; v_finalizable:=true;
  elsif now()<v_expected_end then v_status:='shift_in_progress'; v_reason:='scheduled_shift_not_finished'; v_finalizable:=false;
  elsif not v_sync_complete then v_status:='sync_pending_verification'; v_reason:='biometric_sync_watermark_not_complete_through_shift_end'; v_finalizable:=false;
  elsif coalesce(v_manual,0)>0 or coalesce(v_rejected,0)>0 then v_status:='needs_event_review'; v_reason:='manual_or_rejected_events_present'; v_finalizable:=true;
  elsif v_first_in is null and v_last_out is null then v_status:='absence_review'; v_reason:='no_attendance_events_after_sync_completion'; v_finalizable:=true;
  elsif v_first_in is null then v_status:='missing_checkin'; v_reason:='checkout_without_checkin'; v_finalizable:=true;
  elsif v_last_out is null then v_status:='missing_checkout'; v_reason:='checkin_without_checkout_after_sync_completion'; v_finalizable:=true;
  elsif v_last_out<=v_first_in or v_candidate<=0 or v_candidate>18 then v_status:='invalid_duration'; v_reason:='worked_duration_outside_0_18h'; v_finalizable:=true;
  elsif v_early>0 and not v_has_permission then v_status:='early_leave_review'; v_reason:='early_leave_without_approved_permission'; v_finalizable:=true;
  elsif v_late>v_very_late then v_status:='very_late'; v_system_resolvable:=true; v_finalizable:=true;
  elsif v_late>v_grace then v_status:='late'; v_system_resolvable:=true; v_finalizable:=true;
  else v_status:=case when v_has_permission then 'on_time_with_permission' else 'on_time' end; v_system_resolvable:=true; v_finalizable:=true;
  end if;

  return jsonb_build_object(
    'staff_id',p_staff_id,'staff_name',v_staff.name,'role',v_staff.role,'branch',coalesce(v_sched.branch,v_staff.branch),'attendance_date',p_attendance_date,
    'day_name',v_day_ar,'schedule_id',case when v_has_schedule then v_sched.id else null end,'schedule_config_count',v_schedule_configs,'is_off_day',v_is_off,
    'schedule_effective_from',case when v_has_schedule then v_sched.effective_from else null end,'schedule_effective_to',case when v_has_schedule then v_sched.effective_to else null end,
    'scheduled_start_at',v_expected_start,'scheduled_end_at',v_expected_end,'sync_complete_through',v_sync_complete_through,'sync_complete_for_shift',v_sync_complete,
    'accepted_events',coalesce(v_accepted,0),'check_in_count',coalesce(v_checkins,0),'check_out_count',coalesce(v_checkouts,0),'manual_review_events',coalesce(v_manual,0),'rejected_events',coalesce(v_rejected,0),
    'first_in',v_first_in,'last_out',v_last_out,'first_in_id',v_first_in_id,'last_out_id',v_last_out_id,'candidate_hours',coalesce(v_candidate,0),'late_minutes',coalesce(v_late,0),'early_leave_minutes',coalesce(v_early,0),
    'time_off_request_id',case when v_has_timeoff then v_timeoff.id else null end,'time_off_kind',case when v_has_timeoff then v_timeoff.request_kind else null end,'permission_attached',v_has_permission,
    'policy_version',v_policy_version,'late_grace_minutes',v_grace,'very_late_minutes',v_very_late,'resolution_status',v_status,'system_resolvable',v_system_resolvable,'finalizable',v_finalizable,
    'review_required',not v_system_resolvable,'reason',v_reason,'resolution_version',3
  );
end;
$$;

create or replace function public.dawaa_detect_pending_overtime_v1(p_lookback_days integer default 3)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_s record; v_d date; v_r jsonb; v_scheduled_hours numeric; v_extra_minutes int; v_late_minutes int;
  v_deviation jsonb; v_overtime_minutes int; v_comp record; v_true_hourly_rate numeric;
  v_inserted int:=0; v_updated int:=0; v_invalidated int:=0; v_flagged_unreasonable int:=0;
  v_today date:=(now() at time zone 'Africa/Cairo')::date;
begin
  for v_s in select id,name,branch,role from public.staff where coalesce(active,false)=true loop
    select * into v_comp from public.employee_compensation_profiles
    where staff_id=v_s.id::text and active=true order by effective_from desc nulls last limit 1;
    if coalesce(v_comp.exempt_from_lateness_deduction,false) then continue; end if;
    v_true_hourly_rate:=case when v_comp.hourly_rate is not null and v_comp.hourly_rate>0 then round(v_comp.hourly_rate/26.0,4) else null end;

    for v_d in select generate_series(v_today-greatest(1,least(coalesce(p_lookback_days,3),45)),v_today-1,interval '1 day')::date loop
      v_r:=public.dawaa_build_attendance_day_resolution_v2(v_s.id,v_d);

      if (v_r->>'resolution_status') not in ('on_time','late','very_late','on_time_with_permission','worked_on_off') then
        update public.staff_overtime_approvals
        set status='rejected',decision_note='إبطال تلقائي: اليوم لم يعد مؤهلًا للأوفرتايم بعد إعادة بناء الحضور/الجدول.',decided_at=now(),updated_at=now()
        where staff_id=v_s.id and attendance_date=v_d and status='pending';
        if found then v_invalidated:=v_invalidated+1; end if;
        continue;
      end if;

      v_scheduled_hours:=case when (v_r->>'scheduled_start_at') is not null and (v_r->>'scheduled_end_at') is not null
        then extract(epoch from ((v_r->>'scheduled_end_at')::timestamptz-(v_r->>'scheduled_start_at')::timestamptz))/3600.0 else null end;
      v_extra_minutes:=round(greatest(coalesce((v_r->>'candidate_hours')::numeric,0)-coalesce(v_scheduled_hours,0),0)*60)::int;
      v_late_minutes:=coalesce((v_r->>'late_minutes')::int,0);
      v_deviation:=public.dawaa_net_attendance_deviation_v1(v_late_minutes,v_extra_minutes,v_s.role,false);
      v_overtime_minutes:=coalesce((v_deviation->>'overtime_minutes')::int,0);

      if v_overtime_minutes<10 then
        update public.staff_overtime_approvals
        set status='rejected',decision_note='إبطال تلقائي: إعادة الحساب بعد تحديث الجدول أظهرت أن الأوفرتايم أقل من 10 دقائق.',decided_at=now(),updated_at=now()
        where staff_id=v_s.id and attendance_date=v_d and status='pending';
        if found then v_invalidated:=v_invalidated+1; end if;
        continue;
      end if;

      insert into public.staff_overtime_approvals(staff_id,staff_name,branch,attendance_date,overtime_hours,hourly_rate,overtime_amount,status,decision_note,updated_at)
      values(
        v_s.id,v_s.name,v_s.branch,v_d,round(v_overtime_minutes/60.0,2),
        case when v_overtime_minutes>360 then null else v_true_hourly_rate end,
        case when v_overtime_minutes>360 or v_true_hourly_rate is null then null else round((v_overtime_minutes/60.0)*v_true_hourly_rate*1.5,2) end,
        'pending',
        case when v_overtime_minutes>360 then 'تنبيه: عدد ساعات كبير بشكل غير معتاد — راجع البصمات والجدول قبل الاعتماد.' else null end,
        now()
      )
      on conflict(staff_id,attendance_date) do update set
        overtime_hours=excluded.overtime_hours,
        hourly_rate=excluded.hourly_rate,
        overtime_amount=excluded.overtime_amount,
        decision_note=excluded.decision_note,
        updated_at=now()
      where public.staff_overtime_approvals.status='pending';

      if found then
        if exists(select 1 from public.staff_overtime_approvals where staff_id=v_s.id and attendance_date=v_d and created_at=updated_at) then v_inserted:=v_inserted+1;
        else v_updated:=v_updated+1; end if;
      end if;
      if v_overtime_minutes>360 then v_flagged_unreasonable:=v_flagged_unreasonable+1; end if;
    end loop;
  end loop;
  return jsonb_build_object('queued_or_recalculated',v_inserted+v_updated,'invalidated_stale',v_invalidated,'flagged_unreasonable',v_flagged_unreasonable);
end;
$$;

grant execute on function public.dawaa_biometric_semantic_decision_v1(uuid,timestamptz,text,uuid) to authenticated,service_role;
revoke all on function public.dawaa_build_attendance_day_resolution_v2(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_build_attendance_day_resolution_v2(uuid,date) to service_role;
revoke all on function public.dawaa_detect_pending_overtime_v1(integer) from public,anon,authenticated;
grant execute on function public.dawaa_detect_pending_overtime_v1(integer) to service_role;

notify pgrst,'reload schema';
