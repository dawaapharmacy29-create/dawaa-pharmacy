-- Restore anon EXECUTE on two read RPCs that authorize internally against the verified staff session.
--
-- Production smoke (2026-10-15): every app request runs as `anon` carrying a verified staff session token
-- (dawaa_current_staff_account_id_strict / dawaa_session_account_id_v1). These two functions were limited
-- to `authenticated` (20260825235000_performance_points_truth_v2_restrict_anon,
-- 20260925150000_hr_canonical_architecture_health_v1), so every caller received HTTP 401.
--
-- Both are SECURITY DEFINER and refuse callers without an authorized verified session:
--   get_doctor_pillar_breakdown        -> dawaa_staff_points_truth_v2(p_staff_id, ...) raises not_authorized unless
--                                         dawaa_can_read_employee_transaction(p_staff_id, branch) (session actor,
--                                         view_points, global / own staff / own branch scope).
--   hr_canonical_architecture_health_v1 -> raises 42501 unless dawaa_current_actor_can(manage_hr|manage_payroll|
--                                         manage_attendance); output is aggregate counts only.
-- The guard below refuses to grant if either internal check is no longer present.

do $guard$
declare
  v_pillar text := pg_get_functiondef('public.get_doctor_pillar_breakdown(uuid,text)'::regprocedure);
  v_truth text := pg_get_functiondef('public.dawaa_staff_points_truth_v2(uuid,text)'::regprocedure);
  v_health text := pg_get_functiondef('public.hr_canonical_architecture_health_v1()'::regprocedure);
begin
  if v_pillar !~ 'dawaa_staff_points_truth_v2\(p_staff_id'
     or v_truth !~ 'if not public\.dawaa_can_read_employee_transaction\(p_staff_id'
     or v_truth !~ 'raise exception ''not_authorized''' then
    raise exception 'get_doctor_pillar_breakdown no longer authorizes through dawaa_staff_points_truth_v2; anon grant refused';
  end if;
  if v_health !~ 'if not public\.dawaa_current_actor_can\(array\[''manage_hr'',''manage_payroll'',''manage_attendance''\]\) then'
     or v_health !~ 'errcode=''42501''' then
    raise exception 'hr_canonical_architecture_health_v1 no longer authorizes the session actor first; anon grant refused';
  end if;
end;
$guard$;

grant execute on function public.get_doctor_pillar_breakdown(uuid, text) to anon;
grant execute on function public.hr_canonical_architecture_health_v1() to anon;

notify pgrst, 'reload schema';
