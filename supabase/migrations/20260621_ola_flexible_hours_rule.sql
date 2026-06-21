create extension if not exists pgcrypto;

create table if not exists staff_monthly_hour_rules (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid null,
  staff_name text not null,
  role text null,
  branch_name text null,
  target_hours numeric not null default 208,
  monthly_days_off integer not null default 4,
  flexible_daily_hours boolean not null default false,
  allow_split_shifts boolean not null default false,
  notes text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table staff_monthly_hour_rules add column if not exists staff_id uuid;
alter table staff_monthly_hour_rules add column if not exists staff_name text;
alter table staff_monthly_hour_rules add column if not exists role text;
alter table staff_monthly_hour_rules add column if not exists branch_name text;
alter table staff_monthly_hour_rules add column if not exists target_hours numeric default 208;
alter table staff_monthly_hour_rules add column if not exists monthly_days_off integer default 4;
alter table staff_monthly_hour_rules add column if not exists flexible_daily_hours boolean default false;
alter table staff_monthly_hour_rules add column if not exists allow_split_shifts boolean default false;
alter table staff_monthly_hour_rules add column if not exists notes text;
alter table staff_monthly_hour_rules add column if not exists is_active boolean default true;
alter table staff_monthly_hour_rules add column if not exists created_at timestamptz default now();
alter table staff_monthly_hour_rules add column if not exists updated_at timestamptz default now();

insert into staff_monthly_hour_rules
(staff_name, role, branch_name, target_hours, monthly_days_off, flexible_daily_hours, allow_split_shifts, notes)
select
  'د علا',
  'branches_manager',
  'كل الفروع',
  208,
  4,
  true,
  true,
  'مديرة الفروع: الحساب على إجمالي 208 ساعة شهريا، ويسمح بتقسيم اليوم على أكثر من فترة وأكثر من فرع.'
where not exists (
  select 1 from staff_monthly_hour_rules
  where staff_name = 'د علا' and is_active = true
);
