// Native PostgreSQL check for 20261027150000_data_health_snapshot_read_path_and_coverage_v3.
// Runs only against a local network-isolated container; synthetic data only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
const db = 'data_health_parity';
const migration = readFileSync('supabase/migrations/20261027150000_data_health_snapshot_read_path_and_coverage_v3.sql', 'utf8');

function sql(text, database = db) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'psql failed').trim());
  return r.stdout.trim();
}
function fails(text, expected) {
  assert.throws(() => sql(text), (error) => String(error.message).includes(expected), `expected ${expected}`);
}
const asActor = (role, branch) => `set test.role='${role}'; set test.branch='${branch}';`;
const results = [];
const check = (label, fn) => { fn(); results.push(label); console.log('PASS ' + label); };

assert.equal(spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container], { encoding: 'utf8' }).stdout.trim(), 'none');
sql(`drop database if exists ${db} with (force); create database ${db}`, 'postgres');
sql(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  end $$;
  create schema cron;
  create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as
    $$ insert into cron.job(jobname,schedule,command) values (p_name,p_schedule,p_command) returning jobid $$;
  create function cron.unschedule(p_name text) returns boolean language sql as
    $$ delete from cron.job where jobname=p_name returning true $$;
  create table public.app_data_health_cache(cache_key text primary key, payload jsonb, computed_at timestamptz);
  create table public.compute_calls(n int);
  insert into public.compute_calls values (0);
  create function public.compute_app_data_health_v2() returns jsonb language plpgsql as
    $$ begin update public.compute_calls set n = n + 1; return jsonb_build_object('ok', true); end $$;
  create table public.staff(id uuid primary key, name text, role text, branch text, active boolean, is_active boolean, status text);
  create table public.employee_compensation_profiles(staff_id text, monthly_incentive_base numeric, point_value numeric, effective_from date, active boolean, updated_at timestamptz);
  create function public.employee_operating_actor_role() returns text language sql stable as $$ select current_setting('test.role', true) $$;
  create function public.employee_operating_actor_branch() returns text language sql stable as $$ select current_setting('test.branch', true) $$;
  insert into public.staff values
    ('00000000-0000-4000-8000-000000000001','Synthetic A','pharmacist','فرع شكري',true,true,'active'),
    ('00000000-0000-4000-8000-000000000002','Synthetic B','pharmacist','فرع شكري',true,true,'active'),
    ('00000000-0000-4000-8000-000000000003','Synthetic C','assistant','فرع الشامي',true,true,'active'),
    ('00000000-0000-4000-8000-000000000004','Synthetic Inactive','assistant','فرع الشامي',false,false,'inactive');
  insert into public.employee_compensation_profiles values
    ('00000000-0000-4000-8000-000000000001',3000,3,'2026-01-01',true,now()),
    ('00000000-0000-4000-8000-000000000002',0,3,'2026-01-01',true,now());
  insert into public.app_data_health_cache values ('main','{"seed":true}', now() - interval '46 days');
`);

sql(migration);
sql(migration);

check('re-applying keeps exactly one 30-minute refresh job', () => {
  assert.equal(sql(`select count(*)||'|'||max(schedule) from cron.job where jobname='refresh-app-data-health-v2'`), '1|*/30 * * * *');
});
check('page read returns the snapshot without computing, even when old', () => {
  const out = JSON.parse(sql(`set role anon; set statement_timeout='15s'; select public.get_app_data_health_v2();`));
  assert.equal(out.seed, true);
  assert.equal(out.cached, true);
  assert.equal(out.stale, true);
  assert.equal(sql('select n from public.compute_calls'), '0');
});
check('refresh (cron path) recomputes and updates the snapshot', () => {
  sql('select public.refresh_app_data_health_v2();');
  assert.equal(sql('select n from public.compute_calls'), '1');
  const out = JSON.parse(sql('set role anon; select public.get_app_data_health_v2();'));
  assert.equal(out.ok, true);
  assert.equal(out.stale, false);
});
check('empty cache bootstraps exactly once', () => {
  sql(`delete from public.app_data_health_cache`);
  sql('select public.get_app_data_health_v2();');
  sql('select public.get_app_data_health_v2();');
  assert.equal(sql('select n from public.compute_calls'), '2');
});
check('browser roles cannot trigger the expensive refresh', () => {
  fails('set role anon; select public.refresh_app_data_health_v2();', 'permission denied');
  fails('set role authenticated; select public.refresh_app_data_health_v2();', 'permission denied');
});
check('coverage rejects non-managers', () => {
  fails(`${asActor('pharmacist', 'فرع شكري')} set role anon; select public.get_compensation_profile_coverage_v3(null);`, 'not_authorized');
  fails(`${asActor('', '')} set role anon; select public.get_compensation_profile_coverage_v3(null);`, 'not_authorized');
});
check('coverage for a global manager counts active staff only, with correct statuses', () => {
  const out = JSON.parse(sql(`${asActor('general_manager', '')} set role anon; select public.get_compensation_profile_coverage_v3(null);`));
  assert.equal(out.active_staff, 3);
  assert.equal(out.configured_profiles, 1);
  assert.equal(out.missing_profiles, 2);
  assert.deepEqual(out.missing_staff.map((s) => s.status).sort(), ['invalid_monthly_base', 'missing_profile']);
});
check('coverage for a branch manager is scoped to the own branch', () => {
  const out = JSON.parse(sql(`${asActor('branch_manager', 'فرع الشامي')} set role anon; select public.get_compensation_profile_coverage_v3(null);`));
  assert.equal(out.scope_branch, 'فرع الشامي');
  assert.equal(out.active_staff, 1);
  fails(`${asActor('branch_manager', 'فرع الشامي')} set role anon; select public.get_compensation_profile_coverage_v3('فرع شكري');`, 'not_authorized_for_branch');
});
check('migration writes no staff or compensation data', () => {
  assert.equal(sql('select count(*) from public.staff'), '4');
  assert.equal(sql('select count(*) from public.employee_compensation_profiles'), '2');
});

sql(`drop database ${db} with (force)`, 'postgres');
console.log(`PASS: data-health parity (${results.length} checks)`);
