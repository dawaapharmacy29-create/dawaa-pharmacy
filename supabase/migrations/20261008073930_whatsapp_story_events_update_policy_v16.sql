drop policy if exists whatsapp_customer_story_events_update_v16
  on public.whatsapp_customer_story_events;

create policy whatsapp_customer_story_events_update_v16
on public.whatsapp_customer_story_events
for update
using (
  public.dawaa_current_actor_can(array['edit_reviews', 'approve_reviews', 'manage_conversation_evaluations'])
  and exists (
    select 1
    from public.whatsapp_customer_stories s
    where s.id = whatsapp_customer_story_events.story_id
  )
)
with check (
  public.dawaa_current_actor_can(array['edit_reviews', 'approve_reviews', 'manage_conversation_evaluations'])
  and exists (
    select 1
    from public.whatsapp_customer_stories s
    where s.id = whatsapp_customer_story_events.story_id
  )
);