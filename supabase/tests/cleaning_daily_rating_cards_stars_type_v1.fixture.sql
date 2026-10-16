-- Fixture for 20261016120000_cleaning_daily_rating_cards_stars_type_v1: the tables and helpers
-- get_cleaning_daily_rating_cards_v2 reads (cleaning_daily_ratings.stars is smallint, as in Production), the exact
-- Production function, and the error it raises before the migration.
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.staff (id uuid primary key, name text, role text, active boolean);
create table public.staff_daily_checklist_items (id uuid primary key, active boolean, operation_category text);
create table public.staff_daily_checklist_assignments (
  staff_id uuid, branch text, item_id uuid, active boolean, cadence text, weekday int, active_from date, active_to date, workdays_only boolean
);
create table public.staff_daily_checklist_submissions (
  id uuid primary key default gen_random_uuid(), staff_id uuid, item_id uuid, submission_date date, completed boolean, review_status text
);
create table public.cleaning_daily_ratings (
  id uuid primary key default gen_random_uuid(), staff_id uuid, rating_date date, stars smallint, score_pct numeric,
  points_delta numeric, manager_note text, rated_by_name text, updated_at timestamptz default now()
);

create or replace function public.employee_operating_actor_role() returns text language sql stable
as $$ select nullif(current_setting('test.role', true), '') $$;
create or replace function public.employee_operating_actor_branch() returns text language sql stable
as $$ select nullif(current_setting('test.branch', true), '') $$;
create or replace function public.dawaa_review_coverage_branch_key_v1(p_branch text) returns text language sql immutable
as $$ select lower(trim(coalesce(p_branch, ''))) $$;
create or replace function public.dawaa_staff_checklist_assignment_due_v1(
  p_staff uuid, p_cadence text, p_weekday int, p_from date, p_to date, p_workdays boolean, p_date date
) returns boolean language sql immutable as $$ select true $$;

insert into public.staff values
  ('00000000-0000-4000-8000-000000000001', 'A cleaner', 'cleaning', true),
  ('00000000-0000-4000-8000-000000000002', 'B cleaner', 'cleaning', true);
insert into public.staff_daily_checklist_items values
  ('00000000-0000-4000-8000-0000000000c1', true, 'cleaning'), ('00000000-0000-4000-8000-0000000000c2', true, 'cleaning');
insert into public.staff_daily_checklist_assignments values
  ('00000000-0000-4000-8000-000000000001', 'فرع شكري', '00000000-0000-4000-8000-0000000000c1', true, 'daily', null, null, null, false),
  ('00000000-0000-4000-8000-000000000001', 'فرع شكري', '00000000-0000-4000-8000-0000000000c2', true, 'daily', null, null, null, false),
  ('00000000-0000-4000-8000-000000000002', 'فرع الشامي', '00000000-0000-4000-8000-0000000000c1', true, 'daily', null, null, null, false);
insert into public.staff_daily_checklist_submissions (staff_id, item_id, submission_date, completed, review_status) values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c1', '2026-10-16', true, 'approved'),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000c2', '2026-10-16', true, 'approved');
insert into public.cleaning_daily_ratings (staff_id, rating_date, stars, score_pct, points_delta, manager_note, rated_by_name) values
  ('00000000-0000-4000-8000-000000000001', '2026-10-16', 5, 100, 2, 'ok', 'manager');

\ir cleaning_daily_rating_cards_stars_type_v1.prod.sql

-- The Production definition fails before the migration.
create table public.test_before (error text);
do $$
begin
  perform set_config('test.role', 'general_manager', false);
  perform * from public.get_cleaning_daily_rating_cards_v2('2026-10-16', null);
  insert into public.test_before values (null);
exception when others then
  insert into public.test_before values (sqlstate || ' ' || sqlerrm);
end;
$$;
