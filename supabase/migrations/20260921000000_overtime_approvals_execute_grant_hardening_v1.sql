-- Postgres grants EXECUTE on new functions to PUBLIC by default. The three overtime
-- approval functions (backfilled/added in 20260920232740_overtime_approvals_reproducibility_and_history_v1.sql)
-- still carried that default PUBLIC grant plus an explicit anon grant, alongside authenticated.
-- decide_overtime_approval_v1 already gates on dawaa_current_actor_can(['manage_payroll'])
-- internally, and the two list functions are branch-scoped via current_user_branch_access_v1,
-- so this was not exploitable — but it doesn't match this codebase's own least-privilege
-- pattern of restricting SECURITY DEFINER attendance/payroll RPCs to authenticated + service_role.
-- No behavior change for authenticated callers or the app's own permission checks.

revoke execute on function public.list_pending_overtime_v1(text) from public, anon;
revoke execute on function public.decide_overtime_approval_v1(uuid, text, text) from public, anon;
revoke execute on function public.list_overtime_decisions_v1(text, text, integer) from public, anon;
