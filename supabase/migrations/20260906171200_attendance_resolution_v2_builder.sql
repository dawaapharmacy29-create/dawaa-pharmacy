-- Canonical attendance decision builder v2.
-- Uses staff_id only, canonical time-off, versioned policy, and sync watermark completeness.

create or replace function public.dawaa_build_attendance_day_resolution_v2(p_staff_id uuid,p_attendance_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
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
  if p_staff_id is null or p_attendance_date is null then
    raise exception 'attendance_resolution_identity_or_date_missing' using errcode='22023';
  end if;

  select * into v_staff from public.staff s where s.id=p_staff_id limit 1;
  if not found then raise exception 'attendance_resolution_staff_not_found' using errcode='22023'; end if;

  v_day_ar:=case extract(dow from p_attendance_date)::int
    when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
    when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end;

  select * into v_policy
  from public.attendance_policy_versions p
  where coalesce(p.active,false)=true
    and p.effective_from<=p_attendance_date
    and (p.effective_to is null or p.effective_to>=p_attendance_date)
  order by p.effective_from desc,p.created_at desc limit 1;
  if found then
    v_policy_version:=v_policy.policy_code;
    v_grace:=coalesce(v_policy.late_grace_minutes,15);
    v_very_late:=greatest(v_grace,coalesce(v_policy.very_late_minutes,30));
  end if;

  with candidates as (
    select ss.* from public.shift_schedules ss
    where ss.staff_id=p_staff_id and (
      coalesce(ss.shift_date,ss.date)=p_attendance_date
      or (ss.shift_date is null and ss.date is null and trim(coalesce(ss.day_name,''))=v_day_ar)
    )
  ), configs as (
    select distinct coalesce(is_off,false) is_off,coalesce(is_day_off,false) is_day_off,
      coalesce(nullif(trim(shift_start),''),start_time::text,'') start_value,
      coalesce(nullif(trim(shift_end),''),end_time::text,'') end_value
    from candidates
  )
  select count(*) into v_schedule_configs from configs;

  select ss.* into v_sched
  from public.shift_schedules ss
  where ss.staff_id=p_staff_id and (
    coalesce(ss.shift_date,ss.date)=p_attendance_date
    or (ss.shift_date is null and ss.date is null and trim(coalesce(ss.day_name,''))=v_day_ar)
  )
  order by case when coalesce(ss.shift_date,ss.date)=p_attendance_date then 0 else 1 end,
    ss.updated_at desc nulls last,ss.created_at desc nulls last,ss.id desc limit 1;
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

  select count(*) into v_timeoff_count
  from public.staff_time_off_requests r
  where r.staff_id=p_staff_id and r.status='approved' and p_attendance_date between r.start_date and r.end_date;

  select * into v_timeoff
  from public.staff_time_off_requests r
  where r.staff_id=p_staff_id and r.status='approved' and p_attendance_date between r.start_date and r.end_date
  order by r.decided_at desc nulls last,r.created_at desc,r.id desc limit 1;
  v_has_timeoff:=found;
  if v_has_timeoff then
    v_full_day_timeoff:=v_timeoff.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence');
    v_has_permission:=v_timeoff.request_kind='permission';
  end if;

  v_sync_complete_through:=public.attendance_sync_complete_through_v1('fingerprint_vendor_primary');
  if v_expected_start is not null and v_expected_end is not null then
    v_window_start:=v_expected_start-interval '4 hours';
    v_window_end:=v_expected_end+interval '6 hours';
    v_sync_complete:=v_sync_complete_through is not null and v_sync_complete_through>=v_expected_end;
  else
    v_window_start:=p_attendance_date::timestamp at time zone 'Africa/Cairo';
    v_window_end:=((p_attendance_date+1)::timestamp+interval '6 hours') at time zone 'Africa/Cairo';
    v_sync_complete:=v_sync_complete_through is not null and v_sync_complete_through>=((p_attendance_date+1)::timestamp at time zone 'Africa/Cairo');
  end if;

  select
    count(*) filter(where a.status='accepted')::integer,
    count(*) filter(where a.status='accepted' and a.attendance_type='check_in')::integer,
    count(*) filter(where a.status='accepted' and a.attendance_type='check_out')::integer,
    count(*) filter(where a.status='manual_review')::integer,
    count(*) filter(where a.status='rejected')::integer,
    min(a.recorded_at) filter(where a.status='accepted' and a.attendance_type='check_in'),
    max(a.recorded_at) filter(where a.status='accepted' and a.attendance_type='check_out')
  into v_accepted,v_checkins,v_checkouts,v_manual,v_rejected,v_first_in,v_last_out
  from public.staff_attendance_logs a
  where a.staff_id=p_staff_id and a.recorded_at>=v_window_start and a.recorded_at<v_window_end;

  if v_first_in is not null then
    select a.id into v_first_in_id from public.staff_attendance_logs a
    where a.staff_id=p_staff_id and a.status='accepted' and a.attendance_type='check_in' and a.recorded_at=v_first_in
    order by a.id limit 1;
  end if;
  if v_last_out is not null then
    select a.id into v_last_out_id from public.staff_attendance_logs a
    where a.staff_id=p_staff_id and a.status='accepted' and a.attendance_type='check_out' and a.recorded_at=v_last_out
    order by a.id desc limit 1;
  end if;

  if v_first_in is not null and v_last_out is not null and v_last_out>v_first_in then
    v_candidate:=round((extract(epoch from (v_last_out-v_first_in))/3600.0)::numeric,2);
  end if;
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
    'scheduled_start_at',v_expected_start,'scheduled_end_at',v_expected_end,'sync_complete_through',v_sync_complete_through,'sync_complete_for_shift',v_sync_complete,
    'accepted_events',coalesce(v_accepted,0),'check_in_count',coalesce(v_checkins,0),'check_out_count',coalesce(v_checkouts,0),'manual_review_events',coalesce(v_manual,0),'rejected_events',coalesce(v_rejected,0),
    'first_in',v_first_in,'last_out',v_last_out,'first_in_id',v_first_in_id,'last_out_id',v_last_out_id,'candidate_hours',coalesce(v_candidate,0),'late_minutes',coalesce(v_late,0),'early_leave_minutes',coalesce(v_early,0),
    'time_off_request_id',case when v_has_timeoff then v_timeoff.id else null end,'time_off_kind',case when v_has_timeoff then v_timeoff.request_kind else null end,'permission_attached',v_has_permission,
    'policy_version',v_policy_version,'late_grace_minutes',v_grace,'very_late_minutes',v_very_late,'resolution_status',v_status,'system_resolvable',v_system_resolvable,'finalizable',v_finalizable,
    'review_required',not v_system_resolvable,'reason',v_reason,'resolution_version',2
  );
end;
$function$;

revoke all on function public.dawaa_build_attendance_day_resolution_v2(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_build_attendance_day_resolution_v2(uuid,date) to service_role;

create or replace function public.get_attendance_day_resolution_v2(p_staff_id uuid,p_attendance_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare v_saved public.attendance_daily_summary%rowtype; v_branch text;
begin
  select s.branch into v_branch from public.staff s where s.id=p_staff_id limit 1;
  if not public.dawaa_can_read_staff_attendance_log(p_staff_id,v_branch) then raise exception 'not_authorized_for_attendance_resolution' using errcode='42501'; end if;
  select * into v_saved from public.attendance_daily_summary where staff_id=p_staff_id and attendance_date=p_attendance_date and coalesce(resolution_version,0)>=2 limit 1;
  if found then return to_jsonb(v_saved); end if;
  return public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date);
end;
$function$;

revoke all on function public.get_attendance_day_resolution_v2(uuid,date) from public,anon;
grant execute on function public.get_attendance_day_resolution_v2(uuid,date) to authenticated,service_role;
