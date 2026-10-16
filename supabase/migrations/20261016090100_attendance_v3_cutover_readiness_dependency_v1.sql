-- Create the missing dependency of hr_canonical_architecture_health_v1 in Production.
--
-- Production (2026-10-16): hr_canonical_architecture_health_v1 (ledger 20260925153114, body identical to
-- 20260925150000) calls public.attendance_policy_v3_cutover_readiness_v1(date,date), but that function was never
-- created there: 20260925144500_attendance_v3_cutover_readiness_v1 has no ledger row and no later migration
-- creates or drops it. Every call of the health RPC therefore ends in 42883 once the payroll overview finishes;
-- before 20261015140200 the missing anon grant hid it. /hr-data-quality depends on this RPC.
--
-- The function below is the committed definition from 20260925144500, unchanged (same signature, attributes
-- and grants: no anon; the health RPC reaches it as its SECURITY DEFINER owner). Its dependencies all exist in
-- Production. Read-only Production measurement of its body for the current cycle: 680 attendance days, 1.7 s.

do $guard$
declare
  v_body text;
begin
  if to_regprocedure('public.dawaa_build_attendance_day_resolution_v2(uuid,date)') is null
     or to_regprocedure('public.dawaa_build_attendance_day_resolution_v3(uuid,date)') is null
     or to_regprocedure('public.dawaa_pay_cycle_bounds_v1(date)') is null
     or to_regprocedure('public.dawaa_current_actor_can(text[])') is null then
    raise exception 'attendance_policy_v3_cutover_readiness_v1 dependencies are missing; refusing to create it';
  end if;
  select btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) into v_body
  from pg_proc where oid = to_regprocedure('public.attendance_policy_v3_cutover_readiness_v1(date,date)');
  if v_body is not null and md5(v_body) <> 'b3cb99d46ab56820b535ee2fd4b39423' then
    raise exception 'attendance_policy_v3_cutover_readiness_v1 exists with a different definition; refusing to replace it';
  end if;
end;
$guard$;

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

notify pgrst, 'reload schema';
