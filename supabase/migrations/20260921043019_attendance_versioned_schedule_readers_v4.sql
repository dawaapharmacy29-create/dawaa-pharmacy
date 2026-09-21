create or replace function public.attendance_daily_command_v1(
  p_date date default ((now() at time zone 'Africa/Cairo'))::date,
  p_branch text default null
)
returns table(
  staff_id uuid, staff_name text, role text, branch text, work_date date,
  schedule_status text, shift_start time, shift_end time,
  first_check_in timestamptz, last_check_out timestamptz,
  late_minutes integer, early_leave_minutes integer, attendance_status text,
  approved_exception_type text, approved_exception_reason text,
  biometric_events integer, source_status text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_policy jsonb:=public.get_attendance_policy_v1(p_date);
  v_late_grace integer:=coalesce((v_policy->>'late_grace_minutes')::int,15);
  v_very_late integer:=coalesce((v_policy->>'very_late_minutes')::int,30);
begin
  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;

  return query
  with canonical_staff as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,false)=true
      and s.branch in ('فرع الشامي','فرع شكري')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ), schedule_pick as (
    select cs.id staff_id,ss.shift_start,ss.shift_end,ss.is_off,ss.is_day_off,ss.schedule_id
    from canonical_staff cs
    left join lateral public.attendance_schedule_for_date_v1(cs.id,p_date) ss on true
  ), exceptions as (
    select cs.id staff_id,e.request_label as type,e.reason
    from canonical_staff cs
    left join lateral (
      select coalesce(x.request_label,x.request_kind) request_label,x.reason
      from public.staff_time_off_requests x
      where x.staff_id=cs.id and x.status='approved'
        and x.request_kind in ('permission','annual_leave','sick_leave','exceptional_leave','approved_absence')
        and p_date between x.start_date and x.end_date
      order by x.decided_at desc nulls last,x.updated_at desc,x.id desc limit 1
    ) e on true
  ), base as (
    select cs.id,cs.name,cs.role,cs.branch,sp.shift_start,sp.shift_end,sp.is_off,sp.is_day_off,sp.schedule_id,
      ex.type exception_type,ex.reason exception_reason,
      public.attendance_branch_sync_complete_through_v1(cs.branch) branch_complete_through,
      case when sp.schedule_id is null then 'missing'
           when (sp.is_off or sp.is_day_off) and sp.shift_start is not null and sp.shift_end is not null then 'conflict'
           when (sp.is_off or sp.is_day_off) then 'off'
           when sp.shift_start is null or sp.shift_end is null then 'missing_time' else 'scheduled' end schedule_state
    from canonical_staff cs left join schedule_pick sp on sp.staff_id=cs.id left join exceptions ex on ex.staff_id=cs.id
  ), scheduled as (
    select b.*,
      case when b.schedule_state='scheduled' then (p_date::timestamp+b.shift_start) at time zone 'Africa/Cairo' end scheduled_start,
      case when b.schedule_state='scheduled' then (((p_date+case when b.shift_end<=b.shift_start then 1 else 0 end)::timestamp+b.shift_end) at time zone 'Africa/Cairo') end scheduled_end
    from base b
  ), with_punches as (
    select s.*,p.first_in,p.last_out,coalesce(p.event_count,0) event_count
    from scheduled s
    left join lateral (
      select min(l.recorded_at) filter(where l.attendance_type='check_in') first_in,
             max(l.recorded_at) filter(where l.attendance_type='check_out') last_out,
             count(*)::int event_count
      from public.staff_attendance_logs l
      where l.staff_id=s.id and l.status='accepted'
        and ((s.schedule_state='scheduled' and l.recorded_at>=s.scheduled_start-interval '4 hours' and l.recorded_at<=s.scheduled_end+interval '6 hours')
          or (s.schedule_state<>'scheduled' and l.shift_date=p_date))
    ) p on true
  )
  select c.id,c.name,c.role,c.branch,p_date,c.schedule_state,c.shift_start,c.shift_end,c.first_in,c.last_out,
    case when c.schedule_state<>'scheduled' or c.first_in is null then 0 else greatest(0,floor(extract(epoch from(c.first_in-c.scheduled_start))/60)::int) end,
    case when c.schedule_state<>'scheduled' or c.last_out is null then 0 else greatest(0,floor(extract(epoch from(c.scheduled_end-c.last_out))/60)::int) end,
    case
      when c.schedule_state='conflict' then 'schedule_conflict'
      when c.schedule_state='off' and c.event_count>0 then 'worked_on_off'
      when c.schedule_state='off' then 'off'
      when c.schedule_state in ('missing','missing_time') and c.event_count>0 then 'punch_without_valid_schedule'
      when c.schedule_state in ('missing','missing_time') then 'schedule_missing'
      when c.exception_type is not null and c.event_count=0 then 'approved_exception'
      when c.first_in is null and (c.branch_complete_through is null or c.branch_complete_through<c.scheduled_end) then 'sync_pending'
      when c.first_in is null and p_date<(now() at time zone 'Africa/Cairo')::date then 'absent'
      when c.first_in is null and p_date=(now() at time zone 'Africa/Cairo')::date and now()>c.scheduled_start+(v_late_grace||' minutes')::interval then 'not_arrived'
      when c.first_in is null then 'scheduled'
      when c.last_out is null and (c.branch_complete_through is null or c.branch_complete_through<c.scheduled_end) then 'sync_pending_checkout'
      when c.last_out is null and (p_date<(now() at time zone 'Africa/Cairo')::date or now()>c.scheduled_end+interval '6 hours') then 'missing_checkout'
      when c.last_out is null then 'working_now'
      when c.first_in>c.scheduled_start+(v_very_late||' minutes')::interval then 'very_late'
      when c.first_in>c.scheduled_start+(v_late_grace||' minutes')::interval then 'late'
      else 'on_time' end,
    c.exception_type,c.exception_reason,c.event_count,
    case when c.event_count>0 then 'fingerprint'
      when c.branch_complete_through is null or (c.scheduled_end is not null and c.branch_complete_through<c.scheduled_end) then 'sync_pending'
      else 'schedule' end
  from with_punches c
  where c.schedule_id is not null or c.event_count>0 or c.exception_type is not null
  order by c.branch,c.name;
