create extension if not exists "pgcrypto";

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid()
);

alter table public.staff_accounts
  add column if not exists staff_id uuid,
  add column if not exists username text,
  add column if not exists password_hash text,
  add column if not exists temporary_password text,
  add column if not exists name text,
  add column if not exists staff_name text,
  add column if not exists role text default 'صيدلاني',
  add column if not exists staff_role text default 'صيدلاني',
  add column if not exists branch text default 'فرع شكري',
  add column if not exists branch_id uuid,
  add column if not exists phone text,
  add column if not exists active boolean default true,
  add column if not exists can_login boolean default true,
  add column if not exists visible_in_admin boolean default true,
  add column if not exists permissions jsonb default '{}'::jsonb,
  add column if not exists must_change_password boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists staff_accounts_username_unique_idx
  on public.staff_accounts (username)
  where username is not null;

create unique index if not exists staff_accounts_staff_id_unique_idx
  on public.staff_accounts (staff_id)
  where staff_id is not null;

create index if not exists staff_accounts_role_branch_idx
  on public.staff_accounts (role, branch, active);

create or replace function public.staff_accounts_permissions_for_role(p_role text)
returns jsonb
language sql
stable
as $$
  select case
    when coalesce(p_role, '') in ('أدمن', 'مدير عام', 'المدير العام', 'مدير فرع') then
      jsonb_build_object(
        'view_shift_performance', true,
        'view_dashboard', true,
        'view_doctor_dashboard', true,
        'view_customers', true,
        'edit_customers', true,
        'view_customer_service', true,
        'manage_followups', true,
        'view_team', true,
        'view_schedule', true,
        'manage_time_off', true,
        'view_points', true,
        'manage_points', true,
        'view_reviews', true,
        'add_reviews', true,
        'view_medicines', true,
        'view_delivery', true,
        'view_analytics', true,
        'view_invoices', true,
        'manage_permissions', true,
        'view_activity_log', true
      )
    when coalesce(p_role, '') in ('صيدلاني', 'دكتور', 'طبيب صيدلي', 'pharmacist') then
      jsonb_build_object(
        'view_dashboard', true,
        'view_doctor_dashboard', true,
        'view_customers', true,
        'view_customer_service', true,
        'manage_followups', true,
        'view_team', true,
        'view_schedule', true,
        'view_points', true,
        'view_reviews', true,
        'add_reviews', true,
        'view_medicines', true,
        'view_analytics', true,
        'view_invoices', true
      )
    when coalesce(p_role, '') in ('دليفري', 'توصيل', 'delivery') then
      jsonb_build_object(
        'view_doctor_dashboard', true,
        'view_customers', true,
        'view_points', true,
        'view_delivery', true,
        'view_schedule', true
      )
    else
      jsonb_build_object(
        'view_doctor_dashboard', true,
        'view_customers', true,
        'view_points', true,
        'view_schedule', true
      )
  end;
$$;

create or replace function public.set_staff_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_staff_accounts_updated_at on public.staff_accounts;
create trigger set_staff_accounts_updated_at
before update on public.staff_accounts
for each row execute function public.set_staff_accounts_updated_at();

update public.staff_accounts
set
  branch = case
    when branch in ('shkri', 'shokry', 'abou elazm', 'abu elazm', 'أبو العزم', 'فرع أبو العزم') then 'فرع شكري'
    when branch in ('shami', 'el shami', 'الشامي') then 'فرع الشامي'
    else branch
  end,
  staff_name = coalesce(staff_name, name),
  name = coalesce(name, staff_name),
  staff_role = coalesce(staff_role, role),
  role = coalesce(role, staff_role),
  visible_in_admin = coalesce(visible_in_admin, true),
  can_login = coalesce(can_login, true),
  active = coalesce(active, true),
  permissions = case when permissions is null or permissions = '{}'::jsonb then public.staff_accounts_permissions_for_role(coalesce(role, staff_role)) else permissions end;

update public.staff_accounts
set active = false,
    can_login = false,
    visible_in_admin = false,
    updated_at = now()
where lower(coalesce(username, '')) in ('mohamed.shehata', 'mohamed.shahata', 'mohamed-shahata', 'mohamed-shehata')
   or coalesce(staff_name, name, '') in ('محمد شحاتة', 'محمد شحاته');

insert into public.staff_accounts (
  staff_id,
  username,
  password_hash,
  temporary_password,
  name,
  staff_name,
  role,
  staff_role,
  branch,
  branch_id,
  active,
  can_login,
  visible_in_admin,
  permissions,
  must_change_password
)
select
  s.id,
  trim(s.name) as username,
  crypt('123456', gen_salt('bf')) as password_hash,
  '123456' as temporary_password,
  trim(s.name) as name,
  trim(s.name) as staff_name,
  coalesce(nullif(trim(s.role), ''), 'صيدلاني') as role,
  coalesce(nullif(trim(s.role), ''), 'صيدلاني') as staff_role,
  case
    when coalesce(s.branch, '') in ('shkri', 'shokry', 'abou elazm', 'abu elazm', 'أبو العزم', 'فرع أبو العزم') then 'فرع شكري'
    when coalesce(s.branch, '') in ('shami', 'el shami', 'الشامي') then 'فرع الشامي'
    else coalesce(nullif(trim(s.branch), ''), 'فرع شكري')
  end as branch,
  s.branch_id,
  coalesce(s.active, true) as active,
  true as can_login,
  true as visible_in_admin,
  public.staff_accounts_permissions_for_role(coalesce(nullif(trim(s.role), ''), 'صيدلاني')) as permissions,
  true as must_change_password
