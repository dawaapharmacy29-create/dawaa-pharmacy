drop policy if exists customer_request_events_select_anon_internal on public.customer_request_events;
create policy customer_request_events_select_anon_internal
on public.customer_request_events
for select
to anon
using (public.dawaa_current_staff_account_id_strict() is not null);

drop policy if exists customer_request_events_insert_anon_internal on public.customer_request_events;
create policy customer_request_events_insert_anon_internal
on public.customer_request_events
for insert
to anon
with check (public.dawaa_current_staff_account_id_strict() is not null);

drop policy if exists customer_request_events_update_anon_internal on public.customer_request_events;
create policy customer_request_events_update_anon_internal
on public.customer_request_events
for update
to anon
using (public.dawaa_current_staff_account_id_strict() is not null)
with check (public.dawaa_current_staff_account_id_strict() is not null);
