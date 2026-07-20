begin;

-- The app uses its own staff session while Supabase requests can still run
-- under the `anon` database role. These RPCs are SECURITY DEFINER and each
-- one validates the active staff account through
-- dawaa_require_customer_service_actor_v1 before changing any data.
-- Granting EXECUTE to anon fixes the database-level permission error without
-- bypassing the application authorization checks inside the functions.

grant execute on function public.dawaa_archive_customer_followup_v1(text,text,text) to anon, authenticated;
grant execute on function public.dawaa_restore_customer_followup_v1(text,text) to anon, authenticated;
grant execute on function public.dawaa_postpone_customer_followup_v1(text,text,text) to anon, authenticated;
grant execute on function public.dawaa_create_exceptional_followup_v2(text,text,text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.dawaa_complete_customer_followup_v1(text,text,text,numeric,text,text,text) to anon, authenticated;
grant execute on function public.dawaa_cancel_customer_followup_v1(text,text,text,text) to anon, authenticated;

commit;
