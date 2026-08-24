-- Remove superseded permissive policies after the scoped command boundary is active.
-- Mutation privileges are already revoked; these drops make the RLS contract explicit.
drop policy if exists customer_service_daily_queue_insert_app
  on public.customer_service_daily_queue_items;
drop policy if exists customer_service_daily_queue_select_app
  on public.customer_service_daily_queue_items;
drop policy if exists customer_service_daily_queue_update_app
  on public.customer_service_daily_queue_items;

drop policy if exists customer_service_followup_events_insert_app
  on public.customer_service_followup_events;
drop policy if exists customer_service_followup_events_select_app
  on public.customer_service_followup_events;
drop policy if exists customer_service_followup_events_update_app
  on public.customer_service_followup_events;
