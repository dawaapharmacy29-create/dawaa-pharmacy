-- Synthetic isolated fixture for the contract A regression (one open follow-up per customer + branch).
-- Native PostgreSQL only. No production IDs, names, phones or data. Loaded by
-- scripts/test-followup-contract-a-db.mjs before the actual repository function bodies.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end;
$roles$;

create extension if not exists pgcrypto;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists auth;

create table public.staff_accounts(
  id uuid primary key, staff_id text, name text, staff_name text, username text,
  role text, staff_role text, branch text, active boolean, can_login boolean, permissions jsonb default '{}');

create table public.daily_followups(
  id text primary key default gen_random_uuid()::text,
  date text, followup_date date, followup_datetime timestamptz,
  customer_id text, customer_code text, customer_name text, name text,
  customer_phone text, phone text, branch text,
  status text, followup_status text, contact_status text, followup_type text, category text,
  priority text, followup_reason text, suggested_action text,
  request_type text, request_details text, request_status text, notes text, followup_notes text,
  assigned_to text, responsible_name text, assigned_doctor text,
  next_followup_date date, created_by text, created_by_name text,
  requested_by_staff_id text, request_source text, identity_key text,
  client_request_id text,
  is_hidden boolean default false, is_duplicate boolean default false, duplicate_of text,
  completed_at timestamptz, cancelled_at timestamptz, archived_at timestamptz,
  created_at timestamptz default clock_timestamp(), updated_at timestamptz, updated_by text);

-- Repository copy (20260720_customer_followup_find_or_create_open_case.sql).
create unique index daily_followups_client_request_id_uidx
  on public.daily_followups (client_request_id)
  where client_request_id is not null and btrim(client_request_id) <> '';

-- PRODUCTION-ONLY index, modelled for the test. Production has
-- daily_followups_one_open_case_per_customer_branch_uidx on (identity_key, branch) for open rows;
-- its exact predicate is not in the repository. The broadest plausible "open" predicate is used
-- (hidden and merged rows still count) so the test is at least as strict as Production.
create unique index daily_followups_one_open_case_per_customer_branch_uidx
  on public.daily_followups (identity_key, branch)
  where identity_key is not null and completed_at is null and cancelled_at is null and archived_at is null;

create table public.customer_service_followup_events(
  id uuid primary key default gen_random_uuid(), followup_id text, event_type text, event_status text,
  actor_staff_id text, actor_name text, notes text, metadata jsonb, created_at timestamptz default clock_timestamp());

create table public.customer_followup_events(
  id uuid primary key default gen_random_uuid(), followup_id text, customer_id text, customer_code text,
  event_type text, old_status text, new_status text, event_note text, event_payload jsonb,
  branch text, actor_id text, actor_name text, created_at timestamptz default clock_timestamp());

grant all on all tables in schema public to service_role;

-- Synthetic auth: the current staff account comes from a session setting.
create function public.dawaa_current_staff_account_id_strict() returns uuid
language sql stable as $$ select nullif(current_setting('dawaa.test_actor', true), '')::uuid $$;

create function public.resolve_staff_account_safe(p_actor text)
returns table(id uuid, active boolean, can_login boolean, role text, name text)
language sql stable as $$
  select s.id, s.active, s.can_login, s.role, s.name from public.staff_accounts s where s.id::text = p_actor $$;

create function public.get_user_permissions(p_user_id uuid) returns jsonb
language sql stable as $$ select coalesce((select permissions from public.staff_accounts where id = p_user_id), '{}'::jsonb) $$;

-- Synthetic staff (no real names).
insert into public.staff_accounts(id, name, username, role, branch, active, can_login) values
  ('00000000-0000-4000-8000-0000000000a1', 'Test Agent Shokry', 'agent1', 'customer_service', 'فرع شكري', true, true),
  ('00000000-0000-4000-8000-0000000000a2', 'Test CS Manager', 'manager1', 'customer_service_manager', null, true, true),
  ('00000000-0000-4000-8000-0000000000a3', 'Test Agent Elshamy', 'agent2', 'customer_service', 'فرع الشامي', true, true);
