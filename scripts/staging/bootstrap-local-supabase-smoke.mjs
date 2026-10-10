#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { extractDdl } from './historical-dml.mjs';
import { RC_MIGRATIONS } from './rc-migration-order.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const between = (text, start, end) => {
  const from = text.indexOf(start);
  const to = end ? text.indexOf(end, from + start.length) : text.length;
  if (from < 0 || to < 0) throw new Error(`slice not found: ${start}`);
  return text.slice(from, to);
};
const { checkCanonicalSiDependencies } = createRequire(import.meta.url)('../check-canonical-si-dependencies.cjs');

const container = process.env.DAWAA_LOCAL_SUPABASE_DB_CONTAINER || 'supabase_db_dawaa-pharmacy';
if (!/^supabase_db_[a-z0-9._-]+$/i.test(container)) {
  throw new Error(`refusing unexpected Docker container name: ${container}`);
}
if (!process.argv.includes('--reset')) {
  throw new Error('refusing destructive local bootstrap without --reset');
}
if (String(process.env.VERCEL_ENV || '').toLowerCase() === 'production' || String(process.env.CI || '').toLowerCase() === 'true') {
  throw new Error('refusing local smoke bootstrap in production/CI environment');
}
for (const name of ['VITE_SUPABASE_URL', 'SUPABASE_URL']) {
  const value = String(process.env[name] || '').trim();
  if (/\.supabase\.co\/?$/i.test(value)) throw new Error(`refusing while ${name} points to a hosted Supabase project`);
}

