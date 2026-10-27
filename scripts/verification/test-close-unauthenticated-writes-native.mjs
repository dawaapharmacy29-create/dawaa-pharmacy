// Native PostgreSQL check for 20261027200000_close_unauthenticated_table_writes_v1.
// Recreates the Production write policies of the sensitive tables (permissive `true`), proves
// the anon-key hole exists before the migration, then checks after it that: requests without a
// verified session cannot write; logged-in pages keep working; incentive / evaluation-rule writes
// follow the page permission; attendance requests are written only through the SECURITY DEFINER
// RPC; the punch trigger still binds an employee's first device but nobody binds another's.
// Local network-isolated container; synthetic rows only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'close_unauthenticated_writes';
const migration = readFileSync('supabase/migrations/20261027200000_close_unauthenticated_table_writes_v1.sql', 'utf8');

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}
// Runs one statement as the browser does (role anon, resolved session actor or none).
function as(actor, statement) {
  try {
    sql(`set test.actor = '${actor}'; set role anon; ${statement}`);
    return 'ok';
  } catch (error) {
    return /row-level security|permission denied/.test(error.message) ? 'denied' : `error: ${error.message}`;
  }
}

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  grant usage on schema public to anon, authenticated;
  create table public.staff_accounts(id uuid primary key, staff_id text, role text, active boolean, can_login boolean, permissions jsonb default '{}');

  -- Session identity is outside this change: the test sets the resolved actor directly.
  create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable security definer
    set search_path to 'public','pg_catalog' as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
  -- Production semantics: general manager/admin pass, otherwise the account permission keys.
  create function public.dawaa_current_actor_can(required_permissions text[]) returns boolean language sql stable security definer
    set search_path to 'public','pg_catalog' as $$
    select coalesce((select lower(trim(a.role)) in ('general_manager','admin') or a.permissions ?| required_permissions
      from public.staff_accounts a where a.id = public.dawaa_current_staff_account_id_strict()
        and coalesce(a.active,false) and coalesce(a.can_login,false)), false) $$;
  -- Production bodies (verbatim apart from the strict-account source above).
  create function public.dawaa_current_attendance_subject_id() returns uuid language plpgsql stable security definer
    set search_path to 'public','pg_catalog' as $$
  declare v_account_id uuid; v_staff_id text;
  begin
    v_account_id := public.dawaa_current_staff_account_id_strict();
    if v_account_id is null then return null; end if;
    select nullif(trim(sa.staff_id), '') into v_staff_id from public.staff_accounts sa
    where sa.id = v_account_id and coalesce(sa.active, true) = true and coalesce(sa.can_login, true) = true;
    if v_staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return v_staff_id::uuid; end if;
    return v_account_id;
  end $$;
  create function public.dawaa_can_manage_biometric_mapping_v1() returns boolean language sql stable security definer
    set search_path to 'public','pg_catalog' as $$
    select exists (select 1 from public.staff_accounts a where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active, true) = true and coalesce(a.can_login, true) = true
      and a.role in ('general_manager','executive_manager','branches_manager')) $$;
  grant execute on all functions in schema public to anon, authenticated;

  -- Production tables (relevant columns) and their Production write policies.
  create table public.incentive_medicines(id uuid primary key default gen_random_uuid(), product_name text, incentive_value numeric, active boolean default true);
  create policy incentive_medicines_select_app on public.incentive_medicines for select to anon, authenticated using (true);
  create policy incentive_medicines_insert_app on public.incentive_medicines for insert to anon, authenticated with check (true);
  create policy incentive_medicines_update_app on public.incentive_medicines for update to anon, authenticated using (true) with check (true);

  create table public.evaluation_rules(id uuid primary key default gen_random_uuid(), name text, points int);
  create policy evaluation_rules_auth_select on public.evaluation_rules for select to authenticated using (true);
  create policy evaluation_rules_auth_insert on public.evaluation_rules for insert to authenticated with check (true);
  create policy evaluation_rules_auth_update on public.evaluation_rules for update to authenticated using (true) with check (true);
  create policy evaluation_rules_anon_insert_for_test on public.evaluation_rules for insert to anon with check (true);

  create table public.attendance_manual_requests(id uuid primary key default gen_random_uuid(), staff_id uuid, status text default 'pending', reviewed_by uuid);
  create policy attendance_manual_requests_app_read on public.attendance_manual_requests for select to public using (true);
  create policy attendance_manual_requests_app_insert on public.attendance_manual_requests for insert to public with check (true);
  create policy manual_requests_insert_authenticated on public.attendance_manual_requests for insert to public with check (true);
  create policy attendance_manual_requests_app_update on public.attendance_manual_requests for update to public using (true) with check (true);
  create function public.decide_attendance_correction_request_v2(p_id uuid, p_status text) returns void
    language plpgsql security definer set search_path to 'public','pg_catalog' as $$
  begin
    if not public.dawaa_current_actor_can(array['approve_attendance']) then raise exception 'not_authorized'; end if;
    update public.attendance_manual_requests set status = p_status, reviewed_by = public.dawaa_current_staff_account_id_strict() where id = p_id;
  end $$;
  grant execute on function public.decide_attendance_correction_request_v2(uuid, text) to anon, authenticated;

  create table public.staff_attendance_devices(id uuid primary key default gen_random_uuid(), staff_id uuid, staff_name text, device_id text, status text, last_seen_at timestamptz, updated_at timestamptz);
  create policy "allow attendance devices select" on public.staff_attendance_devices for select to anon, authenticated using (true);
  create policy "allow attendance devices insert" on public.staff_attendance_devices for insert to anon, authenticated with check (true);
  create policy "allow attendance devices update" on public.staff_attendance_devices for update to anon, authenticated using (true) with check (true);

  create table public.staff_attendance_logs(id uuid primary key default gen_random_uuid(), staff_id uuid, staff_name text, device_id text, status text default 'accepted', rejection_reason text, created_by uuid);
  create policy staff_attendance_logs_select on public.staff_attendance_logs for select to public using (true);
  create policy staff_attendance_logs_insert_own on public.staff_attendance_logs for insert to public
    with check ((dawaa_current_staff_account_id_strict() is not null) and (dawaa_current_attendance_subject_id() is not null)
      and (staff_id = dawaa_current_attendance_subject_id()) and (created_by = dawaa_current_staff_account_id_strict()));
  -- Production device-binding part of guard_staff_attendance_device (SECURITY INVOKER trigger).
  create function public.guard_staff_attendance_device() returns trigger language plpgsql as $$
  declare v_staff_key text; v_active_device text;
  begin
    v_staff_key := coalesce(NEW.staff_id::text, NEW.staff_name);
    select device_id into v_active_device from public.staff_attendance_devices
    where coalesce(staff_id::text, staff_name) = v_staff_key and status = 'active' limit 1;
    if v_active_device is null then
      insert into public.staff_attendance_devices (staff_id, staff_name, device_id, status) values (NEW.staff_id, NEW.staff_name, NEW.device_id, 'active');
      return NEW;
    end if;
    if v_active_device <> NEW.device_id then NEW.status := 'rejected'; return NEW; end if;
    update public.staff_attendance_devices set last_seen_at = now(), updated_at = now()
    where coalesce(staff_id::text, staff_name) = v_staff_key and status = 'active';
    return NEW;
  end $$;
  create trigger trg_guard_staff_attendance_device before insert on public.staff_attendance_logs for each row execute function public.guard_staff_attendance_device();

  create table public.customer_analysis(id uuid primary key default gen_random_uuid(), phone text, total_spent numeric);
  create policy customer_analysis_select_app on public.customer_analysis for select to anon, authenticated using (true);
  create policy customer_analysis_insert_app on public.customer_analysis for insert to anon, authenticated with check (true);
  create policy customer_analysis_update_app on public.customer_analysis for update to anon, authenticated using (true) with check (true);

  do $$ declare t text; begin
    foreach t in array array['incentive_medicines','evaluation_rules','attendance_manual_requests','staff_attendance_devices','staff_attendance_logs','customer_analysis'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
    end loop;
  end $$;

  insert into public.staff_accounts values
    ('00000000-0000-4000-8000-000000000001', null, 'general_manager', true, true, '{}'),
    ('00000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000002', 'branch_manager', true, true, '{}'),
    ('00000000-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000003', 'pharmacist', true, true, '{}'),
    ('00000000-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000004', 'pharmacist', true, true, '{"edit_incentive_medicine": true, "approve_attendance": true}'),
    ('00000000-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000005', 'branch_manager', true, false, '{}');
  insert into public.incentive_medicines(id, product_name, incentive_value) values ('11111111-0000-4000-8000-000000000001', 'synthetic', 5);
  insert into public.attendance_manual_requests(id, staff_id) values ('22222222-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003');
`);

const GM = '00000000-0000-4000-8000-000000000001';
const BRANCH_MANAGER = '00000000-0000-4000-8000-000000000002';
const PHARMACIST = '00000000-0000-4000-8000-000000000003';
const PHARMACIST_WITH_KEYS = '00000000-0000-4000-8000-000000000004';
const LOCKED_MANAGER = '00000000-0000-4000-8000-000000000005';
const NO_SESSION = '';
const raiseIncentive = `update public.incentive_medicines set incentive_value = incentive_value + 1 where id = '11111111-0000-4000-8000-000000000001' returning id`;
// An UPDATE that RLS filters out affects 0 rows without an error; count the rows it changed.
const updated = (actor, statement) =>
  sql(`set test.actor = '${actor}'; set role anon; with u as (${statement}) select count(*) from u`);

// Before: the anon key alone can write money-bearing tables.
assert.equal(as(NO_SESSION, `insert into public.incentive_medicines(product_name, incentive_value) values ('x', 999)`), 'ok');
assert.equal(updated(NO_SESSION, raiseIncentive), '1');
assert.equal(updated(NO_SESSION, `update public.attendance_manual_requests set status = 'approved' returning id`), '1');
assert.equal(as(NO_SESSION, `insert into public.staff_attendance_devices(staff_id, device_id, status) values ('aaaaaaaa-0000-4000-8000-000000000003', 'attacker-phone', 'active')`), 'ok');
console.log('PASS before: no-session requests could write incentives, approve attendance requests and bind devices');

sql(`delete from public.incentive_medicines where product_name = 'x';
     update public.attendance_manual_requests set status = 'pending';
     delete from public.staff_attendance_devices;
     delete from public.evaluation_rules;`);
sql(migration);
sql(migration);

// 1. No verified session: every write is refused; reads unchanged.
assert.equal(as(NO_SESSION, `insert into public.incentive_medicines(product_name, incentive_value) values ('x', 999)`), 'denied');
assert.equal(updated(NO_SESSION, raiseIncentive), '0');
assert.equal(as(NO_SESSION, `insert into public.customer_analysis(phone, total_spent) values ('010', 1)`), 'denied');
assert.equal(as(NO_SESSION, `insert into public.evaluation_rules(name, points) values ('x', 1)`), 'denied');
assert.equal(as(LOCKED_MANAGER, `insert into public.incentive_medicines(product_name, incentive_value) values ('x', 1)`), 'denied');
assert.equal(sql(`set role anon; select count(*) from public.incentive_medicines`), '1');
console.log('PASS no session / disabled account: writes refused on all guarded tables, reads unchanged');

// 2. Logged-in pages keep working on ordinary operational tables.
assert.equal(as(PHARMACIST, `insert into public.customer_analysis(phone, total_spent) values ('010', 1)`), 'ok');
assert.equal(updated(PHARMACIST, `update public.customer_analysis set total_spent = 2 where phone = '010' returning id`), '1');
console.log('PASS logged-in staff still write operational tables (customer_analysis insert/update)');

// 3. Incentive values: managers or explicit incentive permission only.
assert.equal(updated(PHARMACIST, raiseIncentive), '0');
assert.equal(as(PHARMACIST, `insert into public.incentive_medicines(product_name, incentive_value) values ('x', 1)`), 'denied');
assert.equal(updated(BRANCH_MANAGER, raiseIncentive), '1');
assert.equal(updated(GM, raiseIncentive), '1');
assert.equal(updated(PHARMACIST_WITH_KEYS, raiseIncentive), '1');
assert.equal(sql(`select incentive_value from public.incentive_medicines where id = '11111111-0000-4000-8000-000000000001'`), '9'); // 5 + 1 (pre-migration hole) + 3 allowed
console.log('PASS incentive_medicines: pharmacist refused; branch manager, GM and holder of edit_incentive_medicine allowed');

// 4. Evaluation rules: manage_evaluation_rules only.
assert.equal(as(BRANCH_MANAGER, `insert into public.evaluation_rules(name, points) values ('x', 1)`), 'denied');
assert.equal(as(GM, `insert into public.evaluation_rules(name, points) values ('rule', 1)`), 'ok');
assert.equal(updated(BRANCH_MANAGER, `update public.evaluation_rules set points = 9 returning id`), '0');
console.log('PASS evaluation_rules: only manage_evaluation_rules writes');

// 5. Attendance correction requests: direct writes refused, RPC decision still works.
assert.equal(updated(GM, `update public.attendance_manual_requests set status = 'approved' returning id`), '0');
assert.equal(as(PHARMACIST, `insert into public.attendance_manual_requests(staff_id) values ('aaaaaaaa-0000-4000-8000-000000000003')`), 'denied');
assert.match(as(PHARMACIST, `select public.decide_attendance_correction_request_v2('22222222-0000-4000-8000-000000000001', 'approved')`), /not_authorized/);
assert.equal(as(PHARMACIST_WITH_KEYS, `select public.decide_attendance_correction_request_v2('22222222-0000-4000-8000-000000000001', 'approved')`), 'ok');
assert.equal(sql(`select status || ':' || reviewed_by from public.attendance_manual_requests`), `approved:${PHARMACIST_WITH_KEYS}`);
console.log('PASS attendance_manual_requests: direct status change refused even for GM; audited RPC decision works');

// 6. Punch device binding: own first device binds through the trigger; nobody binds another's.
const punch = (actor, staff, device) => as(actor, `insert into public.staff_attendance_logs(staff_id, device_id, created_by) values ('${staff}', '${device}', '${actor}')`);
assert.equal(punch(PHARMACIST, 'aaaaaaaa-0000-4000-8000-000000000003', 'phone-A'), 'ok');
assert.equal(sql(`select device_id || ':' || status from public.staff_attendance_devices`), 'phone-A:active');
assert.equal(punch(PHARMACIST, 'aaaaaaaa-0000-4000-8000-000000000003', 'phone-A'), 'ok');
assert.equal(sql(`select count(*) filter (where last_seen_at is not null) from public.staff_attendance_devices`), '1');
assert.equal(punch(PHARMACIST, 'aaaaaaaa-0000-4000-8000-000000000003', 'phone-B'), 'ok');
assert.equal(sql(`select status from public.staff_attendance_logs order by ctid desc limit 1`), 'rejected');
assert.equal(as(PHARMACIST, `insert into public.staff_attendance_devices(staff_id, device_id, status) values ('aaaaaaaa-0000-4000-8000-000000000004', 'phone-A', 'active')`), 'denied');
assert.equal(updated(PHARMACIST_WITH_KEYS, `update public.staff_attendance_devices set device_id = 'phone-X' returning id`), '0');
assert.equal(updated(GM, `update public.staff_attendance_devices set status = 'revoked' returning id`), '1');
console.log('PASS attendance devices: first own device bound by punch, second device rejected, no cross-employee binding, GM can manage');

assert.equal(sql(`select count(*) from pg_policy where polname like '%_session_write_guard_v1'`), String(5 * 3));
sql(`drop database ${db} with (force)`, 'postgres');
console.log('PASS idempotent re-apply: one guard per table and command');
