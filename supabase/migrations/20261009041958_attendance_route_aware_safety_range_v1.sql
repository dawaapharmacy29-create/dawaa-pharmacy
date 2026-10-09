create or replace function public.dawaa_reconcile_attendance_range_route_aware_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_d date;
  v_staff record;
  v_result jsonb;
  v_action text;
  v_processed integer:=0;
  v_waiting integer:=0;
  v_errors integer:=0;
  v_immutable integer:=0;
  v_flexible integer:=0;
  v_standard integer:=0;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'attendance_route_aware_reconcile_invalid_range' using errcode='22023';
  end if;

  for v_d in select generate_series(p_start,p_end,interval '1 day')::date loop
    for v_staff in
      select s.id, public.dawaa_staff_flexible_attendance_v1(s.id) as flexible
      from public.staff s
      where coalesce(s.active,false)=true
        and s.branch in ('فرع الشامي','فرع شكري')
        and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
    loop
      begin
        if v_staff.flexible then
          v_result:=public.dawaa_reconcile_flexible_attendance_dirty_day_v1(v_staff.id,v_d);
          v_flexible:=v_flexible+1;
        else
          v_result:=public.dawaa_reconcile_attendance_dirty_day_v1(v_staff.id,v_d);
          v_standard:=v_standard+1;
        end if;

        v_action:=coalesce(v_result->>'action','unknown');
        if v_action='waiting_not_finalizable' then
          v_waiting:=v_waiting+1;
        else
          v_processed:=v_processed+1;
          if v_action in ('immutable_approved','cycle_locked') then
            v_immutable:=v_immutable+1;
          end if;
        end if;
      exception when others then
        v_errors:=v_errors+1;
      end;
    end loop;
  end loop;

  return jsonb_build_object(
    'schema','attendance_route_aware_safety_range_v1',
    'start',p_start,
    'end',p_end,
    'branch',p_branch,
    'processed',v_processed,
    'waiting',v_waiting,
    'errors',v_errors,
    'immutable_or_locked',v_immutable,
    'flexible_checks',v_flexible,
    'standard_checks',v_standard,
    'generated_at',now()
  );
end;
$function$;

revoke all on function public.dawaa_reconcile_attendance_range_route_aware_v1(date,date,text) from public,anon,authenticated;
grant execute on function public.dawaa_reconcile_attendance_range_route_aware_v1(date,date,text) to service_role;