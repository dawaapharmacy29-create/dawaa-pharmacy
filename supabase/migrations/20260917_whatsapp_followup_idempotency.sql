-- Branch-only migration for the WhatsApp review rebuild.
-- Do not apply to production until the feature is approved for release.

create unique index if not exists whatsapp_auto_followup_requests_dedupe_uk
on public.whatsapp_auto_followup_requests (
  conversation_session_id,
  signal_type,
  evidence_timestamp,
  evidence_quote
);
