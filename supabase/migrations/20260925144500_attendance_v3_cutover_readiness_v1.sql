-- Attendance policy V3 cutover readiness.
-- Makes the temporary V2/V3 compatibility layer measurable and removable only when safe.

create or replace function public.attendance_policy_v3_cutover_readiness_v1(
  p_start date default null,
  p_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_start date;
  v_end date;
  v_total integer:=0;
  v_effective integer:=0;
  v_candidate integer:=0;
  v_unresolved integer:=0;
  v_materialized integer:=0;
  v_pending integer:=0;
begin
  if not public.dawaa_current_actor_can(array['manage_payroll','manage_attendance','manage_hr']) then
    raise exception 'not_authorized_for_attendance_cutover_readiness' using errcode='42501';
  end if;

  if p_start is null or p_end is null then
    select cycle_start,cycle_end into v_start,v_end
    from public.dawaa_pay_cycle_bounds_v1((now() at time zone 'Africa/Cairo')::date);
  else
    v_start:=p_start;
    v_end:=p_end;
  end if;

  if v_end<v_start then raise exception 'invalid_attendance_cutover_range' using errcode='22023'; end if;

  with compared as (
    select a.id,a.status,a.resolution_version,
      public.dawaa_build_attendance_day_resolution_v2(a.staff_id,a.attendance_date) v2,
      public.dawaa_build_attendance_day_resolution_v3(a.staff_id,a.attendance_date) v3
    from public.attendance_daily_summary a
    where a.attendance_date between v_start and v_end
  )
  select
    count(*)::integer,
    count(*) filter(where v2->>'resolution_status' is distinct from v3->>'resolution_status')::integer,
    count(*) filter(where coalesce((v3->>'policy_candidate_changed')::boolean,false))::integer,
    count(*) filter(where nullif(v3->>'resolved_policy_version','') is null)::integer,
    count(*) filter(where coalesce(resolution_version,0)>=3)::integer,
    count(*) filter(where coalesce(resolution_version,0)>=3 and coalesce(status,'')<>'approved')::integer
  into v_total,v_effective,v_candidate,v_unresolved,v_materialized,v_pending
  from compared;

  return jsonb_build_object(
    'schema','attendance_policy_v3_cutover_readiness_v1',
    'start_date',v_start,
    'end_date',v_end,
    'total_days',v_total,
    'effective_status_changes',v_effective,
    'candidate_changes',v_candidate,
    'unresolved_policy_days',v_unresolved,
    'v3_materialized_days',v_materialized,
    'v3_pending_days',v_pending,
    'materialization_pct',case when v_total>0 then round(v_materialized::numeric/v_total*100,2) else 0 end,
    'ready_for_v3_cutover',
      v_total>0
      and v_materialized=v_total
      and v_effective=0
      and v_unresolved=0
      and v_pending=0,
    'cutover_rule','100% materialized + zero V2/V3 changes + zero unresolved policy + zero V3 pending',
    'generated_at',now()
  );
end;
$function$;

revoke execute on function public.attendance_policy_v3_cutover_readiness_v1(date,date)
  from public,anon;
grant execute on function public.attendance_policy_v3_cutover_readiness_v1(date,date)
  to authenticated,service_role;
