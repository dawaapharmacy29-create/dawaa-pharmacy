-- Fixture for 20261016090100_attendance_v3_cutover_readiness_dependency_v1: the dependencies the cutover readiness
-- function calls. Day-resolution builders return stored resolutions so the test controls V2/V3 outcomes; the actor
-- and permissions come from GUCs.
create role anon;
create role authenticated;
create role service_role bypassrls;

create table public.attendance_daily_summary (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  attendance_date date not null,
  status text,
  resolution_version integer
);
create table public.test_day_resolutions (
  staff_id uuid not null,
  attendance_date date not null,
  v2 jsonb not null,
  v3 jsonb not null,
  primary key (staff_id, attendance_date)
);

create or replace function public.dawaa_current_actor_can(required_permissions text[])
returns boolean language sql stable security definer set search_path to 'public'
as $$ select coalesce(string_to_array(nullif(current_setting('test.permissions', true), ''), ',') && required_permissions, false) $$;

create or replace function public.dawaa_pay_cycle_bounds_v1(p_date date)
returns table(cycle_start date, cycle_end date, month_cycle text) language sql stable
as $$ select date '2026-09-26', date '2026-10-25', '2026-10'::text $$;

create or replace function public.dawaa_build_attendance_day_resolution_v2(p_staff_id uuid, p_date date)
returns jsonb language sql stable security definer set search_path to 'public'
as $$ select v2 from public.test_day_resolutions where staff_id = p_staff_id and attendance_date = p_date $$;

create or replace function public.dawaa_build_attendance_day_resolution_v3(p_staff_id uuid, p_date date)
returns jsonb language sql stable security definer set search_path to 'public'
as $$ select v3 from public.test_day_resolutions where staff_id = p_staff_id and attendance_date = p_date $$;

-- Five days inside the cycle, one outside it:
--   d1 materialized+approved, same status       d2 materialized+pending, same status
--   d3 not materialized, V2/V3 status differ     d4 not materialized, candidate change, unresolved policy
--   d5 materialized+approved, same status        d6 outside the cycle (ignored)
insert into public.attendance_daily_summary (staff_id, attendance_date, status, resolution_version) values
  ('00000000-0000-4000-8000-000000000001', '2026-09-26', 'approved', 3),
  ('00000000-0000-4000-8000-000000000001', '2026-09-27', 'pending_review', 3),
  ('00000000-0000-4000-8000-000000000001', '2026-09-28', 'approved', 2),
  ('00000000-0000-4000-8000-000000000002', '2026-10-01', 'approved', null),
  ('00000000-0000-4000-8000-000000000002', '2026-10-25', 'approved', 3),
  ('00000000-0000-4000-8000-000000000002', '2026-10-26', 'approved', 2);
insert into public.test_day_resolutions (staff_id, attendance_date, v2, v3) values
  ('00000000-0000-4000-8000-000000000001', '2026-09-26', '{"resolution_status":"on_time"}', '{"resolution_status":"on_time","resolved_policy_version":"v3"}'),
  ('00000000-0000-4000-8000-000000000001', '2026-09-27', '{"resolution_status":"late"}', '{"resolution_status":"late","resolved_policy_version":"v3"}'),
  ('00000000-0000-4000-8000-000000000001', '2026-09-28', '{"resolution_status":"late"}', '{"resolution_status":"on_time","resolved_policy_version":"v3"}'),
  ('00000000-0000-4000-8000-000000000002', '2026-10-01', '{"resolution_status":"on_time"}', '{"resolution_status":"on_time","policy_candidate_changed":true}'),
  ('00000000-0000-4000-8000-000000000002', '2026-10-25', '{"resolution_status":"absent"}', '{"resolution_status":"absent","resolved_policy_version":"v3"}'),
  ('00000000-0000-4000-8000-000000000002', '2026-10-26', '{"resolution_status":"late"}', '{"resolution_status":"on_time"}');
