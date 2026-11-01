-- Dawaa uses verified staff sessions on the anon transport role.
-- gm_daily_review_actor_v1 still enforces active top-management identity.
grant execute on function public.get_accountant_report_v1(text) to anon;
