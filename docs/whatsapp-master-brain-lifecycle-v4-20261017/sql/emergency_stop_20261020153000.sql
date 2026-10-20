-- EMERGENCY STOP for 20261020153000 (NOT APPLIED). Pauses client approval, execution and source
-- correction WITHOUT restoring any older, weaker approval behavior. Server roles keep EXECUTE so
-- read-only diagnosis remains possible. No data is changed. Resume with resume_20261020153000.sql.
begin;
revoke execute on function public.dawaa_approve_whatsapp_customer_request_action_v2(uuid) from anon, authenticated;
revoke execute on function public.dawaa_materialize_whatsapp_action_v1(uuid) from anon, authenticated;
revoke execute on function public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean) from authenticated;
notify pgrst,'reload schema';
commit;
