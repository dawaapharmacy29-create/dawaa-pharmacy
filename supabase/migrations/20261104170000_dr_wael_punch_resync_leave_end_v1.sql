-- بصمات د وائل: re-read punches after a shift change, a leave for a period, and ending a leave on the return day.
--
-- 1) A punch is typed check_in / check_out once, when it arrives, against the shift of that moment. When the shift is
--    changed afterwards (e.g. د رضا 10–18 → 14:30–20:30 from 21/10) the old typing stayed, so every punch read as a
--    check-out and the day showed «لا يوجد سجل حضور». dr_wael_resync_day_punches_internal_v1 types the day's machine
--    punches again on the current schedule, in order, the same way dawaa_promote_biometric_attendance_v1 does, and
--    dr_wael_apply_shift_change_v1 now calls it before rebuilding each past day.
-- 2) dr_wael_set_leave_v1: an approved leave for a period from the page (create + decide v3, so the leave policy and
--    the annual balance checks still apply, in one transaction).
-- 3) dr_wael_end_leave_v1: ends an approved leave the day the employee came back (an open-ended leave stays open
--    until someone closes it; د محمد وليد's leave from 13/10 was still open while he punched from 31/10). The days
--    from the return date are rebuilt from the punches. Annual leave is not shortened here (its balance ledger is
--    per request), it is cancelled and re-entered instead.
-- Archiving goes through hr_staff_lifecycle_change_v2 from the page (request by one manager, approval by the other).

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
    where sal.staff_id = p_staff_id
      and sal.status in ('accepted', 'manual_review')
      and (sal.shift_date = p_date
           or (b.punch_time at time zone 'Africa/Cairo')::date = p_date)
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

-- Rebuild one past day from its punches unless a manager approved it by hand. Returns true when rebuilt.
create or replace function public.dr_wael_rebuild_day_internal_v1(p_staff_id uuid, p_date date)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if exists (select 1 from public.attendance_daily_summary a
             where a.staff_id = p_staff_id and a.attendance_date = p_date
               and a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%') then
    return false;
  end if;
  perform public.dr_wael_resync_day_punches_internal_v1(p_staff_id, p_date);
  update public.attendance_daily_summary
  set status = 'pending_review', updated_at = now()
  where staff_id = p_staff_id and attendance_date = p_date and status = 'approved' and approved_by like 'system:%';
  perform public.dawaa_materialize_attendance_day_internal_v3(p_staff_id, p_date);
  return true;
end;
$function$;

revoke all on function public.dr_wael_rebuild_day_internal_v1(uuid, date) from public, anon, authenticated;

create or replace function public.dr_wael_set_leave_v1(
  p_staff_id uuid, p_kind text, p_from date, p_to date, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_labels jsonb := '{"approved_absence":"إجازة بإذن الإدارة","annual_leave":"إجازة اعتيادية","sick_leave":"إجازة مرضي","exceptional_leave":"إجازة استثنائية"}';
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'إجازة لفترة من بصمات د وائل');
  v_request public.staff_time_off_requests%rowtype;
  v_decided public.staff_time_off_requests%rowtype;
begin
  if p_staff_id is null or p_from is null or p_to is null or p_to < p_from or not (v_labels ? coalesce(p_kind, '')) then
    raise exception 'invalid_leave_request' using errcode = '22023';
  end if;
  if p_to - p_from > 92 or p_from < v_today - 40 or p_from > v_today + 120 then
    raise exception 'leave_period_out_of_range' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff_id and s.is_active is true
                   and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن')) then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;

  v_request := public.create_staff_time_off_request_v1(
    p_staff_id, p_kind, v_labels->>p_kind, p_from, p_to, null, null, null, v_reason);
  v_decided := public.decide_staff_time_off_request_v3(v_request.id, 'approved', v_reason);

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('leave', p_staff_id, jsonb_build_object('request_id', v_decided.id, 'kind', p_kind, 'from', p_from,
    'to', p_to, 'reason', v_reason), v_actor);

  return jsonb_build_object('success', true, 'request_id', v_decided.id, 'status', v_decided.status,
    'from', v_decided.start_date, 'to', v_decided.end_date);
end;
$function$;

create or replace function public.dr_wael_end_leave_v1(p_request_id uuid, p_return_date date, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_note text := coalesce(nullif(trim(p_note), ''), 'رجع للشغل — إنهاء الإجازة من بصمات د وائل');
  v_before public.staff_time_off_requests%rowtype;
  v_after public.staff_time_off_requests%rowtype;
  v_actor_name text;
  v_date date;
  v_rebuilt int := 0;
  v_kept int := 0;
  v_cancelled boolean := false;
begin
  if p_request_id is null or p_return_date is null or p_return_date > v_today + 60 then
    raise exception 'invalid_leave_end' using errcode = '22023';
  end if;
  select * into v_before from public.staff_time_off_requests where id = p_request_id for update;
  if not found or v_before.status <> 'approved' or v_before.request_kind = 'permission'
     or v_before.request_kind = 'shift_swap' then
    raise exception 'leave_not_found_or_not_approved' using errcode = '22023';
  end if;
  if v_before.end_date < p_return_date then
    raise exception 'leave_already_ends_before_return' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff s where s.id = v_before.staff_id
                   and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن')) then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;
  if p_return_date < v_today - 40 then
    raise exception 'leave_end_date_out_of_range' using errcode = '22023';
  end if;

  if p_return_date <= v_before.start_date then
    -- Came back before the leave started: nothing of it was taken.
    v_after := public.cancel_staff_time_off_request_v1(p_request_id, v_note);
    v_cancelled := true;
  elsif v_before.request_kind = 'annual_leave' then
    raise exception 'annual_leave_cancel_and_reenter' using errcode = '22023';
  else
    select coalesce(sa.staff_name, sa.name, sa.username) into v_actor_name
    from public.staff_accounts sa where sa.id = v_actor;
    update public.staff_time_off_requests
    set end_date = p_return_date - 1,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'open_ended', false, 'return_date_pending', false, 'return_date', p_return_date,
          'original_end_date', v_before.end_date, 'ended_by', v_actor, 'ended_at', now()),
        decision_note = concat_ws(' | ', nullif(decision_note, ''), v_note || ' — آخر يوم إجازة ' || (p_return_date - 1)),
        updated_at = now()
    where id = p_request_id
    returning * into v_after;
    insert into public.staff_time_off_audit(request_id, staff_id, action, actor_id, actor_name, actor_role,
      before_state, after_state, reason)
    values (v_after.id, v_after.staff_id, 'end_date_shortened', v_actor::text, v_actor_name, 'dr_wael_fingerprints',
      to_jsonb(v_before), to_jsonb(v_after), v_note);
  end if;

  -- A leave «until further notice» also hid the employee from the schedule; show them again.
  if v_before.source = 'manager_open_ended_leave' then
    update public.staff set visible_in_schedule = true, updated_at = now()
    where id = v_before.staff_id and is_active is true and visible_in_schedule is false;
  end if;

  for v_date in select g::date from generate_series(p_return_date, least(v_before.end_date, v_today), interval '1 day') g loop
    if public.dr_wael_rebuild_day_internal_v1(v_before.staff_id, v_date) then
      v_rebuilt := v_rebuilt + 1;
    else
      v_kept := v_kept + 1;
    end if;
  end loop;

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('leave_end', v_before.staff_id, jsonb_build_object('request_id', p_request_id, 'return_date', p_return_date,
    'original_end_date', v_before.end_date, 'cancelled', v_cancelled, 'rebuilt', v_rebuilt, 'kept', v_kept,
    'note', v_note), v_actor);

  return jsonb_build_object('success', true, 'request_id', p_request_id, 'cancelled', v_cancelled,
    'return_date', p_return_date, 'days_rebuilt', v_rebuilt, 'days_kept_manager_approved', v_kept);
end;
$function$;

revoke all on function public.dr_wael_set_leave_v1(uuid, text, date, date, text) from public;
revoke all on function public.dr_wael_end_leave_v1(uuid, date, text) from public;
grant execute on function public.dr_wael_set_leave_v1(uuid, text, date, date, text) to anon, authenticated;
grant execute on function public.dr_wael_end_leave_v1(uuid, date, text) to anon, authenticated;

-- Same shift change as before; it now re-reads the day's punches before each rebuild.
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
      select * into v_row from public.attendance_schedule_for_date_v1(p_staff_id, v_date) limit 1;
      if p_mode = 'period' and found and (coalesce(v_row.is_off, false) or coalesce(v_row.is_day_off, false)) then
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
    end loop;
  end if;

  -- Rebuild the past days the change covers.
  for v_date in
    select g::date from generate_series(greatest(p_from, v_today - 40), least(coalesce(v_to, v_today), v_today), interval '1 day') g
  loop
    if exists (select 1 from public.attendance_daily_summary a
               where a.staff_id = p_staff_id and a.attendance_date = v_date
                 and a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%') then
      v_kept := v_kept + 1;
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
    v_rebuilt := v_rebuilt + 1;
  end loop;

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('shift', p_staff_id, jsonb_build_object('mode', p_mode, 'start', p_start, 'end', p_end, 'from', p_from,
    'to', v_to, 'days', to_jsonb(p_days), 'written', v_written, 'rebuilt', v_rebuilt, 'kept', v_kept,
    'skipped', v_skipped, 'note', v_note), v_actor);

  return jsonb_build_object('success', true, 'staff_id', p_staff_id, 'mode', p_mode, 'from', p_from, 'to', v_to,
    'rows_written', v_written, 'days_rebuilt', v_rebuilt, 'days_kept_manager_approved', v_kept, 'skipped', v_skipped);
end;
$function$;

-- One-time repair: the days already rebuilt by earlier shift changes kept the old in/out typing.
do $repair$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_change record;
  v_date date;
begin
  for v_change in
    select distinct staff_id,
           greatest((payload->>'from')::date, v_today - 40) as d_from,
           least(coalesce((payload->>'to')::date, v_today), v_today) as d_to
    from public.dr_wael_change_log_v1
    where kind = 'shift' and payload ? 'from'
  loop
    for v_date in select g::date from generate_series(v_change.d_from, v_change.d_to, interval '1 day') g loop
      perform public.dr_wael_rebuild_day_internal_v1(v_change.staff_id, v_date);
    end loop;
  end loop;
end;
$repair$;
