-- صيدليات دواء - تثبيت نهائي للموظفين/الحسابات/العملاء/الجداول
-- شغّل الملف كاملًا في Supabase SQL Editor قبل تجربة النسخة الجديدة.

-- 1) حسابات الفريق: تأكد من وجود الأعمدة الأساسية بدون كسر الجداول القديمة
create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid,
  username text unique,
  temporary_password text,
  password_status text default 'مؤقتة',
  name text,
  staff_name text,
  role text,
  staff_role text,
  branch text,
  branch_id text,
  active boolean default true,
  can_login boolean default true,
  visible_in_admin boolean default true,
  permissions jsonb default '{}'::jsonb,
  auth_user_id uuid,
  last_login_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.staff_accounts add column if not exists staff_id uuid;
alter table public.staff_accounts add column if not exists username text;
alter table public.staff_accounts add column if not exists temporary_password text;
alter table public.staff_accounts add column if not exists password_status text default 'مؤقتة';
alter table public.staff_accounts add column if not exists name text;
alter table public.staff_accounts add column if not exists staff_name text;
alter table public.staff_accounts add column if not exists role text;
alter table public.staff_accounts add column if not exists staff_role text;
alter table public.staff_accounts add column if not exists branch text;
alter table public.staff_accounts add column if not exists branch_id text;
alter table public.staff_accounts add column if not exists active boolean default true;
alter table public.staff_accounts add column if not exists can_login boolean default true;
alter table public.staff_accounts add column if not exists visible_in_admin boolean default true;
alter table public.staff_accounts add column if not exists permissions jsonb default '{}'::jsonb;
alter table public.staff_accounts add column if not exists auth_user_id uuid;
alter table public.staff_accounts add column if not exists last_login_at timestamptz;
alter table public.staff_accounts add column if not exists created_at timestamptz default now();
alter table public.staff_accounts add column if not exists updated_at timestamptz default now();

-- تعبئة بيانات الحسابات الناقصة من جدول staff
update public.staff_accounts a
set
  staff_name = coalesce(a.staff_name, s.name),
  name = coalesce(a.name, s.name),
  role = coalesce(a.role, s.role),
  staff_role = coalesce(a.staff_role, s.role),
  branch = coalesce(a.branch, s.branch),
  branch_id = coalesce(a.branch_id, s.branch_id::text),
  permissions = coalesce(a.permissions, '{}'::jsonb),
  active = coalesce(a.active, true),
  can_login = coalesce(a.can_login, true),
  visible_in_admin = coalesce(a.visible_in_admin, true),
  updated_at = now()
from public.staff s
where a.staff_id = s.id;

create unique index if not exists staff_accounts_username_unique
on public.staff_accounts (username)
where username is not null;

create index if not exists staff_accounts_staff_id_idx on public.staff_accounts(staff_id);

-- 2) صلاحيات المستخدم: إنشاء جدول overrides لو ناقص
create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  permission_key text not null,
  allowed boolean not null default true,
  created_by uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, permission_key)
);

create table if not exists public.permission_definitions (
  id uuid primary key default gen_random_uuid(),
  permission_key text not null unique,
  name_ar text,
  label text,
  description text,
  category text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3) سجل الأنشطة الموحد
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  operation text,
  entity_type text,
  entity_id text,
  entity_title text,
  user_id uuid,
  user_name text,
  user_role text,
  branch_id text,
  branch_name text,
  details text,
  old_value jsonb,
  new_value jsonb,
  route_path text,
  created_at timestamptz default now()
);

-- 4) جدول الرواكد والصرف: تأكد من أعمدة العميل المهمة
alter table public.stagnant_medicine_dispenses add column if not exists customer_id text;
alter table public.stagnant_medicine_dispenses add column if not exists customer_name text;
alter table public.stagnant_medicine_dispenses add column if not exists customer_code text;
alter table public.stagnant_medicine_dispenses add column if not exists customer_phone text;
alter table public.stagnant_medicine_dispenses add column if not exists invoice_no text;
alter table public.stagnant_medicine_dispenses add column if not exists doctor_id uuid;
alter table public.stagnant_medicine_dispenses add column if not exists doctor_name text;
alter table public.stagnant_medicine_dispenses add column if not exists total_incentive numeric default 0;

-- 5) جدول الشيفتات: أعمدة ثابتة وتخفيف مشكلة ظهور إجازة بسبب سجلات قديمة
alter table public.shift_schedules add column if not exists staff_id uuid;
alter table public.shift_schedules add column if not exists staff_name text;
alter table public.shift_schedules add column if not exists branch text;
alter table public.shift_schedules add column if not exists day_name text;
alter table public.shift_schedules add column if not exists day_of_week integer;
alter table public.shift_schedules add column if not exists shift_start text;
alter table public.shift_schedules add column if not exists shift_end text;
alter table public.shift_schedules add column if not exists is_off boolean default false;
alter table public.shift_schedules add column if not exists is_day_off boolean default false;
alter table public.shift_schedules add column if not exists is_different boolean default false;
alter table public.shift_schedules add column if not exists has_custom_time boolean default false;
alter table public.shift_schedules add column if not exists updated_at timestamptz default now();

-- 6) تشخيص مهم: د/ حسن أو أي موظف ظاهر إجازة طول الأسبوع
-- شغّل الاستعلام التالي وحده لمراجعة بياناته:
-- select s.id, s.name, ss.day_name, ss.shift_start, ss.shift_end, ss.is_off, ss.is_day_off, ss.updated_at
-- from public.staff s
-- left join public.shift_schedules ss on ss.staff_id = s.id or ss.staff_name = s.name
-- where s.name ilike '%حسن%'
-- order by s.name, ss.day_of_week, ss.updated_at desc;

-- 7) تشخيص تكرار الموظفين قبل أي حذف
-- select name, role, branch, count(*) as duplicate_count, array_agg(id) as ids
-- from public.staff
-- group by name, role, branch
-- having count(*) > 1;

-- 8) أرشفة الجداول القديمة الفارغة فقط - لا تشغلها إلا بعد أسبوع استقرار
-- do $$
-- begin
--   if exists (select 1 from information_schema.tables where table_schema='public' and table_name='staff_shift_schedules') then
--     alter table public.staff_shift_schedules rename to archived_staff_shift_schedules_old;
--   end if;
--   if exists (select 1 from information_schema.tables where table_schema='public' and table_name='points') then
--     alter table public.points rename to archived_points_old;
--   end if;
--   if exists (select 1 from information_schema.tables where table_schema='public' and table_name='doctor_permissions') then
--     alter table public.doctor_permissions rename to archived_doctor_permissions_old;
--   end if;
-- end $$;
