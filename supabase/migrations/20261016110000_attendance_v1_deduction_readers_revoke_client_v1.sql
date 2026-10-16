-- Close anonymous access to the legacy V1 attendance deduction readers.
--
-- Production (2026-10-16): attendance_deduction_pending_review_v1() and attendance_unified_approvals_v1() are
-- SECURITY DEFINER with no authorization check and EXECUTE for PUBLIC/anon/authenticated: anyone holding the public
-- anon key could read every pending attendance deduction (staff, branch, points, amount) without a session.
-- No client (main or this branch), database function or cron job calls either function; the HR boundary gate
-- (scripts/check-hr-domain-boundary-v1.cjs) already forbids client use of the V1 deduction APIs, and
-- 20260925141000_attendance_points_ledger_cutover_v2 restricts the V1 readers to service_role.
--
-- This migration only revokes client EXECUTE (service_role keeps it); both definitions are unchanged. The V2 ledger
-- cutover (and therefore the /attendance-report pending-deduction tile) is a separate decision.

do $guard$
begin
  if to_regprocedure('public.attendance_deduction_pending_review_v1()') is null
     or to_regprocedure('public.attendance_unified_approvals_v1()') is null then
    raise exception 'V1 attendance deduction readers are missing; nothing to restrict';
  end if;
end;
$guard$;

revoke execute on function public.attendance_deduction_pending_review_v1() from public, anon, authenticated;
revoke execute on function public.attendance_unified_approvals_v1() from public, anon, authenticated;
grant execute on function public.attendance_deduction_pending_review_v1() to service_role;
grant execute on function public.attendance_unified_approvals_v1() to service_role;

notify pgrst, 'reload schema';
