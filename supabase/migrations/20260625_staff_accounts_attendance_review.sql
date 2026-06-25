-- Staff accounts, permissions, and attendance import review support.
-- Safe to run multiple times: creates review tables only when missing.

create table if not exists public.staff_schedule_rules (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid null,
  staff_name text not null,
  branch text null,
  allowed_start time not null,
  allowed_end time not null,
  allowed_hours numeric(5,2) not null,
  days_per_week integer null,
  rule_type text not null default 'allowed_short_shift',
  notes text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text null,
  imported_by uuid null,
  branch text null,
  period_start date null,
  period_end date null,
  status text not null default 'preview',
  total_rows integer not null default 0,
  warning_count integer not null default 0,
  error_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  saved_at timestamptz null
);

create table if not exists public.attendance_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.attendance_import_batches(id) on delete cascade,
  staff_id uuid null,
  staff_name text not null,
  branch text null,
  work_day text null,
  work_date date null,
  raw_shift text null,
  start_time time null,
  end_time time null,
  hours numeric(5,2) null,
  is_off boolean not null default false,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  status text not null default 'preview',
  created_at timestamptz not null default now()
);

create table if not exists public.staff_attendance_summary_monthly (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid null,
  staff_name text not null,
  branch text null,
  month date not null,
  scheduled_days integer not null default 0,
  worked_days integer not null default 0,
  off_days integer not null default 0,
  scheduled_hours numeric(8,2) not null default 0,
  worked_hours numeric(8,2) not null default 0,
  late_minutes integer not null default 0,
  absence_days integer not null default 0,
  warnings_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (staff_id, staff_name, branch, month)
);

create index if not exists idx_staff_schedule_rules_name_branch
  on public.staff_schedule_rules (staff_name, branch)
  where active = true;

create index if not exists idx_attendance_import_rows_batch
  on public.attendance_import_rows (batch_id);

create index if not exists idx_staff_attendance_summary_month
  on public.staff_attendance_summary_monthly (month, branch);

insert into public.staff_schedule_rules (
  staff_name,
  branch,
  allowed_start,
  allowed_end,
  allowed_hours,
  days_per_week,
  rule_type,
  notes
)
select
  name_variant,
  'فرع شكري',
  time '13:30',
  time '19:30',
  6,
  3,
  'allowed_short_shift',
  'قاعدة د/ ندى: شيفت 1:30 PM إلى 7:30 PM لمدة 6 ساعات، 3 أيام أسبوعيًا. فرع أبو العزم يظهر في النظام كفرع شكري.'
from (values ('د/ ندى'), ('د/ ندي'), ('د ندى'), ('د ندي')) as variants(name_variant)
where not exists (
  select 1
  from public.staff_schedule_rules r
  where r.staff_name = variants.name_variant
    and r.branch = 'فرع شكري'
    and r.allowed_start = time '13:30'
    and r.allowed_end = time '19:30'
    and r.active = true
);
