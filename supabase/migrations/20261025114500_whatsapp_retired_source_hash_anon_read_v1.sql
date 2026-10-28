-- Smart Folder staff sessions use the anon PostgREST role with a separately
-- verified application actor. The original retired-hash SELECT policy granted
-- authenticated only, so a missing current hash incorrectly raised 42501.
--
-- Permit only SELECT and only when the canonical source is visible through its
-- existing actor-aware RLS policy. Never grant INSERT/UPDATE/DELETE or expose
-- a source that the current employee could not otherwise read.
alter table public.whatsapp_review_source_hash_aliases enable row level security;
grant select on table public.whatsapp_review_source_hash_aliases to anon;

alter policy whatsapp_review_source_hash_aliases_select_v1
  on public.whatsapp_review_source_hash_aliases
  to anon, authenticated;

do $$
begin
  if not has_table_privilege('anon', 'public.whatsapp_review_source_hash_aliases', 'SELECT')
     or has_table_privilege('anon', 'public.whatsapp_review_source_hash_aliases', 'INSERT')
     or has_table_privilege('anon', 'public.whatsapp_review_source_hash_aliases', 'UPDATE')
     or has_table_privilege('anon', 'public.whatsapp_review_source_hash_aliases', 'DELETE') then
    raise exception 'retired-hash registry least-privilege postcheck failed';
  end if;
end $$;
