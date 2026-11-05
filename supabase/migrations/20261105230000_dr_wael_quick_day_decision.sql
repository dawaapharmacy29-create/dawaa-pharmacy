-- One-click decisions next to each day waiting for review on «بصمات د وائل» (owner request 2026-11-05).
-- A thin wrapper over the existing, audited decision routines; it only picks the right one for the day's
-- state and refuses anything that is not a plain case, so the detailed review stays the path for the rest.
--   to_shift_end  : missing check-out  -> manual check-out at the scheduled end (no deduction), then approve
--   from_shift_start : missing check-in -> manual check-in at the scheduled start (no deduction), then approve
--   absent        : no punch at all     -> approve the day with 0 hours (unpaid absence)
--   off           : no punch at all     -> excused absence (approved_absence), no penalty
--   as_is         : complete punches (late / early leave / off day / no schedule) -> approve what the punches say
-- Only the standard engine (standard_v2); flexible staff keep the detailed review.

create or replace function public.dr_wael_quick_day_decision_v1(p_staff_id uuid, p_date date, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_day public.attendance_daily_summary%rowtype;
  v_route jsonb;
  v_note text;
  v_after public.attendance_daily_summary%rowtype;
  v_approved boolean := false;
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
    if v_day.first_in is not null or v_day.last_out is not null then
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
    if v_day.resolution_status not in ('late', 'early_leave_review', 'off_day', 'no_schedule', 'approved_time_off')
       or (v_day.resolution_status in ('late', 'early_leave_review') and (v_day.first_in is null or v_day.last_out is null)) then
      raise exception 'quick_decision_needs_details' using errcode = '55000';
    end if;
    v_note := 'قرار سريع: اعتماد اليوم زي ما البصمات بتقول';
    perform public.approve_attendance_day_resolution_v2(p_staff_id, p_date, null, v_note);
    return jsonb_build_object('approved', true, 'decision', p_decision);
  end if;

  -- After a manual punch the day is rebuilt; approve it when it is now complete.
  select * into v_after from public.attendance_daily_summary
  where staff_id = p_staff_id and attendance_date = p_date;
  if v_after.status = 'approved' then
    v_approved := true;
  else
    begin
      perform public.approve_attendance_day_resolution_v2(p_staff_id, p_date, null, v_note);
      v_approved := true;
    exception when others then
      v_approved := false;  -- the punch is saved; the day stays for the detailed review
    end;
  end if;
  return jsonb_build_object('approved', v_approved, 'decision', p_decision);
end;
$function$;
revoke all on function public.dr_wael_quick_day_decision_v1(uuid, date, text) from public, anon;
grant execute on function public.dr_wael_quick_day_decision_v1(uuid, date, text) to authenticated;