from public.staff s
where trim(coalesce(s.name, '')) <> ''
  and coalesce(s.active, true) = true
  and coalesce(s.deleted_at is null, true)
  and coalesce(s.is_deleted, false) = false
on conflict (staff_id) where staff_id is not null do update
set
  name = excluded.name,
  staff_name = excluded.staff_name,
  role = excluded.role,
  staff_role = excluded.staff_role,
  branch = excluded.branch,
  branch_id = excluded.branch_id,
  active = excluded.active,
  can_login = excluded.can_login,
  visible_in_admin = true,
  permissions = case
    when public.staff_accounts.permissions is null or public.staff_accounts.permissions = '{}'::jsonb
    then excluded.permissions
    else public.staff_accounts.permissions
  end,
  updated_at = now();

insert into public.staff_accounts (
  username,
  password_hash,
  temporary_password,
  name,
  staff_name,
  role,
  staff_role,
  branch,
  active,
  can_login,
  visible_in_admin,
  permissions,
  must_change_password
)
values (
  'admin',
  crypt('admin123', gen_salt('bf')),
  'admin123',
  'المدير العام',
  'المدير العام',
  'أدمن',
  'أدمن',
  'كل الفروع',
  true,
  true,
  true,
  public.staff_accounts_permissions_for_role('أدمن'),
  true
)
on conflict (username) where username is not null do update
set
  name = excluded.name,
  staff_name = excluded.staff_name,
  role = excluded.role,
  staff_role = excluded.staff_role,
  branch = excluded.branch,
  active = true,
  can_login = true,
  visible_in_admin = true,
  permissions = excluded.permissions,
  updated_at = now();

create or replace function public.staff_account_login(
  p_username text,
  p_password text
)
returns table (
  id uuid,
  username text,
  name text,
  role text,
  branch text,
  staff_id uuid,
  staff_name text,
  staff_role text,
  branch_id uuid,
  can_login boolean,
  permissions jsonb,
  must_change_password boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    a.id,
    a.username,
    coalesce(a.staff_name, a.name) as name,
    coalesce(a.staff_role, a.role) as role,
    a.branch,
    a.staff_id,
    coalesce(a.staff_name, a.name) as staff_name,
    coalesce(a.staff_role, a.role) as staff_role,
    a.branch_id,
    coalesce(a.can_login, true) as can_login,
    coalesce(a.permissions, '{}'::jsonb) as permissions,
    coalesce(a.must_change_password, false) as must_change_password
  from public.staff_accounts a
  where lower(trim(a.username)) = lower(trim(p_username))
    and coalesce(a.active, true) = true
    and coalesce(a.can_login, true) = true
    and a.password_hash = crypt(p_password, a.password_hash)
  limit 1;
end;
$$;

create or replace function public.staff_account_reset_password(
  p_account_id uuid,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_accounts
  set
    password_hash = crypt(p_new_password, gen_salt('bf')),
    temporary_password = p_new_password,
    must_change_password = true,
    updated_at = now()
  where id = p_account_id;
end;
$$;

alter table public.staff_accounts enable row level security;

drop policy if exists "Allow anon read staff accounts" on public.staff_accounts;
drop policy if exists "Allow anon insert staff accounts" on public.staff_accounts;
drop policy if exists "Allow anon update staff accounts" on public.staff_accounts;
drop policy if exists "Allow authenticated read staff accounts" on public.staff_accounts;
drop policy if exists "Allow authenticated update staff accounts" on public.staff_accounts;

create policy "Allow anon read staff accounts"
on public.staff_accounts
for select
to anon
using (true);

create policy "Allow anon insert staff accounts"
on public.staff_accounts
for insert
to anon
with check (true);

create policy "Allow anon update staff accounts"
on public.staff_accounts
for update
to anon
using (true)
with check (true);

create policy "Allow authenticated read staff accounts"
on public.staff_accounts
for select
to authenticated
using (true);

create policy "Allow authenticated update staff accounts"
on public.staff_accounts
for update
to authenticated
using (true)
with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.staff_accounts to anon, authenticated;
grant execute on function public.staff_account_login(text, text) to anon, authenticated;
grant execute on function public.staff_account_reset_password(uuid, text) to anon, authenticated;

select username, staff_name as name, staff_role as role, branch, temporary_password, active, can_login, visible_in_admin
from public.staff_accounts
where visible_in_admin is distinct from false
order by branch, role, staff_name;
