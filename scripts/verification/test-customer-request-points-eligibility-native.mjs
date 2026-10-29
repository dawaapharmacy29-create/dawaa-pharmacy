// Native PostgreSQL check for 20261029090000 (registrar) + 20261029100000 (eligibility v2).
// Synced requests (recorder only, no product_code) are credited when the customer is known by code
// or phone; cancelled, unknown-customer, 7-day repeats and staff without a tier are not; the
// backfill is idempotent and refuses anything older than the previous cycle.
// Local network-isolated container; synthetic rows.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'customer_request_points_v2';
const registrar = readFileSync('supabase/migrations/20261029090000_customer_request_registrar_from_source_recorder_v1.sql', 'utf8');
const eligibility = readFileSync('supabase/migrations/20261029100000_customer_request_points_eligibility_v2.sql', 'utf8');

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create table public.staff(id uuid primary key, name text, branch text);
  create table public.staff_accounts(id uuid primary key, staff_id uuid);
  create table public.staff_incentive_tiers(staff_id uuid, tier_key text, updated_at timestamptz default now(), created_at timestamptz default now());
  create table public.customer_request_incentive_policy(tier_key text, registration_points numeric, achievement_points numeric, policy_version text, effective_from timestamptz, active boolean);
  create table public.customer_request_incentive_events(id uuid primary key default gen_random_uuid(), request_id uuid, event_key text, staff_id uuid, tier_key text,
    points numeric, policy_version text, event_at timestamptz, metadata jsonb, employee_transaction_id uuid, unique (request_id, event_key, policy_version));
  create table public.employee_transactions(id uuid primary key default gen_random_uuid(), staff_id uuid, employee_id uuid, employee_name text, type text, title text,
    reason text, amount numeric, points numeric, points_delta numeric, source text, source_id uuid, transaction_date date, created_at timestamptz, description text,
    month_cycle text, branch text, status text, category text, employee_visible boolean, created_by text, metadata jsonb);
  create table public.customer_requests(id uuid primary key, doctor_id uuid, created_by text, source_recorded_staff_id uuid, customer_id text, customer_code text,
    customer_phone text, medicine_name text, product_code text, status text, sync_conflict boolean, doctor_notes text, source_notes text, branch text,
    requested_at timestamptz, created_at timestamptz, closed_at timestamptz, updated_at timestamptz);
  create function public.customer_request_cycle_label(p_at timestamptz) returns text language sql immutable as $$
    select to_char(((p_at at time zone 'Africa/Cairo') + interval '6 days')::date, 'YYYY-MM') $$;
  -- Production resolver body (before the registrar migration).
  CREATE OR REPLACE FUNCTION public.resolve_customer_request_registrar_staff_id(p_request customer_requests)
   RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
  AS $function$ declare v_staff_id uuid; v_created_uuid uuid; begin if p_request.doctor_id is not null and exists(select 1 from public.staff s where s.id=p_request.doctor_id) then return p_request.doctor_id; end if; begin v_created_uuid:=nullif(trim(coalesce(p_request.created_by,'')),'')::uuid; exception when others then v_created_uuid:=null; end; if v_created_uuid is not null then select s.id into v_staff_id from public.staff s where s.id=v_created_uuid limit 1; if v_staff_id is not null then return v_staff_id; end if; select sa.staff_id into v_staff_id from public.staff_accounts sa where sa.id=v_created_uuid and sa.staff_id is not null limit 1; if v_staff_id is not null then return v_staff_id; end if; end if; return null; end $function$;

  insert into public.staff values
    ('aaaaaaaa-0000-4000-8000-000000000001', 'doctor', 'فرع شكري'),
    ('aaaaaaaa-0000-4000-8000-000000000002', 'no tier', 'فرع شكري');
  insert into public.staff_incentive_tiers(staff_id, tier_key) values ('aaaaaaaa-0000-4000-8000-000000000001', 'mid_doctor');
  insert into public.customer_request_incentive_policy values ('mid_doctor', 1, 3, '2026-08-29-v2', '2026-08-29', true);
`);
const D = 'aaaaaaaa-0000-4000-8000-000000000001';
const N = 'aaaaaaaa-0000-4000-8000-000000000002';
const req = (n, recorder, code, phone, medicine, status, createdAt, extra = '') => `('cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}', null, null, '${recorder}', null,
  ${code ? `'${code}'` : 'null'}, ${phone ? `'${phone}'` : 'null'}, '${medicine}', null, '${status}', false, ${extra ? `'${extra}'` : 'null'}, null, 'فرع شكري',
  '${createdAt}', '${createdAt}', null, '${createdAt}')`;
sql(`insert into public.customer_requests values
  ${req(1, D, 'C1', null, 'Panadol', 'new', '2026-10-05 10:00+02')},
  ${req(2, D, null, '0100 123-4567', 'Brufen', 'delivered', '2026-10-06 10:00+02')},
  ${req(3, D, null, null, 'Augmentin', 'new', '2026-10-07 10:00+02')},
  ${req(4, D, 'C1', null, 'Zyrtec', 'cancelled', '2026-10-08 10:00+02')},
  ${req(5, D, 'C1', null, 'panadol ', 'new', '2026-10-09 10:00+02')},
  ${req(6, N, 'C9', null, 'Cataflam', 'new', '2026-10-10 10:00+02')},
  ${req(7, D, 'C1', null, 'Panadol', 'new', '2026-10-20 10:00+02')},
  ${req(8, D, 'C7', null, 'Concor', 'new', '2026-09-20 10:00+02')},
  ${req(9, D, 'C8', null, 'Lipitor', 'new', '2026-10-27 10:00+02', 'مكرر')};`);

// Before the migrations: the production rules credit nothing (no product_code, recorder unresolved).
assert.equal(sql(`select public.resolve_customer_request_registrar_staff_id(r) is null from public.customer_requests r where r.id = 'cccccccc-0000-4000-8000-000000000001'`), 't');
sql(registrar);
sql(eligibility);
sql(eligibility);

const run = () => JSON.parse(sql(`select public.backfill_customer_request_points_v1()::text`));
const first = run();
const ledger = () => sql(`select string_agg(right(metadata->>'request_id', 2) || ':' || (metadata->>'event_key') || ':' || points::int || ':' || month_cycle, ',' order by metadata->>'request_id', metadata->>'event_key') from public.employee_transactions`);
const before = ledger();
// 01 code → registered (1). 02 phone only + delivered → registered (1) + achieved (3).
// 03 no customer, 04 cancelled, 05 repeat of 01 within 7 days, 06 no tier, 08 older than the window, 09 marked duplicate → nothing.
// 07 same customer and medicine as 01 but 15 days later → registered.
assert.equal(before, '01:request_registered:1:2026-10,02:request_achieved:3:2026-10,02:request_registered:1:2026-10,07:request_registered:1:2026-10');
assert.deepEqual({ registered: first.registered_events, achieved: first.achieved_events }, { registered: 3, achieved: 1 });
run();
assert.equal(ledger(), before, 'backfill must be idempotent');
assert.throws(() => sql(`select public.backfill_customer_request_points_v1('2026-08-01')`), /limited to the previous and current cycles/);
console.log('PASS synced requests credited by code or phone; cancelled, unknown customer, 7-day repeat, no tier, duplicate note and older cycles excluded; backfill idempotent and window-guarded');
sql(`drop database ${db} with (force)`, 'postgres');
