drop policy if exists customer_service_manager_reviews_insert_all on public.customer_service_manager_reviews;
drop policy if exists customer_service_manager_reviews_select_all on public.customer_service_manager_reviews;
drop policy if exists customer_service_manager_reviews_update_all on public.customer_service_manager_reviews;

create policy customer_service_manager_reviews_select_canonical
on public.customer_service_manager_reviews
for select
to anon, authenticated
using (public.dawaa_current_actor_can(array['view_reviews']));

create policy customer_service_manager_reviews_insert_canonical
on public.customer_service_manager_reviews
for insert
to anon, authenticated
with check (public.dawaa_current_actor_can(array['approve_reviews']));

create policy customer_service_manager_reviews_update_canonical
on public.customer_service_manager_reviews
for update
to anon, authenticated
using (public.dawaa_current_actor_can(array['approve_reviews']))
with check (public.dawaa_current_actor_can(array['approve_reviews']));