end;
$$;

create or replace function public.dawaa_biometric_semantic_decision_v1(
  p_staff_id uuid,p_event_time timestamptz,p_raw_type text,p_biometric_log_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_event_local timestamp; v_event_date date; v_start timestamptz; v_end timestamptz; v_sched_date date;
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
    and (l.recorded_at<p_event_time or (l.recorded_at=p_event_time and p_biometric_log_id is not null and l.biometric_source_log_id::text<p_biometric_log_id::text))
    and p_event_time-l.recorded_at between interval '0 seconds' and interval '120 seconds'
  order by l.recorded_at desc,l.id desc limit 1;
  if v_dup is not null then
    return jsonb_build_object('decision','duplicate','semantic_type',null,'confidence',0.99,'reason','same_employee_within_120_seconds','duplicate_of_log_id',v_dup);
  end if;

  v_event_local:=p_event_time at time zone 'Africa/Cairo';
  v_event_date:=v_event_local::date;

  with candidate_dates as (
    select v_event_date d union all select v_event_date-1 union all select v_event_date+1
  ), windows as (
    select d.d schedule_date,
      (d.d::timestamp+s.shift_start) at time zone 'Africa/Cairo' s_at,
      (((d.d+case when s.shift_end<=s.shift_start then 1 else 0 end)::timestamp+s.shift_end) at time zone 'Africa/Cairo') e_at
    from candidate_dates d
    join lateral public.attendance_schedule_for_date_v1(p_staff_id,d.d) s on true
    where s.shift_start is not null and s.shift_end is not null and not coalesce(s.is_off,false) and not coalesce(s.is_day_off,false)
  )
  select schedule_date,s_at,e_at into v_sched_date,v_start,v_end
  from windows
  where p_event_time between s_at-interval '4 hours' and e_at+interval '6 hours'
  order by least(abs(extract(epoch from(p_event_time-s_at))),abs(extract(epoch from(p_event_time-e_at)))) limit 1;

  if v_start is null or v_end is null then
    return jsonb_build_object('decision',case when v_raw is null then 'review' else 'accepted' end,'semantic_type',v_raw,
      'confidence',case when v_raw is null then 0.20 else 0.45 end,'reason','no_matching_schedule_fallback_to_raw');
  end if;

  v_mid:=v_start+((v_end-v_start)/2);
  if p_event_time<=v_start+interval '4 hours' then v_type:='check_in'; v_reason:='schedule_start_window'; v_conf:=0.96;
  elsif p_event_time>=v_end-interval '4 hours' then v_type:='check_out'; v_reason:='schedule_end_window'; v_conf:=0.96;
  elsif p_event_time<v_mid then v_type:='check_in'; v_reason:='closer_to_shift_start'; v_conf:=0.82;
  else v_type:='check_out'; v_reason:='closer_to_shift_end'; v_conf:=0.82; end if;

  return jsonb_build_object('decision','accepted','semantic_type',v_type,'confidence',v_conf,'reason',v_reason,
    'schedule_date',v_sched_date,'scheduled_start_at',v_start,'scheduled_end_at',v_end,'raw_type',v_raw);
end;
$$;

-- Resolution v2 keeps the existing decision policy, but selects only schedule versions effective on the attendance date.
create or replace function public.dawaa_build_attendance_day_resolution_v2(p_staff_id uuid,p_attendance_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype; v_day_ar text; v_sched public.shift_schedules%rowtype;
  v_schedule_configs integer:=0; v_has_schedule boolean:=false; v_is_off boolean:=false;
  v_start_time time; v_end_time time; v_expected_start timestamptz; v_expected_end timestamptz;
  v_window_start timestamptz; v_window_end timestamptz; v_sync_complete_through timestamptz; v_sync_complete boolean:=false;
  v_timeoff public.staff_time_off_requests%rowtype; v_timeoff_count integer:=0; v_has_timeoff boolean:=false;
  v_full_day_timeoff boolean:=false; v_has_permission boolean:=false;
  v_policy public.attendance_policy_versions%rowtype; v_policy_version text:='unconfigured'; v_grace integer:=15; v_very_late integer:=30;
  v_first_in timestamptz; v_last_out timestamptz; v_first_in_id uuid; v_last_out_id uuid;
  v_accepted integer:=0; v_checkins integer:=0; v_checkouts integer:=0; v_manual integer:=0; v_rejected integer:=0;
  v_candidate numeric:=0; v_late integer:=0; v_early integer:=0; v_status text; v_reason text;
  v_system_resolvable boolean:=false; v_finalizable boolean:=false; v_schedule_id uuid;
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
    where ss.staff_id=p_staff_id and ss.effective_from<=p_attendance_date and (ss.effective_to is null or ss.effective_to>=p_attendance_date)
      and (coalesce(ss.shift_date,ss.date)=p_attendance_date or (ss.shift_date is null and ss.date is null and trim(coalesce(ss.day_name,''))=v_day_ar))
  ), configs as (
    select distinct coalesce(is_off,false) is_off,coalesce(is_day_off,false) is_day_off,
      coalesce(nullif(trim(shift_start),''),start_time::text,'') start_value,
      coalesce(nullif(trim(shift_end),''),end_time::text,'') end_value from candidates
  )
  select count(*) into v_schedule_configs from configs;

  select schedule_id into v_schedule_id from public.attendance_schedule_for_date_v1(p_staff_id,p_attendance_date);
  if v_schedule_id is not null then select * into v_sched from public.shift_schedules where id=v_schedule_id; v_has_schedule:=found; end if;

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

  select count(*) into v_timeoff_count from public.staff_time_off_requests r where r.staff_id=p_staff_id and r.status='approved' and p_attendance_date between r.start_date and r.end_date;
  select * into v_timeoff from public.staff_time_off_requests r where r.staff_id=p_staff_id and r.status='approved' and p_attendance_date between r.start_date and r.end_date
  order by r.decided_at desc nulls last,r.created_at desc,r.id desc limit 1;
  v_has_timeoff:=found;
  if v_has_timeoff then v_full_day_timeoff:=v_timeoff.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence'); v_has_permission:=v_timeoff.request_kind='permission'; end if;

  v_sync_complete_through:=public.attendance_branch_sync_complete_through_v1(coalesce(v_sched.branch,v_staff.branch));
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
  from public.staff_attendance_logs a where a.staff_id=p_staff_id and a.recorded_at>=v_window_start and a.recorded_at<v_window_end;

  if v_first_in is not null then select a.id into v_first_in_id from public.staff_attendance_logs a where a.staff_id=p_staff_id and a.status='accepted' and a.attendance_type='check_in' and a.recorded_at=v_first_in order by a.id limit 1; end if;
  if v_last_out is not null then select a.id into v_last_out_id from public.staff_attendance_logs a where a.staff_id=p_staff_id and a.status='accepted' and a.attendance_type='check_out' and a.recorded_at=v_last_out order by a.id desc limit 1; end if;

  if v_first_in is not null and v_last_out is not null and v_last_out>v_first_in then v_candidate:=round((extract(epoch from(v_last_out-v_first_in))/3600.0)::numeric,2); end if;
  if v_expected_start is not null and v_first_in is not null then v_late:=greatest(0,floor(extract(epoch from(v_first_in-v_expected_start))/60.0)::integer); end if;
  if v_expected_end is not null and v_last_out is not null then v_early:=greatest(0,floor(extract(epoch from(v_expected_end-v_last_out))/60.0)::integer); end if;

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
  elsif coalesce(v_manual,0)>0 or exists(select 1 from public.staff_attendance_logs ar left join public.biometric_semantic_decisions bd on bd.biometric_log_id=ar.biometric_source_log_id where ar.staff_id=p_staff_id and ar.recorded_at>=v_window_start and ar.recorded_at<v_window_end and ar.status='rejected' and ar.biometric_method='fingerprint_terminal' and coalesce(bd.decision,'')<>'duplicate') then v_status:='needs_event_review'; v_reason:='manual_or_actionable_rejected_events_present'; v_finalizable:=true;
  elsif v_first_in is null and v_last_out is null then v_status:='absence_review'; v_reason:='no_attendance_events_after_sync_completion'; v_finalizable:=true;
  elsif v_first_in is null then v_status:='missing_checkin'; v_reason:='checkout_without_checkin'; v_finalizable:=true;
  elsif v_last_out is null then v_status:='missing_checkout'; v_reason:='checkin_without_checkout_after_sync_completion'; v_finalizable:=true;
  elsif v_last_out<=v_first_in or v_candidate<=0 or v_candidate>18 then v_status:='invalid_duration'; v_reason:='worked_duration_outside_0_18h'; v_finalizable:=true;
  elsif v_early>0 and not v_has_permission then v_status:='early_leave_review'; v_reason:='early_leave_without_approved_permission'; v_finalizable:=true;
  elsif v_late>v_very_late then v_status:='very_late'; v_system_resolvable:=true; v_finalizable:=true;
  elsif v_late>v_grace then v_status:='late'; v_system_resolvable:=true; v_finalizable:=true;
  else v_status:=case when v_has_permission then 'on_time_with_permission' else 'on_time' end; v_system_resolvable:=true; v_finalizable:=true; end if;

  return jsonb_build_object('staff_id',p_staff_id,'staff_name',v_staff.name,'role',v_staff.role,'branch',coalesce(v_sched.branch,v_staff.branch),
    'attendance_date',p_attendance_date,'day_name',v_day_ar,'schedule_id',case when v_has_schedule then v_sched.id else null end,'schedule_config_count',v_schedule_configs,
    'is_off_day',v_is_off,'scheduled_start_at',v_expected_start,'scheduled_end_at',v_expected_end,'sync_complete_through',v_sync_complete_through,'sync_complete_for_shift',v_sync_complete,
    'accepted_events',coalesce(v_accepted,0),'check_in_count',coalesce(v_checkins,0),'check_out_count',coalesce(v_checkouts,0),'manual_review_events',coalesce(v_manual,0),
    'rejected_events',coalesce(v_rejected,0),'first_in',v_first_in,'last_out',v_last_out,'first_in_id',v_first_in_id,'last_out_id',v_last_out_id,
    'candidate_hours',coalesce(v_candidate,0),'late_minutes',coalesce(v_late,0),'early_leave_minutes',coalesce(v_early,0),
    'time_off_request_id',case when v_has_timeoff then v_timeoff.id else null end,'time_off_kind',case when v_has_timeoff then v_timeoff.request_kind else null end,
    'permission_attached',v_has_permission,'policy_version',v_policy_version,'late_grace_minutes',v_grace,'very_late_minutes',v_very_late,
    'resolution_status',v_status,'system_resolvable',v_system_resolvable,'finalizable',v_finalizable,'review_required',not v_system_resolvable,
    'reason',v_reason,'resolution_version',2);
end;
$$;

create or replace function public.attendance_schedule_health_v1(p_branch text default null)
returns table(staff_id uuid,staff_name text,role text,branch text,weekly_rows integer,off_days integer,distinct_work_times integer,missing_time_rows integer,date_overrides integer,has_custom_pattern boolean,health_status text)
language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $$
declare v_actor uuid;
begin
  v_actor:=public.dawaa_current_staff_account_id_strict();
  if v_actor is null then raise exception 'active staff actor required' using errcode='42501'; end if;
  return query
  with active_staff as (
    select s.id,s.name,s.role,s.branch from public.staff s
    where coalesce(s.active,s.is_active,true) and s.branch in ('فرع الشامي','فرع شكري')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ), agg as (
    select s.id,s.name,s.role,s.branch,
      count(*) filter(where ss.shift_date is null and ss.date is null and ss.effective_to is null)::integer weekly_rows,
      count(*) filter(where ss.shift_date is null and ss.date is null and ss.effective_to is null and (coalesce(ss.is_off,false) or coalesce(ss.is_day_off,false)))::integer off_days,
      count(distinct concat_ws('-',coalesce(ss.shift_start,ss.start_time::text),coalesce(ss.shift_end,ss.end_time::text)))
        filter(where ss.shift_date is null and ss.date is null and ss.effective_to is null and not(coalesce(ss.is_off,false) or coalesce(ss.is_day_off,false)))::integer distinct_work_times,
      count(*) filter(where ss.shift_date is null and ss.date is null and ss.effective_to is null and not(coalesce(ss.is_off,false) or coalesce(ss.is_day_off,false))
        and (coalesce(nullif(trim(ss.shift_start),''),ss.start_time::text) is null or coalesce(nullif(trim(ss.shift_end),''),ss.end_time::text) is null))::integer missing_time_rows,
      count(*) filter(where coalesce(ss.shift_date,ss.date) is not null and ss.effective_from<=current_date and (ss.effective_to is null or ss.effective_to>=current_date))::integer date_overrides
    from active_staff s left join public.shift_schedules ss on ss.staff_id=s.id group by s.id,s.name,s.role,s.branch
  )
  select a.id,a.name,a.role,a.branch,a.weekly_rows,a.off_days,a.distinct_work_times,a.missing_time_rows,a.date_overrides,
    (a.distinct_work_times>1 or a.date_overrides>0 or a.off_days>1),
    case when a.weekly_rows<7 then 'missing_weekly_days' when a.weekly_rows>7 then 'duplicate_weekly_rows' when a.missing_time_rows>0 then 'missing_shift_time'
      when a.distinct_work_times>1 or a.date_overrides>0 or a.off_days>1 then 'custom_schedule' else 'ok' end
  from agg a
  order by case when a.weekly_rows<>7 or a.missing_time_rows>0 then 0 when a.distinct_work_times>1 or a.date_overrides>0 or a.off_days>1 then 1 else 2 end,a.branch,a.name;
end;
$$;
