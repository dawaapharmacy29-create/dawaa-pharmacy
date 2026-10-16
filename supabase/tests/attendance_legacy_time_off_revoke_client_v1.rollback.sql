-- Rollback of 20261016140000_attendance_legacy_time_off_revoke_client_v1 (grants only): restores the reviewed
-- Production EXECUTE grants (PUBLIC, anon, authenticated; service_role is kept). Re-opens the client exposure.
grant execute on function public.attendance_request_time_off_v1(text,date,date,time without time zone,time without time zone,text) to public, anon, authenticated;
grant execute on function public.attendance_branch_review_time_off_v1(uuid,text,text) to public, anon, authenticated;
grant execute on function public.attendance_gm_review_time_off_v1(uuid,text,text) to public, anon, authenticated;
grant execute on function public.attendance_branch_time_off_queue_v1() to public, anon, authenticated;
grant execute on function public.attendance_gm_time_off_queue_v1() to public, anon, authenticated;
grant execute on function public.attendance_my_time_off_requests_v1() to public, anon, authenticated;
grant execute on function public.attendance_cancel_time_off_request_v1(uuid) to public, anon, authenticated;
