-- Fix notifications RLS: the app uses custom staff_account_login (not Supabase Auth)
-- so auth.uid() is always null. Open up to authenticated role.

alter table public.notifications disable row level security;
alter table public.notifications enable row level security;

drop policy if exists "notifications_select" on public.notifications;
drop policy if exists "notifications_insert" on public.notifications;
drop policy if exists "notifications_update" on public.notifications;
drop policy if exists "notifications_delete" on public.notifications;

-- Allow all authenticated users (and anon for app clients) to read/write
create policy "notifications_all_access"
  on public.notifications
  for all
  to anon, authenticated
  using (true)
  with check (true);
