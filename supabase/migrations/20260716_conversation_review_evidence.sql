-- Conversation review coaching message + optional WhatsApp screenshots.
-- The bucket is private; files are displayed through short-lived signed URLs.

begin;

alter table if exists public.conversation_sales_reviews
  add column if not exists reviewer_message text;

create table if not exists public.conversation_review_attachments (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.conversation_sales_reviews(id) on delete cascade,
  staff_id uuid null,
  storage_path text not null,
  file_name text null,
  mime_type text null,
  size_bytes bigint null,
  uploaded_by text null,
  uploaded_by_name text null,
  created_at timestamptz not null default now(),
  constraint conversation_review_attachment_size_chk check (size_bytes is null or size_bytes between 1 and 5242880),
  constraint conversation_review_attachment_type_chk check (mime_type is null or mime_type in ('image/jpeg','image/png','image/webp'))
);

create unique index if not exists conversation_review_attachments_path_uidx
  on public.conversation_review_attachments(storage_path);
create index if not exists conversation_review_attachments_review_idx
  on public.conversation_review_attachments(review_id, created_at);
create index if not exists conversation_review_attachments_staff_idx
  on public.conversation_review_attachments(staff_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'conversation-review-evidence',
  'conversation-review-evidence',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The application currently uses its own staff session layer, so storage access
-- is granted to the app roles while object paths remain undiscoverable and URLs
-- remain private/signed. Row-level ownership continues to be enforced by the
-- review query (staff_id/doctor_id) in the doctor workspace.
drop policy if exists conversation_review_evidence_read on storage.objects;
create policy conversation_review_evidence_read
on storage.objects for select
to anon, authenticated
using (bucket_id = 'conversation-review-evidence');

drop policy if exists conversation_review_evidence_insert on storage.objects;
create policy conversation_review_evidence_insert
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'conversation-review-evidence');

drop policy if exists conversation_review_evidence_delete on storage.objects;
create policy conversation_review_evidence_delete
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'conversation-review-evidence');

-- Keep attachment rows available to the existing custom session layer.
-- A later migration can replace these grants with auth.uid()-based RLS once all
-- staff_accounts are linked to auth_user_id.
grant select, insert, update, delete on public.conversation_review_attachments to anon, authenticated;
grant select, update on public.conversation_sales_reviews to anon, authenticated;

commit;
