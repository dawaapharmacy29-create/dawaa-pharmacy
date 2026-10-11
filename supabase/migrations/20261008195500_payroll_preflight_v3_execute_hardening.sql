-- Least-privilege hardening for Payroll Cycle Preflight V3.
-- The RPC performs its own manage_payroll authorization and should never be invokable by anon/PUBLIC.

revoke execute on function public.payroll_cycle_preflight_v3(text,text) from anon;
revoke execute on function public.payroll_cycle_preflight_v3(text,text) from public;
grant execute on function public.payroll_cycle_preflight_v3(text,text) to authenticated, service_role;
