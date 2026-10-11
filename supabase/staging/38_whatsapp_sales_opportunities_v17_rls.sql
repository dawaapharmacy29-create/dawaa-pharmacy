-- Local mirror of the production source-scoped V17 row-security policies.
alter table public.whatsapp_sales_opportunities_v17 enable row level security;

drop policy if exists whatsapp_sales_opportunities_v17_select on public.whatsapp_sales_opportunities_v17;
create policy whatsapp_sales_opportunities_v17_select
on public.whatsapp_sales_opportunities_v17
for select
to public
using (
  exists (
    select 1
    from public.whatsapp_review_sources s
    where s.id = whatsapp_sales_opportunities_v17.root_source_id
      and public.dawaa_can_read_conversation_review_row_v2(
        (select public.dawaa_current_staff_account_id_strict()),
        s.staff_id,
        null::uuid,
        s.branch,
        null::uuid
      )
  )
);

drop policy if exists whatsapp_sales_opportunities_v17_insert on public.whatsapp_sales_opportunities_v17;
create policy whatsapp_sales_opportunities_v17_insert
on public.whatsapp_sales_opportunities_v17
for insert
to public
with check (
  (select public.dawaa_current_actor_can(array['add_reviews','reviews.action.create','manage_conversation_evaluations']))
  and exists (
    select 1
    from public.whatsapp_review_sources s
    where s.id = whatsapp_sales_opportunities_v17.root_source_id
      and public.dawaa_can_read_conversation_review_row_v2(
        (select public.dawaa_current_staff_account_id_strict()),
        s.staff_id,
        null::uuid,
        s.branch,
        null::uuid
      )
  )
);

drop policy if exists whatsapp_sales_opportunities_v17_update on public.whatsapp_sales_opportunities_v17;
create policy whatsapp_sales_opportunities_v17_update
on public.whatsapp_sales_opportunities_v17
for update
to public
using ((select public.dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations'])))
with check ((select public.dawaa_current_actor_can(array['edit_reviews','approve_reviews','manage_conversation_evaluations'])));
