-- Harden legacy payroll RPCs: anon must never execute payroll finalization/staging APIs.
-- Keep authenticated/service_role access for backward-compatible internal flows.

revoke execute on function public.compare_payroll_final_snapshot_v1(uuid) from public, anon;
revoke execute on function public.payroll_final_snapshot_preview_v1(uuid,text) from public, anon;
revoke execute on function public.payroll_finalization_gate_v1(uuid,text) from public, anon;
revoke execute on function public.review_payroll_staged_snapshot_v1(uuid,text,text) from public, anon;
revoke execute on function public.stage_payroll_final_snapshot_v1(uuid,text,text) from public, anon;

grant execute on function public.compare_payroll_final_snapshot_v1(uuid) to authenticated, service_role;
grant execute on function public.payroll_final_snapshot_preview_v1(uuid,text) to authenticated, service_role;
grant execute on function public.payroll_finalization_gate_v1(uuid,text) to authenticated, service_role;
grant execute on function public.review_payroll_staged_snapshot_v1(uuid,text,text) to authenticated, service_role;
grant execute on function public.stage_payroll_final_snapshot_v1(uuid,text,text) to authenticated, service_role;
