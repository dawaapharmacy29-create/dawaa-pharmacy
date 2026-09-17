-- Carry canonical customer identity from WhatsApp ingestion into the follow-up queue.
-- Branch-only until release approval.

alter table public.whatsapp_auto_followup_requests
  add column if not exists customer_id uuid,
  add column if not exists customer_code text;

create index if not exists whatsapp_auto_followup_requests_customer_id_idx
  on public.whatsapp_auto_followup_requests(customer_id)
  where customer_id is not null;

create index if not exists whatsapp_auto_followup_requests_customer_code_idx
  on public.whatsapp_auto_followup_requests(customer_code)
  where nullif(trim(customer_code), '') is not null;

comment on column public.whatsapp_auto_followup_requests.customer_id is
  'Canonical customers.id resolved during WhatsApp ingestion when identity is unambiguous.';
comment on column public.whatsapp_auto_followup_requests.customer_code is
  'Canonical customer code resolved during WhatsApp ingestion when identity is unambiguous.';
