-- Login/account lookup performance hardening — 2026-08-22
-- The login path calls staff_account_login and resolve_staff_account_safe repeatedly.
-- Keep lookups index-backed as staff/account history grows.

create index if not exists idx_staff_accounts_username_lower
  on public.staff_accounts (lower(username));

create index if not exists idx_staff_accounts_active_username
  on public.staff_accounts (active, lower(username));

create index if not exists idx_staff_accounts_staff_id
  on public.staff_accounts (staff_id)
  where staff_id is not null;

create index if not exists idx_staff_identity_aliases_alias_lower
  on public.staff_identity_aliases (lower(alias_name));

create index if not exists idx_staff_identity_aliases_staff_id
  on public.staff_identity_aliases (staff_id);
