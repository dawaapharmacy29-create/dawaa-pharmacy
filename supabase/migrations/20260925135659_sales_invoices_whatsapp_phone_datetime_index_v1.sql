-- Performance-only support for Sales Intelligence invoice candidate retrieval.
-- whatsapp_phone is a real alternate customer identity on sales_invoices and differs from
-- customer_phone on many rows, so it must remain part of candidate retrieval. The composite
-- index keeps phone + bounded invoice_datetime lookups index-friendly and prevents the
-- all-source dry-run from timing out on the production invoice table.
create index if not exists sales_invoices_whatsapp_phone_invoice_datetime_idx
on public.sales_invoices (whatsapp_phone, invoice_datetime)
where whatsapp_phone is not null and btrim(whatsapp_phone) <> '';
