create extension if not exists "pgcrypto";

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid()
);

alter table public.staff_accounts
  add column if not exists username text,
  add column if not exists password_hash text,
  add column if not exists name text,
  add column if not exists staff_name text,
  add column if not exists role text default 'صيدلاني',
  add column if not exists staff_role text default 'صيدلاني',
  add column if not exists branch text default 'الكل',
  add column if not exists phone text,
  add column if not exists staff_id uuid,
  add column if not exists active boolean default true,
  add column if not exists must_change_password boolean default true,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists last_login_at timestamptz;

create unique index if not exists staff_accounts_username_unique_idx
on public.staff_accounts (username);

create index if not exists staff_accounts_role_branch_idx
on public.staff_accounts (role, branch, active);

alter table public.staff_accounts enable row level security;

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
  select
    a.id,
    a.username,
    coalesce(a.name, a.staff_name) as name,
    coalesce(a.role, a.staff_role) as role,
    a.branch,
    a.phone,
    a.active
  from public.staff_accounts a
  where lower(a.username) = lower(trim(p_username))
    and a.active = true
    and a.password_hash = crypt(p_password, a.password_hash)
  limit 1;
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
  password_hash = excluded.password_hash,
  name = excluded.name,
  staff_name = excluded.staff_name,
  role = excluded.role,
  staff_role = excluded.staff_role,
  branch = excluded.branch,
  active = excluded.active,
  must_change_password = excluded.must_change_password,
  updated_at = now();

select username, coalesce(name, staff_name) as name, coalesce(role, staff_role) as role, branch, active
from public.staff_accounts
order by branch, role, name;
