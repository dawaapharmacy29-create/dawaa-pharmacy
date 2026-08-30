alter table public.attendance_daily_summary
  add column if not exists schedule_id uuid,
  add column if not exists scheduled_start_at timestamptz,
  add column if not exists scheduled_end_at timestamptz,
  add column if not exists candidate_hours numeric,
  add column if not exists payroll_eligible_hours numeric,
  add column if not exists resolution_status text,
  add column if not exists resolution_version integer,
  add column if not exists resolution_snapshot jsonb,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text,
  add column if not exists approved_by_name text,
  add column if not exists approval_note text;

drop policy if exists attendance_daily_summary_insert_app on public.attendance_daily_summary;
drop policy if exists attendance_daily_summary_update_app on public.attendance_daily_summary;
drop policy if exists attendance_daily_summary_select_app on public.attendance_daily_summary;
revoke all on table public.attendance_daily_summary from anon, authenticated;
grant all on table public.attendance_daily_summary to service_role;

create or replace function public.dawaa_build_attendance_day_resolution_v1(
  p_staff_id uuid,
  p_attendance_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_day_ar text;
  v_sched public.shift_schedules%rowtype;
  v_has_schedule boolean:=false;
  v_off boolean:=false;
  v_start_time time;
  v_end_time time;
  v_expected_start timestamptz;
  v_expected_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
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
  v_ready boolean:=false;
  v_branch text;
  v_staff_name text;
  v_reason text;
begin
  if p_staff_id is null or p_attendance_date is null then
    raise exception 'attendance_resolution_identity_or_date_missing' using errcode='22023';
  end if;

  v_day_ar:=case extract(dow from p_attendance_date)::int
    when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
    when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end;

  select coalesce(s.name,sa.staff_name,sa.name,sa.username), coalesce(s.branch,sa.branch)
    into v_staff_name,v_branch
  from public.staff_accounts sa
  left join public.staff s on s.id::text=sa.staff_id::text
  where trim(coalesce(sa.staff_id,''))=p_staff_id::text or sa.id=p_staff_id
  order by (trim(coalesce(sa.staff_id,''))=p_staff_id::text) desc, coalesce(sa.active,true) desc
  limit 1;

  select ss.* into v_sched
  from public.shift_schedules ss
  where ss.staff_id=p_staff_id and trim(coalesce(ss.day_name,''))=v_day_ar
  order by ss.updated_at desc nulls last, ss.created_at desc nulls last, ss.id desc
  limit 1;
  v_has_schedule:=found;

  if v_has_schedule then
    v_branch:=coalesce(v_sched.branch,v_branch);
    v_off:=coalesce(v_sched.is_off,false) or coalesce(v_sched.is_day_off,false);
    if not v_off and coalesce(trim(v_sched.shift_start),'') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
       and coalesce(trim(v_sched.shift_end),'') ~ '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' then
      v_start_time:=v_sched.shift_start::time;
      v_end_time:=v_sched.shift_end::time;
      v_expected_start:=(p_attendance_date::timestamp+v_start_time) at time zone 'Africa/Cairo';
      v_expected_end:=((p_attendance_date + case when v_end_time<=v_start_time then 1 else 0 end)::timestamp+v_end_time) at time zone 'Africa/Cairo';
    end if;
  end if;

  if v_expected_start is not null and v_expected_end is not null then
    v_window_start:=v_expected_start-interval '4 hours';
    v_window_end:=v_expected_end+interval '4 hours';
  else
    v_window_start:=p_attendance_date::timestamp at time zone 'Africa/Cairo';
    v_window_end:=((p_attendance_date+1)::timestamp+interval '6 hours') at time zone 'Africa/Cairo';
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
  if v_expected_start is not null and v_first_in is not null then
    v_late:=greatest(0,round(extract(epoch from (v_first_in-v_expected_start))/60.0)::integer);
  end if;
  if v_expected_end is not null and v_last_out is not null then
    v_early:=greatest(0,round(extract(epoch from (v_expected_end-v_last_out))/60.0)::integer);
  end if;

  if not v_has_schedule then v_status:='no_schedule'; v_reason:='no_canonical_staff_schedule';
  elsif v_off and coalesce(v_accepted,0)=0 and coalesce(v_manual,0)=0 and coalesce(v_rejected,0)=0 then v_status:='ready_off_day'; v_ready:=true;
  elsif v_off then v_status:='off_day_with_events'; v_reason:='attendance_events_on_scheduled_off_day';
  elsif v_expected_start is null or v_expected_end is null then v_status:='invalid_schedule_time'; v_reason:='schedule_time_missing_or_invalid';
  elsif coalesce(v_manual,0)>0 or coalesce(v_rejected,0)>0 then v_status:='needs_event_review'; v_reason:='manual_or_rejected_events_present';
  elsif coalesce(v_checkins,0)<>1 or coalesce(v_checkouts,0)<>1 then v_status:='missing_or_duplicate_punch'; v_reason:='expected_exactly_one_accepted_checkin_and_checkout';
  elsif v_candidate<=0 or v_candidate>18 then v_status:='invalid_duration'; v_reason:='worked_duration_outside_0_18h';
  else v_status:='ready'; v_ready:=true;
  end if;

  return jsonb_build_object(
    'staff_id',p_staff_id,'staff_name',v_staff_name,'attendance_date',p_attendance_date,'branch',v_branch,
    'schedule_id',case when v_has_schedule then v_sched.id else null end,'schedule_source',case when v_has_schedule then v_sched.source else null end,
    'day_name',v_day_ar,'is_off_day',v_off,'scheduled_start_at',v_expected_start,'scheduled_end_at',v_expected_end,
    'accepted_events',coalesce(v_accepted,0),'check_in_count',coalesce(v_checkins,0),'check_out_count',coalesce(v_checkouts,0),
    'manual_review_events',coalesce(v_manual,0),'rejected_events',coalesce(v_rejected,0),
    'first_in',v_first_in,'last_out',v_last_out,'first_in_id',v_first_in_id,'last_out_id',v_last_out_id,
    'candidate_hours',coalesce(v_candidate,0),'late_minutes',coalesce(v_late,0),'early_leave_minutes',coalesce(v_early,0),
    'resolution_status',v_status,'ready_for_approval',v_ready,'reason',v_reason,'resolution_version',1
  );
end;
$function$;

revoke all on function public.dawaa_build_attendance_day_resolution_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_build_attendance_day_resolution_v1(uuid,date) to service_role;

create or replace function public.get_attendance_day_resolution_v1(p_staff_id uuid,p_attendance_date date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_username text;
  v_saved public.attendance_daily_summary%rowtype;
begin
  select sa.username into v_username from public.staff_accounts sa
  where trim(coalesce(sa.staff_id,''))=p_staff_id::text or sa.id=p_staff_id
  order by (trim(coalesce(sa.staff_id,''))=p_staff_id::text) desc,coalesce(sa.active,true) desc limit 1;
  if v_username is null then raise exception 'attendance_resolution_staff_identity_missing'; end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_username) then raise exception 'not_authorized_for_attendance_resolution' using errcode='42501'; end if;

  select * into v_saved from public.attendance_daily_summary
  where staff_id=p_staff_id and attendance_date=p_attendance_date and status='approved' limit 1;
  if found then
    return coalesce(v_saved.resolution_snapshot,'{}'::jsonb)||jsonb_build_object(
      'approved',true,'payroll_eligible_hours',v_saved.payroll_eligible_hours,'approved_at',v_saved.approved_at,
      'approved_by',v_saved.approved_by,'approved_by_name',v_saved.approved_by_name,'approval_note',v_saved.approval_note
    );
  end if;
  return public.dawaa_build_attendance_day_resolution_v1(p_staff_id,p_attendance_date)||jsonb_build_object('approved',false);
end;
$function$;

revoke all on function public.get_attendance_day_resolution_v1(uuid,date) from public;
grant execute on function public.get_attendance_day_resolution_v1(uuid,date) to anon,authenticated,service_role;

create or replace function public.approve_attendance_day_resolution_v1(
  p_staff_id uuid,
  p_attendance_date date,
  p_payroll_eligible_hours numeric default null,
  p_note text default null
)
returns public.attendance_daily_summary
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_username text;
  v_actor_id text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_preview jsonb;
  v_candidate numeric;
  v_hours numeric;
  v_ready boolean;
  v_saved public.attendance_daily_summary%rowtype;
begin
  select sa.username into v_username from public.staff_accounts sa
  where trim(coalesce(sa.staff_id,''))=p_staff_id::text or sa.id=p_staff_id
  order by (trim(coalesce(sa.staff_id,''))=p_staff_id::text) desc,coalesce(sa.active,true) desc limit 1;
  if v_username is null then raise exception 'attendance_resolution_staff_identity_missing'; end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_username) then raise exception 'not_authorized_for_attendance_resolution' using errcode='42501'; end if;

  select * into v_saved from public.attendance_daily_summary
  where staff_id=p_staff_id and attendance_date=p_attendance_date and status='approved' for update;
  if found then return v_saved; end if;

  v_preview:=public.dawaa_build_attendance_day_resolution_v1(p_staff_id,p_attendance_date);
  v_candidate:=coalesce((v_preview->>'candidate_hours')::numeric,0);
  v_ready:=coalesce((v_preview->>'ready_for_approval')::boolean,false);
  v_hours:=coalesce(p_payroll_eligible_hours,v_candidate);

  if v_hours<0 or v_hours>18 then raise exception 'attendance_resolution_hours_out_of_range' using errcode='22023'; end if;
  if not v_ready and (p_payroll_eligible_hours is null or nullif(trim(coalesce(p_note,'')),'') is null) then
    raise exception 'attendance_resolution_override_requires_hours_and_note' using errcode='22023';
  end if;
  if p_payroll_eligible_hours is not null and abs(v_hours-v_candidate)>0.01 and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception 'attendance_resolution_changed_hours_require_note' using errcode='22023';
  end if;

  select coalesce(sa.name,sa.staff_name,sa.username) into v_actor_name from public.staff_accounts sa where sa.id::text=v_actor_id limit 1;

  insert into public.attendance_daily_summary(
    staff_id,attendance_date,branch,first_in,last_out,total_hours,late_minutes,early_leave_minutes,missing_punch,status,source,
    schedule_id,scheduled_start_at,scheduled_end_at,candidate_hours,payroll_eligible_hours,resolution_status,resolution_version,
    resolution_snapshot,approved_at,approved_by,approved_by_name,approval_note,updated_at
  ) values(
    p_staff_id,p_attendance_date,v_preview->>'branch',nullif(v_preview->>'first_in','')::timestamptz,nullif(v_preview->>'last_out','')::timestamptz,
    v_candidate,coalesce((v_preview->>'late_minutes')::integer,0),coalesce((v_preview->>'early_leave_minutes')::integer,0),
    not v_ready,'approved','attendance_resolution_v1',nullif(v_preview->>'schedule_id','')::uuid,
    nullif(v_preview->>'scheduled_start_at','')::timestamptz,nullif(v_preview->>'scheduled_end_at','')::timestamptz,
    v_candidate,v_hours,v_preview->>'resolution_status',1,
    v_preview||jsonb_build_object('approved_payroll_eligible_hours',v_hours,'approval_note',nullif(trim(coalesce(p_note,'')),'')),
    now(),v_actor_id,v_actor_name,nullif(trim(coalesce(p_note,'')),''),now()
  )
  on conflict(staff_id,attendance_date) where staff_id is not null and attendance_date is not null do update
  set branch=excluded.branch,first_in=excluded.first_in,last_out=excluded.last_out,total_hours=excluded.total_hours,
      late_minutes=excluded.late_minutes,early_leave_minutes=excluded.early_leave_minutes,missing_punch=excluded.missing_punch,
      status=excluded.status,source=excluded.source,schedule_id=excluded.schedule_id,scheduled_start_at=excluded.scheduled_start_at,
      scheduled_end_at=excluded.scheduled_end_at,candidate_hours=excluded.candidate_hours,payroll_eligible_hours=excluded.payroll_eligible_hours,
      resolution_status=excluded.resolution_status,resolution_version=excluded.resolution_version,resolution_snapshot=excluded.resolution_snapshot,
      approved_at=excluded.approved_at,approved_by=excluded.approved_by,approved_by_name=excluded.approved_by_name,
      approval_note=excluded.approval_note,updated_at=excluded.updated_at
  where public.attendance_daily_summary.status is distinct from 'approved'
  returning * into v_saved;

  if v_saved.id is null then
    select * into v_saved from public.attendance_daily_summary where staff_id=p_staff_id and attendance_date=p_attendance_date limit 1;
  end if;
  return v_saved;
end;
$function$;

revoke all on function public.approve_attendance_day_resolution_v1(uuid,date,numeric,text) from public;
grant execute on function public.approve_attendance_day_resolution_v1(uuid,date,numeric,text) to anon,authenticated,service_role;
