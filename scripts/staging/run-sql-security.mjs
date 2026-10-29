// Execute the existing authorization/RLS suites on isolated local PostgreSQL/WASM databases.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { localSql } from './local-sql.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = await localSql(true);
const readSql = file => readFileSync(path.join(root, file), 'utf8').replace(/^\\ir ([^\n]+)$/gm,
  (_, relative) => readSql(path.normalize(path.join(path.dirname(file), relative.trim()))));
const suites = [
  ['branch_inventory_weekly_counts_v1', ['20261029120000_branch_inventory_weekly_counts_v1.sql']],
  ['whatsapp_invoice_link_confirmation_v1', [
    '../migrations/20261012121500_whatsapp_invoice_link_confirmation_v1.sql',
  ]],
  ['customer_review_incubation_scope_v1', ['20261009193000_harden_customer_review_and_incubation_scope_v1.sql']],
  ['conversation_review_correction_session_v1', ['20261005124600_automatic_review_writer_guard_v2.sql', '20261005135500_automatic_review_guard_order_v2.sql', '20261008160000_conversation_review_manager_correction_versioning_v1.sql']],
  ['whatsapp_evidence_journey_link_session_v1', ['20261008104059_whatsapp_evidence_journey_link_staff_session_v1.sql']],
  ['whatsapp_customer_case_v22_envelope_rls_v1', ['20261010110000_whatsapp_customer_case_v22_envelope_rls_v1.sql']],
  ['whatsapp_customer_journey_v15_rls', ['../staging/35_whatsapp_customer_journey_v15_rls.sql'], true],
  ['whatsapp_customer_story_v16_rls', ['../staging/36_whatsapp_customer_story_v16_rls.sql'], true],
  ['whatsapp_sales_opportunities_v17_rls', ['../staging/38_whatsapp_sales_opportunities_v17_rls.sql'], true],
  ['production_read_contracts_v1', [
    '../migrations/20261011173000_notification_sla_anon_session_read_v1.sql',
    '../migrations/20261011173100_dashboard_staff_ops_summary_accounts_v1.sql',
  ]],
  ['rls_actor_scope_initplan_v1', ['20261015140000_rls_actor_scope_initplan_v1.sql']],
  ['weekly_queue_completion_read_only_v1', ['20261015140100_weekly_queue_completion_read_only_v1.sql']],
  ['session_internal_authorized_reads_v1', [
    '20261015140200_anon_session_internal_authorized_reads_v1.sql',
    '20261015140300_reconcile_staff_points_manager_summary_v4.sql',
  ]],
  ['notification_rls_latest_index_v1', [
    '../migrations/20261003114500_notification_inbox_latest_lookup_v5.sql',
    '../migrations/20261011190000_notifications_inbox_canonical_latest_tiebreak_v1.sql',
  ], false, 'notifications_inbox_canonical_latest_v5_idx'],
  ['whatsapp_customer_cases_v22_initplan_v1', [
    '20261015140000_rls_actor_scope_initplan_v1.sql',
    '20261015150000_whatsapp_customer_cases_v22_initplan_v1.sql',
  ]],
  ['attendance_read_scope_initplan_callers_v1', [
    '20261015140000_rls_actor_scope_initplan_v1.sql',
    '20261015150100_attendance_read_scope_initplan_callers_v1.sql',
  ]],
  ['pending_overtime_branch_scope_initplan_v1', ['20261015150200_pending_overtime_branch_scope_initplan_v1.sql']],
  ['employee_kpi_read_scope_initplan_v1', ['20261015150300_employee_kpi_read_scope_initplan_v1.sql']],
  // Index plan suite: tables listed last are vacuumed (visibility map) before the test file, as in Production.
  ['sales_invoices_health_covering_index_v1', ['20261015150400_sales_invoices_health_classification_covering_index_v1.sql'],
    false, null, ['public.sales_invoices']],
  // Applied twice: a re-run of the guarded migration must be a no-op.
  ['staff_actor_session_identity_once_v1', [
    '20261016090000_staff_actor_session_identity_once_per_call_v1.sql',
    '20261016090000_staff_actor_session_identity_once_per_call_v1.sql',
  ]],
  ['attendance_v3_cutover_readiness_dependency_v1', [
    '20261016090100_attendance_v3_cutover_readiness_dependency_v1.sql',
    '20261016090100_attendance_v3_cutover_readiness_dependency_v1.sql',
  ]],
  ['payroll_cycle_staff_scope_shared_v1', [
    '20261016100000_payroll_cycle_staff_scope_shared_v1.sql',
    '20261016100000_payroll_cycle_staff_scope_shared_v1.sql',
  ]],
  ['attendance_v1_deduction_readers_revoke_client_v1', [
    '20261016110000_attendance_v1_deduction_readers_revoke_client_v1.sql',
    '20261016110000_attendance_v1_deduction_readers_revoke_client_v1.sql',
  ]],
  ['cleaning_daily_rating_cards_stars_type_v1', [
    '20261016120000_cleaning_daily_rating_cards_stars_type_v1.sql',
    '20261016120000_cleaning_daily_rating_cards_stars_type_v1.sql',
  ]],
  ['at_risk_completion_read_only_v1', [
    '20261016130000_at_risk_completion_read_only_v1.sql',
    '20261016130000_at_risk_completion_read_only_v1.sql',
  ]],
  ['attendance_legacy_time_off_revoke_client_v1', [
    '20261016140000_attendance_legacy_time_off_revoke_client_v1.sql',
    '20261016140000_attendance_legacy_time_off_revoke_client_v1.sql',
  ]],
  ['overtime_approval_freshness_v1', [
    '20261016150000_overtime_approval_freshness_v1.sql',
    '20261016150000_overtime_approval_freshness_v1.sql',
  ]],
  ['overtime_review_operational_closure_v1', [
    '20261016145000_overtime_review_operational_closure_v1.sql',
    '20261016145000_overtime_review_operational_closure_v1.sql',
    '20261016150000_overtime_approval_freshness_v1.sql',
  ]],
];
const guardRefusals = [
  ['hr_health_without_actor_check', 'session_internal_authorized_reads_v1', 'session_grant_guard_refusal_health_v1.pre.sql',
    '20261015140200_anon_session_internal_authorized_reads_v1.sql', /hr_canonical_architecture_health_v1 no longer authorizes the session actor first; anon grant refused/],
  ['pillar_truth_without_authorization', 'session_internal_authorized_reads_v1', 'session_grant_guard_refusal_pillar_v1.pre.sql',
    '20261015140200_anon_session_internal_authorized_reads_v1.sql', /get_doctor_pillar_breakdown no longer authorizes through dawaa_staff_points_truth_v2; anon grant refused/],
  ['v4_actor_without_verified_session', 'session_internal_authorized_reads_v1', 'session_grant_guard_refusal_v4_actor_v1.pre.sql',
    '20261015140300_reconcile_staff_points_manager_summary_v4.sql', /get_staff_points_manager_summary_v4 no longer authorizes the verified session actor; anon grant refused/],
  ['strict_identity_changed_after_review', 'staff_actor_session_identity_once_v1', 'staff_actor_session_identity_guard_refusal_v1.pre.sql',
    '20261016090000_staff_actor_session_identity_once_per_call_v1.sql',
    /dawaa_current_staff_account_id_strict\(\) differs from the reviewed definition; regenerate this migration/,
    'staff_actor_session_identity_guard_refusal_v1.post.sql'],
  ['cutover_readiness_exists_differently', 'attendance_v3_cutover_readiness_dependency_v1', 'attendance_v3_cutover_readiness_guard_refusal_v1.pre.sql',
    '20261016090100_attendance_v3_cutover_readiness_dependency_v1.sql',
    /attendance_policy_v3_cutover_readiness_v1 exists with a different definition; refusing to replace it/,
    'attendance_v3_cutover_readiness_guard_refusal_v1.post.sql'],
  ['payroll_overview_changed_after_review', 'payroll_cycle_staff_scope_shared_v1', 'payroll_cycle_staff_scope_guard_refusal_v1.pre.sql',
    '20261016100000_payroll_cycle_staff_scope_shared_v1.sql',
    /payroll_cycle_finalization_overview_v2 differs from the reviewed definition; regenerate this migration/,
    'payroll_cycle_staff_scope_guard_refusal_v1.post.sql'],
  ['cleaning_cards_changed_after_review', 'cleaning_daily_rating_cards_stars_type_v1', 'cleaning_daily_rating_cards_guard_refusal_v1.pre.sql',
    '20261016120000_cleaning_daily_rating_cards_stars_type_v1.sql',
    /get_cleaning_daily_rating_cards_v2 differs from the reviewed definition; regenerate this migration/,
    'cleaning_daily_rating_cards_guard_refusal_v1.post.sql'],
  ['at_risk_completion_changed_after_review', 'at_risk_completion_read_only_v1', 'at_risk_completion_guard_refusal_v1.pre.sql',
    '20261016130000_at_risk_completion_read_only_v1.sql',
    /get_customer_service_at_risk_completion_v1 differs from the reviewed definition; regenerate this migration/,
    'at_risk_completion_guard_refusal_v1.post.sql'],
  ['legacy_time_off_changed_after_review', 'attendance_legacy_time_off_revoke_client_v1', 'attendance_legacy_time_off_guard_refusal_v1.pre.sql',
    '20261016140000_attendance_legacy_time_off_revoke_client_v1.sql',
    /legacy time-off API public\.attendance_gm_time_off_queue_v1\(\) differs from the reviewed definition; regenerate this migration/,
    'attendance_legacy_time_off_guard_refusal_v1.post.sql'],
  ['legacy_time_off_grants_changed_after_review', 'attendance_legacy_time_off_revoke_client_v1', 'attendance_legacy_time_off_grant_refusal_v1.pre.sql',
    '20261016140000_attendance_legacy_time_off_revoke_client_v1.sql',
    /legacy time-off API public\.attendance_my_time_off_requests_v1\(\) has unreviewed grants \(PUBLIC,anon,authenticated,reporting,service_role\); regenerate this migration/,
    'attendance_legacy_time_off_guard_refusal_v1.post.sql'],
  ['overtime_fingerprint_changed_after_review', 'overtime_approval_freshness_v1', 'overtime_approval_freshness_guard_refusal_v1.pre.sql',
    '20261016150000_overtime_approval_freshness_v1.sql',
    /attendance_resolution_fingerprint_v2 differs from the reviewed definition; regenerate this migration/,
    'overtime_approval_freshness_guard_refusal_v1.post.sql'],
  ['overtime_invalidation_changed_after_review', 'overtime_approval_freshness_v1', 'overtime_invalidation_guard_refusal_v1.pre.sql',
    '20261016150000_overtime_approval_freshness_v1.sql',
    /hr_invalidate_overtime_on_attendance_change_v1 differs from the reviewed definition; regenerate this migration/,
    'overtime_approval_freshness_guard_refusal_v1.post.sql'],
  ['overtime_decision_rpc_changed_after_review', 'overtime_review_operational_closure_v1', 'overtime_review_guard_refusal_v1.pre.sql',
    '20261016145000_overtime_review_operational_closure_v1.sql',
    /decide_overtime_approval_v3 differs from the reviewed definition; regenerate this migration/,
    'overtime_review_guard_refusal_v1.post.sql'],
];
try {
  for (const [name, migrations, stagingPolicies = false, , vacuumTables = []] of suites) {
    const db = `sql_security_${name}`;
    await runtime.execute('postgres', `create database ${db};`);
    const policyFiles = migrations.map(m => stagingPolicies
      ? path.normalize(path.join('supabase/tests', m))
      : `supabase/migrations/${m}`);
    for (const file of [`supabase/tests/${name}.fixture.sql`, ...policyFiles, `supabase/tests/${name}.test.sql`]) {
      if (file.endsWith('.test.sql')) {
        for (const table of vacuumTables) {
          const vacuum = await runtime.execute(db, `vacuum analyze ${table};`);
          if (vacuum.code) throw new Error(`${name} vacuum ${table}: ${vacuum.stderr}`);
        }
      }
      const result = await runtime.execute(db, readSql(file));
      if (result.code) throw new Error(`${file}: ${result.stderr}`);
      if (file.endsWith('.test.sql') && name === 'notification_rls_latest_index_v1'
          && !result.stdout.includes('notifications_inbox_canonical_latest_v5_idx')) {
        throw new Error(`${name}: EXPLAIN did not use notifications_inbox_canonical_latest_v5_idx`);
      }
    }
    console.log(`PASS ${name}: existing SQL authorization/RLS assertions`);
    await runtime.execute('postgres', `drop database ${db};`);
  }
  // Grant-guard refusal cases: a migration whose anon grant depends on an internal authorization check must
  // fail (and grant nothing) when that check has been removed from the function it guards.
  for (const [caseName, fixture, preMutation, migration, expectedError,
    postCheck = 'session_grant_guard_refusal_v1.post.sql'] of guardRefusals) {
    const db = `sql_security_guard_${caseName}`;
    await runtime.execute('postgres', `create database ${db};`);
    for (const file of [`supabase/tests/${fixture}.fixture.sql`, `supabase/tests/${preMutation}`]) {
      const result = await runtime.execute(db, readSql(file));
      if (result.code) throw new Error(`${caseName} ${file}: ${result.stderr}`);
    }
    const refused = await runtime.execute(db, readSql(`supabase/migrations/${migration}`));
    if (!refused.code) throw new Error(`${caseName}: ${migration} did not refuse the grant after its guarded check was removed`);
    if (!expectedError.test(refused.stderr)) throw new Error(`${caseName}: ${migration} failed for another reason: ${refused.stderr}`);
    const post = await runtime.execute(db, readSql(`supabase/tests/${postCheck}`));
    if (post.code) throw new Error(`${caseName}: ${post.stderr}`);
    console.log(`PASS guard refusal ${caseName}: grant refused and nothing granted`);
    await runtime.execute('postgres', `drop database ${db};`);
  }
  const normalizerDb = 'sql_security_product_normalizer_v21';
  await runtime.execute('postgres', `create database ${normalizerDb};`);
  const truthBoundary = readSql('supabase/migrations/20261005123000_sales_intelligence_truth_boundary_v2.sql');
  const normalizerStart = truthBoundary.indexOf('create or replace function public.dawaa_normalize_product_match_v21(');
  const normalizerEnd = truthBoundary.indexOf('$function$;', normalizerStart);
  if (normalizerStart < 0 || normalizerEnd < 0) {
    throw new Error('product normalizer definition is missing from the canonical SI migration');
  }
  const definition = truthBoundary.slice(normalizerStart, normalizerEnd + '$function$;'.length);
  for (const sql of [definition, readSql('supabase/tests/product_normalizer_v21.test.sql')]) {
    const result = await runtime.execute(normalizerDb, sql);
    if (result.code) throw new Error(`product normalizer SQL contract: ${result.stderr}`);
  }
  console.log('PASS product_normalizer_v21: Production SQL signature, security and output parity');
  await runtime.execute('postgres', `drop database ${normalizerDb};`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await runtime.close(); }
