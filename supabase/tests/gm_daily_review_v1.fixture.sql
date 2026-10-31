-- Synthetic isolated fixture; reuses the daily agenda fixture (no production IDs).
\ir branch_manager_daily_agenda_v1.fixture.sql

alter table public.sales_invoices add column created_at timestamptz default now();
create table public.attendance_daily_summary(id uuid primary key default gen_random_uuid(), staff_id uuid,
  attendance_date date, branch text, status text, missing_punch boolean, late_minutes integer);
create table public.cleaning_daily_ratings(id uuid primary key default gen_random_uuid(), staff_id uuid, branch text,
  rating_date date, stars integer);
create table public.shift_handovers(id uuid primary key default gen_random_uuid(), branch text, shift_date date);

-- Yesterday: one Shokry row still waiting for review; Al-Shami all reviewed.
insert into public.attendance_daily_summary(attendance_date, branch, status, missing_punch, late_minutes) values
  ((now() at time zone 'Africa/Cairo')::date - 1, 'فرع شكري', 'pending_review', true, 0),
  ((now() at time zone 'Africa/Cairo')::date - 1, 'فرع شكري', 'approved', false, 20),
  ((now() at time zone 'Africa/Cairo')::date - 1, 'فرع الشامي', 'approved', false, 0);
-- Cleaning rated yesterday in Shokry only.
insert into public.cleaning_daily_ratings(branch, rating_date, stars) values
  ('فرع شكري', (now() at time zone 'Africa/Cairo')::date - 1, 4);
insert into public.shift_handovers(branch, shift_date) values ('فرع شكري', date '2026-09-11');
