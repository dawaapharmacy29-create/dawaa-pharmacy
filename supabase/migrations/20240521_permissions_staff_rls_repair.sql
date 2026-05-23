-- Repair RLS and schema for staff accounts, roles, and user permission overrides.
-- Date: 2024-05-21

create extension if not exists pgcrypto;

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid()
);

alter table public.staff_accounts
  add column if not exists staff_id uuid,
  add column if not exists username text,
  add column if not exists password_hash text,
  add column if not exists temporary_password text,
  add column if not exists password_status text default 'مؤقتة',
  add column if not exists name text,
  add column if not exists staff_name text,
  add column if not exists role text default 'صيدلاني',
  add column if not exists staff_role text default 'صيدلاني',
  add column if not exists branch text default 'الكل',
  add column if not exists branch_id uuid,
  add column if not exists phone text,
  add column if not exists active boolean default true,
  add column if not exists can_login boolean default true,
  add column if not exists visible_in_admin boolean default true,
  add column if not exists permissions jsonb default '{}'::jsonb,
  add column if not exists must_change_password boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists last_login_at timestamptz;

create unique index if not exists staff_accounts_username_unique_idx
  on public.staff_accounts (username)
  where username is not null;

create unique index if not exists staff_accounts_staff_id_unique_idx
  on public.staff_accounts (staff_id)
  where staff_id is not null;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  name_ar text not null,
  description text,
  permissions jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  permission_key text not null,
  allowed boolean default true,
  created_at timestamptz default now(),
  created_by uuid,
  unique(user_id, permission_key)
);

create index if not exists user_permissions_user_id_idx on public.user_permissions(user_id);
create index if not exists user_permissions_permission_key_idx on public.user_permissions(permission_key);

