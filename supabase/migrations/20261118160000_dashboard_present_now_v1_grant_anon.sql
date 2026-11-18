-- The app calls with the anon role and a staff session; gm_daily_review_actor_v1 inside the function
-- does the check (same grants as get_gm_daily_review_v1). Without this the dashboard got a 401 and
-- showed nobody.
grant execute on function public.dashboard_present_now_v1(timestamptz) to anon;
