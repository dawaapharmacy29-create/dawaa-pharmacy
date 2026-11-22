-- Two attendance reading fixes from the November review.
--
-- 1) «كل جمعة باستمرار» from a date failed with «ماتسجلش» when the weekday already had a newer weekly row
--    (e.g. one opened on 11-04): only rows that started before the date were closed, so inserting the new
--    open row hit uq_shift_schedules_staff_day_active_v2. A permanent change from a date now replaces the
--    rows of that weekday that start after it; they are kept in the change log.
--
-- 2) The quick decision «اعتماد اليوم زي ما البصمات بتقول» approved a day off / no-schedule day with 0 hours
--    even when the punches showed a full shift (e.g. 13:03 → 22:26), because those days keep no first_in /
--    last_out on the summary. It now reads the day's own punches: two or more give the hours between the
--    first and the last one (the terminal sometimes types both as «حضور»); a single punch needs the full card.
--    «غياب» / «أوف» are refused on a day that has its own punches.

create or replace function public.dr_wael_day_own_punches_v1(p_staff_id uuid, p_date date)
returns table (punches int, first_at timestamptz, last_at timestamptz)
language sql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
  select count(*)::int, min(l.recorded_at), max(l.recorded_at)
  from public.staff_attendance_logs l
  where l.staff_id = p_staff_id and l.shift_date = p_date and coalesce(l.status, '') <> 'rejected'
    and not public.dr_wael_punch_belongs_to_neighbor_v1(p_staff_id, p_date);
$function$;

revoke all on function public.dr_wael_day_own_punches_v1(uuid, date) from public, anon, authenticated;

