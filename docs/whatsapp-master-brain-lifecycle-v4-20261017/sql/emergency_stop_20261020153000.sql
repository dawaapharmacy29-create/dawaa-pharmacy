-- EMERGENCY STOP around 20261020153000 (NOT APPLIED). Safe BEFORE or AFTER that migration:
-- pauses client approval, execution and (when installed) source correction WITHOUT restoring any
-- older, weaker approval behavior. Server roles keep EXECUTE for read-only diagnosis. No data or
-- function body is changed. Resume only with resume_20261020153000.sql.
begin;
do $stop$
begin
  revoke execute on function public.dawaa_approve_whatsapp_customer_request_action_v2(uuid) from public, anon, authenticated;
  revoke execute on function public.dawaa_materialize_whatsapp_action_v1(uuid) from public, anon, authenticated;
  if to_regprocedure('public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean)') is not null then
    revoke execute on function public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean)
      from public, anon, authenticated;
  end if;
end
$stop$;
notify pgrst,'reload schema';
commit;
