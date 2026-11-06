-- Shift edits by scope, and punch reading that understands the employee's real shifts.
--
-- 1) dawaa_biometric_semantic_decision_v1: a punch at least 3 hours after an accepted check-in of the same shift
--    is the check-out, wherever it falls in the schedule. Before this, a short day read as two check-ins and showed
--    as a forgotten check-out (real case: 16:30-22:30 with punches 14:18 and 20:04). Nothing else in it changes.
-- 2) dr_wael_resync_day_punches_internal_v1: never re-reads a punch a manager confirmed or a punch of a day a
--    manager approved.
-- 3) dr_wael_apply_shift_change_v1: a period can cover chosen weekdays only, and the days around the change are
--    rebuilt so an overnight shift gets its last punch back.
-- 4) get_dr_wael_open_day_punches_v1 (read only): the open days with the punches around them; the page reads them
--    against the suggested and known shifts. No money moves until a manager applies a shift.
-- 5) One-time rebuild of the open days that have two check-ins hours apart.

create or replace function public.dawaa_biometric_semantic_decision_v1(p_staff_id uuid, p_event_time timestamp with time zone, p_raw_type text, p_biometric_log_id uuid default null::uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_event_local timestamp;
  v_event_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_sched_date date;
  v_raw text:=case lower(trim(coalesce(p_raw_type,'')))
    when 'check_in' then 'check_in' when 'in' then 'check_in'
    when 'check_out' then 'check_out' when 'out' then 'check_out' else null end;
  v_type text; v_reason text; v_conf numeric:=0.50; v_dup uuid; v_mid timestamptz;
begin
  if p_staff_id is null or p_event_time is null then
    return jsonb_build_object('decision','review','semantic_type',v_raw,'confidence',0.20,'reason','missing_staff_or_time');
  end if;

  select l.biometric_source_log_id into v_dup
  from public.staff_attendance_logs l
  where l.staff_id=p_staff_id
    and l.biometric_method='fingerprint_terminal'
    and l.status='accepted'
    and l.biometric_source_log_id is not null
    and (l.recorded_at<p_event_time or
      (l.recorded_at=p_event_time and p_biometric_log_id is not null
       and l.biometric_source_log_id::text<p_biometric_log_id::text))
    and p_event_time-l.recorded_at between interval '0 seconds' and interval '120 seconds'
  order by l.recorded_at desc,l.id desc limit 1;
  if v_dup is not null then
    return jsonb_build_object('decision','duplicate','semantic_type',null,'confidence',0.99,
      'reason','same_employee_within_120_seconds','duplicate_of_log_id',v_dup);
  end if;

  v_event_local:=p_event_time at time zone 'Africa/Cairo';
  v_event_date:=v_event_local::date;

  with candidate_dates as (
    select v_event_date d union all select v_event_date-1 union all select v_event_date+1
  ), windows as (
    select d.d schedule_date,
      (d.d::timestamp+s.shift_start) at time zone 'Africa/Cairo' s_at,
      (((d.d+case when s.shift_end<=s.shift_start then 1 else 0 end)::timestamp+s.shift_end)
        at time zone 'Africa/Cairo') e_at
    from candidate_dates d
    join lateral public.attendance_schedule_for_date_v1(p_staff_id,d.d) s on true
    where s.shift_start is not null and s.shift_end is not null
      and not coalesce(s.is_off,false) and not coalesce(s.is_day_off,false)
  )
  select schedule_date,s_at,e_at into v_sched_date,v_start,v_end
  from windows
  where p_event_time between s_at-interval '4 hours' and e_at+interval '6 hours'
  order by least(abs(extract(epoch from(p_event_time-s_at))),abs(extract(epoch from(p_event_time-e_at))))
  limit 1;

  if v_start is null or v_end is null then
    return jsonb_build_object('decision',case when v_raw is null then 'review' else 'accepted' end,
      'semantic_type',v_raw,'confidence',case when v_raw is null then 0.20 else 0.45 end,
      'reason','no_matching_schedule_fallback_to_raw');
  end if;

  v_mid:=v_start+((v_end-v_start)/2);
  if p_event_time<=v_start+interval '4 hours' then
    v_type:='check_in'; v_reason:='schedule_start_window'; v_conf:=0.96;
  elsif p_event_time>=v_end-interval '4 hours' then
    v_type:='check_out'; v_reason:='schedule_end_window'; v_conf:=0.96;
  elsif p_event_time<v_mid then
    v_type:='check_in'; v_reason:='closer_to_shift_start'; v_conf:=0.82;
  else
    v_type:='check_out'; v_reason:='closer_to_shift_end'; v_conf:=0.82;
  end if;

  -- He already checked in on this shift hours ago: this punch is the leaving one.
  if v_type='check_in' and exists (
    select 1 from public.staff_attendance_logs l
    where l.staff_id=p_staff_id and l.shift_date=v_sched_date
      and l.status='accepted' and l.attendance_type='check_in'
      and l.biometric_source_log_id is distinct from p_biometric_log_id
      and p_event_time-l.recorded_at between interval '3 hours' and interval '16 hours'
  ) then
    v_type:='check_out'; v_reason:='second_punch_after_check_in'; v_conf:=0.85;
  end if;

  return jsonb_build_object('decision','accepted','semantic_type',v_type,'confidence',v_conf,
    'reason',v_reason,'schedule_date',v_sched_date,'scheduled_start_at',v_start,
    'scheduled_end_at',v_end,'raw_type',v_raw);
end;
$function$;

create or replace function public.dr_wael_resync_day_punches_internal_v1(p_staff_id uuid, p_date date)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_row record;
  v_raw text;
  v_decision jsonb;
  v_semantic text;
  v_name text;
  v_conf numeric;
  v_reason text;
  v_status text;
  v_rejection text;
  v_changed int := 0;
begin
  if p_staff_id is null or p_date is null then
    return 0;
  end if;
  for v_row in
    select sal.id as log_id, sal.attendance_type, sal.status, sal.shift_date, b.id as bio_id, b.punch_type,
           public.dawaa_fingerprint_effective_time_v1(b.provider, b.raw_payload, b.punch_time) as effective_time
    from public.staff_attendance_logs sal
    join public.biometric_attendance_logs b on b.id = sal.biometric_source_log_id
    left join public.biometric_semantic_decisions sd on sd.biometric_log_id = b.id
    where sal.staff_id = p_staff_id
      and sal.status in ('accepted', 'manual_review')
      and (sal.shift_date = p_date
           or (b.punch_time at time zone 'Africa/Cairo')::date = p_date)
      -- A reading a manager confirmed, or a punch of a day a manager approved, is not read again.
      and coalesce(sd.reason, '') !~ '^(manager_|manual_override)'
      and not exists (select 1 from public.attendance_daily_summary a
                      where a.staff_id = sal.staff_id and a.attendance_date = sal.shift_date
                        and a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%')
    order by b.punch_time
  loop
    v_raw := case lower(trim(coalesce(v_row.punch_type, '')))
      when 'check_in' then 'check_in' when 'in' then 'check_in'
      when 'check_out' then 'check_out' when 'out' then 'check_out'
      else null end;
    v_decision := public.dawaa_biometric_semantic_decision_v1(p_staff_id, v_row.effective_time, v_raw, v_row.bio_id);
    v_semantic := nullif(v_decision->>'semantic_type', '');
    v_name := coalesce(nullif(v_decision->>'decision', ''), 'review');
    v_conf := nullif(v_decision->>'confidence', '')::numeric;
    v_reason := v_decision->>'reason';

    if v_name = 'duplicate' then
      v_status := 'rejected';
      v_rejection := 'بصمة تأكيد مكررة خلال دقيقتين — محفوظة كسجل خام ولا تُحسب في الحضور';
    elsif v_name in ('review', 'manual_review') or v_semantic is null or coalesce(v_conf, 0) < 0.75 then
      v_status := 'manual_review';
      v_rejection := 'البصمة تحتاج مراجعة ذكية قبل الاحتساب — ' || coalesce(v_reason, 'سبب غير محدد');
    else
      v_status := 'accepted';
      v_rejection := null;
    end if;

    insert into public.biometric_semantic_decisions(
      biometric_log_id, staff_id, raw_type, semantic_type, decision, confidence, reason,
      schedule_date, scheduled_start_at, scheduled_end_at, duplicate_of_log_id, updated_at)
    values (
      v_row.bio_id, p_staff_id, v_raw, v_semantic, v_name, v_conf, v_reason,
      nullif(v_decision->>'schedule_date', '')::date,
      nullif(v_decision->>'scheduled_start_at', '')::timestamptz,
      nullif(v_decision->>'scheduled_end_at', '')::timestamptz,
      nullif(v_decision->>'duplicate_of_log_id', '')::uuid,
      now())
    on conflict (biometric_log_id) do update set
      staff_id = excluded.staff_id, raw_type = excluded.raw_type, semantic_type = excluded.semantic_type,
      decision = excluded.decision, confidence = excluded.confidence, reason = excluded.reason,
      schedule_date = excluded.schedule_date, scheduled_start_at = excluded.scheduled_start_at,
      scheduled_end_at = excluded.scheduled_end_at, duplicate_of_log_id = excluded.duplicate_of_log_id,
      updated_at = now();

    update public.staff_attendance_logs
    set attendance_type = coalesce(v_semantic, v_raw, attendance_type),
        status = v_status,
        rejection_reason = v_rejection,
        shift_date = coalesce(nullif(v_decision->>'schedule_date', '')::date, shift_date),
        updated_at = now()
    where id = v_row.log_id
      and (attendance_type is distinct from coalesce(v_semantic, v_raw, attendance_type)
           or status is distinct from v_status
           or shift_date is distinct from coalesce(nullif(v_decision->>'schedule_date', '')::date, shift_date));
    if found then
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end;
$function$;

revoke all on function public.dr_wael_resync_day_punches_internal_v1(uuid, date) from public, anon, authenticated;

create or replace function public.dr_wael_apply_shift_change_v1(
  p_staff_id uuid, p_start time, p_end time, p_mode text, p_from date,
  p_to date default null, p_days text[] default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_week text[] := array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  v_note text := coalesce(nullif(trim(p_note), ''), 'تعديل ميعاد من بصمات د وائل');
  v_staff public.staff%rowtype;
  v_to date;
  v_hours numeric;
  v_day text;
  v_date date;
  v_row record;
  v_override uuid;
  v_written int := 0;
  v_rebuilt int := 0;
  v_kept int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_written_dates date[] := '{}';
  v_covered boolean;
begin
  if p_staff_id is null or p_start is null or p_end is null or p_start = p_end or p_from is null
     or p_mode not in ('permanent', 'day', 'period') then
    raise exception 'invalid_shift_change' using errcode = '22023';
  end if;
  if p_from < v_today - 40 or p_from > v_today + 60 then
    raise exception 'shift_change_date_out_of_range' using errcode = '22023';
  end if;
  v_to := case p_mode when 'permanent' then null when 'day' then p_from else p_to end;
  if p_mode = 'period' and (v_to is null or v_to < p_from or v_to - p_from > 62) then
    raise exception 'invalid_shift_change_period' using errcode = '22023';
  end if;
  if p_days is not null and not (p_days <@ v_week) then
    raise exception 'invalid_shift_change_days' using errcode = '22023';
  end if;

  select * into v_staff from public.staff s
  where s.id = p_staff_id and s.is_active is true and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن');
  if not found then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;

  v_hours := round((extract(epoch from (p_end - p_start)) / 3600.0
                    + case when p_end <= p_start then 24 else 0 end)::numeric, 2);
  if v_hours > 18 then
    raise exception 'shift_change_exceeds_18_hours' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dr_wael_shift:' || p_staff_id::text, 0));

  if p_mode = 'permanent' then
    foreach v_day in array v_week loop
      select ss.* into v_row from public.shift_schedules ss
      where ss.staff_id = p_staff_id and ss.shift_date is null and ss.date is null and trim(ss.day_name) = v_day
        and ss.effective_from <= p_from and (ss.effective_to is null or ss.effective_to >= p_from)
      order by ss.effective_from desc, coalesce(ss.updated_at, ss.created_at) desc nulls last
      limit 1;
      if p_days is not null then
        if not (v_day = any(p_days)) then
          continue;
        end if;
      elsif found and (coalesce(v_row.is_off, false) or coalesce(v_row.is_day_off, false)) then
        continue;
      end if;

      if found and v_row.effective_from = p_from then
        update public.shift_schedules
        set shift_start = to_char(p_start, 'HH24:MI'), shift_end = to_char(p_end, 'HH24:MI'),
            start_time = p_start, end_time = p_end, hours = v_hours, is_off = false, is_day_off = false,
            has_custom_time = true, is_different = true, source = 'dr_wael_smart_shift_v1',
            notes = concat_ws(' | ', nullif(notes, ''), v_note)
        where id = v_row.id;
      else
        update public.shift_schedules
        set effective_to = p_from - 1,
            notes = concat_ws(' | ', nullif(notes, ''), 'أُغلق بميعاد جديد من بصمات د وائل')
        where staff_id = p_staff_id and shift_date is null and date is null and trim(day_name) = v_day
          and effective_from < p_from and (effective_to is null or effective_to >= p_from);
        insert into public.shift_schedules(
          staff_id, staff_name, employee_name, role, branch, day_name, shift_start, shift_end, start_time, end_time,
          hours, is_off, is_day_off, is_different, has_custom_time, notes, source, status, effective_from, effective_to)
        values (
          p_staff_id, v_staff.name, v_staff.name, v_staff.role, v_staff.branch, v_day,
          to_char(p_start, 'HH24:MI'), to_char(p_end, 'HH24:MI'), p_start, p_end,
          v_hours, false, false, true, true, v_note, 'dr_wael_smart_shift_v1', 'scheduled', p_from, null);
      end if;
      v_written := v_written + 1;
    end loop;
  else
    for v_date in select g::date from generate_series(p_from, v_to, interval '1 day') g loop
      -- A period can cover chosen weekdays only («كل خميس من .. لحد ..»); a weekday chosen by name is applied
      -- even if the schedule has it off.
      if p_mode = 'period' and p_days is not null and not (v_week[extract(dow from v_date)::int + 1] = any(p_days)) then
        continue;
      end if;
      select * into v_row from public.attendance_schedule_for_date_v1(p_staff_id, v_date) limit 1;
      if p_mode = 'period' and p_days is null and found and (coalesce(v_row.is_off, false) or coalesce(v_row.is_day_off, false)) then
        v_skipped := v_skipped || jsonb_build_object('date', v_date, 'reason', 'day_off');
        continue;
      end if;
      select ss.id into v_override from public.shift_schedules ss
      where ss.staff_id = p_staff_id and coalesce(ss.shift_date, ss.date) = v_date and ss.source = 'dr_wael_smart_shift_v1'
      order by coalesce(ss.updated_at, ss.created_at) desc nulls last limit 1;
      if found then
        update public.shift_schedules
        set shift_start = to_char(p_start, 'HH24:MI'), shift_end = to_char(p_end, 'HH24:MI'),
            start_time = p_start, end_time = p_end, hours = v_hours, is_off = false, is_day_off = false,
            notes = v_note
        where id = v_override;
      else
        insert into public.shift_schedules(
          staff_id, staff_name, employee_name, role, branch, day_name, shift_start, shift_end, start_time, end_time,
          hours, is_off, is_day_off, is_different, has_custom_time, shift_date, date, notes, source, status,
          effective_from, effective_to)
        values (
          p_staff_id, v_staff.name, v_staff.name, v_staff.role, v_staff.branch, v_week[extract(dow from v_date)::int + 1],
          to_char(p_start, 'HH24:MI'), to_char(p_end, 'HH24:MI'), p_start, p_end,
          v_hours, false, false, true, true, v_date, v_date, v_note, 'dr_wael_smart_shift_v1', 'scheduled',
          v_date, v_date);
      end if;
      v_written := v_written + 1;
      v_written_dates := v_written_dates || v_date;
    end loop;
  end if;

  -- Rebuild the past days the change covers, and the day on each side of them: an overnight shift leaves its
  -- last punch on the next date and a new shift can release a punch to the day before.
  for v_date in
    select distinct g::date
    from (
      select generate_series(greatest(p_from, v_today - 40) - 1, least(coalesce(v_to, v_today), v_today) + 1, interval '1 day') as g
      where p_mode = 'permanent'
      union all
      select generate_series(d - 1, d + 1, interval '1 day')
      from unnest(v_written_dates) d
    ) x
    where g::date between v_today - 41 and v_today
    order by 1
  loop
    v_covered := v_date = any(v_written_dates)
      or (p_mode = 'permanent' and v_date >= p_from and v_date <= least(coalesce(v_to, v_today), v_today));
    if exists (select 1 from public.attendance_daily_summary a
               where a.staff_id = p_staff_id and a.attendance_date = v_date
                 and a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%') then
      if v_covered then
        v_kept := v_kept + 1;
      end if;
      continue;
    end if;
    if not exists (select 1 from public.attendance_daily_summary a where a.staff_id = p_staff_id and a.attendance_date = v_date)
       and not exists (select 1 from public.staff_attendance_logs l where l.staff_id = p_staff_id and l.shift_date = v_date) then
      continue;
    end if;
    update public.attendance_daily_summary
    set status = 'pending_review', updated_at = now()
    where staff_id = p_staff_id and attendance_date = v_date and status = 'approved' and approved_by like 'system:%';
    -- Punches were typed (in/out) against the old shift; read them again on the new one first.
    perform public.dr_wael_resync_day_punches_internal_v1(p_staff_id, v_date);
    perform public.dawaa_materialize_attendance_day_internal_v3(p_staff_id, v_date);
    if v_covered then
      v_rebuilt := v_rebuilt + 1;
    end if;
  end loop;

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('shift', p_staff_id, jsonb_build_object('mode', p_mode, 'start', p_start, 'end', p_end, 'from', p_from,
    'to', v_to, 'days', to_jsonb(p_days), 'written', v_written, 'rebuilt', v_rebuilt, 'kept', v_kept,
    'skipped', v_skipped, 'note', v_note), v_actor);

  return jsonb_build_object('success', true, 'staff_id', p_staff_id, 'mode', p_mode, 'from', p_from, 'to', v_to,
    'rows_written', v_written, 'days_rebuilt', v_rebuilt, 'days_kept_manager_approved', v_kept, 'skipped', v_skipped);
end;
$function$;

create or replace function public.get_dr_wael_open_day_punches_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_days jsonb;
  v_punches jsonb;
begin
  perform public.dr_wael_fingerprints_actor_v1();

  with open_days as (
    select a.staff_id, a.attendance_date as day, a.resolution_status, coalesce(a.late_minutes, 0) as late,
           coalesce(a.early_leave_minutes, 0) as early
    from public.attendance_daily_summary a
    join public.staff s on s.id = a.staff_id
      and s.is_active is true and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن')
    where a.attendance_date between v_today - 40 and v_today and a.status = 'pending_review'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', o.staff_id, 'date', o.day, 'resolution', o.resolution_status, 'late', o.late, 'early', o.early,
      'scheduled_in', case when coalesce(sc.is_off, false) or coalesce(sc.is_day_off, false) then null else to_char(sc.shift_start, 'HH24:MI') end,
      'scheduled_out', case when coalesce(sc.is_off, false) or coalesce(sc.is_day_off, false) then null else to_char(sc.shift_end, 'HH24:MI') end)
    order by o.staff_id, o.day), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('staff_id', p.staff_id, 'at', p.at) order by p.staff_id, p.at)
      from (
        select distinct b.staff_id, to_char(b.punch_time at time zone 'Africa/Cairo', 'YYYY-MM-DD"T"HH24:MI') as at
        from public.biometric_attendance_logs b
        left join public.staff_attendance_logs l on l.biometric_source_log_id = b.id and l.staff_id = b.staff_id
        where b.staff_id in (select staff_id from open_days)
          and b.punch_time >= ((v_today - 42)::timestamp at time zone 'Africa/Cairo')
          and coalesce(l.status, 'accepted') <> 'rejected'
      ) p), '[]'::jsonb)
    into v_days, v_punches
  from open_days o
  left join lateral (select * from public.attendance_schedule_for_date_v1(o.staff_id, o.day) limit 1) sc on true;

  return jsonb_build_object('today', v_today, 'days', v_days, 'punches', v_punches);
end;
$function$;

revoke all on function public.get_dr_wael_open_day_punches_v1() from public;
grant execute on function public.get_dr_wael_open_day_punches_v1() to anon, authenticated;

-- One-time: the open days read as two check-ins hours apart.
do $repair$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_day record;
begin
  for v_day in
    select a.staff_id, a.attendance_date
    from public.attendance_daily_summary a
    where a.status = 'pending_review' and a.resolution_status = 'missing_checkout'
      and a.attendance_date between v_today - 40 and v_today
      and (select count(*) >= 2 and max(l.recorded_at) - min(l.recorded_at) >= interval '3 hours'
           from public.staff_attendance_logs l
           where l.staff_id = a.staff_id and l.shift_date = a.attendance_date
             and l.status = 'accepted' and l.attendance_type = 'check_in')
  loop
    perform public.dr_wael_rebuild_day_internal_v1(v_day.staff_id, v_day.attendance_date);
  end loop;
end;
$repair$;
