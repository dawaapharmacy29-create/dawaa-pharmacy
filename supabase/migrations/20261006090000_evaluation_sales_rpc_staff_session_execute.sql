-- Staff-account sessions use the anon PostgREST role plus x-dawaa-user-id.
-- These SECURITY DEFINER readers fail closed through dawaa_assert_staff_sales_scope_v1
-- before touching canonical sales invoices, so grant only the two scoped readers.
revoke all on function public.get_staff_evaluation_sales_summary_v3(uuid,date,date) from public;
revoke all on function public.get_staff_performance_sales_bundle_v1(uuid,date,date,date,integer) from public;

grant execute on function public.get_staff_evaluation_sales_summary_v3(uuid,date,date)
  to anon, authenticated, service_role;
grant execute on function public.get_staff_performance_sales_bundle_v1(uuid,date,date,date,integer)
  to anon, authenticated, service_role;
