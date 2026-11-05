// Generates the emergency rollback for the 20261017 security candidates from the captured Production catalog.
// Restores the exact pre-change Production function bodies, policy expressions and grants. It deliberately
// re-opens the vulnerabilities, so it is only for a confirmed functional emergency.
const fs = require('fs');
const [catalogFile, policiesFile, outFile] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
const fn = (name) => {
  const r = rows.find((x) => x.kind === 'd_function' && x.nm.replace(/^public\./, '').split('(')[0] === name);
  if (!r) throw new Error('missing ' + name);
  return r.ddl.slice(0, r.ddl.indexOf('\n;\nrevoke')) + '\n;';
};
const restoreBodies = [
  'dawaa_current_staff_id_v1', 'dawaa_current_notification_account_id_v1', 'dawaa_has_active_app_session',
  'app_staff_role', 'app_actor_is_team_dawaa', 'dawaa_can_read_conversation_review_row_v2', 'dawaa_shortage_permission_allowed_v1',
  'dawaa_customer_service_queue_scope_v3', 'dawaa_can_access_customer_intelligence_branch_v2', 'dawaa_can_manage_customer_intelligence_v2',
  'customer_followup_performance_v1', 'get_customer_followup_records_v1', 'update_customer_welcome_message_status', 'save_quick_reply_script',
  'get_weekly_manager_metrics_cached_v1', 'get_weekly_manager_metrics_fast_v1', 'list_weekly_manager_evaluation_subjects_v1',
  'dawaa_can_manage_branch_targets',
];
const policyNames = [
  'employee_compensation_admin_delete_v2', 'employee_compensation_admin_insert_v2', 'employee_compensation_admin_update_v2',
  'employee_compensation_read_v2', 'employee_events_insert_v1', 'employee_events_self_read_v1',
  'employee_statements_admin_delete_v2', 'employee_statements_admin_insert_v2', 'employee_statements_admin_update_v2',
  'employee_statements_read_v2', 'manager_daily_checklist_self_v1', 'manager_weekly_evaluations_admin_delete_v2',
  'manager_weekly_evaluations_admin_insert_v2', 'manager_weekly_evaluations_admin_update_v2', 'manager_weekly_evaluations_read_v2',
];
const policyLines = fs.readFileSync(policiesFile, 'utf8').split('\n');
const policies = policyNames.map((n) => {
  const line = policyLines.find((l) => l.startsWith(`create policy ${n} on public.`));
  if (!line) throw new Error('missing policy ' + n);
  const table = line.match(/ on public\.(\w+) as /)[1];
  return `drop policy if exists ${n} on public.${table};\n${line}`;
});
const regrant = [
  'calculate_customer_loyalty_cycle_internal_v1(uuid,date,date,numeric,text,text)',
  'submit_customer_loyalty_approval_internal_v1(uuid,date,date,numeric,text,text,text)',
  'review_customer_loyalty_approval_internal_v1(uuid,text,text,text)',
  'insert_customer_points_ledger_internal_v1(jsonb)',
  'upsert_customer_loyalty_setting_internal_v1(jsonb)',
  'set_branch_daily_task_status(uuid,text,uuid,text,text,text)',
  'save_branch_sales_target_v2(uuid,text,numeric)',
].map((s) => `grant execute on function public.${s} to anon, authenticated;`);

const sql = `-- EMERGENCY ROLLBACK for the 20261017 security identity hardening candidates (090000-090600).
-- Restores the exact pre-change Production bodies (captured read-only 2026-10-16), the 15 policy
-- expressions and the 7 client grants. THIS RE-OPENS the x-dawaa-user-id and p_actor_id exposures:
-- use only for a confirmed functional emergency, then re-apply the forward fix.
-- Business rows are not touched. Run as one transaction.
begin;

-- 1. Function bodies (CREATE OR REPLACE keeps owner and EXECUTE grants).
${restoreBodies.map(fn).join('\n\n')}

-- 2. Policies: drop + recreate inside this transaction (never absent to other sessions).
${policies.join('\n')}

-- 3. Client grants removed by 20261017090600.
${regrant.join('\n')}

-- 4. Primitives introduced by 20261017090000 (nothing references them after step 1).
drop function if exists public.dawaa_bind_actor_v1(uuid);
drop function if exists public.dawaa_bind_actor_v1(text);
drop function if exists public.dawaa_request_context_is_client_v1();

commit;
`;
fs.writeFileSync(outFile, sql);
console.log('rollback written', outFile, sql.length, 'bytes');
