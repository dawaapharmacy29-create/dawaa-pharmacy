-- Dashboard-safe RLS repair.
-- Run this whole file in Supabase SQL Editor. Do not run a selected fragment.

create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  name text not null,
  email text,
  role text default 'موظف',
  branch text,
  phone text,
  permissions jsonb default '{}'::jsonb,
  active boolean default true,
  staff_account_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.user_profiles add column if not exists auth_user_id uuid;
alter table public.user_profiles alter column auth_user_id drop not null;
alter table public.user_profiles add column if not exists staff_account_id uuid;
alter table public.user_profiles add column if not exists permissions jsonb default '{}'::jsonb;
alter table public.user_profiles add column if not exists active boolean default true;

alter table public.staff_accounts add column if not exists auth_user_id uuid;
alter table public.staff_accounts add column if not exists created_by uuid;
alter table public.staff_accounts add column if not exists updated_by uuid;
alter table public.staff_accounts add column if not exists updated_at timestamptz default now();
alter table public.staff_accounts add column if not exists can_login boolean default true;
alter table public.staff_accounts add column if not exists visible_in_admin boolean default true;
alter table public.staff_accounts add column if not exists permissions jsonb default '{}'::jsonb;

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

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  permission_key text unique not null,
  name_ar text,
  description text,
  category text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null,
  permission_key text not null,
  allowed boolean default true,
  created_at timestamptz default now(),
  unique(role_id, permission_key)
);

create table if not exists public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  permission_key text not null,
  allowed boolean default true,
  created_at timestamptz default now(),
  created_by uuid,
  unique(user_id, permission_key)
);

