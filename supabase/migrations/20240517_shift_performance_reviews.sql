create extension if not exists "pgcrypto";

create table if not exists public.shift_performance_reviews (
  id uuid primary key default gen_random_uuid(),
  review_date date not null,
  branch_id uuid,
  branch_name text,
  shift_type text not null,
  shift_start time,
  shift_end time,
  issue_category text,
  issue_description text,
  workload_pressure text default 'normal',
  workload_pressure_notes text,
  negligence_suspected text default 'needs_review',
  severity text default 'medium',
  action_mode text default 'training_only',
  status text default 'pending',
  reviewed_by uuid,
  reviewed_by_name text,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  evidence text,
  notes text,
  total_points numeric default 0,
  cycle_start date,
  cycle_end date,
  month_cycle text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.shift_performance_reviews
  add column if not exists branch_id uuid,
  add column if not exists branch_name text,
  add column if not exists shift_start time,
  add column if not exists shift_end time,
  add column if not exists workload_pressure_notes text,
  add column if not exists evidence text,
  add column if not exists total_points numeric default 0,
  add column if not exists cycle_start date,
  add column if not exists cycle_end date,
  add column if not exists month_cycle text,
  add column if not exists updated_at timestamptz default now();

create table if not exists public.shift_performance_review_members (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.shift_performance_reviews(id) on delete cascade,
  staff_id text not null,
  staff_name text,
  staff_role text,
  is_shift_leader boolean default false,
  was_present boolean default true,
  has_permission boolean default false,
  base_points numeric default 0,
  repeat_count integer default 0,
  multiplier numeric default 1,
  assigned_points numeric default 0,
  point_transaction_id uuid,
  notes text,
  created_at timestamptz default now()
);

alter table public.shift_performance_review_members
  add column if not exists staff_role text,
  add column if not exists was_present boolean default true,
  add column if not exists has_permission boolean default false,
  add column if not exists point_transaction_id uuid,
  add column if not exists notes text;

create table if not exists public.point_records (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text,
  type text,
  points numeric default 0,
  reason text,
  manager_note text,
  created_by text,
  branch text,
  cycle_start date,
  cycle_end date,
  source_type text,
  source_id text,
  points_delta numeric default 0,
  status text default 'pending',
  month_cycle text,
  created_by_id text,
  created_by_name text,
  created_by_role text,
  created_at timestamptz default now()
);

alter table public.point_records
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists points_delta numeric default 0,
  add column if not exists status text default 'pending',
  add column if not exists month_cycle text,
  add column if not exists created_by_id text,
  add column if not exists created_by_name text,
  add column if not exists created_by_role text;

create table if not exists public.points_transactions (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text,
  branch text,
  category text,
  source_type text,
  source_id text,
  points numeric default 0,
  points_delta numeric default 0,
  month_cycle text,
  status text default 'pending',
  reason text,
  created_at timestamptz default now()
);

alter table public.points_transactions
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists points_delta numeric default 0,
  add column if not exists month_cycle text,
  add column if not exists status text default 'pending',
  add column if not exists reason text;

create index if not exists shift_performance_reviews_date_idx
  on public.shift_performance_reviews (review_date desc, branch_name, shift_type);

create index if not exists shift_performance_reviews_cycle_idx
  on public.shift_performance_reviews (cycle_start, cycle_end, status);

create index if not exists shift_performance_members_review_idx
  on public.shift_performance_review_members (review_id);

create index if not exists shift_performance_members_staff_idx
  on public.shift_performance_review_members (staff_id, staff_name);

create index if not exists point_records_source_idx
  on public.point_records (source_type, source_id);

create index if not exists point_records_employee_cycle_idx
  on public.point_records (employee_id, month_cycle, created_at desc);

create index if not exists points_transactions_source_idx
  on public.points_transactions (source_type, source_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_shift_performance_reviews_updated_at on public.shift_performance_reviews;
create trigger set_shift_performance_reviews_updated_at
before update on public.shift_performance_reviews
for each row execute function public.set_updated_at();

alter table public.shift_performance_reviews enable row level security;
alter table public.shift_performance_review_members enable row level security;
alter table public.point_records enable row level security;
alter table public.points_transactions enable row level security;

drop policy if exists "Allow anon read shift performance reviews" on public.shift_performance_reviews;
drop policy if exists "Allow anon insert shift performance reviews" on public.shift_performance_reviews;
drop policy if exists "Allow anon update shift performance reviews" on public.shift_performance_reviews;

create policy "Allow anon read shift performance reviews"
on public.shift_performance_reviews
for select
to anon
using (true);

create policy "Allow anon insert shift performance reviews"
on public.shift_performance_reviews
for insert
to anon
with check (true);

create policy "Allow anon update shift performance reviews"
on public.shift_performance_reviews
for update
to anon
using (true)
with check (true);

drop policy if exists "Allow anon read shift performance members" on public.shift_performance_review_members;
drop policy if exists "Allow anon insert shift performance members" on public.shift_performance_review_members;
drop policy if exists "Allow anon update shift performance members" on public.shift_performance_review_members;

create policy "Allow anon read shift performance members"
on public.shift_performance_review_members
for select
to anon
using (true);

create policy "Allow anon insert shift performance members"
on public.shift_performance_review_members
for insert
to anon
with check (true);

create policy "Allow anon update shift performance members"
on public.shift_performance_review_members
for update
to anon
using (true)
with check (true);

drop policy if exists "Allow anon read point records" on public.point_records;
drop policy if exists "Allow anon insert point records" on public.point_records;
drop policy if exists "Allow anon update point records" on public.point_records;

create policy "Allow anon read point records"
on public.point_records
for select
to anon
using (true);

create policy "Allow anon insert point records"
on public.point_records
for insert
to anon
with check (true);

create policy "Allow anon update point records"
on public.point_records
for update
to anon
using (true)
with check (true);

drop policy if exists "Allow anon read points transactions" on public.points_transactions;
drop policy if exists "Allow anon insert points transactions" on public.points_transactions;
drop policy if exists "Allow anon update points transactions" on public.points_transactions;

create policy "Allow anon read points transactions"
on public.points_transactions
for select
to anon
using (true);

create policy "Allow anon insert points transactions"
on public.points_transactions
for insert
to anon
with check (true);

create policy "Allow anon update points transactions"
on public.points_transactions
for update
to anon
using (true)
with check (true);
