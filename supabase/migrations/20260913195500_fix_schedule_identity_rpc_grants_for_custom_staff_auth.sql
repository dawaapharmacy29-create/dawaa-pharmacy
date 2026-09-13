-- The web app currently uses its custom staff session and sends x-dawaa-user-id,
-- so PostgREST RPC calls execute as anon rather than Supabase authenticated.
-- These RPCs resolve the active staff actor server-side through
-- dawaa_current_staff_account_id_strict(); the write RPC additionally
-- requires top-management authorization and writes an audit record.

grant execute on function public.get_shift_schedule_identity_health_v1() to anon;
grant execute on function public.list_unmapped_shift_schedule_groups_v1(text, integer) to anon;
grant execute on function public.list_schedule_identity_staff_candidates_v1(text, text, integer) to anon;
grant execute on function public.assign_shift_schedule_staff_identity_v1(text, text, uuid, text) to anon;