create or replace function public.staff_account_login(p_username text, p_password text)
returns table (
  id uuid,
  staff_id uuid,
  username text,
  name text,
  role text,
  branch text,
  phone text,
  active boolean,
  can_login boolean,
  permissions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_name text;
  v_role_permissions jsonb;
begin
  -- Get role name from staff account
  select coalesce(a.role, a.staff_role, 'صيدلاني') into v_role_name
  from public.staff_accounts a
  where lower(a.username) = lower(p_username)
    and coalesce(a.can_login, true) = true
    and coalesce(a.active, true) = true
    and (
      a.temporary_password = p_password
      or a.password_hash = crypt(p_password, a.password_hash)
      or a.password_hash = p_password
    )
  limit 1;

  -- Get role permissions from roles table
  select r.permissions into v_role_permissions
  from public.roles r
  where r.name = v_role_name or r.name_ar = v_role_name
  limit 1;

  return query
  select
    a.id,
    a.staff_id,
    a.username,
    coalesce(a.name, a.staff_name, a.username) as name,
    coalesce(a.role, a.staff_role, 'صيدلاني') as role,
    coalesce(a.branch, 'الكل') as branch,
    a.phone,
    coalesce(a.active, true) as active,
    coalesce(a.can_login, true) as can_login,
    coalesce(v_role_permissions, a.permissions, '{}'::jsonb) as permissions
  from public.staff_accounts a
  where lower(a.username) = lower(p_username)
    and coalesce(a.can_login, true) = true
    and coalesce(a.active, true) = true
    and (
      a.temporary_password = p_password
      or a.password_hash = crypt(p_password, a.password_hash)
      or a.password_hash = p_password
    )
  limit 1;

  update public.staff_accounts a
  set last_login_at = now()
  where lower(a.username) = lower(p_username)
    and coalesce(a.can_login, true) = true
    and coalesce(a.active, true) = true
    and (
      a.temporary_password = p_password
      or a.password_hash = crypt(p_password, a.password_hash)
      or a.password_hash = p_password
    );
end;
$$;

create or replace function public.staff_account_reset_password(p_account_id uuid, p_new_password text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_accounts
  set
    temporary_password = p_new_password,
    password_hash = crypt(p_new_password, gen_salt('bf')),
    password_status = 'مؤقتة',
    must_change_password = true,
    updated_at = now()
  where id = p_account_id;
end;
$$;

alter table public.staff_accounts enable row level security;
alter table public.user_permissions enable row level security;
alter table public.roles enable row level security;

drop policy if exists "Allow anon read staff accounts" on public.staff_accounts;
drop policy if exists "Allow anon insert staff accounts" on public.staff_accounts;
drop policy if exists "Allow anon update staff accounts" on public.staff_accounts;
drop policy if exists "Allow authenticated read staff accounts" on public.staff_accounts;
drop policy if exists "Allow authenticated update staff accounts" on public.staff_accounts;
drop policy if exists "staff_accounts_select_authenticated" on public.staff_accounts;
drop policy if exists "staff_accounts_insert_admin" on public.staff_accounts;
drop policy if exists "staff_accounts_update_admin" on public.staff_accounts;
drop policy if exists "staff_accounts_delete_admin" on public.staff_accounts;

create policy "Allow anon read staff accounts"
on public.staff_accounts for select to anon using (true);

create policy "Allow anon insert staff accounts"
on public.staff_accounts for insert to anon with check (true);

create policy "Allow anon update staff accounts"
on public.staff_accounts for update to anon using (true) with check (true);

create policy "Allow anon delete staff accounts"
on public.staff_accounts for delete to anon using (true);

drop policy if exists "Allow anon read user permissions" on public.user_permissions;
drop policy if exists "Allow anon insert user permissions" on public.user_permissions;
drop policy if exists "Allow anon update user permissions" on public.user_permissions;
drop policy if exists "Allow anon delete user permissions" on public.user_permissions;

create policy "Allow anon read user permissions"
on public.user_permissions for select to anon using (true);

create policy "Allow anon insert user permissions"
on public.user_permissions for insert to anon with check (true);

create policy "Allow anon update user permissions"
on public.user_permissions for update to anon using (true) with check (true);

create policy "Allow anon delete user permissions"
on public.user_permissions for delete to anon using (true);

drop policy if exists "Allow anon read roles" on public.roles;
drop policy if exists "Allow anon insert roles" on public.roles;
drop policy if exists "Allow anon update roles" on public.roles;
drop policy if exists "Allow anon delete roles" on public.roles;

create policy "Allow anon read roles"
on public.roles for select to anon using (true);

create policy "Allow anon insert roles"
on public.roles for insert to anon with check (true);

create policy "Allow anon update roles"
on public.roles for update to anon using (true) with check (true);

create policy "Allow anon delete roles"
on public.roles for delete to anon using (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.staff_accounts to anon, authenticated;
grant select, insert, update, delete on public.user_permissions to anon, authenticated;
grant select, insert, update, delete on public.roles to anon, authenticated;
grant execute on function public.staff_account_login(text, text) to anon, authenticated;
grant execute on function public.staff_account_reset_password(uuid, text) to anon, authenticated;

-- Function to get effective permissions for a user (role + overrides)
create or replace function public.get_user_permissions(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with role_permissions as (
    select r.permissions
    from staff_accounts sa
    join roles r on r.name = sa.role or r.name_ar = sa.role
    where sa.id = p_user_id
  ),
  user_overrides as (
    select permission_key, allowed
    from user_permissions
    where user_id = p_user_id
  )
  select
    coalesce(
      (
        select jsonb_object_agg(
          ak.key,
          coalesce(
            (select to_jsonb(uo.allowed) from user_overrides uo where uo.permission_key = ak.key),
            (rp.permissions->>ak.key)::jsonb,
            'false'::jsonb
          )
        )
        from (
          select jsonb_object_keys(rp.permissions) as key
          from role_permissions rp
          union
          select permission_key as key
          from user_overrides
        ) ak
        cross join role_permissions rp
      ),
      '{}'::jsonb
    ) as permissions;
$$;

-- Function to check if user has specific permission
create or replace function public.user_has_permission(p_user_id uuid, p_permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((get_user_permissions(p_user_id)->>p_permission_key)::boolean, false);
$$;

grant execute on function public.get_user_permissions(uuid) to anon, authenticated;
grant execute on function public.user_has_permission(uuid, text) to anon, authenticated;
