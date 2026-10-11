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
const queryColumns = (relation, columns) => {
  const values = columns.map((column) => `'${column.replaceAll("'", "''")}'`).join(',');
  return Number(query(`select count(*) from pg_attribute where attrelid='public.${relation}'::regclass and not attisdropped and attname in (${values})`));
};
const apply = (label, sql, { lazy = true } = {}) => {
  const prefix = lazy ? 'set check_function_bodies = off;\n' : '';
  psql(prefix + sql);
  console.log(`PASS ${label}`);
};
const applyNotificationReadModel = () => {
  apply('notification read model v2 base', read('supabase/migrations/20260907090000_notification_read_model_v2.sql'));
  apply('notification metadata contract v2', read('supabase/migrations/20260907091000_notification_metadata_contract_v2.sql'));
  apply('notification metadata read model v2', read('supabase/migrations/20260907092500_notification_read_model_metadata_v2.sql'));
  apply('notification SLA policies and events', read('supabase/migrations/20260908164500_notification_sla_engine_v1.sql'));
  apply('notification SLA read model v1', read('supabase/migrations/20260908171000_notification_sla_read_model_v1.sql'));
  apply('notification SLA metadata surface v1', read('supabase/migrations/20260908172000_notification_sla_metadata_surface_v1.sql'));
  const guardrails = read('supabase/migrations/20260911063000_notification_architecture_v3_guardrails.sql');
  apply('notification route v3', between(
    guardrails,
    'create or replace function public.notification_route_v3(',
    '-- Preserve the original SLA-enriched view once on fresh databases.'
  ));
  apply('notification v3 base and canonical view', between(
    guardrails,
    '-- Preserve the original SLA-enriched view once on fresh databases.',
    'create or replace view public.notification_events_v3'
  ));
  apply('notification signals and canonical view v2', read('supabase/migrations/20260911165000_smart_notification_signal_and_noise_control_v1.sql'));
  apply('notification signal refinement v2', read('supabase/migrations/20260911170500_smart_notification_signal_refinement_v2.sql'));
  const priorityRefinement = read('supabase/migrations/20260912202500_notification_review_severity_and_legacy_sync_cleanup_v4.sql');
  apply('notification presentation priority refinement', between(
    priorityRefinement,
    'create or replace function public.notification_presentation_priority_v1(',
    '\nupdate public.notifications'
  ));
  apply('custom-auth notification read grants', `
    grant select on public.notification_events_v2_base, public.notification_events_v2, public.notifications to anon, authenticated;
    grant execute on function public.dawaa_current_notification_account_id_v1() to anon, authenticated;
    grant execute on function public.dawaa_current_notification_branch_v1() to anon, authenticated;
    grant execute on function public.dawaa_current_notification_role_v1() to anon, authenticated;
    grant execute on function public.dawaa_current_staff_id_v1() to anon, authenticated;
    grant execute on function public.dawaa_notification_visible_to_current_user_v2(text,text,text,text,text,text) to anon, authenticated;
  `);
  apply('notification SLA local read grants and active-actor RLS', `
    alter table public.notification_sla_policies enable row level security;
    revoke all on public.notification_sla_policies from anon, authenticated;
    grant select on public.notification_sla_policies to anon, authenticated;
    drop policy if exists notification_sla_policies_local_active_actor on public.notification_sla_policies;
    create policy notification_sla_policies_local_active_actor
      on public.notification_sla_policies for select to anon, authenticated
      using (public.dawaa_current_staff_account_id_strict() is not null);
    grant select on public.notification_sla_events to anon, authenticated;
    revoke insert, update, delete on public.notification_sla_events from anon, authenticated;
    drop policy if exists notification_sla_events_visible_v1 on public.notification_sla_events;
    create policy notification_sla_events_visible_v1 on public.notification_sla_events
      for select to anon, authenticated
      using (exists (
        select 1 from public.notifications n
        where n.id = notification_sla_events.notification_id
          and public.dawaa_notification_visible_to_current_user_v2(
            n.recipient_user_id, n.user_id::text, n.recipient_staff_id,
            n.staff_id, n.recipient_role, n.branch
          )
      ));
  `);
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
apply('customer request branch key', between(
  read('supabase/migrations/20260824150000_harden_customer_requests_rls_v2.sql'),
  'create or replace function public.dawaa_customer_request_branch_key',
  'create or replace function public.dawaa_can_access_customer_request_branch'
));
apply('shared runtime dependency Production schema parity', read('supabase/staging/41_shared_runtime_dependency_parity.sql'));
apply('notification custom-auth identity helper', between(
  read('supabase/migrations/20260716090000_employee_360_profile_events_payroll.sql'),
  'create or replace function public.dawaa_current_staff_id_v1()',
  '\n$$;'
) + '\n$$;\nrevoke all on function public.dawaa_current_staff_id_v1() from public;\ngrant execute on function public.dawaa_current_staff_id_v1() to anon, authenticated;');
const notificationAudience = read('supabase/migrations/20260823173500_fix_notification_audience_leakage_v2.sql');
apply('notification audience visibility helpers', between(
  notificationAudience,
  'create or replace function public.dawaa_current_notification_account_id_v1()',
  '-- Backfill the old recipient column used by legacy writers.'
));
apply('notification audience RLS', between(
  notificationAudience,
  '-- Replace permissive app policies with recipient-scoped policies.',
  '-- Fix the scheduled weekly manager reminder writer.'
));
applyNotificationReadModel();
apply('pending shift-notes count RPC', read('supabase/migrations/20260822231000_pending_shift_notes_count_v1.sql'));
apply('WhatsApp Journey V15 source-scoped RLS', read('supabase/staging/35_whatsapp_customer_journey_v15_rls.sql'));
apply('WhatsApp Story V16 branch-scoped RLS', read('supabase/staging/36_whatsapp_customer_story_v16_rls.sql'));

const liveDefs = JSON.parse(read('docs/si-operational-audit-20261009/followup-core-live-definitions.json'));
const liveDef = (prefix) => {
  const item = liveDefs.find((d) => d.signature.startsWith(prefix));
  if (!item) throw new Error(`missing captured definition: ${prefix}`);
  return item.definition;
};

apply('prerequisite followup core', read('supabase/migrations/20260720_customer_followup_find_or_create_open_case.sql'));
apply('captured canonical identity/materialization helpers', `${liveDef('dawaa_normalize_egyptian_mobile_v1')};\n${liveDef('dawaa_customer_identity_key_v1')};\n${liveDef('dawaa_materialize_whatsapp_action_core_v2')};`);
apply('canonical staff-account directory RPC', read('supabase/migrations/20260820_expand_staff_accounts_directory.sql'));
apply('Sales Intelligence read-path RLS', between(
  read('supabase/migrations/20261003111500_db_rls_timeout_hardening_v1.sql'),
  '-- 1) Sales Intelligence read-path RLS: cache request identity / management checks',
  '-- 2) WhatsApp review/source RLS used by the SI views'
));
apply('WhatsApp review-source SELECT RLS for invoker views', between(
  read('supabase/migrations/20261003111500_db_rls_timeout_hardening_v1.sql'),
  'drop policy if exists whatsapp_review_sources_select_v1',
  'drop policy if exists whatsapp_review_sources_insert_v1'
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
apply('current SI policy-evaluation read view', between(
  read('supabase/migrations/20261003193000_si_case_lifecycle_reconciliation_v1.sql'),
  'create or replace view public.sales_intelligence_current_policy_evaluations',
  'create or replace view public.sales_intelligence_current_basket_invoice_matches'
));
apply('local Opportunity Center V22 schema parity', read('supabase/staging/37_whatsapp_opportunity_center_v22.sql'));
apply('local V17 source-scoped RLS parity', read('supabase/staging/38_whatsapp_sales_opportunities_v17_rls.sql'));

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
apply('local custom-auth read access to notification SLA policy metadata', `
  grant select on public.notification_sla_policies to anon;
`);

const required = ['staff_accounts', 'staff_login_sessions', 'whatsapp_review_sources'];
for (const table of required) {
  if (query(`select to_regclass('public.${table}') is not null`) !== 't') {
    throw new Error(`required runtime table missing after bootstrap: ${table}`);
  }
}
const sharedRuntimeRelations = ['notification_events_v2', 'staff_identity_aliases', 'customer_requests', 'daily_followups', 'shift_notes'];
for (const name of sharedRuntimeRelations) {
  if (query(`select to_regclass('public.${name}') is not null`) !== 't') {
    throw new Error(`shared runtime dependency missing after bootstrap: ${name}`);
  }
}
if (query("select to_regprocedure('public.count_pending_shift_notes_v1()') is not null") !== 't') {
  throw new Error('shared runtime dependency missing after bootstrap: count_pending_shift_notes_v1()');
}
if (query("select relkind = 'v' from pg_class where oid='public.notification_events_v2'::regclass") !== 't') {
  throw new Error('notification_events_v2 must be the repository-defined view');
}
const notificationDependencies = query(`select
  to_regclass('public.notification_events_v2_base') is not null
  and to_regprocedure('public.canonical_notification_type_v2(text)') is not null
  and to_regprocedure('public.notification_route_v3(text,text,text,text,uuid,jsonb)') is not null
  and to_regprocedure('public.notification_presentation_priority_v1(text,text,text,text,text,jsonb)') is not null
  and to_regprocedure('public.notification_signal_metadata_v1(text,text,text,text,text,boolean,jsonb)') is not null`);
if (notificationDependencies !== 't') throw new Error('canonical notification read-model dependency chain is incomplete');
if (query("select relrowsecurity from pg_class where oid='public.customer_requests'::regclass") !== 't'
  || query("select relrowsecurity from pg_class where oid='public.daily_followups'::regclass") !== 't'
  || query("select relrowsecurity from pg_class where oid='public.shift_notes'::regclass") !== 't'
  || query("select relrowsecurity from pg_class where oid='public.staff_identity_aliases'::regclass") !== 't') {
  throw new Error('shared runtime identity/shift tables must retain RLS');
}
const requestRepository = read('src/features/customer-requests/data/customerRequestsRepository.ts');
const requestProjection = requestRepository.match(/const CUSTOMER_REQUEST_OPERATIONAL_SELECT = \[([\s\S]*?)\]\.join/);
if (!requestProjection) throw new Error('customer-request repository projection could not be read for schema verification');
const requestColumns = [...requestProjection[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
if (queryColumns('customer_requests', requestColumns) !== requestColumns.length) {
  throw new Error('customer_requests is missing one or more columns selected by its canonical repository');
}
if (query(`select count(*) from public.notifications`) !== '0'
  || query(`select count(*) from public.staff_identity_aliases`) !== '0'
  || query(`select count(*) from public.shift_notes`) !== '0') {
  throw new Error('shared runtime dependency parity must not introduce synthetic operational rows');
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
