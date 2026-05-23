-- Suggested schema only. Review in Supabase before running.
-- Do not use service_role in the frontend.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text,
  phone text,
  role text not null,
  branch text not null,
  shift_start text default '09:00',
  shift_end text default '17:00',
  holiday_day text,
  points integer default 500,
  max_points integer default 500,
  status text default 'نشط',
  join_date date default current_date,
  notes text,
  user_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.shift_schedules (
  id uuid primary key default gen_random_uuid(),
  staff_name text not null,
  employee_name text,
  role text,
  branch text not null,
  day_name text not null,
  shift_start text,
  shift_end text,
  hours numeric,
  is_off boolean default false,
  raw_shift text,
  source text,
  created_at timestamptz default now()
);

create table if not exists public.shift_exceptions (
  id uuid primary key default gen_random_uuid(),
  staff_name text not null,
  employee_name text,
  type text not null,
  status text default 'pending',
  branch text,
  day_name text,
  date date,
  reason text,
  source text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  branch text,
  attendance_date date not null default current_date,
  scheduled_start text,
  scheduled_end text,
  actual_check_in timestamptz,
  actual_check_out timestamptz,
  status text default 'pending',
  late_minutes integer default 0,
  early_leave_minutes integer default 0,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.points_transactions (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  branch text,
  category text,
  source_type text,
  source_id text,
  points integer not null,
  status text default 'pending',
  reason text,
  created_at timestamptz default now()
);

create index if not exists employees_name_idx on public.employees (name);
create index if not exists shift_schedules_staff_day_idx on public.shift_schedules (staff_name, day_name);
create index if not exists shift_exceptions_staff_status_idx on public.shift_exceptions (staff_name, status);
create index if not exists attendance_employee_date_idx on public.attendance (employee_name, attendance_date);
create index if not exists points_transactions_employee_idx on public.points_transactions (employee_name);
