-- Customer Request operational/read RPCs are called by the custom anon staff client.
-- They must never use SECURITY DEFINER to bypass customer_requests branch RLS.
-- Keep execute grants for the app roles, but run the SELECTs as the caller so the
-- same view_customer_requests policy used by the canonical list applies everywhere.

alter function public.get_customer_request_action_queue(text, integer) security invoker;
alter function public.get_customer_request_operational_insights(text, integer) security invoker;
alter function public.get_customer_request_source_audit_v4(text) security invoker;
alter function public.get_customer_request_supplier_export_v1(text) security invoker;

revoke execute on function public.get_customer_request_action_queue(text, integer) from public;
revoke execute on function public.get_customer_request_operational_insights(text, integer) from public;
revoke execute on function public.get_customer_request_source_audit_v4(text) from public;
revoke execute on function public.get_customer_request_supplier_export_v1(text) from public;

grant execute on function public.get_customer_request_action_queue(text, integer) to anon, authenticated, service_role;
grant execute on function public.get_customer_request_operational_insights(text, integer) to anon, authenticated, service_role;
grant execute on function public.get_customer_request_source_audit_v4(text) to anon, authenticated, service_role;
grant execute on function public.get_customer_request_supplier_export_v1(text) to anon, authenticated, service_role;
