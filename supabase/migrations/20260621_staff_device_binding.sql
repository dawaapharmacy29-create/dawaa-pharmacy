create extension if not exists pgcrypto;

create table if not exists public.staff_attendance_devices (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid null,
  staff_name text not null,
  role text null,
  branch_name text null,
  device_id text not null,
  device_label text null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'active',
  approved_by uuid null,
  approved_at timestamptz null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_attendance_devices add column if not exists staff_id uuid;
alter table public.staff_attendance_devices add column if not exists staff_name text;
alter table public.staff_attendance_devices add column if not exists role text;
alter table public.staff_attendance_devices add column if not exists branch_name text;
alter table public.staff_attendance_devices add column if not exists device_id text;
alter table public.staff_attendance_devices add column if not exists device_label text;
alter table public.staff_attendance_devices add column if not exists first_seen_at timestamptz default now();
alter table public.staff_attendance_devices add column if not exists last_seen_at timestamptz default now();
alter table public.staff_attendance_devices add column if not exists status text default 'active';
alter table public.staff_attendance_devices add column if not exists approved_by uuid;
alter table public.staff_attendance_devices add column if not exists approved_at timestamptz;
alter table public.staff_attendance_devices add column if not exists notes text;
alter table public.staff_attendance_devices add column if not exists created_at timestamptz default now();
alter table public.staff_attendance_devices add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_staff_attendance_devices_active_staff
on public.staff_attendance_devices (coalesce(staff_id::text, staff_name))
where status = 'active';

create index if not exists idx_staff_attendance_devices_device on public.staff_attendance_devices(device_id);
create index if not exists idx_staff_attendance_devices_status on public.staff_attendance_devices(status, updated_at desc);
