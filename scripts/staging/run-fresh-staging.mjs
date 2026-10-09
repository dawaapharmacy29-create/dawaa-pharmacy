// Fresh staging migration test, reproducible from zero on a throwaway native PostgreSQL database.
// Order: 1 platform shim -> 2 Production-shaped tables -> 3 Production-only objects (indexes, captured
// bodies, stubs) -> 4 repository prerequisite bodies -> 5 synthetic seed -> 6 the Release Candidate
// migrations in their deterministic order, with a check after each -> 7 historical DML not re-run
// (plus a negative control proving the check would catch it) -> 8 read-only reconciliation ->
// 9 contract smoke on the migrated database.
// Uses only a local database (libpq env: PGHOST, PGPORT, PGUSER). Refuses any non-local host.
// Never touches Supabase. Writes a JSON summary to $STAGING_REPORT when set.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { extractDdl, HISTORICAL_DML } from './historical-dml.mjs';
import { RC_MIGRATIONS } from './rc-migration-order.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const host = process.env.PGHOST || '';
if (host && !['localhost', '127.0.0.1', '::1'].includes(host) && !host.startsWith('/')) {
  throw new Error(`refusing non-local PGHOST ${host}`);
}
for (const name of ['VITE_SUPABASE_URL', 'SUPABASE_URL', 'DATABASE_URL', 'SUPABASE_DB_URL']) {
  if (process.env[name]) throw new Error(`refusing to run with ${name} set: staging tests use a throwaway local database only`);
}
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const between = (text, start, end) => {
  const from = text.indexOf(start);
  const to = end ? text.indexOf(end, from + start.length) : text.length;
  if (from < 0 || to < 0) throw new Error(`slice not found: ${start}`);
  return text.slice(from, to);
};
function psql(db, sql, { allowError = false, options = '' } = {}) {
  const result = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-d', db], {
    input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PGOPTIONS: options },
  });
  if (result.status !== 0 && !allowError) throw new Error(`psql failed (${db}):\n${result.stderr.slice(0, 4000)}`);
  return { ...result, code: result.status };
}
const query = (db, sql) => psql(db, sql).stdout.trim();
const liveDefs = JSON.parse(read('docs/si-operational-audit-20261009/followup-core-live-definitions.json'));
const liveDef = (prefix) => liveDefs.find((d) => d.signature.startsWith(prefix)).definition;

// Captured Production bodies and repository bodies the migrations and the smoke checks rely on.
export const PREREQUISITES = [
  ['captured Production body', 'dawaa_normalize_egyptian_mobile_v1, dawaa_customer_identity_key_v1, dawaa_materialize_whatsapp_action_core_v2', 'followup-core-live-definitions.json'],
  ['repo body', 'find_or_create_open_customer_followup (original), lookup index', '20260720_customer_followup_find_or_create_open_case.sql'],
  ['repo body', 'dawaa_customer_request_branch_key', '20260824150000_harden_customer_requests_rls_v2.sql'],
  ['repo body', 'resolve_staff_account_safe', '20260713_staff_accounts_security_hardening.sql'],
  ['repo body', 'correct_customer_followup_data_v1', '20260720_customer_followup_customer_correction.sql'],
  ['repo body', 'list_open_followup_duplicate_groups_v1, merge_open_followup_duplicates_v1', '20260720_customer_followup_duplicate_management.sql'],
  ['repo body', 'transfer_customer_followup_branch_v1', '20260721_transfer_customer_followup_branch_v1.sql'],
  ['repo body', 'normalize_customer_followup_branch, repair_customer_followup_duplicates_and_branches', '20260726232000_dedupe_followups_and_fix_canonical_branch.sql (functions only, before "-- Run once")'],
  ['repo body', 'dawaa_require_customer_service_actor_v1', '20260823184000_harden_db_authorization_permission_truth_v1.sql'],
  ['repo body', 'dawaa_parse_followup_datetime_v1, dawaa_log_customer_followup_event_v1, dawaa_create_exceptional_followup_v2', '20260719_customer_service_secure_command_center.sql'],
  ['repo body', 'dawaa_create_or_link_customer_followup_v1', '20260824180000_customer_followup_lifecycle_commands_v1.sql'],
  ['captured Production body', 'sync_customer_branch_to_open_followups_and_daily_queue + customers trigger', 'branch-sync-live-definition.json'],
  ['repo body', 'dawaa_whatsapp_followup_resolve_customer_identity_v1 (function only; its one-time UPDATE is not run)', '20260917074500_whatsapp_followup_customer_identity_v1.sql'],
];

