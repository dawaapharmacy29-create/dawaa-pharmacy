-- RESUME after emergency_stop_20261020153000.sql (NOT APPLIED). Restores exactly the grants of
-- 20261020153000 and changes no data or function body. It refuses to run unless the hardened
-- approve/execute commands of that migration are installed, so it can never re-open the older
-- approval behavior (e.g. after a stop applied before the migration, or after an exact rollback).
begin;
do $resume$
begin
  if to_regprocedure('public.dawaa_is_transaction_branch_v1(text)') is null
     or to_regprocedure('public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean)') is null
     or position('customer_request_action_transaction_branch_required' in
          pg_get_functiondef('public.dawaa_approve_whatsapp_customer_request_action_v2(uuid)'::regprocedure)) = 0
     or position('whatsapp_action_transaction_branch_required' in
          pg_get_functiondef('public.dawaa_materialize_whatsapp_action_v1(uuid)'::regprocedure)) = 0 then
    raise exception 'resume_requires_hardened_20261020153000: the stop stays in force';
  end if;
  grant execute on function public.dawaa_approve_whatsapp_customer_request_action_v2(uuid) to anon, authenticated, service_role;
  grant execute on function public.dawaa_materialize_whatsapp_action_v1(uuid) to anon, authenticated, service_role;
  grant execute on function public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean)
    to authenticated, service_role;
end
$resume$;
notify pgrst,'reload schema';
commit;
