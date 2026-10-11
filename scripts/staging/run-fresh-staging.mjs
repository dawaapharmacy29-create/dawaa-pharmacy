// Fresh staging migration test, reproducible from zero on native PostgreSQL or --pglite.
// Order: 1 platform shim -> 2 Production-shaped tables -> 3 Production-only objects (indexes, captured
// bodies, stubs) -> 4 repository prerequisite bodies -> 5 synthetic seed -> 6 the Release Candidate
// migrations in their deterministic order, with a check after each -> 7 historical DML not re-run
// (plus a negative control proving the check would catch it) -> 8 read-only reconciliation ->
// 9 contract smoke on the migrated database.
// Uses only a local database (libpq env: PGHOST, PGPORT, PGUSER). Refuses any non-local host.
// Never touches Supabase. Writes a JSON summary to $STAGING_REPORT when set.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { extractDdl, HISTORICAL_DML } from './historical-dml.mjs';
import { RC_MIGRATIONS } from './rc-migration-order.mjs';
import { localSql } from './local-sql.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { checkCanonicalSiDependencies } = createRequire(import.meta.url)('../check-canonical-si-dependencies.cjs');
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
const sqlRuntime = await localSql(process.argv.includes('--pglite'));
async function psql(db, sql, { allowError = false, options = '' } = {}) {
  const result = await sqlRuntime.execute(db, sql, options);
  if (result.code !== 0 && !allowError) throw new Error(`psql failed (${db}):\n${result.stderr.slice(0, 4000)}`);
  return result;
}
const query = async (db, sql) => (await psql(db, sql)).stdout.trim();
const liveDefs = JSON.parse(read('docs/si-operational-audit-20261009/followup-core-live-definitions.json'));
const liveDef = (prefix) => liveDefs.find((d) => d.signature.startsWith(prefix)).definition;

async function applyNotificationReadModel(db, lazy) {
  await psql(db, read('supabase/migrations/20260907090000_notification_read_model_v2.sql'), lazy);
  await psql(db, read('supabase/migrations/20260907091000_notification_metadata_contract_v2.sql'), lazy);
  await psql(db, read('supabase/migrations/20260907092500_notification_read_model_metadata_v2.sql'), lazy);
  await psql(db, read('supabase/migrations/20260908164500_notification_sla_engine_v1.sql'), lazy);
  await psql(db, read('supabase/migrations/20260908171000_notification_sla_read_model_v1.sql'), lazy);
  await psql(db, read('supabase/migrations/20260908172000_notification_sla_metadata_surface_v1.sql'), lazy);
  const guardrails = read('supabase/migrations/20260911063000_notification_architecture_v3_guardrails.sql');
  await psql(db, between(guardrails, 'create or replace function public.notification_route_v3(',
    '-- Preserve the original SLA-enriched view once on fresh databases.'), lazy);
  await psql(db, between(guardrails, '-- Preserve the original SLA-enriched view once on fresh databases.',
    'create or replace view public.notification_events_v3'), lazy);
  await psql(db, read('supabase/migrations/20260911165000_smart_notification_signal_and_noise_control_v1.sql'), lazy);
  await psql(db, read('supabase/migrations/20260911170500_smart_notification_signal_refinement_v2.sql'), lazy);
  const priorityRefinement = read('supabase/migrations/20260912202500_notification_review_severity_and_legacy_sync_cleanup_v4.sql');
  await psql(db, between(priorityRefinement, 'create or replace function public.notification_presentation_priority_v1(',
    '\nupdate public.notifications'), lazy);
  await psql(db, `
    grant select on public.notification_events_v2_base, public.notification_events_v2, public.notifications to anon, authenticated;
    grant execute on function public.dawaa_current_notification_account_id_v1() to anon, authenticated;
    grant execute on function public.dawaa_current_notification_branch_v1() to anon, authenticated;
    grant execute on function public.dawaa_current_notification_role_v1() to anon, authenticated;
    grant execute on function public.dawaa_current_staff_id_v1() to anon, authenticated;
    grant execute on function public.dawaa_notification_visible_to_current_user_v2(text,text,text,text,text,text) to anon, authenticated;
  `, lazy);
  await psql(db, `
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
  `, lazy);
}

