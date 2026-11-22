-- «شوف ونفّذ» on «نسيان بصمة» failed with «تعذّر حفظ القرار» for two kinds of day:
--   * the punch it was meant to add was already there (the day had not been read again since it came in, e.g.
--     a night check-out the next morning). Adding a second one also opened a missing-punch incident that could
--     carry a deduction. The day is now read again from its punches and handed back for a decision;
--   * the employee is no longer active, which the missing-punch record refuses. It now says so clearly.
-- Also keeps the 12-hour cap on off-day spans that was applied live (dr_wael_quick_decision_span_cap_12h_v1).
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

  if p_decision in ('to_shift_end', 'from_shift_start') then
    if not exists (select 1 from public.staff s where s.id = p_staff_id and coalesce(s.active, false)) then
      raise exception 'quick_decision_staff_inactive' using errcode = '55000';
    end if;
    -- The punch it would add is already there: read the day again instead of adding a second one.
    if exists (
      select 1 from public.staff_attendance_logs l
      where l.staff_id = p_staff_id and l.shift_date = p_date and coalesce(l.status, '') <> 'rejected'
        and ((p_decision = 'to_shift_end' and l.attendance_type = 'check_out' and l.recorded_at > v_day.first_in)
          or (p_decision = 'from_shift_start' and l.attendance_type = 'check_in' and l.recorded_at < v_day.last_out))
    ) then
      if exists (select 1 from public.attendance_inline_review_holds_v1 h
                 where h.staff_id = p_staff_id and h.attendance_date = p_date) then
        perform public.dawaa_refresh_inline_attendance_review_v1(p_staff_id, p_date);
      else
        perform public.dawaa_materialize_attendance_day_internal_v3(p_staff_id, p_date);
      end if;
      return jsonb_build_object('approved', false, 'reread', true, 'decision', p_decision);
    end if;
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
