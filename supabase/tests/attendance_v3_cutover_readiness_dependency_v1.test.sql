-- 20261016090100_attendance_v3_cutover_readiness_dependency_v1: the health RPC's cutover dependency exists with
-- the committed contract (signature, authorization, result, grants).
do $$
declare v record;
begin
  select p.provolatile, p.prosecdef, p.proconfig into v
  from pg_proc p where p.oid = to_regprocedure('public.attendance_policy_v3_cutover_readiness_v1(date,date)');
  if not found then raise exception 'attendance_policy_v3_cutover_readiness_v1(date,date) is missing'; end if;
  if v.provolatile <> 's' or not v.prosecdef or v.proconfig <> array['search_path=public, pg_catalog'] then
    raise exception 'cutover readiness attributes differ from the committed definition: % % %', v.provolatile, v.prosecdef, v.proconfig;
  end if;
  if has_function_privilege('anon', 'public.attendance_policy_v3_cutover_readiness_v1(date,date)', 'execute') then
    raise exception 'anon must not execute attendance_policy_v3_cutover_readiness_v1';
  end if;
  if not has_function_privilege('authenticated', 'public.attendance_policy_v3_cutover_readiness_v1(date,date)', 'execute')
     or not has_function_privilege('service_role', 'public.attendance_policy_v3_cutover_readiness_v1(date,date)', 'execute') then
    raise exception 'authenticated/service_role lost EXECUTE on attendance_policy_v3_cutover_readiness_v1';
  end if;
end;
$$;

-- An actor without manage_payroll/manage_attendance/manage_hr is refused.
do $$
begin
  perform set_config('test.permissions', 'view_team', false);
  begin
    perform public.attendance_policy_v3_cutover_readiness_v1(null, null);
    raise exception using errcode = 'P0901', message = 'unauthorized actor read cutover readiness';
  exception
    when sqlstate 'P0901' then raise;
    when insufficient_privilege then null;
  end;
end;
$$;

-- Authorized: the default range is the current pay cycle and the counts match the fixture.
do $$
declare r jsonb;
begin
  perform set_config('test.permissions', 'manage_hr', false);
  r := public.attendance_policy_v3_cutover_readiness_v1(null, null);
  if r->>'start_date' <> '2026-09-26' or r->>'end_date' <> '2026-10-25' then raise exception 'wrong default range: %', r; end if;
  if (r->>'total_days')::int <> 5 or (r->>'effective_status_changes')::int <> 1 or (r->>'candidate_changes')::int <> 1
     or (r->>'unresolved_policy_days')::int <> 1 or (r->>'v3_materialized_days')::int <> 3 or (r->>'v3_pending_days')::int <> 1
     or (r->>'materialization_pct')::numeric <> 60.00 or (r->>'ready_for_v3_cutover')::boolean then
    raise exception 'cutover readiness counts differ from the committed rule: %', r;
  end if;
  begin
    perform public.attendance_policy_v3_cutover_readiness_v1('2026-10-02', '2026-10-01');
    raise exception using errcode = 'P0901', message = 'inverted range accepted';
  exception
    when sqlstate 'P0901' then raise;
    when invalid_parameter_value then null;
  end;
end;
$$;
