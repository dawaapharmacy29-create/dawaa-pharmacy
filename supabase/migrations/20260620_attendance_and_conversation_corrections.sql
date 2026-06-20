-- Dawaa Pharmacy V3: attendance by location + conversation correction layer
-- Safe migration: no destructive statements.

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

alter table public.attendance_locations add column if not exists name text;
alter table public.attendance_locations add column if not exists type text;
alter table public.attendance_locations add column if not exists branch_name text;
alter table public.attendance_locations add column if not exists latitude numeric;
alter table public.attendance_locations add column if not exists longitude numeric;
alter table public.attendance_locations add column if not exists allowed_radius_meters integer default 100;
alter table public.attendance_locations add column if not exists max_gps_accuracy_meters integer default 80;
alter table public.attendance_locations add column if not exists is_active boolean default true;
alter table public.attendance_locations add column if not exists created_at timestamptz default now();
alter table public.attendance_locations add column if not exists updated_at timestamptz default now();

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
  biometric_method text null,
  device_id text null,
  status text not null default 'accepted' check (status in ('accepted', 'rejected', 'manual_review')),
  rejection_reason text null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_attendance_logs add column if not exists staff_id uuid;
alter table public.staff_attendance_logs add column if not exists staff_name text;
alter table public.staff_attendance_logs add column if not exists role text;
alter table public.staff_attendance_logs add column if not exists branch_name text;
alter table public.staff_attendance_logs add column if not exists location_id uuid references public.attendance_locations(id);
alter table public.staff_attendance_logs add column if not exists attendance_type text;
alter table public.staff_attendance_logs add column if not exists recorded_at timestamptz default now();
alter table public.staff_attendance_logs add column if not exists shift_date date default current_date;
alter table public.staff_attendance_logs add column if not exists shift_name text;
alter table public.staff_attendance_logs add column if not exists scheduled_shift_start time;
alter table public.staff_attendance_logs add column if not exists scheduled_shift_end time;
alter table public.staff_attendance_logs add column if not exists latitude numeric;
alter table public.staff_attendance_logs add column if not exists longitude numeric;
alter table public.staff_attendance_logs add column if not exists gps_accuracy_meters numeric;
alter table public.staff_attendance_logs add column if not exists distance_from_location_meters numeric;
alter table public.staff_attendance_logs add column if not exists biometric_verified boolean default false;
alter table public.staff_attendance_logs add column if not exists biometric_method text;
alter table public.staff_attendance_logs add column if not exists device_id text;
alter table public.staff_attendance_logs add column if not exists status text default 'accepted';
alter table public.staff_attendance_logs add column if not exists rejection_reason text;
alter table public.staff_attendance_logs add column if not exists created_by uuid;
alter table public.staff_attendance_logs add column if not exists created_at timestamptz default now();
alter table public.staff_attendance_logs add column if not exists updated_at timestamptz default now();

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

create table if not exists public.conversation_penalty_corrections (
  id uuid primary key default gen_random_uuid(),
  negative_evaluation_id uuid not null,
  staff_id uuid null,
  staff_name text not null,
  cycle_start date not null,
  cycle_end date not null,
  original_negative_points numeric not null default 0,
  remaining_negative_points numeric not null default 0,
  required_positive_corrections integer not null default 3,
  achieved_positive_corrections integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'corrected', 'partially_corrected', 'finalized')),
  is_major_error boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_correction_matches (
  id uuid primary key default gen_random_uuid(),
  correction_id uuid not null references public.conversation_penalty_corrections(id) on delete cascade,
  positive_evaluation_id uuid not null,
  correction_weight integer not null default 1,
  created_at timestamptz not null default now(),
  unique(correction_id, positive_evaluation_id)
);

create index if not exists idx_attendance_locations_active on public.attendance_locations(is_active, branch_name);
create index if not exists idx_staff_attendance_staff_date on public.staff_attendance_logs(staff_id, shift_date desc);
create index if not exists idx_staff_attendance_branch_date on public.staff_attendance_logs(branch_name, shift_date desc);
create index if not exists idx_attendance_manual_status on public.attendance_manual_requests(status, created_at desc);
create index if not exists idx_conversation_corrections_staff_cycle on public.conversation_penalty_corrections(staff_id, cycle_start, cycle_end, status);

alter table public.attendance_locations enable row level security;
alter table public.staff_attendance_logs enable row level security;
alter table public.attendance_manual_requests enable row level security;
alter table public.conversation_penalty_corrections enable row level security;
alter table public.conversation_correction_matches enable row level security;

do $$ begin
  create policy "attendance_locations_read_active" on public.attendance_locations for select using (is_active = true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff_attendance_insert_authenticated" on public.staff_attendance_logs for insert with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "staff_attendance_read_authenticated" on public.staff_attendance_logs for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "manual_requests_insert_authenticated" on public.attendance_manual_requests for insert with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "manual_requests_read_authenticated" on public.attendance_manual_requests for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "conversation_corrections_read_authenticated" on public.conversation_penalty_corrections for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "conversation_matches_read_authenticated" on public.conversation_correction_matches for select using (true);
exception when duplicate_object then null; end $$;
