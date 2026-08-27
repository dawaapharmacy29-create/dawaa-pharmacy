-- Architecture Hardening V7
-- user_profiles contains phone/email/permissions and must not be anonymously enumerable.
-- All currently active profiles are linked to staff_accounts, so the canonical staff-account
-- resolver can safely scope custom application sessions without breaking the Dawaa header auth.

alter table public.user_profiles enable row level security;

drop policy if exists "Allow anon read user profiles" on public.user_profiles;
drop policy if exists user_profiles_select_actor on public.user_profiles;

create policy user_profiles_self_or_manager_read_v7
on public.user_profiles
for select
to anon, authenticated
using (
  staff_account_id = public.dawaa_current_staff_account_id_strict()
  or (auth.uid() is not null and auth_user_id = auth.uid())
  or public.dawaa_can_manage_staff()
  or public.dawaa_can_manage_permissions()
);