create or replace function public.dawaa_request_staff_id()
returns uuid
language sql
stable
as $fn$
  select case
    when coalesce(current_setting('request.headers', true), '') = '' then null::uuid
    when ((current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id')
      ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      then (current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id')::uuid
    else null::uuid
  end;
$fn$;

create or replace function public.dawaa_current_actor_id()
returns uuid
language sql
stable
as $fn$
  select coalesce(
    (
      select up.id
      from public.user_profiles up
      where up.auth_user_id = auth.uid()
        and coalesce(up.active, true)
      limit 1
    ),
    public.dawaa_request_staff_id()
  );
$fn$;

create or replace function public.dawaa_current_actor_can(required_permissions text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  with actor as (
    select
      coalesce(sa.id, up.staff_account_id, up.id) as actor_id,
      coalesce(sa.username, '') as username,
      coalesce(sa.role, sa.staff_role, up.role, '') as role_name,
      coalesce(sa.permissions, '{}'::jsonb) || coalesce(up.permissions, '{}'::jsonb) as permissions,
      coalesce(sa.active, up.active, true) as active,
      coalesce(sa.can_login, true) as can_login
    from (select public.dawaa_request_staff_id() as staff_id, auth.uid() as auth_id) ctx
    left join public.staff_accounts sa
      on sa.id = ctx.staff_id or sa.auth_user_id = ctx.auth_id
    left join public.user_profiles up
      on up.auth_user_id = ctx.auth_id or up.staff_account_id = sa.id
    where sa.id is not null or up.id is not null
    limit 1
  )
  select coalesce(
    (
      select active
        and can_login
        and (
          lower(username) = 'dr.moaz'
          or role_name in ('مدير عام', 'admin', 'مدير')
          or permissions ?| required_permissions
        )
      from actor
    ),
    false
  );
$fn$;

create or replace function public.dawaa_can_manage_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.dawaa_current_actor_can(array[
    'manage_staff_accounts',
    'create_staff_account',
    'edit_staff_account',
    'reset_staff_password',
    'disable_staff_account'
  ]);
$fn$;

create or replace function public.dawaa_can_manage_permissions()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.dawaa_current_actor_can(array[
    'manage_permissions',
    'manage_roles',
    'manage_user_permissions'
  ]);
$fn$;

grant execute on function public.dawaa_request_staff_id() to anon, authenticated;
grant execute on function public.dawaa_current_actor_id() to anon, authenticated;
grant execute on function public.dawaa_current_actor_can(text[]) to anon, authenticated;
grant execute on function public.dawaa_can_manage_staff() to anon, authenticated;
grant execute on function public.dawaa_can_manage_permissions() to anon, authenticated;

alter table public.user_profiles enable row level security;
alter table public.staff_accounts enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;
alter table public.user_permission_overrides enable row level security;

drop policy if exists "staff_accounts_select_authenticated" on public.staff_accounts;
drop policy if exists "staff_accounts_select_actor" on public.staff_accounts;
drop policy if exists "staff_accounts_write_staff_admin" on public.staff_accounts;
drop policy if exists "staff_accounts_view_own" on public.staff_accounts;
drop policy if exists "staff_accounts_view_all" on public.staff_accounts;
drop policy if exists "staff_accounts_insert" on public.staff_accounts;
drop policy if exists "staff_accounts_update_own" on public.staff_accounts;
drop policy if exists "staff_accounts_update_any" on public.staff_accounts;
drop policy if exists "staff_accounts_delete" on public.staff_accounts;
drop policy if exists "Allow anon read staff accounts" on public.staff_accounts;
drop policy if exists "Allow anon insert staff accounts" on public.staff_accounts;
drop policy if exists "Allow anon update staff accounts" on public.staff_accounts;
drop policy if exists "Allow anon delete staff accounts" on public.staff_accounts;

create policy "staff_accounts_select_authenticated"
on public.staff_accounts for select to authenticated using (true);

create policy "staff_accounts_select_actor"
on public.staff_accounts for select to anon, authenticated
using (public.dawaa_current_actor_id() is not null);

create policy "staff_accounts_write_staff_admin"
on public.staff_accounts for all to anon, authenticated
using (public.dawaa_can_manage_staff())
with check (public.dawaa_can_manage_staff());

drop policy if exists "roles_select_authenticated" on public.roles;
drop policy if exists "roles_select_actor" on public.roles;
drop policy if exists "roles_write_permissions_admin" on public.roles;
drop policy if exists "roles_write_admin" on public.roles;
drop policy if exists "Allow anon read roles" on public.roles;
drop policy if exists "Allow anon insert roles" on public.roles;
drop policy if exists "Allow anon update roles" on public.roles;
drop policy if exists "Allow anon delete roles" on public.roles;
create policy "roles_select_authenticated" on public.roles for select to authenticated using (true);
create policy "roles_select_actor" on public.roles for select to anon, authenticated using (public.dawaa_current_actor_id() is not null);
create policy "roles_write_permissions_admin" on public.roles for all to anon, authenticated using (public.dawaa_can_manage_permissions()) with check (public.dawaa_can_manage_permissions());

drop policy if exists "permissions_select_authenticated" on public.permissions;
drop policy if exists "permissions_select_actor" on public.permissions;
drop policy if exists "permissions_write_permissions_admin" on public.permissions;
drop policy if exists "permissions_write_admin" on public.permissions;
create policy "permissions_select_authenticated" on public.permissions for select to authenticated using (true);
create policy "permissions_select_actor" on public.permissions for select to anon, authenticated using (public.dawaa_current_actor_id() is not null);
create policy "permissions_write_permissions_admin" on public.permissions for all to anon, authenticated using (public.dawaa_can_manage_permissions()) with check (public.dawaa_can_manage_permissions());

drop policy if exists "role_permissions_select_authenticated" on public.role_permissions;
drop policy if exists "role_permissions_select_actor" on public.role_permissions;
drop policy if exists "role_permissions_write_permissions_admin" on public.role_permissions;
create policy "role_permissions_select_authenticated" on public.role_permissions for select to authenticated using (true);
create policy "role_permissions_select_actor" on public.role_permissions for select to anon, authenticated using (public.dawaa_current_actor_id() is not null);
create policy "role_permissions_write_permissions_admin" on public.role_permissions for all to anon, authenticated using (public.dawaa_can_manage_permissions()) with check (public.dawaa_can_manage_permissions());

drop policy if exists "user_permissions_select_authenticated" on public.user_permissions;
drop policy if exists "user_permissions_select_actor" on public.user_permissions;
drop policy if exists "user_permissions_write_permissions_admin" on public.user_permissions;
drop policy if exists "user_permissions_write_admin" on public.user_permissions;
drop policy if exists "Allow anon read user permissions" on public.user_permissions;
drop policy if exists "Allow anon insert user permissions" on public.user_permissions;
drop policy if exists "Allow anon update user permissions" on public.user_permissions;
drop policy if exists "Allow anon delete user permissions" on public.user_permissions;
create policy "user_permissions_select_authenticated" on public.user_permissions for select to authenticated using (true);
create policy "user_permissions_select_actor" on public.user_permissions for select to anon, authenticated using (public.dawaa_current_actor_id() is not null);
create policy "user_permissions_write_permissions_admin" on public.user_permissions for all to anon, authenticated using (public.dawaa_can_manage_permissions()) with check (public.dawaa_can_manage_permissions());

drop policy if exists "user_permission_overrides_select_authenticated" on public.user_permission_overrides;
drop policy if exists "user_permission_overrides_select_actor" on public.user_permission_overrides;
drop policy if exists "user_permission_overrides_write_permissions_admin" on public.user_permission_overrides;
create policy "user_permission_overrides_select_authenticated" on public.user_permission_overrides for select to authenticated using (true);
create policy "user_permission_overrides_select_actor" on public.user_permission_overrides for select to anon, authenticated using (public.dawaa_current_actor_id() is not null);
create policy "user_permission_overrides_write_permissions_admin" on public.user_permission_overrides for all to anon, authenticated using (public.dawaa_can_manage_permissions()) with check (public.dawaa_can_manage_permissions());

grant select, insert, update, delete on public.staff_accounts to anon, authenticated;
grant select, insert, update, delete on public.roles to anon, authenticated;
grant select, insert, update, delete on public.permissions to anon, authenticated;
grant select, insert, update, delete on public.role_permissions to anon, authenticated;
grant select, insert, update, delete on public.user_permissions to anon, authenticated;
grant select, insert, update, delete on public.user_permission_overrides to anon, authenticated;

create unique index if not exists staff_accounts_username_unique_idx
  on public.staff_accounts (username)
  where username is not null;
create unique index if not exists user_profiles_staff_account_uidx
  on public.user_profiles (staff_account_id);
create unique index if not exists user_permissions_user_permission_uidx
  on public.user_permissions (user_id, permission_key);
create unique index if not exists user_permission_overrides_user_permission_uidx
  on public.user_permission_overrides (user_id, permission_key);

insert into public.staff_accounts (
  username,
  password_hash,
  temporary_password,
  password_status,
  name,
  staff_name,
  role,
  staff_role,
  branch,
  active,
  can_login,
  visible_in_admin,
  permissions
)
values (
  'dr.moaz',
  crypt('9493', gen_salt('bf')),
  '9493',
  'مؤقتة',
  'د معاذ',
  'د معاذ',
  'مدير عام',
  'مدير عام',
  'كل الفروع',
  true,
  true,
  true,
  '{
    "manage_staff_accounts": true,
    "view_staff_accounts": true,
    "create_staff_account": true,
    "edit_staff_account": true,
    "reset_staff_password": true,
    "disable_staff_account": true,
    "view_roles_permissions": true,
    "manage_roles": true,
    "manage_permissions": true,
    "manage_user_permissions": true,
    "view_dashboard": true,
    "view_analytics_sales": true,
    "import_sales_invoices": true,
    "view_activity_logs": true,
    "manage_settings": true,
    "manage_branches": true,
    "view_doctor_dashboard": true,
    "view_list_medicines": true,
    "create_list_medicine": true,
    "edit_list_medicine": true,
    "dispense_list_medicine": true,
    "view_incentive_medicines": true,
    "create_incentive_medicine": true,
    "edit_incentive_medicine": true,
    "dispense_incentive_medicine": true,
    "view_stagnant_medicines": true,
    "create_stagnant_medicine": true,
    "edit_stagnant_medicine": true,
    "dispense_stagnant_medicine": true,
    "view_points_rewards": true,
    "create_reward": true,
    "create_deduction": true,
    "approve_points_changes": true
  }'::jsonb
)
on conflict (username) do update
set temporary_password = excluded.temporary_password,
    password_hash = excluded.password_hash,
    password_status = excluded.password_status,
    name = excluded.name,
    staff_name = excluded.staff_name,
    role = excluded.role,
    staff_role = excluded.staff_role,
    branch = excluded.branch,
    active = true,
    can_login = true,
    visible_in_admin = true,
    permissions = coalesce(public.staff_accounts.permissions, '{}'::jsonb) || excluded.permissions,
    updated_at = now();

insert into public.user_profiles (
  staff_account_id,
  name,
  role,
  branch,
  permissions,
  active
)
select
  sa.id,
  'د معاذ',
  'مدير عام',
  'كل الفروع',
  sa.permissions,
  true
from public.staff_accounts sa
where lower(sa.username) = 'dr.moaz'
on conflict (staff_account_id) do update
set name = excluded.name,
    role = excluded.role,
    branch = excluded.branch,
    permissions = coalesce(public.user_profiles.permissions, '{}'::jsonb) || excluded.permissions,
    active = true,
    updated_at = now();

insert into public.roles (name, name_ar, description, permissions)
select
  'general_manager',
  'مدير عام',
  'صلاحيات كاملة على النظام',
  sa.permissions
from public.staff_accounts sa
where lower(sa.username) = 'dr.moaz'
on conflict (name) do update
set name_ar = excluded.name_ar,
    description = excluded.description,
    permissions = coalesce(public.roles.permissions, '{}'::jsonb) || excluded.permissions,
    updated_at = now();
