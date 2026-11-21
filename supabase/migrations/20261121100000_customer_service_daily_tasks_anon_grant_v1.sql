-- Customer service daily tasks: let the app's session-token requests reach the RPCs.
--
-- The app signs staff in with its own session token (x-dawaa-session-token), so its requests run as the anon role
-- and the actor is resolved inside each function by dawaa_current_staff_account_id_strict(). v1 granted these RPCs to
-- authenticated only, so every call from the app failed with "permission denied" (seen on the page as «تعذر تحميل
-- البيانات»). Like the app's other RPCs, they are granted to anon and authenticated; each one still calls
-- dawaa_cs_tasks_actor_v1() first, which rejects a request without an active staff session and without the
-- customer_service_daily_tasks / _manage keys. The internal helpers stay closed to clients.

grant execute on function public.dawaa_cs_daily_tasks_build_v1(date) to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_list_v1(date, text, boolean) to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_submit_v1(jsonb) to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_settings_v1() to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_settings_save_v1(numeric, integer, jsonb) to anon, authenticated;
grant execute on function public.dawaa_cs_daily_tasks_overview_v1(date, date) to anon, authenticated;
