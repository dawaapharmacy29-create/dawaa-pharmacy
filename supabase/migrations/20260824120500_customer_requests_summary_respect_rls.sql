-- Keep Customer Requests operational summary/overdue RPCs compatible with the
-- custom anon staff session while ensuring they never bypass branch RLS.
-- SECURITY INVOKER makes the underlying customer_requests SELECTs use the same
-- dawaa_can_access_customer_request_branch(...) policies as the list query.

alter function public.get_customer_requests_command_center_summary(text) security invoker;
alter function public.get_customer_request_overdue_ids(text) security invoker;

revoke execute on function public.get_customer_requests_command_center_summary(text) from public;
revoke execute on function public.get_customer_request_overdue_ids(text) from public;

grant execute on function public.get_customer_requests_command_center_summary(text) to anon, authenticated, service_role;
grant execute on function public.get_customer_request_overdue_ids(text) to anon, authenticated, service_role;
