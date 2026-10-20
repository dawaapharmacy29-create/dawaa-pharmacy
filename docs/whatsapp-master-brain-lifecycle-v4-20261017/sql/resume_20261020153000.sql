-- RESUME after emergency_stop_20261020153000.sql (NOT APPLIED): restores exactly the grants of the
-- forward migration and changes no data or function body.
begin;
grant execute on function public.dawaa_approve_whatsapp_customer_request_action_v2(uuid) to anon, authenticated, service_role;
grant execute on function public.dawaa_materialize_whatsapp_action_v1(uuid) to anon, authenticated, service_role;
grant execute on function public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean) to authenticated, service_role;
notify pgrst,'reload schema';
commit;
