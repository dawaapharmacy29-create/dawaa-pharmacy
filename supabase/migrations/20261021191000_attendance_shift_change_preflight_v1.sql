-- Preflight only: guarded manager intent to correct ONE dated shift. No mutations.
create or replace function public.attendance_shift_change_preflight_v1(
  p_staff_id uuid, p_date date, p_start time without time zone, p_end time without time zone
) returns jsonb
language plpgsql stable security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_schedule record;
  v_summary record;
  v_overrides int;
  v_staff public.staff%rowtype;
  v_hours numeric;
  v_blockers text[] := array[]::text[];
begin
  if p_staff_id is null or p_date is null or p_start is null or p_end is null then
    raise exception 'shift_preflight_requires_staff_date_times' using errcode='22023';
  end if;
  if not public.dawaa_time_off_can_decide_staff_v1(p_staff_id) then
    raise exception 'not_authorized_for_shift_preflight' using errcode='42501';
  end if;
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
  v_hours:=round(((extract(epoch from (p_end-p_start))
          + case when p_end<=p_start then 86400 else 0 end)/3600)::numeric,2);
  if v_hours<4 or v_hours>12 then
    v_blockers:=array_append(v_blockers,'shift_duration_outside_4_12_hours');
  end if;
  select * into v_summary from public.attendance_daily_summary
    where staff_id=p_staff_id and attendance_date=p_date limit 1;
  if v_summary.status='approved' then
    v_blockers:=array_append(v_blockers,'attendance_day_already_approved');
  end if;
  select count(*) into v_overrides from public.shift_schedules
    where staff_id=p_staff_id and coalesce(shift_date,date)=p_date;
  if v_overrides>1 then
    v_blockers:=array_append(v_blockers,'conflicting_date_overrides');
  end if;
  select * into v_schedule from public.attendance_schedule_for_date_v1(p_staff_id,p_date) limit 1;
  if v_schedule.schedule_id is null then
    v_blockers:=array_append(v_blockers,'schedule_missing');
  end if;
  if coalesce(v_schedule.is_off,false) or coalesce(v_schedule.is_day_off,false) then
    v_blockers:=array_append(v_blockers,'day_is_off');
  end if;
  if not exists (
    select 1 from public.biometric_attendance_logs b
    where b.staff_id=p_staff_id
      and public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
      between ((p_date::timestamp+p_start) at time zone 'Africa/Cairo')-interval '4 hours'
      and (((p_date+case when p_end<=p_start then 1 else 0 end)::timestamp+p_end)
        at time zone 'Africa/Cairo')+interval '4 hours'
  ) then
    v_blockers:=array_append(v_blockers,'no_raw_biometric_evidence_in_proposed_window');
  end if;
  return jsonb_build_object(
    'eligible_for_further_review',coalesce(array_length(v_blockers,1),0)=0,
    'blockers',to_jsonb(v_blockers),
    'staff_id',p_staff_id,'date',p_date,'branch',v_staff.branch,
    'proposed_start',p_start,'proposed_end',p_end,'proposed_hours',v_hours,
    'current_schedule_id',v_schedule.schedule_id,
    'current_shift_start',v_schedule.shift_start,'current_shift_end',v_schedule.shift_end,
    'date_override_count',v_overrides,
    'attendance_status',v_summary.status,
    'changes_applied',false,
    'approval_possible',false
  );
end;
$$;
revoke all on function public.attendance_shift_change_preflight_v1(uuid,date,time without time zone,time without time zone) from public;
grant execute on function public.attendance_shift_change_preflight_v1(uuid,date,time without time zone,time without time zone) to authenticated,service_role;
notify pgrst,'reload schema';
