-- A leave for a «موقوف» employee now reaches their attendance days. dawaa_mark_attendance_dirty_v1 skips staff who are
-- not active, so the queue never picks these days up and they stayed «غياب». Only days that already exist are rebuilt,
-- and dr_wael_rebuild_day_internal_v1 keeps any day a person approved.
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
  v_date date;
  v_rebuilt int := 0;
begin
  if p_staff_id is null or p_from is null or p_to is null or p_to < p_from or not (v_labels ? coalesce(p_kind, '')) then
    raise exception 'invalid_leave_request' using errcode = '22023';
  end if;
  if p_to - p_from > 92 or p_from < v_today - 40 or p_from > v_today + 120 then
    raise exception 'leave_period_out_of_range' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff_id and (s.is_active is true or btrim(coalesce(s.status, '')) = 'موقوف')
                   and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن')) then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;

  v_request := public.create_staff_time_off_request_v1(
    p_staff_id, p_kind, v_labels->>p_kind, p_from, p_to, null, null, null, v_reason);
  v_decided := public.decide_staff_time_off_request_v3(v_request.id, 'approved', v_reason);

  if exists (select 1 from public.staff s where s.id = p_staff_id and coalesce(s.active, false) = false) then
    for v_date in
      select a.attendance_date from public.attendance_daily_summary a
      where a.staff_id = p_staff_id
        and a.attendance_date between v_decided.start_date and least(v_decided.end_date, v_today)
      order by 1
    loop
      if public.dr_wael_rebuild_day_internal_v1(p_staff_id, v_date) then
        v_rebuilt := v_rebuilt + 1;
      end if;
    end loop;
  end if;

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('leave', p_staff_id, jsonb_build_object('request_id', v_decided.id, 'kind', p_kind, 'from', p_from,
    'to', p_to, 'reason', v_reason, 'days_rebuilt', v_rebuilt), v_actor);

  return jsonb_build_object('success', true, 'request_id', v_decided.id, 'status', v_decided.status,
    'from', v_decided.start_date, 'to', v_decided.end_date, 'days_rebuilt', v_rebuilt);
end;
$function$;

notify pgrst, 'reload schema';
