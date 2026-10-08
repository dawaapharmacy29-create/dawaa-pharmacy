-- Keep the app-session payroll history entrypoint compatible with the current
-- staff header identity model while preserving the function's internal
-- manage_payroll and per-staff authorization guards.

revoke all on function public.list_payroll_finalized_snapshots_v2(uuid,text,integer)
from public, anon, authenticated;

grant execute on function public.list_payroll_finalized_snapshots_v2(uuid,text,integer)
to anon, authenticated, service_role;
