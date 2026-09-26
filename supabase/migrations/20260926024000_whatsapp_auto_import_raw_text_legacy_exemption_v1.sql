-- Allow the eight known pre-fix auto-ingest rows to receive metadata/customer repairs while
-- continuing to reject every new whatsapp_export_auto row that lacks raw_text.

alter table public.whatsapp_review_sources
  drop constraint if exists whatsapp_auto_import_raw_text_required_v1;

alter table public.whatsapp_review_sources
  add constraint whatsapp_auto_import_raw_text_required_v1
  check (
    source_type <> 'whatsapp_export_auto'
    or (raw_text is not null and btrim(raw_text) <> '')
    or id in (
      '0c925c2d-8705-4b90-9bed-5fe11bac22c0'::uuid,
      '5280fc43-ddfc-4a82-9f00-ea1db1549b2b'::uuid,
      '89f4fdb1-dd77-4a80-a2ff-593dc9b4d73e'::uuid,
      '73101c91-979e-420c-b7be-2eefd523093e'::uuid,
      'cb60a81d-f084-40df-b08f-9fbf8e5fd517'::uuid,
      '95fef156-0228-421b-9efa-3496518fc14d'::uuid,
      '7a4c1fb1-baec-4ab2-8630-71a4dcd9299f'::uuid,
      '75fb82b5-9693-4edf-93b2-59bfbea6c76c'::uuid
    )
  )
  not valid;

comment on constraint whatsapp_auto_import_raw_text_required_v1
on public.whatsapp_review_sources is
'New whatsapp_export_auto rows require raw_text. Only eight explicit pre-fix legacy row IDs are exempt so metadata repairs remain possible.';
