-- The payroll page's «تحميل ملخص الدورة» failed with "permission denied for function payroll_cycle_preflight_v3":
-- the app calls RPCs as anon with the staff session token, and this was the only payroll function not open to anon.
-- The function checks the caller itself (dawaa_current_actor_can 'manage_payroll' + active staff account).
grant execute on function public.payroll_cycle_preflight_v3(text, text) to anon, authenticated;
