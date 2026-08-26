revoke execute on function public.refresh_daily_followup_customer_metrics(text) from anon,authenticated;
revoke execute on function public.refresh_daily_followup_customer_metrics_for_codes_v2(text[]) from anon,authenticated;
grant execute on function public.refresh_daily_followup_customer_metrics(text) to service_role;
grant execute on function public.refresh_daily_followup_customer_metrics_for_codes_v2(text[]) to service_role;
