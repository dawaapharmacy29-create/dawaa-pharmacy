alter table public.whatsapp_review_sources
  add column if not exists invoice_link_confirmed boolean not null default false,
  add column if not exists invoice_link_confirmed_invoice_id text,
  add column if not exists invoice_link_confirmed_invoice_number text,
  add column if not exists invoice_link_confirmed_by text,
  add column if not exists invoice_link_confirmed_by_name text,
  add column if not exists invoice_link_confirmed_at timestamptz,
  add column if not exists invoice_link_confirmation_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_review_sources_invoice_link_confirmed_ck'
      and conrelid = 'public.whatsapp_review_sources'::regclass
  ) then
    alter table public.whatsapp_review_sources
      add constraint whatsapp_review_sources_invoice_link_confirmed_ck
      check (
        invoice_link_confirmed = false
        or (
          invoice_link_confirmed_invoice_id is not null
          and btrim(invoice_link_confirmed_invoice_id) <> ''
          and invoice_link_confirmed_by is not null
          and btrim(invoice_link_confirmed_by) <> ''
          and invoice_link_confirmed_at is not null
        )
      );
  end if;
end $$;