function bootstrap(db) {
  psql('postgres', `drop database if exists ${db}; create database ${db};`);
  // Bodies are created as the historical migrations did: validated when first called.
  const lazy = { options: '-c check_function_bodies=off' };
  for (const file of ['00_platform_shim.sql', '10_production_tables.sql', '20_production_only_objects.sql', '30_session_helpers.sql']) {
    psql(db, read(`supabase/staging/${file}`), lazy);
  }
  psql(db, read('supabase/migrations/20260720_customer_followup_find_or_create_open_case.sql'), lazy);
  psql(db, `${liveDef('dawaa_normalize_egyptian_mobile_v1')};\n${liveDef('dawaa_customer_identity_key_v1')};\n${liveDef('dawaa_materialize_whatsapp_action_core_v2')};`, lazy);
  psql(db, between(read('supabase/migrations/20260824150000_harden_customer_requests_rls_v2.sql'),
    'create or replace function public.dawaa_customer_request_branch_key', 'create or replace function public.dawaa_can_access_customer_request_branch'), lazy);
  psql(db, between(read('supabase/migrations/20260713_staff_accounts_security_hardening.sql'),
    'create function public.resolve_staff_account_safe', '\n$$;') + '\n$$;', lazy);
  psql(db, read('supabase/migrations/20260720_customer_followup_customer_correction.sql'), lazy);
  psql(db, read('supabase/migrations/20260720_customer_followup_duplicate_management.sql'), lazy);
  psql(db, read('supabase/migrations/20260721_transfer_customer_followup_branch_v1.sql'), lazy);
  psql(db, between(read('supabase/migrations/20260726232000_dedupe_followups_and_fix_canonical_branch.sql'),
    'create or replace function public.normalize_customer_followup_branch', '-- Run once during migration.'), lazy);
  const authz = read('supabase/migrations/20260823184000_harden_db_authorization_permission_truth_v1.sql');
  psql(db, between(authz, 'create or replace function public.dawaa_require_customer_service_actor_v1', '\n$$;') + '\n$$;', lazy);
  const command = read('supabase/migrations/20260719_customer_service_secure_command_center.sql');
  psql(db, between(command, 'create or replace function public.dawaa_parse_followup_datetime_v1', 'create or replace function public.dawaa_require_customer_service_actor_v1'), lazy);
  psql(db, between(command, 'create or replace function public.dawaa_log_customer_followup_event_v1', 'create or replace function public.dawaa_archive_customer_followup_v1'), lazy);
  psql(db, between(command, 'create or replace function public.dawaa_create_exceptional_followup_v2', 'create or replace function public.dawaa_complete_customer_followup_v1'), lazy);
  psql(db, between(read('supabase/migrations/20260824180000_customer_followup_lifecycle_commands_v1.sql'),
    'create or replace function public.dawaa_create_or_link_customer_followup_v1', 'create or replace function public.dawaa_save_customer_followup_result_v1'), lazy);
  psql(db, between(read('supabase/migrations/20260917074500_whatsapp_followup_customer_identity_v1.sql'),
    'create or replace function public.dawaa_whatsapp_followup_resolve_customer_identity_v1', 'revoke all on function public.dawaa_whatsapp_followup_resolve_customer_identity_v1'), lazy);
  psql(db, JSON.parse(read('docs/si-operational-audit-20261009/branch-sync-live-definition.json')).definition, lazy);
  psql(db, `create trigger customer_branch_sync after update on public.customers
    for each row execute function public.sync_customer_branch_to_open_followups_and_daily_queue();`);
  // Production ACL on the core (20260824180000): clients reach it only through the wrapper.
  psql(db, `revoke all on function public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text) from public, anon, authenticated;
    revoke all on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) from public, anon;
    grant execute on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) to authenticated;
    revoke all on function public.dawaa_materialize_whatsapp_action_core_v2(uuid) from public, anon, authenticated;`);
  psql(db, read('supabase/staging/40_synthetic_seed.sql'));
}

// Rows the historical DML would change. Compared before and after the migration chain.
const DML_WATCH = `select md5(coalesce(string_agg(x, '|' order by x), '')) from (
  select 'r:' || id || ':' || is_current || ':' || coalesce(updated_at::text, '') as x from public.conversation_sales_reviews
  union all
  select 'a:' || id || ':' || coalesce(status, '') || ':' || coalesce(auto_eligible::text, '') || ':' || coalesce(updated_at::text, '') from public.whatsapp_conversation_actions) s`;

function applyMigration(db, migration, { original = false } = {}) {
  const sql = original ? read(`supabase/migrations/${migration}`) : extractDdl(root, migration).sql;
  return psql(db, sql, { allowError: true });
}

