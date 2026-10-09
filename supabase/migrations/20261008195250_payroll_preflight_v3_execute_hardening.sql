revoke execute on function public.payroll_cycle_preflight_v3(text,text) from anon;
revoke execute on function public.payroll_cycle_preflight_v3(text,text) from public;
grant execute on function public.payroll_cycle_preflight_v3(text,text) to authenticated, service_role;