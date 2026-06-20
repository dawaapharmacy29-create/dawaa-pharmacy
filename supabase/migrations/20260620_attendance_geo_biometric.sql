-- Dawaa Pharmacy attendance + geo + biometric foundation
-- Safe migration: no destructive changes.

create extension if not exists pgcrypto;

create table if not exists public.attendance_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('branch', 'warehouse')),
  branch_name text null,
  latitude numeric not null,
  longitude numeric not null,
  allowed_radius_meters integer not null default 100,
  max_gps_accuracy_meters integer not null default 80,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_attendance_logs (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid null,
  staff_name text not null,
  role text null,
  branch_name text null,
  location_id uuid null references public.attendance_locations(id),
  attendance_type text not null check (attendance_type in ('check_in', 'check_out')),
  recorded_at timestamptz not null default now(),
  shift_date date not null default current_date,
  shift_name text null,
  scheduled_shift_start time null,
  scheduled_shift_end time null,
  latitude numeric null,
  longitude numeric null,
  gps_accuracy_meters numeric null,
  distance_from_location_meters numeric null,
  biometric_verified boolean not null default false,
  biometric_method text null check (biometric_method is null or biometric_method in ('webauthn', 'device_biometrics', 'passkey', 'fallback_pin')),
  device_id text null,
  status text not null default 'manual_review' check (status in ('accepted', 'rejected', 'manual_review')),
  rejection_reason text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_manual_requests (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid null,
  staff_name text not null,
  branch_name text null,
  request_type text not null check (request_type in ('missed_check_in', 'missed_check_out', 'gps_issue', 'biometric_issue', 'other')),
  requested_time timestamptz not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid null,
  reviewed_at timestamptz null,
  review_note text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_locations_active on public.attendance_locations(is_active, type, branch_name);
create index if not exists idx_staff_attendance_logs_staff_date on public.staff_attendance_logs(staff_id, shift_date desc, recorded_at desc);
create index if not exists idx_staff_attendance_logs_branch_date on public.staff_attendance_logs(branch_name, shift_date desc, recorded_at desc);
create index if not exists idx_staff_attendance_logs_status on public.staff_attendance_logs(status, recorded_at desc);
create index if not exists idx_attendance_manual_requests_status on public.attendance_manual_requests(status, created_at desc);

alter table public.attendance_locations enable row level security;
alter table public.staff_attendance_logs enable row level security;
alter table public.attendance_manual_requests enable row level security;

-- The frontend sends x-dawaa-user-id through the existing Supabase client.
-- Policies are intentionally permissive for authenticated app traffic while the project uses custom auth.
-- Tighten later with JWT auth if/when Supabase Auth becomes the source of truth.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_locations' and policyname = 'attendance_locations_read_active') then
    create policy attendance_locations_read_active on public.attendance_locations for select using (is_active = true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staff_attendance_logs' and policyname = 'staff_attendance_logs_app_insert') then
    create policy staff_attendance_logs_app_insert on public.staff_attendance_logs for insert with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'staff_attendance_logs' and policyname = 'staff_attendance_logs_app_read') then
    create policy staff_attendance_logs_app_read on public.staff_attendance_logs for select using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_manual_requests' and policyname = 'attendance_manual_requests_app_insert') then
    create policy attendance_manual_requests_app_insert on public.attendance_manual_requests for insert with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_manual_requests' and policyname = 'attendance_manual_requests_app_read') then
    create policy attendance_manual_requests_app_read on public.attendance_manual_requests for select using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'attendance_manual_requests' and policyname = 'attendance_manual_requests_app_update') then
    create policy attendance_manual_requests_app_update on public.attendance_manual_requests for update using (true) with check (true);
  end if;
end $$;
