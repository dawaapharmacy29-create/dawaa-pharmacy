-- WhatsApp Customer Story V16 — story events UPDATE policy (reanalysis idempotency).
--
-- Problem: whatsapp_customer_story_events had INSERT + SELECT policies but no UPDATE policy.
-- Story V16 writes events with upsert(onConflict: story_id,event_key). The first analysis inserts;
-- every reanalysis of the same conversation hits ON CONFLICT DO UPDATE, which RLS default-denies
-- ("new row violates row-level security policy (USING expression)"), so derived events went stale.
--
-- Contract (mirrors the sibling Story/Journey tables, nothing broader):
--   * same permission set as whatsapp_customer_stories_update_v16 and every *_update_v15 policy:
--     edit_reviews | approve_reviews | manage_conversation_evaluations, resolved through the
--     verified Dawaa staff identity (dawaa_current_actor_can -> dawaa_current_staff_account_id_strict);
--   * scoped to stories the actor can SEE: the EXISTS subquery on whatsapp_customer_stories runs
--     under that table's SELECT policy (view permission + branch/top-management scope), so an actor
--     cannot update events of a story outside their branch visibility;
--   * WITH CHECK repeats both conditions, so an event cannot be moved to a story the actor cannot see.
-- No grant change, no RLS disable, no SECURITY DEFINER function, no DELETE policy (events are never
-- deleted/reinserted; an upsert of the same (story_id, event_key) refreshes the derived row in place).

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