function docker(args, input = undefined) {
  const result = spawnSync('docker', args, {
    cwd: root,
    input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

const inspect = docker(['inspect', '-f', '{{.State.Running}}', container]);
if (inspect.status !== 0 || inspect.stdout.trim() !== 'true') {
  throw new Error(`local Supabase database container is not running: ${container}\n${inspect.stderr.trim()}`);
}

function psql(sql, { allowError = false, tuplesOnly = false } = {}) {
  const args = ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'];
  if (tuplesOnly) args.push('-At');
  const result = docker(args, sql);
  if (result.status !== 0 && !allowError) {
    throw new Error(`psql failed:\n${result.stderr.slice(0, 5000)}`);
  }
  return result;
}
const query = (sql) => psql(sql, { tuplesOnly: true }).stdout.trim();
const apply = (label, sql, { lazy = true } = {}) => {
  const prefix = lazy ? 'set check_function_bodies = off;\n' : '';
  psql(prefix + sql);
  console.log(`PASS ${label}`);
};

console.log(`Local smoke bootstrap target: Docker container ${container}, database postgres`);
console.log('This resets ONLY the local public schema and loads synthetic smoke-test data.');

psql(`
  drop schema if exists public cascade;
  create schema public authorization postgres;
  grant usage on schema public to anon, authenticated, service_role;
  grant create on schema public to postgres, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);
console.log('PASS reset local public schema');

// Real Supabase Local already owns auth/roles/extensions, so 00_platform_shim.sql is intentionally skipped.
for (const file of ['10_production_tables.sql', '15_canonical_si_schema.sql', '20_production_only_objects.sql', '30_session_helpers.sql']) {
  apply(`staging ${file}`, read(`supabase/staging/${file}`));
}

const liveDefs = JSON.parse(read('docs/si-operational-audit-20261009/followup-core-live-definitions.json'));
const liveDef = (prefix) => {
  const item = liveDefs.find((d) => d.signature.startsWith(prefix));
  if (!item) throw new Error(`missing captured definition: ${prefix}`);
  return item.definition;
};

apply('prerequisite followup core', read('supabase/migrations/20260720_customer_followup_find_or_create_open_case.sql'));
apply('captured canonical identity/materialization helpers', `${liveDef('dawaa_normalize_egyptian_mobile_v1')};\n${liveDef('dawaa_customer_identity_key_v1')};\n${liveDef('dawaa_materialize_whatsapp_action_core_v2')};`);
apply('customer request branch key', between(
  read('supabase/migrations/20260824150000_harden_customer_requests_rls_v2.sql'),
  'create or replace function public.dawaa_customer_request_branch_key',
  'create or replace function public.dawaa_can_access_customer_request_branch'
));
apply('staff account resolver', between(
  read('supabase/migrations/20260713_staff_accounts_security_hardening.sql'),
  'create function public.resolve_staff_account_safe',
  '\n$$;'
) + '\n$$;');
apply('followup customer correction', read('supabase/migrations/20260720_customer_followup_customer_correction.sql'));
apply('followup duplicate management', read('supabase/migrations/20260720_customer_followup_duplicate_management.sql'));
apply('followup branch transfer', read('supabase/migrations/20260721_transfer_customer_followup_branch_v1.sql'));
apply('followup normalization helpers', between(
  read('supabase/migrations/20260726232000_dedupe_followups_and_fix_canonical_branch.sql'),
  'create or replace function public.normalize_customer_followup_branch',
  '-- Run once during migration.'
));
const authz = read('supabase/migrations/20260823184000_harden_db_authorization_permission_truth_v1.sql');
apply('customer-service actor authorization', between(authz, 'create or replace function public.dawaa_require_customer_service_actor_v1', '\n$$;') + '\n$$;');
const command = read('supabase/migrations/20260719_customer_service_secure_command_center.sql');
apply('followup parse helper', between(command, 'create or replace function public.dawaa_parse_followup_datetime_v1', 'create or replace function public.dawaa_require_customer_service_actor_v1'));
apply('followup event helper', between(command, 'create or replace function public.dawaa_log_customer_followup_event_v1', 'create or replace function public.dawaa_archive_customer_followup_v1'));
apply('exceptional followup helper', between(command, 'create or replace function public.dawaa_create_exceptional_followup_v2', 'create or replace function public.dawaa_complete_customer_followup_v1'));
apply('followup lifecycle wrapper', between(
  read('supabase/migrations/20260824180000_customer_followup_lifecycle_commands_v1.sql'),
  'create or replace function public.dawaa_create_or_link_customer_followup_v1',
  'create or replace function public.dawaa_save_customer_followup_result_v1'
));
apply('WhatsApp customer identity resolver', between(
  read('supabase/migrations/20260917074500_whatsapp_followup_customer_identity_v1.sql'),
  'create or replace function public.dawaa_whatsapp_followup_resolve_customer_identity_v1',
  'revoke all on function public.dawaa_whatsapp_followup_resolve_customer_identity_v1'
));
apply('captured customer branch sync', JSON.parse(read('docs/si-operational-audit-20261009/branch-sync-live-definition.json')).definition);
apply('customer branch sync trigger', `drop trigger if exists customer_branch_sync on public.customers;\ncreate trigger customer_branch_sync after update on public.customers for each row execute function public.sync_customer_branch_to_open_followups_and_daily_queue();`);
apply('followup/materialization ACL', `
  revoke all on function public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text) from public, anon, authenticated;
  revoke all on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) from public, anon;
  grant execute on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) to authenticated;
  revoke all on function public.dawaa_materialize_whatsapp_action_core_v2(uuid) from public, anon, authenticated;
`);
apply('staff-name normalizer', between(
  read('supabase/migrations/20260901090000_base44_purchase_invoice_sync_system_v1.sql'),
  'create or replace function public.dawaa_normalize_staff_name_v1',
  'create or replace function public.dawaa_map_base44_branch_v1'
));
apply('SI lifecycle reconciliation body', between(
  read('supabase/migrations/20261003193000_si_case_lifecycle_reconciliation_v1.sql'),
  'create or replace function public.sales_intelligence_reconcile_case_set_v1',
  'create or replace view public.sales_intelligence_current_policy_evaluations'
));

apply('synthetic smoke seed', read('supabase/staging/40_synthetic_seed.sql'), { lazy: false });

for (const migration of RC_MIGRATIONS) {
  const sql = extractDdl(root, migration.file).sql;
  apply(`RC ${migration.order} ${migration.file}`, sql);
  for (const assertion of migration.assertions) {
    const value = query(assertion.sql);
    if (value !== assertion.expect) {
      throw new Error(`${migration.file}: ${assertion.name} -> ${value}, expected ${assertion.expect}`);
    }
  }
}

const required = ['staff_accounts', 'staff_login_sessions', 'whatsapp_review_sources'];
for (const table of required) {
  if (query(`select to_regclass('public.${table}') is not null`) !== 't') {
    throw new Error(`required runtime table missing after bootstrap: ${table}`);
  }
}
const dependencies = checkCanonicalSiDependencies(root);
if (dependencies.missing.length) throw new Error(`repository dependency definitions missing: ${dependencies.missing.join(', ')}`);
for (const name of dependencies.dependencies) {
  const exists = query(`select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='${name}') or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${name}')`);
  if (exists !== 't') throw new Error(`runtime dependency missing after bootstrap: ${name}`);
}

console.log(`PASS canonical SI runtime dependencies (${dependencies.dependencies.length})`);
console.log(`PASS required runtime tables: ${required.join(', ')}`);
console.log('LOCAL_SUPABASE_SMOKE_BOOTSTRAP_READY');