// Captured Production bodies and repository bodies the migrations and the smoke checks rely on.
export const PREREQUISITES = [
  ['catalog-derived schema only', 'SI tables/composite row types and canonical writer relation columns/defaults/keys', 'supabase/staging/15_canonical_si_schema.sql'],
  ['repo body', 'dawaa_normalize_staff_name_v1', '20260901090000_base44_purchase_invoice_sync_system_v1.sql (normalizer only)'],
  ['repo bodies', 'sales_intelligence_reconcile_case_set_v1 and current-case/current-attribution publication views', '20261003193000_si_case_lifecycle_reconciliation_v1.sql (definitions only; no compatibility backfill)'],
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

async function bootstrap(db) {
  await psql('postgres', `drop database if exists ${db}; create database ${db};`);
  // Bodies are created as the historical migrations did: validated when first called.
  const lazy = { options: '-c check_function_bodies=off' };
  for (const file of ['00_platform_shim.sql', '10_production_tables.sql', '15_canonical_si_schema.sql', '20_production_only_objects.sql', '30_session_helpers.sql']) {
    await psql(db, read(`supabase/staging/${file}`), lazy);
  }
  await psql(db, between(read('supabase/migrations/20260824150000_harden_customer_requests_rls_v2.sql'),
    'create or replace function public.dawaa_customer_request_branch_key',
    'create or replace function public.dawaa_can_access_customer_request_branch'), lazy);
  await psql(db, read('supabase/staging/41_shared_runtime_dependency_parity.sql'), lazy);
  await psql(db, between(read('supabase/migrations/20260716090000_employee_360_profile_events_payroll.sql'),
    'create or replace function public.dawaa_current_staff_id_v1()', '\n$$;') + '\n$$;\nrevoke all on function public.dawaa_current_staff_id_v1() from public;\ngrant execute on function public.dawaa_current_staff_id_v1() to anon, authenticated;', lazy);
  const notificationAudience = read('supabase/migrations/20260823173500_fix_notification_audience_leakage_v2.sql');
  await psql(db, between(notificationAudience, 'create or replace function public.dawaa_current_notification_account_id_v1()',
    '-- Backfill the old recipient column used by legacy writers.'), lazy);
  await psql(db, between(notificationAudience, '-- Replace permissive app policies with recipient-scoped policies.',
    '-- Fix the scheduled weekly manager reminder writer.'), lazy);
  await applyNotificationReadModel(db, lazy);
  await psql(db, read('supabase/migrations/20260822231000_pending_shift_notes_count_v1.sql'), lazy);
  await psql(db, read('supabase/migrations/20260720_customer_followup_find_or_create_open_case.sql'), lazy);
  await psql(db, `${liveDef('dawaa_normalize_egyptian_mobile_v1')};\n${liveDef('dawaa_customer_identity_key_v1')};\n${liveDef('dawaa_materialize_whatsapp_action_core_v2')};`, lazy);
  await psql(db, between(read('supabase/migrations/20260713_staff_accounts_security_hardening.sql'),
    'create function public.resolve_staff_account_safe', '\n$$;') + '\n$$;', lazy);
  await psql(db, read('supabase/migrations/20260720_customer_followup_customer_correction.sql'), lazy);
  await psql(db, read('supabase/migrations/20260720_customer_followup_duplicate_management.sql'), lazy);
  await psql(db, read('supabase/migrations/20260721_transfer_customer_followup_branch_v1.sql'), lazy);
  await psql(db, between(read('supabase/migrations/20260726232000_dedupe_followups_and_fix_canonical_branch.sql'),
    'create or replace function public.normalize_customer_followup_branch', '-- Run once during migration.'), lazy);
  const authz = read('supabase/migrations/20260823184000_harden_db_authorization_permission_truth_v1.sql');
  await psql(db, between(authz, 'create or replace function public.dawaa_require_customer_service_actor_v1', '\n$$;') + '\n$$;', lazy);
  const command = read('supabase/migrations/20260719_customer_service_secure_command_center.sql');
  await psql(db, between(command, 'create or replace function public.dawaa_parse_followup_datetime_v1', 'create or replace function public.dawaa_require_customer_service_actor_v1'), lazy);
  await psql(db, between(command, 'create or replace function public.dawaa_log_customer_followup_event_v1', 'create or replace function public.dawaa_archive_customer_followup_v1'), lazy);
  await psql(db, between(command, 'create or replace function public.dawaa_create_exceptional_followup_v2', 'create or replace function public.dawaa_complete_customer_followup_v1'), lazy);
  await psql(db, between(read('supabase/migrations/20260824180000_customer_followup_lifecycle_commands_v1.sql'),
    'create or replace function public.dawaa_create_or_link_customer_followup_v1', 'create or replace function public.dawaa_save_customer_followup_result_v1'), lazy);
  await psql(db, between(read('supabase/migrations/20260917074500_whatsapp_followup_customer_identity_v1.sql'),
    'create or replace function public.dawaa_whatsapp_followup_resolve_customer_identity_v1', 'revoke all on function public.dawaa_whatsapp_followup_resolve_customer_identity_v1'), lazy);
  await psql(db, JSON.parse(read('docs/si-operational-audit-20261009/branch-sync-live-definition.json')).definition, lazy);
  await psql(db, `create trigger customer_branch_sync after update on public.customers
    for each row execute function public.sync_customer_branch_to_open_followups_and_daily_queue();`);
  // Production ACL on the core (20260824180000): clients reach it only through the wrapper.
  await psql(db, `revoke all on function public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text) from public, anon, authenticated;
    revoke all on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) from public, anon;
    grant execute on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) to authenticated;
    revoke all on function public.dawaa_materialize_whatsapp_action_core_v2(uuid) from public, anon, authenticated;`);
  await psql(db, between(read('supabase/migrations/20260901090000_base44_purchase_invoice_sync_system_v1.sql'),
    'create or replace function public.dawaa_normalize_staff_name_v1', 'create or replace function public.dawaa_map_base44_branch_v1'), lazy);
  await psql(db, between(read('supabase/migrations/20261003193000_si_case_lifecycle_reconciliation_v1.sql'),
    'create or replace function public.sales_intelligence_reconcile_case_set_v1', 'create or replace view public.sales_intelligence_current_policy_evaluations'), lazy);
  await psql(db, between(read('supabase/migrations/20261003193000_si_case_lifecycle_reconciliation_v1.sql'),
    'create or replace view public.sales_intelligence_current_policy_evaluations', 'create or replace view public.sales_intelligence_current_basket_invoice_matches'), lazy);
  await psql(db, read('supabase/migrations/20260820_expand_staff_accounts_directory.sql'), lazy);
  await psql(db, between(read('supabase/migrations/20261003111500_db_rls_timeout_hardening_v1.sql'),
    '-- 1) Sales Intelligence read-path RLS: cache request identity / management checks',
    '-- 2) WhatsApp review/source RLS used by the SI views'), lazy);
  await psql(db, between(read('supabase/migrations/20261003111500_db_rls_timeout_hardening_v1.sql'),
    'drop policy if exists whatsapp_review_sources_select_v1',
    'drop policy if exists whatsapp_review_sources_insert_v1'), lazy);
  await psql(db, read('supabase/staging/37_whatsapp_opportunity_center_v22.sql'), lazy);
  await psql(db, read('supabase/staging/38_whatsapp_sales_opportunities_v17_rls.sql'), lazy);
  await psql(db, read('supabase/staging/40_synthetic_seed.sql'));
}

// Rows the historical DML would change. Compared before and after the migration chain.
const DML_WATCH = `select md5(coalesce(string_agg(x, '|' order by x), '')) from (
  select 'r:' || id || ':' || is_current || ':' || coalesce(updated_at::text, '') as x from public.conversation_sales_reviews
  union all
  select 'a:' || id || ':' || coalesce(status, '') || ':' || coalesce(auto_eligible::text, '') || ':' || coalesce(updated_at::text, '') from public.whatsapp_conversation_actions) s`;

async function applyMigration(db, migration, { original = false } = {}) {
  const sql = original ? read(`supabase/migrations/${migration}`) : extractDdl(root, migration).sql;
  return await psql(db, sql, { allowError: true });
}

const suffix = `${process.pid}`;
const db = `dawaa_staging_${suffix}`;
const control = `dawaa_staging_control_${suffix}`;
const summary = { runtime: process.argv.includes('--pglite') ? 'PGlite 0.5.8' : 'native PostgreSQL', steps: [], historicalDml: {}, reconciliation: {}, smoke: [] };
const step = (name, detail = 'ok') => { summary.steps.push({ name, detail }); console.log(`PASS ${name}${detail === 'ok' ? '' : ` (${detail})`}`); };
try {
  await bootstrap(db);
  step('bootstrap: platform shim, Production-shaped tables, Production-only objects, prerequisite bodies, synthetic seed');
  assert.equal(await query(db, `select count(*) from pg_class where oid in (
    'public.whatsapp_product_demand_monthly_v22'::regclass,
    'public.whatsapp_sales_leakage_monthly_v22'::regclass,
    'public.whatsapp_product_demand_unresolved_detail_v22'::regclass,
    'public.whatsapp_product_demand_unresolved_v22'::regclass
  ) and relkind='v' and not relrowsecurity`), '4', 'Opportunity Center views must exist as non-RLS views');
  assert.equal(await query(db, `select count(*) from pg_proc where oid in (
    'public.dawaa_cycle_start_26(date)'::regprocedure,
    'public.dawaa_cycle_end_25(date)'::regprocedure
  )`), '2', '26-to-25 cycle helpers must exist');
  assert.equal(await query(db, `select relrowsecurity from pg_class where oid='public.whatsapp_sales_opportunities_v17'::regclass`), 't',
    'V17 base relation must retain its production row-security boundary');
  assert.equal(await query(db, `select count(*) from pg_policy where polrelid='public.whatsapp_review_sources'::regclass
    and polname='whatsapp_review_sources_select_v1'`), '1',
    'WhatsApp source SELECT RLS must be present for security-invoker read views');
  assert.equal(await query(db, `set role authenticated;
    set request.headers = '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a2"}';
    select count(*) from public.sales_intelligence_current_case_analyses where case_id='syn-case-1';
    reset role;`), '1', 'authorized local manager must read the current case analysis through the invoker view');
  assert.equal(await query(db, `set role authenticated;
    set request.headers = '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a4"}';
    select count(*) from public.sales_intelligence_current_case_analyses where case_id='syn-case-1';
    reset role;`), '0', 'inactive local account must not read current case analysis through the invoker view');
  step('Case Detail invoker-view read is authorized for manager and denied for inactive actor');
  assert.equal(await query(db, `select count(*) from pg_policy where polrelid='public.whatsapp_sales_opportunities_v17'::regclass
    and polname in ('whatsapp_sales_opportunities_v17_select','whatsapp_sales_opportunities_v17_insert','whatsapp_sales_opportunities_v17_update')`), '3',
    'V17 source-scoped select/insert/update policies must be installed');
  assert.equal(await query(db, `select count(*) from pg_attribute where attrelid='public.whatsapp_product_demand_monthly_v22'::regclass
    and attname in ('cycle_start','cycle_end','branch','product_id','product_code','product_name','inquiry_opportunities','unique_customers',
      'unavailable_count','accepted_or_later_count','acceptance_rate','conversation_verified_count') and not attisdropped`), '12',
    'monthly demand view must expose the read-model contract used by the UI');
  assert.equal(await query(db, `select count(*) from pg_attribute where attrelid='public.whatsapp_sales_leakage_monthly_v22'::regclass
    and attname in ('cycle_start','cycle_end','branch','leakage_code','cases_count','unique_customers','unique_products','staff_attributed_cases')
    and not attisdropped`), '8', 'monthly leakage view must expose the read-model contract used by the UI');
  assert.equal(await query(db, `select count(*) from pg_attribute where attrelid='public.whatsapp_product_demand_unresolved_v22'::regclass
    and attname in ('cycle_start','cycle_end','branch','unresolved_type','unresolved_mentions','conversations_affected') and not attisdropped`), '6',
    'unresolved demand view must expose the read-model contract used by the UI');
  assert.equal(await query(db, `select
    position('whatsapp_sales_opportunities_v17' in pg_get_viewdef('public.whatsapp_product_demand_monthly_v22'::regclass)) > 0
    and position('dawaa_cycle_start_26' in pg_get_viewdef('public.whatsapp_product_demand_monthly_v22'::regclass)) > 0
    and position('dawaa_cycle_end_25' in pg_get_viewdef('public.whatsapp_sales_leakage_monthly_v22'::regclass)) > 0
    and position('whatsapp_review_sources' in pg_get_viewdef('public.whatsapp_product_demand_unresolved_detail_v22'::regclass)) > 0
    and position('whatsapp_operational_canonical_sources_v1' in pg_get_viewdef('public.whatsapp_product_demand_unresolved_detail_v22'::regclass)) > 0
    and position('whatsapp_product_demand_unresolved_detail_v22' in pg_get_viewdef('public.whatsapp_product_demand_unresolved_v22'::regclass)) > 0`), 't',
    'Opportunity Center read models must retain the supplied production dependency graph');
  assert.equal(await query(db, `select public.dawaa_cycle_start_26('2026-10-25'::date) || '|' ||
    public.dawaa_cycle_end_25('2026-10-25'::date) || '|' ||
    public.dawaa_cycle_start_26('2026-10-26'::date) || '|' ||
    public.dawaa_cycle_end_25('2026-10-26'::date)`), '2026-09-26|2026-10-25|2026-10-26|2026-11-25',
    'cycle boundaries must match the application 26th-to-25th cycle');
  assert.equal(await query(db, `select
    (select count(*) from public.whatsapp_product_demand_monthly_v22) +
    (select count(*) from public.whatsapp_sales_leakage_monthly_v22) +
    (select count(*) from public.whatsapp_product_demand_unresolved_detail_v22) +
    (select count(*) from public.whatsapp_product_demand_unresolved_v22)`), '0',
    'schema parity must not invent Opportunity Center business rows');
  step('Opportunity Center V22 views, cycle functions, and V17 RLS contract verified');
  assert.equal(await query(db, `select
    (select relkind='v' from pg_class where oid='public.notification_events_v2'::regclass)
    and to_regclass('public.notification_events_v2_base') is not null
    and to_regprocedure('public.canonical_notification_type_v2(text)') is not null
    and to_regprocedure('public.notification_route_v3(text,text,text,text,uuid,jsonb)') is not null
    and to_regprocedure('public.notification_presentation_priority_v1(text,text,text,text,text,jsonb)') is not null
    and to_regprocedure('public.notification_signal_metadata_v1(text,text,text,text,text,boolean,jsonb)') is not null
    and to_regprocedure('public.count_pending_shift_notes_v1()') is not null
    and (select relrowsecurity from pg_class where oid='public.customer_requests'::regclass)
    and (select relrowsecurity from pg_class where oid='public.daily_followups'::regclass)
    and (select relrowsecurity from pg_class where oid='public.shift_notes'::regclass)
    and (select relrowsecurity from pg_class where oid='public.staff_identity_aliases'::regclass)`), 't',
    'shared runtime views/RPC and protected tables must be installed');
  const requestRepository = read('src/features/customer-requests/data/customerRequestsRepository.ts');
  const requestProjection = requestRepository.match(/const CUSTOMER_REQUEST_OPERATIONAL_SELECT = \[([\s\S]*?)\]\.join/);
  assert.ok(requestProjection, 'customer-request repository projection must be readable for schema verification');
  const requestColumns = [...requestProjection[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const requestColumnSql = requestColumns.map((column) => `'${column.replaceAll("'", "''")}'`).join(',');
  assert.equal(await query(db, `select count(*) from pg_attribute
    where attrelid='public.customer_requests'::regclass and not attisdropped and attname in (${requestColumnSql})`),
    String(requestColumns.length), 'customer_requests must satisfy its complete canonical repository projection');
  assert.equal(await query(db, `select count(*) from pg_attribute
    where attrelid='public.daily_followups'::regclass and not attisdropped
      and attname in ('staff_id','followup_summary','requested_by_staff_id')`), '3',
    'daily_followups must include its runtime evidence columns');
  assert.equal(await query(db, `select
    (select count(*) from public.staff_identity_aliases) +
    (select count(*) from public.shift_notes) +
    (select count(*) from public.notifications)`), '0',
    'shared runtime parity must not seed fake alias or shift-note rows');
  step('shared runtime dependency schema, RLS, notification view, and pending shift-notes RPC verified');
  const before = await query(db, DML_WATCH);
  const seededReady = await query(db, `select count(*) from whatsapp_conversation_actions where action_type='customer_request' and status='ready' and target_id is null`);
  assert.ok(Number(seededReady) > 0, 'seed must contain rows the historical DML would change');

  for (const m of RC_MIGRATIONS) {
    const result = await applyMigration(db, m.file);
    if (result.code !== 0) throw new Error(`${m.file} failed:\n${result.stderr.slice(0, 3000)}`);
    for (const check of m.assertions) {
      const value = await query(db, check.sql);
      assert.equal(value, check.expect, `${m.file}: ${check.name} -> ${value}`);
    }
    step(`migration ${m.order} ${m.file}`, `${m.assertions.length} post-checks`);
  }
  await psql(db, 'grant select on public.notification_sla_policies to anon;');
  const anonymousDependencyProbe = await psql(db, `
    begin;
    set local role anon;
    select set_config('request.headers','{}',true);
    select
      (select count(*) from public.notification_events_v2)
      + (select count(*) from public.shift_notes)
      + (select count(*) from public.staff_identity_aliases)
      + (select count(*) from public.customer_requests)
      + (select count(*) from public.daily_followups);
    rollback;
  `);
  assert.equal(anonymousDependencyProbe.code, 0, 'anonymous shared dependency reads must remain executable');
  assert.equal(anonymousDependencyProbe.stdout.trim().split(/\r?\n/).at(-1), '0',
    'anonymous reads without a local staff session must not expose shared dependency rows');
  assert.equal(await query(db, `select count(*) from pg_policy
    where polrelid in (
      'public.notifications'::regclass,
      'public.notification_sla_policies'::regclass,
      'public.notification_sla_events'::regclass,
      'public.shift_notes'::regclass,
      'public.staff_identity_aliases'::regclass,
      'public.customer_requests'::regclass,
      'public.daily_followups'::regclass
    ) and (
      lower(trim(coalesce(pg_get_expr(polqual,polrelid),''))) in ('true','(true)')
      or lower(trim(coalesce(pg_get_expr(polwithcheck,polrelid),''))) in ('true','(true)')
    )`), '0',
    'shared dependency policies must not use unconditional true predicates');
  const dependencies = checkCanonicalSiDependencies(root);
  assert.deepEqual(dependencies.missing, []);
  for (const name of dependencies.dependencies) {
    assert.equal(await query(db, `select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='${name}') or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='${name}')`), 't', `missing runtime dependency ${name}`);
  }
  step('canonical SI source and runtime dependencies resolved', `${dependencies.dependencies.length} objects`);
  // Every migration is re-runnable (CREATE OR REPLACE / IF NOT EXISTS / guarded DO).
  for (const m of RC_MIGRATIONS.filter((item) => item.rerunnable !== false)) {
    const again = await applyMigration(db, m.file);
    if (again.code !== 0) throw new Error(`${m.file} is not re-runnable:\n${again.stderr.slice(0, 2000)}`);
  }
  for (const m of RC_MIGRATIONS.filter((item) => item.rerunnable === false)) {
    assert.notEqual((await applyMigration(db, m.file)).code, 0, `${m.file} is marked apply-once but re-applied`);
  }
  step('every RC migration re-applies cleanly except the apply-once renames', RC_MIGRATIONS.filter((m) => m.rerunnable === false).map((m) => m.order).join(', '));

  const after = await query(db, DML_WATCH);
  assert.equal(after, before, 'historical DML changed watched rows');
  assert.equal(await query(db, `select count(*) from whatsapp_conversation_actions where action_type='customer_request' and status='ready' and target_id is null`), seededReady);
  summary.historicalDml.staging = { watchedRowsUnchanged: true, readyCustomerRequestsKept: Number(seededReady) };
  step('historical DML of 20261005133000 and 20261005141000 did not run', `${seededReady} ready requests and all review flags unchanged`);

  // Negative control: the ORIGINAL files on the same seed do change the watched rows.
  await bootstrap(control);
  const controlBefore = await query(control, DML_WATCH);
  for (const m of RC_MIGRATIONS) {
    const result = await applyMigration(control, m.file, { original: HISTORICAL_DML.some((h) => h.migration === m.file) });
    if (result.code !== 0) throw new Error(`control ${m.file} failed:\n${result.stderr.slice(0, 2000)}`);
  }
  assert.notEqual(await query(control, DML_WATCH), controlBefore, 'negative control: original files must change watched rows');
  summary.historicalDml.negativeControl = 'original files change the watched rows (check is sensitive)';
  step('negative control: the unsplit originals would have rewritten the seeded rows');
  await psql('postgres', `drop database if exists ${control};`);

  // Read-only reconciliation on the migrated staging database.
  const rec = await psql(db, read('supabase/readonly/release_candidate_reconciliation_v1.sql'));
  if (rec.code !== 0) throw new Error(`reconciliation failed:\n${rec.stderr}`);
  assert.equal(await query(db, DML_WATCH), before, 'reconciliation must not write');
  summary.reconciliation.output = rec.stdout;
  step('read-only reconciliation ran on the migrated database and wrote nothing');

  // Contract smoke on the migrated database (synthetic customer, staff session through the wrapper).
  const as = `set request.headers = '{"x-dawaa-user-id":"00000000-0000-4000-8000-0000000000a2"}'; set role authenticated;`;
  const call = (type) => `${as} select public.dawaa_create_or_link_customer_followup_v1(null,'SYN-STG-1','Synthetic Staging Customer',null,'فرع شكري','${type}','synthetic',null,null,null,null,'staging_smoke');`;
  const first = JSON.parse((await psql(db, call('general'))).stdout.trim().split('\n').pop());
  const second = JSON.parse((await psql(db, call('complaint'))).stdout.trim().split('\n').pop());
  assert.equal(first.created, true);
  assert.equal(second.followup_id, first.followup_id);
  assert.equal(second.linked_to_open_case, true);
  summary.smoke.push('contract A on the migrated database: second request_type linked to the open case');
  step('contract A smoke on the migrated database');

  await psql(db, 'reset role');
  await psql(db, read('supabase/tests/internal_story_sync_v16.test.sql'));
  step('internal story sync SQL authorization, safe search_path, evidence events and refresh retry regression');

  const retryRow = {
    pipeline_version:'synthetic-retry',engine_version_case_segmentation:'synthetic',
    engine_version_historical_closure:'synthetic',engine_version_commercial_confirmation:'synthetic',
    engine_version_protocol_applicability:'synthetic',semantic_source_hash:'synthetic-retry',
    case_type:'sales_opportunity',case_status:'sales_opportunity',pipeline_status:'analyzed',
    overall_evidence_level:'high',case_started_at:'2026-09-16T06:00:00Z',historical_closure_level:'not_closed',
    commercial_confirmation_state:'unknown',protocol_applicability:'unknown',attribution_level:'unknown',
    integrity_evaluation_scope:'insufficient',
  };
  const retrySql = `set role service_role; select public.sales_intelligence_write_case_analysis('syn-case-2', '${JSON.stringify(retryRow)}'::jsonb);`;
  const retryResults = await Promise.all(Array.from({ length: 5 }, () => psql(db, retrySql)));
  const retryRows = retryResults.map(r => JSON.parse(r.stdout.trim().split('\n').pop()));
  assert.equal(new Set(retryRows.map(r => r.analysis_id)).size, 1);
  assert.equal(retryRows.filter(r => r.is_new).length, 1);
  await psql(db, 'reset role');
  assert.equal(await query(db, `select count(*) from public.sales_intelligence_case_analyses where case_id='syn-case-2' and is_current`), '1');
  step('five concurrent canonical analysis retry submissions converge on one current row');

  await psql(db, read('supabase/tests/canonical_si_schema_runtime.test.sql'));
  step('actual attribution, match, policy writers and unproven reconciliation execute against captured table contracts');

  await psql('postgres', `drop database if exists ${db};`);
  if (process.env.STAGING_REPORT) writeFileSync(process.env.STAGING_REPORT, JSON.stringify(summary, null, 2));
  console.log(`fresh staging: ${summary.steps.length} steps passed`);
} catch (error) {
  console.error(error.message || error);
  console.error(`fresh staging: FAILED after ${summary.steps.length} passing steps`);
  process.exitCode = 1;
} finally {
  await sqlRuntime.close();
}
