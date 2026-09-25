-- Step 1 import guard: every NEW auto-ingested WhatsApp source must keep the original
-- session transcript so parsing/segmentation can be reproduced later.
-- NOT VALID intentionally preserves the small historical v3 legacy set that was written without
-- raw_text; new INSERT/UPDATE rows are still checked immediately by PostgreSQL.

alter table public.whatsapp_review_sources
  drop constraint if exists whatsapp_auto_import_raw_text_required_v1;

alter table public.whatsapp_review_sources
  add constraint whatsapp_auto_import_raw_text_required_v1
  check (
    source_type <> 'whatsapp_export_auto'
    or (raw_text is not null and btrim(raw_text) <> '')
  )
  not valid;

comment on constraint whatsapp_auto_import_raw_text_required_v1
on public.whatsapp_review_sources is
'New whatsapp_export_auto rows must preserve a non-empty raw transcript. Historical pre-fix rows remain until safely re-imported.';
