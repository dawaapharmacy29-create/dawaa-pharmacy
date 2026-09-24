-- A checkout after midnight belongs to the previous overnight shift.
-- On an off day, exclude only the preceding shift's checkout grace window
-- from the off-day evidence scan. The preceding workday still sees the punch.
do $fix$ declare
  v_def text;
  v_anchor text := $anchor$    v_sync_complete:=v_sync_complete_through is not null and v_sync_complete_through>=((p_attendance_date+1)::timestamp at time zone 'Africa/Cairo');$anchor$;
  v_extra text := $extra$
    if v_is_off then
      v_window_start:=coalesce((
        select greatest(v_window_start,
          ((p_attendance_date::timestamp + prior.shift_end) at time zone 'Africa/Cairo') + interval '15 minutes')
        from public.attendance_schedule_for_date_v1(p_staff_id,p_attendance_date-1) prior
        where not coalesce(prior.is_off,false) and not coalesce(prior.is_day_off,false)
          and prior.shift_start is not null and prior.shift_end is not null
          and prior.shift_end<=prior.shift_start
      ),v_window_start);
    end if;$extra$;
begin
  select pg_get_functiondef('public.dawaa_build_attendance_day_resolution_v2(uuid,date)'::regprocedure) into v_def;
  if strpos(v_def,'prior.shift_end<=prior.shift_start')>0 then return; end if;
  if strpos(v_def,v_anchor)=0 then raise exception 'Unexpected attendance builder; no change applied'; end if;
  execute replace(v_def,v_anchor,v_anchor||v_extra);
end $fix$;
