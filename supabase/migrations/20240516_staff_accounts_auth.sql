create extension if not exists "pgcrypto";

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  password_hash text not null,
  name text not null,
  staff_name text,
  role text not null default 'صيدلاني',
  staff_role text,
  branch text not null default 'الكل',
  phone text,
  staff_id uuid,
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create index if not exists staff_accounts_role_branch_idx
on public.staff_accounts (role, branch, active);

alter table public.staff_accounts enable row level security;

revoke all on table public.staff_accounts from anon, authenticated;

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
  phone text,
  active boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with matched as (
    select a.id
    from public.staff_accounts a
    where lower(a.username) = lower(trim(p_username))
      and a.active = true
      and a.password_hash = crypt(p_password, a.password_hash)
    limit 1
  ),
  updated as (
    update public.staff_accounts a
    set last_login_at = now()
    from matched m
    where a.id = m.id
    returning a.id, a.username, a.name, a.role, a.branch, a.phone, a.active
  )
  select updated.id, updated.username, coalesce(updated.name, updated.staff_name), coalesce(updated.role, updated.staff_role), updated.branch, updated.phone, updated.active
  from updated;
end;
$$;

grant execute on function public.staff_account_login(text, text) to anon, authenticated;

insert into public.staff_accounts (username, password_hash, name, staff_name, role, staff_role, branch, active, must_change_password)
values
  ('admin', crypt('admin123', gen_salt('bf')), 'المدير العام', 'المدير العام', 'أدمن', 'أدمن', 'الكل', true, true),
  ('doha', crypt('123456', gen_salt('bf')), 'د/ ضحى', 'د/ ضحى', 'صيدلاني', 'صيدلاني', 'فرع الشامي', true, true),
  ('mohamed.khaled.shamy', crypt('123456', gen_salt('bf')), 'د/ محمد خالد', 'د/ محمد خالد', 'صيدلاني', 'صيدلاني', 'فرع الشامي', true, true),
  ('mohamed.mesad', crypt('123456', gen_salt('bf')), 'د/ محمد مسعد', 'د/ محمد مسعد', 'صيدلاني', 'صيدلاني', 'فرع الشامي', true, true),
  ('shimaa', crypt('123456', gen_salt('bf')), 'د/ شيماء', 'د/ شيماء', 'صيدلاني', 'صيدلاني', 'فرع الشامي', true, true),
  ('aliyaa', crypt('123456', gen_salt('bf')), 'د/ علياء', 'د/ علياء', 'صيدلاني', 'صيدلاني', 'فرع الشامي', true, true),
  ('yousef', crypt('123456', gen_salt('bf')), 'د/ يوسف', 'د/ يوسف', 'صيدلاني', 'صيدلاني', 'فرع الشامي', true, true),
  ('sara', crypt('123456', gen_salt('bf')), 'د/ سارة', 'د/ سارة', 'صيدلاني', 'صيدلاني', 'فرع شكري', true, true),
  ('ola', crypt('123456', gen_salt('bf')), 'د/ علا', 'د/ علا', 'صيدلاني', 'صيدلاني', 'فرع شكري', true, true),
  ('donia', crypt('123456', gen_salt('bf')), 'د/ دنيا', 'د/ دنيا', 'صيدلاني', 'صيدلاني', 'فرع شكري', true, true),
  ('islam', crypt('123456', gen_salt('bf')), 'د/ إسلام', 'د/ إسلام', 'صيدلاني', 'صيدلاني', 'فرع شكري', true, true),
  ('hassan', crypt('123456', gen_salt('bf')), 'د/ حسن', 'د/ حسن', 'صيدلاني', 'صيدلاني', 'فرع شكري', true, true),
  ('mohamed.khaled.shokry', crypt('123456', gen_salt('bf')), 'د/ محمد خالد', 'د/ محمد خالد', 'صيدلاني', 'صيدلاني', 'فرع شكري', true, true),
  ('mohamed.shehata', crypt('123456', gen_salt('bf')), 'محمد شحاتة', 'محمد شحاتة', 'مساعد', 'مساعد', 'فرع شكري', true, true),
  ('mostafa', crypt('123456', gen_salt('bf')), 'مصطفى', 'مصطفى', 'مساعد', 'مساعد', 'فرع الشامي', true, true),
  ('ahmed.batal', crypt('123456', gen_salt('bf')), 'احمد البطل', 'احمد البطل', 'توصيل', 'توصيل', 'فرع الشامي', true, true),
  ('ahmed.wagih', crypt('123456', gen_salt('bf')), 'احمد وجيه', 'احمد وجيه', 'توصيل', 'توصيل', 'فرع شكري', true, true),
  ('eslam', crypt('123456', gen_salt('bf')), 'اسلام', 'اسلام', 'توصيل', 'توصيل', 'فرع شكري', true, true),
  ('hussein', crypt('123456', gen_salt('bf')), 'حسين', 'حسين', 'توصيل', 'توصيل', 'فرع شكري', true, true)
on conflict (username) do update
set
  name = excluded.name,
  staff_name = excluded.staff_name,
  role = excluded.role,
  staff_role = excluded.staff_role,
  branch = excluded.branch,
  active = excluded.active,
  updated_at = now();

-- تغيير باسورد أي حساب:
-- update public.staff_accounts
-- set password_hash = crypt('NEW_PASSWORD_HERE', gen_salt('bf')), must_change_password = false
-- where username = 'islam';

-- تعطيل حساب:
-- update public.staff_accounts
-- set active = false
-- where username = 'islam';
