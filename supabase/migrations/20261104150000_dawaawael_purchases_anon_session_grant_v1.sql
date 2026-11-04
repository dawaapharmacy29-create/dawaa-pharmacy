-- The admin site calls RPCs with its staff session on the anon role (like get_gm_daily_review_v1 and
-- list_purchase_invoices_v1); get_dawaawael_purchases_v1 checks the staff account and role itself.
-- Without this grant the «المشتريات» page answered 401.
grant execute on function public.get_dawaawael_purchases_v1(text, text, date, date, text, integer) to anon;
