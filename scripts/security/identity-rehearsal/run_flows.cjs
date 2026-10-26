// Differential legitimate-flow test: identical calls, with the headers the real browser client sends
// (x-dawaa-session-token + the x-dawaa-user-id hint naming the SAME logged-in account), on
//   dawaa_sec_baseline   (Production-identical, pre-fix)  and
//   dawaa_sec_rehearsal  (candidate migrations applied).
// A legitimate flow must produce the same result (or a strictly more correct one, listed explicitly).
const { spawnSync } = require('child_process');
const fs = require('fs');
const ACC = {
  gm: 'a1000000-0000-4000-8000-000000000001', bm: 'a1000000-0000-4000-8000-000000000002',
  ph1: 'a1000000-0000-4000-8000-000000000003', ph2: 'a1000000-0000-4000-8000-000000000004',
  csm: 'a1000000-0000-4000-8000-000000000005',
};
const TOK = {
  gm: 'tok-gm-000000000000000000000000000000000001', bm: 'tok-bm-000000000000000000000000000000000002',
  ph1: 'tok-ph1-00000000000000000000000000000000003', ph2: 'tok-ph2-00000000000000000000000000000000004',
  csm: 'tok-csm-00000000000000000000000000000000005',
};
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
function run(db, who, sql) {
  const headers = { 'x-dawaa-session-token': TOK[who], 'x-dawaa-user-id': ACC[who] };
  const script = [
    '\\set ON_ERROR_STOP 1', 'begin;',
    `do $$ begin perform set_config('request.jwt.claims', ${q('{"role":"anon"}')}, true); perform set_config('request.headers', ${q(JSON.stringify(headers))}, true); end $$;`,
    'set local role anon;', sql.trim().replace(/;?$/, ';'), 'rollback;',
  ].join('\n');
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_dawaa-pharmacy', 'psql', '-U', 'postgres', '-d', db, '-At', '-q'], { input: script, encoding: 'utf8' });
  const err = (r.stderr || '').split('\n').find((l) => /ERROR/.test(l));
  return err ? 'ERROR: ' + err.replace(/^.*ERROR:\s*/, '') : (r.stdout || '').trim();
}
const today = '2026-10-17';
const flows = (who) => [
  ['identity: current staff id', 'select public.dawaa_current_staff_id_v1()'],
  ['identity: notification account', 'select public.dawaa_current_notification_account_id_v1()'],
  ['identity: active app session', 'select public.dawaa_has_active_app_session()'],
  ['identity: strict account', 'select public.dawaa_current_staff_account_id_strict()'],
  ['HR: monthly statements visible', 'select count(*) from public.employee_monthly_statements'],
  ['payroll: compensation visible', 'select count(*) from public.employee_compensation_profiles'],
  ['HR: employee events visible', 'select count(*) from public.employee_events'],
  ['HR: weekly evaluations visible', 'select count(*) from public.manager_weekly_evaluations'],
  ['HR: daily checklist visible', 'select count(*) from public.manager_daily_checklist'],
  ['HR: staff directory visible', 'select count(*) from public.staff'],
  ['payroll: deduction rules visible', 'select count(*) from public.deduction_rules'],
  ['payroll: reward rules visible', 'select count(*) from public.reward_rules'],
  ['notifications visible', 'select count(*) from public.notifications'],
  ['tasks visible', 'select count(*) from public.tasks'],
  ['warehouse dispatches visible', 'select count(*) from public.warehouse_shortage_dispatches'],
  ['HR weekly: subjects list', `select count(*) from public.list_weekly_manager_evaluation_subjects_v1('${ACC[who]}', null)`],
  ['HR weekly: cached metrics', `select count(*) from public.get_weekly_manager_metrics_cached_v1('${ACC[who]}', null, null, date '2026-10-10', date '2026-10-16')`],
  ['HR monthly: staff list v5', `select count(*) from public.list_staff_for_monthly_evaluation_v5('${ACC[who]}', null, date '2026-10-01')`],
  ['sales target: can manage', `select public.dawaa_can_manage_branch_targets('${ACC[who]}')`],
  ['sales target: set via editor', `select (public.set_branch_sales_target('فرع شكري', 111111, '${ACC[who]}')).target_amount`],
  ['CS: queue scope', `select public.dawaa_customer_service_queue_scope_v3('${ACC[who]}')`],
  ['CS: daily20 queue', `select count(*) from public.get_customer_points_daily20_v2(date '${today}', '${ACC[who]}')`],
  ['CS: intelligence manage', `select public.dawaa_can_manage_customer_intelligence_v2('${ACC[who]}')`],
  ['CS: followup performance', `select public.customer_followup_performance_v1('${ACC[who]}', null, date '2026-10-01', date '${today}') is not null`],
  ['CS: followup records', `select public.get_customer_followup_records_v1('${ACC[who]}', null, null, null, date '2026-10-01', date '${today}', 10, 0) is not null`],
  ['roles: app_staff_role(self)', `select public.app_staff_role('${ACC[who]}')`],
  ['roles: app_role_allowed(self, managers)', `select public.app_role_allowed('${ACC[who]}', array['general_manager','branch_manager','customer_service_manager'])`],
  ['reviews: can read own-branch row', `select public.dawaa_can_read_conversation_review_row_v2(public.dawaa_current_staff_account_id_strict(), null, null, 'فرع شكري', null)`],
  ['points wrapper: ledger insert permission path', `select public.insert_customer_points_ledger('{"customer_code":"1","points_amount":1,"transaction_type":"credit","branch":"فرع شكري"}'::jsonb) is not null`],
  ['loyalty wrapper reaches internal', `select public.calculate_customer_loyalty_cycle(gen_random_uuid(), date '2026-09-01', date '2026-09-30', 1, null, null)`],
];
// Explicitly expected, strictly-more-correct differences (documented in the report):
const knownBetter = new Set([]);
const out = [];
let same = 0, diff = 0;
for (const who of ['gm', 'bm', 'ph1', 'ph2', 'csm']) {
  for (const [name, sql] of flows(who)) {
    const a = run('dawaa_sec_baseline', who, sql);
    const b = run('dawaa_sec_rehearsal', who, sql);
    const key = `${who} :: ${name}`;
    const equal = a === b;
    equal ? same++ : diff++;
    out.push({ who, name, baseline: a.slice(0, 160), rehearsal: b.slice(0, 160), equal });
    if (!equal) console.log(`DIFF ${key}\n   baseline : ${a.slice(0, 150)}\n   rehearsal: ${b.slice(0, 150)}`);
  }
}
console.log(`\nFLOWS: ${same} identical, ${diff} different, ${same + diff} calls`);
fs.writeFileSync(process.argv[2] || 'results_flows.json', JSON.stringify(out, null, 1));
