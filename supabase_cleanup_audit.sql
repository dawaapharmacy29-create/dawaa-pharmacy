-- Dawaa Pharmacy Supabase cleanup audit
-- Safe read-only audit script. It does not delete, rename, or modify data.

-- 1) List all public tables.
select
  schemaname,
  tablename,
  tableowner
from pg_tables
where schemaname = 'public'
order by tablename;

-- 2) List all public columns.
select
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 3) Estimated table sizes and row counts.
select
  n.nspname as schema_name,
  c.relname as table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  c.reltuples::bigint as estimated_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;

-- 4) Suspected old or duplicate tables.
select
  tablename as suspected_legacy_table
from pg_tables
where schemaname = 'public'
  and tablename in (
    'employees',
    'team_members',
    'staff_shift_schedules',
    'employee_rewards',
    'employee_penalties',
    'penalties',
    'rewards',
    'staff_penalties',
    'staff_rewards',
    'old_permissions',
    'demo_users',
    'mock_data'
  )
order by tablename;

-- 5) Official tables expected by the app after cleanup.
select unnest(array[
  'staff',
  'staff_accounts',
  'shift_schedules',
  'employee_transactions',
  'permissions',
  'user_permissions',
  'user_permission_overrides',
  'shift_performance_reviews',
  'shift_performance_review_members',
  'shift_exceptions'
]) as official_table;

-- Proposed only, do not run automatically:
-- alter table public.employees rename to archived_employees_old;
-- alter table public.team_members rename to archived_team_members_old;
-- alter table public.staff_shift_schedules rename to archived_staff_shift_schedules_old;
-- alter table public.employee_rewards rename to archived_employee_rewards_old;
-- alter table public.employee_penalties rename to archived_employee_penalties_old;
-- alter table public.penalties rename to archived_penalties_old;
-- alter table public.rewards rename to archived_rewards_old;
-- alter table public.staff_penalties rename to archived_staff_penalties_old;
-- alter table public.staff_rewards rename to archived_staff_rewards_old;
-- alter table public.old_permissions rename to archived_old_permissions_old;
-- alter table public.demo_users rename to archived_demo_users_old;
-- alter table public.mock_data rename to archived_mock_data_old;

-- Proposed migration pattern only, validate columns first:
-- insert into public.employee_transactions (
--   staff_id, type, amount, points_delta, reason, description,
--   source, source_id, created_by, created_at, month_cycle, branch, status
-- )
-- select
--   staff_id,
--   'penalty',
--   amount,
--   -abs(coalesce(points_delta, points, 0)),
--   coalesce(reason, title, 'Legacy penalty'),
--   description,
--   'legacy_penalties',
--   id,
--   created_by,
--   created_at,
--   month_cycle,
--   branch,
--   'active'
-- from public.penalties
-- where staff_id is not null;

-- insert into public.employee_transactions (
--   staff_id, type, amount, points_delta, reason, description,
--   source, source_id, created_by, created_at, month_cycle, branch, status
-- )
-- select
--   staff_id,
--   'reward',
--   amount,
--   abs(coalesce(points_delta, points, 0)),
--   coalesce(reason, title, 'Legacy reward'),
--   description,
--   'legacy_rewards',
--   id,
--   created_by,
--   created_at,
--   month_cycle,
--   branch,
--   'active'
-- from public.rewards
-- where staff_id is not null;
