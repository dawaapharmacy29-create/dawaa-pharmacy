-- A manager's explicit decision that a WhatsApp source belongs to its linked doctor (staff_id).
-- Sales Intelligence credits a greeting name that the directory cannot resolve (inactive account,
-- archived namesake, first name only) to that doctor ONLY when this flag is set. A staff_id filled
-- from an invoice seller or a legacy matcher never carries it, so it never promotes a greeting.
alter table public.whatsapp_review_sources
  add column if not exists staff_link_confirmed boolean not null default false,
  add column if not exists staff_link_confirmed_at timestamptz,
  add column if not exists staff_link_confirmed_by_name text;

comment on column public.whatsapp_review_sources.staff_link_confirmed is
  'Manager confirmed that staff_id is the doctor of this conversation; lets the greeting name be credited to that doctor even when the directory cannot resolve it.';
