-- SAFE ROLLBACK for 20261020153000 (NOT APPLIED; recommended rollback). Removes only the new
-- correction command and the two new triggers. The hardened approve/materialize guards and their
-- helpers stay, so no wrong approval behavior is reopened. No data is changed: applied corrections
-- stay audited in whatsapp_review_audit and retired proposals stay dismissed.
begin;
drop trigger if exists canonical_request_projection_guard_v1 on public.whatsapp_conversation_actions;
drop function if exists public.dawaa_guard_canonical_request_projection_v1();
drop trigger if exists whatsapp_source_attribution_guard_v1 on public.whatsapp_review_sources;
drop function if exists public.dawaa_guard_whatsapp_source_attribution_v1();
drop function if exists public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean);
notify pgrst,'reload schema';
commit;