create or replace function public.dr_wael_quick_day_decision_v1(p_staff_id uuid, p_date date, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_day public.attendance_daily_summary%rowtype;
  v_route jsonb;
  v_note text;
  v_after public.attendance_daily_summary%rowtype;
  v_approved boolean := false;
  v_own record;
  v_hours numeric;
begin
  if p_staff_id is null or p_date is null
     or p_decision not in ('to_shift_end', 'from_shift_start', 'absent', 'off', 'as_is') then
    raise exception 'quick_decision_invalid' using errcode = '22023';
  end if;
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception 'invalid_or_expired_staff_session' using errcode = '42501';
  end if;

  select * into v_day from public.attendance_daily_summary
  where staff_id = p_staff_id and attendance_date = p_date;
  if not found then raise exception 'quick_decision_day_not_found' using errcode = '22023'; end if;
  if v_day.status = 'approved' then
    return jsonb_build_object('approved', true, 'already', true);
  end if;

  v_route := public.dawaa_attendance_engine_route_v1(p_staff_id);
  if v_route->>'route' is distinct from 'standard_v2' then
    raise exception 'quick_decision_needs_details' using errcode = '55000';
  end if;

  -- The punches the day really has, also on days the summary keeps none (off day, no schedule).
  select * into v_own from public.dr_wael_day_own_punches_v1(p_staff_id, p_date);

  if p_decision = 'to_shift_end' then
    if v_day.resolution_status <> 'missing_checkout' or v_day.first_in is null or v_day.scheduled_end_at is null then
      raise exception 'quick_decision_needs_details' using errcode = '55000';
    end if;
    v_note := 'قرار سريع: انصراف على ميعاد آخر الشيفت (نسيان بصمة الانصراف)';
    perform public.resolve_missing_punch_incident_v1(p_staff_id, p_date, 'check_out', v_day.scheduled_end_at, v_note, false);
  elsif p_decision = 'from_shift_start' then
    if v_day.resolution_status <> 'missing_checkin' or v_day.last_out is null or v_day.scheduled_start_at is null then
      raise exception 'quick_decision_needs_details' using errcode = '55000';
    end if;
    v_note := 'قرار سريع: حضور على ميعاد أول الشيفت (نسيان بصمة الحضور)';
    perform public.resolve_missing_punch_incident_v1(p_staff_id, p_date, 'check_in', v_day.scheduled_start_at, v_note, false);
  elsif p_decision in ('absent', 'off') then
    if v_day.first_in is not null or v_day.last_out is not null or coalesce(v_own.punches, 0) > 0 then
      raise exception 'quick_decision_needs_details' using errcode = '55000';
    end if;
    if p_decision = 'off' then
      perform public.approve_attendance_full_day_timeoff_v1(p_staff_id, p_date, 'approved_absence',
        'قرار سريع: أوف / غياب بإذن — من غير خصم');
      return jsonb_build_object('approved', true, 'decision', p_decision);
    end if;
    v_note := 'قرار سريع: غياب من غير إذن (اليوم من غير أجر)';
    perform public.approve_attendance_day_resolution_v2(p_staff_id, p_date, 0, v_note);
    return jsonb_build_object('approved', true, 'decision', p_decision);
  else
    if v_day.resolution_status not in ('late', 'early_leave_review', 'off_day', 'no_schedule', 'approved_time_off', 'worked_on_off')
       or (v_day.resolution_status in ('late', 'early_leave_review') and (v_day.first_in is null or v_day.last_out is null)) then
      raise exception 'quick_decision_needs_details' using errcode = '55000';
    end if;
    v_note := 'قرار سريع: اعتماد اليوم زي ما البصمات بتقول';
    if v_day.resolution_status in ('off_day', 'no_schedule', 'approved_time_off', 'worked_on_off')
       and coalesce(v_own.punches, 0) > 0 then
      -- One punch can't tell the hours; the full card asks for them.
      if v_own.punches < 2 then
        raise exception 'quick_decision_needs_details' using errcode = '55000';
      end if;
      v_hours := round((extract(epoch from (v_own.last_at - v_own.first_at)) / 3600.0)::numeric, 2);
      -- Over 12 hours is two shifts' punches (e.g. 04:00 → 20:20), not one day's work.
      if v_hours <= 0 or v_hours > 12 then
        raise exception 'quick_decision_needs_details' using errcode = '55000';
      end if;
      v_note := v_note || ' (' || to_char(v_own.first_at at time zone 'Africa/Cairo', 'HH24:MI') || ' → '
        || to_char(v_own.last_at at time zone 'Africa/Cairo', 'HH24:MI') || ')';
      perform public.approve_attendance_day_resolution_v2(p_staff_id, p_date, v_hours, v_note);
      return jsonb_build_object('approved', true, 'decision', p_decision, 'hours', v_hours);
    end if;
    perform public.approve_attendance_day_resolution_v2(p_staff_id, p_date, null, v_note);
    return jsonb_build_object('approved', true, 'decision', p_decision);
  end if;

  select * into v_after from public.attendance_daily_summary
  where staff_id = p_staff_id and attendance_date = p_date;
  if v_after.status = 'approved' then
    v_approved := true;
  else
    begin
      perform public.approve_attendance_day_resolution_v2(p_staff_id, p_date, null, v_note);
      v_approved := true;
    exception when others then
      v_approved := false;
    end;
  end if;
  return jsonb_build_object('approved', v_approved, 'decision', p_decision);
end;
$function$;

revoke all on function public.dr_wael_quick_day_decision_v1(uuid, date, text) from public;
grant execute on function public.dr_wael_quick_day_decision_v1(uuid, date, text) to anon, authenticated, service_role;

create or replace function public.dr_wael_apply_shift_change_v1(p_staff_id uuid, p_start time without time zone, p_end time without time zone, p_mode text, p_from date, p_to date default null::date, p_days text[] default null::text[], p_note text default null::text, p_origin text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_catalog'
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
  v_has_row boolean;
  v_override uuid;
  v_written int := 0;
  v_rebuilt int := 0;
  v_kept int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_replaced jsonb := '[]'::jsonb;
  v_written_dates date[] := '{}';
  v_covered boolean;
  v_old record;
  v_old_hours numeric;
begin
  if p_origin is not null and p_origin not in ('management', 'employee', 'correction') then
    raise exception 'invalid_shift_origin' using errcode = '22023';
  end if;
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

  -- The shift it replaces, read before anything is written: the credit shows whether the hours went down.
  select * into v_old from public.attendance_schedule_for_date_v1(p_staff_id, p_from) limit 1;
  if found and not coalesce(v_old.is_off, false) and not coalesce(v_old.is_day_off, false)
     and v_old.shift_start is not null and v_old.shift_end is not null then
    v_old_hours := round((extract(epoch from (v_old.shift_end - v_old.shift_start)) / 3600.0
                          + case when v_old.shift_end <= v_old.shift_start then 24 else 0 end)::numeric, 2);
  end if;

  if p_mode = 'permanent' then
    foreach v_day in array v_week loop
      select ss.* into v_row from public.shift_schedules ss
      where ss.staff_id = p_staff_id and ss.shift_date is null and ss.date is null and trim(ss.day_name) = v_day
        and ss.effective_from <= p_from and (ss.effective_to is null or ss.effective_to >= p_from)
      order by ss.effective_from desc, coalesce(ss.updated_at, ss.created_at) desc nulls last
      limit 1;
      v_has_row := found;
      if p_days is not null then
        if not (v_day = any(p_days)) then
          continue;
        end if;
      elsif v_has_row and (coalesce(v_row.is_off, false) or coalesce(v_row.is_day_off, false)) then
        continue;
      end if;

      -- «From p_from on» replaces this weekday's rows that start after it. One left open also blocked the new
      -- open row (uq_shift_schedules_staff_day_active_v2) and the change failed with «ماتسجلش».
      with gone as (
        delete from public.shift_schedules
        where staff_id = p_staff_id and shift_date is null and date is null and trim(day_name) = v_day
          and effective_from > p_from
        returning id, day_name, shift_start, shift_end, is_off, effective_from, effective_to, source
      )
      select v_replaced || coalesce(jsonb_agg(to_jsonb(gone)), '[]'::jsonb) into v_replaced from gone;

      if v_has_row and v_row.effective_from = p_from then
        update public.shift_schedules
        set shift_start = to_char(p_start, 'HH24:MI'), shift_end = to_char(p_end, 'HH24:MI'),
            start_time = p_start, end_time = p_end, hours = v_hours, is_off = false, is_day_off = false,
            has_custom_time = true, is_different = true, source = 'dr_wael_smart_shift_v1', effective_to = null,
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
    'skipped', v_skipped, 'replaced', v_replaced, 'note', v_note, 'origin', p_origin,
    'old_start', case when v_old_hours is not null then v_old.shift_start end,
    'old_end', case when v_old_hours is not null then v_old.shift_end end,
    'old_hours', v_old_hours, 'new_hours', v_hours), v_actor);

  return jsonb_build_object('success', true, 'staff_id', p_staff_id, 'mode', p_mode, 'from', p_from, 'to', v_to,
    'rows_written', v_written, 'days_rebuilt', v_rebuilt, 'days_kept_manager_approved', v_kept, 'skipped', v_skipped);
end;
$function$;

revoke all on function public.dr_wael_apply_shift_change_v1(uuid, time, time, text, date, date, text[], text, text) from public;
grant execute on function public.dr_wael_apply_shift_change_v1(uuid, time, time, text, date, date, text[], text, text) to anon, authenticated, service_role;
