-- Isolated database rehearsal — platform layer (runs on a throwaway local PostgreSQL 16 cluster; never on production).
-- Emulates what Supabase gives the migrations: the API roles, default privileges for new objects in public, and the
-- tables/columns the migrations read. The identity layer is the ONLY stub: dawaa_current_staff_account_id_strict()
-- returns the verified session account, simulated by the transaction setting test.actor; permissions come from a
-- test table. Every function the migrations call for scope and attribution is copied verbatim from production in
-- 01_production_functions.sql.
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase grants API roles access to new objects in public by default; the migrations must revoke where needed.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.staff (id uuid primary key, name text, branch text, active boolean default true, role text);
create table public.staff_accounts (id uuid primary key, role text, branch text, active boolean, can_login boolean, staff_id text);
create table public.staff_identity_aliases (id uuid primary key default gen_random_uuid(), staff_id uuid, alias_name text, normalized_alias text, active boolean default true);
create table public.sales_invoices (
  id text primary key, branch text, branch_name text, invoice_number text, invoice_date timestamptz,
  staff_id text, seller_name text, normalized_seller_name text, staff_name text,
  customer_id uuid, customer_code text, customer_phone text,
  net_total numeric, net_amount numeric, discounted_amount numeric, total_amount numeric, amount numeric, gross_total numeric, gross_amount numeric
);
create table public.attendance_daily_summary (
  id uuid primary key default gen_random_uuid(), staff_id uuid, attendance_date date, branch text,
  first_in timestamptz, last_out timestamptz, status text, payroll_eligible_hours numeric, candidate_hours numeric,
  scheduled_start_at timestamptz, scheduled_end_at timestamptz, resolution_status text
);
create table public.biometric_attendance_logs (id uuid primary key default gen_random_uuid(), staff_id uuid, punch_time timestamptz, device_id text, raw_payload jsonb);
create table public.conversation_sales_reviews_canonical_v2 (
  id uuid primary key, doctor_id uuid, staff_id uuid, branch text, invoice_number text, converted_to_sale boolean,
  conversation_date timestamptz, first_customer_message_at timestamptz, created_at timestamptz default now(),
  customer_code text, customer_phone text, customer_id text
);

-- Identity stub (the only one): the verified session account and its permissions.
create table public.test_actor_permissions (account_id uuid, permission text);
create function public.dawaa_current_staff_account_id_strict() returns uuid
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
create function public.dawaa_current_actor_can(required_permissions text[]) returns boolean
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$
  select exists (select 1 from public.staff_accounts sa where sa.id = public.dawaa_current_staff_account_id_strict()
                 and coalesce(sa.active, false) and coalesce(sa.can_login, false)
                 and (lower(sa.role) in ('general_manager', 'admin')
                      or exists (select 1 from public.test_actor_permissions p where p.account_id = sa.id and p.permission = any(required_permissions))))
$$;
-- Attendance projection stub used only for the peer comparison's per-cycle counts.
create function public.get_staff_attendance_detail_v2(p_staff_id uuid, p_start date, p_end date) returns jsonb
language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$
  select jsonb_build_object('summary', jsonb_build_object(
    'actual_worked_days', count(*) filter (where status = 'approved'), 'late_days', 0,
    'total_worked_hours', coalesce(sum(payroll_eligible_hours) filter (where status = 'approved'), 0),
    'pending_review_days', count(*) filter (where status <> 'approved'), 'cycle_open', false))
  from public.attendance_daily_summary where staff_id = p_staff_id and attendance_date between p_start and p_end
$$;
