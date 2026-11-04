-- Use persisted shift ownership. Unresolved raw evidence appears once on its Cairo date.
create or replace function public.get_dr_wael_day_punches_v1(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_branches text[] := array['فرع شكري', 'فرع الشامي', 'المخزن'];
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_punches jsonb;
  v_start timestamptz := p_date::timestamp at time zone 'Africa/Cairo';
  v_end timestamptz := (p_date + 1)::timestamp at time zone 'Africa/Cairo';
begin
  perform public.dr_wael_fingerprints_actor_v1();
  if p_date is null or p_date > v_today or p_date < v_today - 400 then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(x.row order by x.at), '[]'::jsonb) into v_punches
  from (
    select b.punch_time as at, jsonb_build_object(
        'staff_id', b.staff_id, 'name', coalesce(s.name, b.staff_name_snapshot), 'branch', b.branch,
        'biometric_user_id', b.biometric_user_id, 'punch_time', b.punch_time, 'punch_type', b.punch_type,
        'device_id', b.device_id, 'provider', b.provider, 'event_id', b.id,
        'interpreted_type', case when a.status = 'accepted' then a.attendance_type end,
        'interpretation_status', a.status, 'interpretation_reason', a.rejection_reason) as row
    from public.biometric_attendance_logs b
    left join public.staff s on s.id = b.staff_id
    left join public.staff_attendance_logs a on a.biometric_source_log_id = b.id
      and a.staff_id = b.staff_id
    where b.punch_time >= v_start - interval '8 hours'
      and b.punch_time < v_end + interval '12 hours'
      and coalesce(a.shift_date, (b.punch_time at time zone 'Africa/Cairo')::date) = p_date
      and (b.branch = any(v_branches) or s.branch = any(v_branches))
    order by b.punch_time
    limit 3000
  ) x;

  return jsonb_build_object('date', p_date, 'punches', v_punches);
end;
$function$;