const suffix = `${process.pid}`;
const db = `dawaa_staging_${suffix}`;
const control = `dawaa_staging_control_${suffix}`;
const summary = { steps: [], historicalDml: {}, reconciliation: {}, smoke: [] };
const step = (name, detail = 'ok') => { summary.steps.push({ name, detail }); console.log(`PASS ${name}${detail === 'ok' ? '' : ` (${detail})`}`); };
try {
  bootstrap(db);
  step('bootstrap: platform shim, Production-shaped tables, Production-only objects, prerequisite bodies, synthetic seed');
  const before = query(db, DML_WATCH);
  const seededReady = query(db, `select count(*) from whatsapp_conversation_actions where action_type='customer_request' and status='ready' and target_id is null`);
  assert.ok(Number(seededReady) > 0, 'seed must contain rows the historical DML would change');

  for (const m of RC_MIGRATIONS) {
    const result = applyMigration(db, m.file);
    if (result.code !== 0) throw new Error(`${m.file} failed:\n${result.stderr.slice(0, 3000)}`);
    for (const check of m.assertions) {
      const value = query(db, check.sql);
      assert.equal(value, check.expect, `${m.file}: ${check.name} -> ${value}`);
    }
    step(`migration ${m.order} ${m.file}`, `${m.assertions.length} post-checks`);
  }
  // Every migration is re-runnable (CREATE OR REPLACE / IF NOT EXISTS / guarded DO).
  for (const m of RC_MIGRATIONS.filter((item) => item.rerunnable !== false)) {
    const again = applyMigration(db, m.file);
    if (again.code !== 0) throw new Error(`${m.file} is not re-runnable:\n${again.stderr.slice(0, 2000)}`);
  }
  for (const m of RC_MIGRATIONS.filter((item) => item.rerunnable === false)) {
    assert.notEqual(applyMigration(db, m.file).code, 0, `${m.file} is marked apply-once but re-applied`);
  }
  step('every RC migration re-applies cleanly except the apply-once renames', RC_MIGRATIONS.filter((m) => m.rerunnable === false).map((m) => m.order).join(', '));

  const after = query(db, DML_WATCH);
  assert.equal(after, before, 'historical DML changed watched rows');
  assert.equal(query(db, `select count(*) from whatsapp_conversation_actions where action_type='customer_request' and status='ready' and target_id is null`), seededReady);
  summary.historicalDml.staging = { watchedRowsUnchanged: true, readyCustomerRequestsKept: Number(seededReady) };
  step('historical DML of 20261005133000 and 20261005141000 did not run', `${seededReady} ready requests and all review flags unchanged`);

  // Negative control: the ORIGINAL files on the same seed do change the watched rows.
  bootstrap(control);
  const controlBefore = query(control, DML_WATCH);
  for (const m of RC_MIGRATIONS) {
    const result = applyMigration(control, m.file, { original: HISTORICAL_DML.some((h) => h.migration === m.file) });
    if (result.code !== 0) throw new Error(`control ${m.file} failed:\n${result.stderr.slice(0, 2000)}`);
  }
  assert.notEqual(query(control, DML_WATCH), controlBefore, 'negative control: original files must change watched rows');
  summary.historicalDml.negativeControl = 'original files change the watched rows (check is sensitive)';
  step('negative control: the unsplit originals would have rewritten the seeded rows');
  psql('postgres', `drop database if exists ${control};`);

  // Read-only reconciliation on the migrated staging database.
  const rec = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', path.join(root, 'supabase/readonly/release_candidate_reconciliation_v1.sql')],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (rec.status !== 0) throw new Error(`reconciliation failed:\n${rec.stderr}`);
  assert.equal(query(db, DML_WATCH), before, 'reconciliation must not write');
  summary.reconciliation.output = rec.stdout;
  step('read-only reconciliation ran on the migrated database and wrote nothing');

  // Contract smoke on the migrated database (synthetic customer, staff session through the wrapper).
  const as = `set request.headers = '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a2"}'; set role authenticated;`;
  const call = (type) => `${as} select public.dawaa_create_or_link_customer_followup_v1(null,'SYN-STG-1','Synthetic Staging Customer',null,'فرع شكري','${type}','synthetic',null,null,null,null,'staging_smoke');`;
  const first = JSON.parse(psql(db, call('general')).stdout.trim().split('\n').pop());
  const second = JSON.parse(psql(db, call('complaint')).stdout.trim().split('\n').pop());
  assert.equal(first.created, true);
  assert.equal(second.followup_id, first.followup_id);
  assert.equal(second.linked_to_open_case, true);
  summary.smoke.push('contract A on the migrated database: second request_type linked to the open case');
  step('contract A smoke on the migrated database');

  psql('postgres', `drop database if exists ${db};`);
  if (process.env.STAGING_REPORT) writeFileSync(process.env.STAGING_REPORT, JSON.stringify(summary, null, 2));
  console.log(`fresh staging: ${summary.steps.length} steps passed`);
} catch (error) {
  console.error(error.message || error);
  console.error(`fresh staging: FAILED after ${summary.steps.length} passing steps`);
  process.exit(1);
}
