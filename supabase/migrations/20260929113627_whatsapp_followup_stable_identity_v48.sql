-- V48: Stable Follow-up Identity (src/lib/whatsappFollowupIdentity.ts).
--
-- Follow-ups were deduplicated per import instance: whatsapp_auto_followup_requests by
-- conversation_session_id (+ signal/quote) and whatsapp_conversation_actions by
-- (source_id, action_key). A re-import under another segmentation, a grown export, or the same
-- conversation through the other ingestion path produced a new session/source and a duplicate task.
--
-- followup_identity = fu1 | customer anchor | episode start | follow-up type | reason
-- is written by the canonical writers and is unique. Existing rows keep NULL (no backfill);
-- NULLs never collide, so legacy rows are untouched.

alter table public.whatsapp_auto_followup_requests
  add column if not exists followup_identity text;
create unique index if not exists whatsapp_auto_followup_requests_followup_identity_uk
  on public.whatsapp_auto_followup_requests (followup_identity);

alter table public.whatsapp_conversation_actions
  add column if not exists followup_identity text;
create unique index if not exists whatsapp_conversation_actions_followup_identity_uk
  on public.whatsapp_conversation_actions (followup_identity);
