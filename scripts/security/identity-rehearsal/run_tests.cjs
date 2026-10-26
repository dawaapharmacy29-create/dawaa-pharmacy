// Security rehearsal test runner for the ISOLATED clone database dawaa_sec_rehearsal (local Docker only).
// Every case runs in its own transaction that ends with ROLLBACK, exactly like one PostgREST request:
// request.jwt.claims + request.headers GUCs, SET LOCAL ROLE anon|service_role, one statement.
// Usage: node run_tests.cjs <pre|post> [outfile]
const { spawnSync } = require('child_process');
const fs = require('fs');
const phase = process.argv[2] || 'post';
const DB = 'dawaa_sec_rehearsal';
const ACC = {
  gm: 'a1000000-0000-4000-8000-000000000001', bm: 'a1000000-0000-4000-8000-000000000002',
  ph1: 'a1000000-0000-4000-8000-000000000003', ph2: 'a1000000-0000-4000-8000-000000000004',
  csm: 'a1000000-0000-4000-8000-000000000005',
};
const STAFF = {
  gm: '51000000-0000-4000-8000-000000000001', bm: '51000000-0000-4000-8000-000000000002',
  ph1: '51000000-0000-4000-8000-000000000003', ph2: '51000000-0000-4000-8000-000000000004',
};
const TOK = {
  gm: 'tok-gm-000000000000000000000000000000000001', bm: 'tok-bm-000000000000000000000000000000000002',
  ph1: 'tok-ph1-00000000000000000000000000000000003', ph2: 'tok-ph2-00000000000000000000000000000000004',
  csm: 'tok-csm-00000000000000000000000000000000005',
};
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function run({ session, forged, role = 'anon' }, sql) {
  const headers = {};
  if (session) headers['x-dawaa-session-token'] = TOK[session];
  if (forged) headers['x-dawaa-user-id'] = forged;
  const claims = { role };
  const script = [
    '\\set ON_ERROR_STOP 1',
    'begin;',
    `do $$ begin perform set_config('request.jwt.claims', ${q(JSON.stringify(claims))}, true); perform set_config('request.headers', ${q(JSON.stringify(headers))}, true); end $$;`,
    `set local role ${role};`,
    sql.trim().replace(/;?$/, ';'),
    'rollback;',
  ].join('\n');
  const r = spawnSync('docker', ['exec', '-i', 'supabase_db_dawaa-pharmacy', 'psql', '-U', 'postgres', '-d', DB, '-At', '-q'], {
    input: script, encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  });
  const err = (r.stderr || '').split('\n').find((l) => /ERROR/.test(l));
  if (err) return 'ERROR: ' + err.replace(/^.*ERROR:\s*/, '');
  return (r.stdout || '').trim();
}

const isErr = (v) => v.startsWith('ERROR');
const denied = (v) => isErr(v) && /permission denied|not_authorized|unauthorized|not allowed|row-level security|ليس لديك|غير مصرح/i.test(v);
const eq = (x) => (v) => v === String(x);
const zeroOrDenied = (v) => v === '0' || v === '' || denied(v);

// Each case: [group, name, context, sql, expectPre, expectPost]
// expectPre documents the CURRENT (Production-identical) behaviour; expectPost is the security requirement.
const cases = [
  // ---------------- C) No session ----------------
  ['C no-session', 'statements visible', {}, 'select count(*) from public.employee_monthly_statements', eq(0), eq(0)],
  ['C no-session', 'compensation visible', {}, 'select count(*) from public.employee_compensation_profiles', eq(0), eq(0)],
  ['C no-session', 'staff visible', {}, 'select count(*) from public.staff', eq(0), eq(0)],
  ['C no-session', 'weekly evaluations visible', {}, 'select count(*) from public.manager_weekly_evaluations', eq(0), eq(0)],
  ['C no-session', 'insert monthly statement', {}, `with x as (insert into public.employee_monthly_statements(id,staff_id,staff_name,cycle_start) values (gen_random_uuid(),'${STAFF.ph1}','x','2026-09-26') returning 1) select count(*) from x`, denied, denied],
  ['C no-session', 'has_active_app_session()', {}, 'select public.dawaa_has_active_app_session()', eq('f'), eq('f')],

  // ---------------- D) Forged x-dawaa-user-id (no session) ----------------
  ['D forged-header', 'current_staff_id_v1 = GM staff id', { forged: ACC.gm }, 'select coalesce(public.dawaa_current_staff_id_v1(), \'<null>\')', eq(STAFF.gm), eq('<null>')],
  ['D forged-header', 'notification account = GM', { forged: ACC.gm }, 'select coalesce(public.dawaa_current_notification_account_id_v1(), \'<null>\')', eq(ACC.gm), eq('<null>')],
  ['D forged-header', 'has_active_app_session', { forged: ACC.gm }, 'select public.dawaa_has_active_app_session()', eq('t'), eq('f')],
  ['D forged-header', 'payroll statement of impersonated victim readable', { forged: ACC.gm }, "select coalesce(string_agg(staff_id, ','),'<none>') from public.employee_monthly_statements", eq(STAFF.gm), eq('<none>')],
  ['D forged-header', 'compensation of impersonated victim readable', { forged: ACC.gm }, 'select count(*) from public.employee_compensation_profiles', eq(1), eq(0)],
  ['D forged-header', 'employee events of victim readable', { forged: ACC.gm }, 'select count(*) from public.employee_events', eq(1), eq(0)],
  ['D forged-header', 'staff readable', { forged: ACC.gm }, 'select count(*) from public.staff', eq(5), eq(0)],
  ['D forged-header', 'weekly evaluations of victim readable', { forged: ACC.gm }, 'select count(*) from public.manager_weekly_evaluations', eq(1), eq(0)],
  ['D forged-header', 'insert monthly statement (write)', { forged: ACC.gm }, `with x as (insert into public.employee_monthly_statements(id,staff_id,staff_name,cycle_start) values (gen_random_uuid(),'${STAFF.ph1}','forged','2026-09-26') returning 1) select count(*) from x`, denied, denied],
  ['D forged-header', 'update victim daily checklist (write)', { forged: ACC.gm }, 'with x as (update public.manager_daily_checklist set completed=true returning 1) select count(*) from x', eq(1), zeroOrDenied],
  ['D forged-header', 'delete weekly evaluations (write)', { forged: ACC.gm }, 'with x as (delete from public.manager_weekly_evaluations returning 1) select count(*) from x', zeroOrDenied, zeroOrDenied],
  // forged header + a real low-privilege session must not elevate
  ['D forged-header+session', 'PH2 session + GM header: whose statement', { session: 'ph2', forged: ACC.gm }, "select coalesce(string_agg(staff_id, ','),'<none>') from public.employee_monthly_statements", eq(STAFF.gm), eq(STAFF.ph2)],
  ['D forged-header+session', 'PH2 session + GM header: identity', { session: 'ph2', forged: ACC.gm }, 'select public.dawaa_current_staff_id_v1()', eq(STAFF.gm), eq(STAFF.ph2)],

  // ---------------- A) Valid manager session ----------------
  ['A manager', 'GM identity from session only', { session: 'gm' }, "select coalesce(public.dawaa_current_staff_id_v1(),'<null>')", eq('<null>'), eq(STAFF.gm)],
  ['A manager', 'GM notification account', { session: 'gm' }, 'select public.dawaa_current_notification_account_id_v1()', (v) => v === ACC.gm || v === '', eq(ACC.gm)],
  ['A manager', 'GM has_active_app_session', { session: 'gm' }, 'select public.dawaa_has_active_app_session()', (v) => v === 't' || v === 'f', eq('t')],
  ['A manager', 'GM reads all statements', { session: 'gm' }, 'select count(*) from public.employee_monthly_statements', (v) => /^\d+$/.test(v), eq(5)],
  ['A manager', 'GM reads all compensation', { session: 'gm' }, 'select count(*) from public.employee_compensation_profiles', (v) => /^\d+$/.test(v), eq(5)],
  ['A manager', 'GM reads all weekly evaluations', { session: 'gm' }, 'select count(*) from public.manager_weekly_evaluations', (v) => /^\d+$/.test(v), eq(2)],
  ['A manager', 'GM inserts monthly statement', { session: 'gm' }, `with x as (insert into public.employee_monthly_statements(id,staff_id,staff_name,cycle_start) values (gen_random_uuid(),'${STAFF.ph1}','gm-write','2026-09-26') returning 1) select count(*) from x`, (v) => true, eq(1)],
  ['A manager', 'GM sets branch sales target', { session: 'gm' }, `select (public.set_branch_sales_target('فرع شكري', 123456, '${ACC.gm}')).target_amount`, (v) => true, eq('123456')],
  ['A manager', 'GM sets target with p_actor_id NULL', { session: 'gm' }, `select (public.set_branch_sales_target('فرع شكري', 123457, null)).target_amount`, (v) => true, eq('123457')],
  ['A manager', 'GM queue scope', { session: 'gm' }, `select coalesce(public.dawaa_customer_service_queue_scope_v3('${ACC.gm}'),'<null>')`, (v) => true, (v) => v !== '<null>' && !isErr(v)],

  // ---------------- B) Valid normal staff session ----------------
  ['B staff', 'PH1 reads own statement only', { session: 'ph1' }, 'select count(*) from public.employee_monthly_statements', (v) => true, eq(1)],
  ['B staff', 'PH1 reads own compensation only', { session: 'ph1' }, 'select count(*) from public.employee_compensation_profiles', (v) => true, eq(1)],
  ['B staff', 'PH1 reads own weekly evaluation only', { session: 'ph1' }, 'select count(*) from public.manager_weekly_evaluations', (v) => true, eq(1)],
  ['B staff', 'PH1 cannot insert statement', { session: 'ph1' }, `with x as (insert into public.employee_monthly_statements(id,staff_id,staff_name,cycle_start) values (gen_random_uuid(),'${STAFF.ph1}','self','2026-09-26') returning 1) select count(*) from x`, denied, denied],
  ['B staff', 'PH1 cannot set sales target', { session: 'ph1' }, `select (public.set_branch_sales_target('فرع شكري', 1, null)).target_amount`, denied, denied],
  ['B staff', 'PH1 updates only own checklist', { session: 'ph1' }, 'with x as (update public.manager_daily_checklist set completed=true returning 1) select count(*) from x', (v) => true, eq(1)],

  // ---------------- E) Forged p_actor_id ----------------
  ['E forged-actor', 'PH1 session + p_actor_id=GM sets sales target', { session: 'ph1' }, `select (public.set_branch_sales_target('فرع شكري', 999, '${ACC.gm}')).target_amount`, eq('999'), denied],
  ['E forged-actor', 'no session + p_actor_id=GM sets sales target', {}, `select (public.set_branch_sales_target('فرع شكري', 998, '${ACC.gm}')).target_amount`, eq('998'), denied],
  ['E forged-actor', 'no session save_branch_sales_target_v2(GM)', {}, `select (public.save_branch_sales_target_v2('${ACC.gm}','فرع شكري', 997)) is not null`, eq('t'), denied],
  ['E forged-actor', 'PH2 session queue scope as GM', { session: 'ph2' }, `select coalesce(public.dawaa_customer_service_queue_scope_v3('${ACC.gm}'),'<null>')`, (v) => true, (v) => v !== '*' && !/ALL/i.test(v)],
  ['E forged-actor', 'PH2 session queue scope equals own scope', { session: 'ph2' }, `select coalesce(public.dawaa_customer_service_queue_scope_v3('${ACC.gm}'),'<null>') = coalesce(public.dawaa_customer_service_queue_scope_v3(null),'<null>')`, eq('f'), eq('t')],
  ['E forged-actor', 'no session app_staff_role(GM)', {}, `select coalesce(public.app_staff_role('${ACC.gm}'),'<null>')`, eq('general_manager'), eq('<null>')],
  ['E forged-actor', 'no session app_role_allowed(GM, managers)', {}, `select public.app_role_allowed('${ACC.gm}', array['general_manager'])`, eq('t'), eq('f')],
  ['E forged-actor', 'PH1 can_manage_customer_intelligence(GM)', { session: 'ph1' }, `select public.dawaa_can_manage_customer_intelligence_v2('${ACC.gm}')`, eq('t'), eq('f')],
  ['E forged-actor', 'PH1 can_manage_branch_targets(GM)', { session: 'ph1' }, `select public.dawaa_can_manage_branch_targets('${ACC.gm}')`, eq('t'), eq('f')],
  ['E forged-actor', 'no session review_row_v2(GM, other staff)', {}, `select public.dawaa_can_read_conversation_review_row_v2('${ACC.gm}', '${STAFF.ph2}', null, 'فرع الشامي', null)`, eq('t'), eq('f')],
  ['E forged-actor', 'no session set_branch_daily_task_status approve', {}, `select (public.set_branch_daily_task_status('b0000000-0000-4000-8000-000000000001','approved','${ACC.gm}','x','forged',null)).status`, eq('approved'), denied],
  ['E forged-actor', 'no session submit loyalty internal (GM)', {}, `select public.submit_customer_loyalty_approval_internal_v1(gen_random_uuid(), '2026-09-01','2026-09-30', 1, 'x', '${ACC.gm}', 'GM')`, (v) => !/ليس لديك صلاحية إنشاء/.test(v), denied],
  ['E forged-actor', 'no session calculate loyalty internal (GM)', {}, `select public.calculate_customer_loyalty_cycle_internal_v1(gen_random_uuid(), '2026-09-01','2026-09-30', 1, '${ACC.gm}', 'GM')`, (v) => true, denied],
  ['E forged-actor', 'no session insert points ledger internal', {}, `select public.insert_customer_points_ledger_internal_v1('{"created_by":"${ACC.gm}"}'::jsonb)`, (v) => true, denied],
  ['E forged-actor', 'no session upsert loyalty setting internal', {}, `select public.upsert_customer_loyalty_setting_internal_v1('{"created_by":"${ACC.gm}"}'::jsonb)`, (v) => true, denied],
  ['E forged-actor', 'PH2 weekly subjects as GM', { session: 'ph2' }, `select count(*) from public.list_weekly_manager_evaluation_subjects_v1('${ACC.gm}', null)`, (v) => true, (v) => v === '0' || denied(v)],

  // ---------------- F) Wrong branch ----------------
  ['F cross-branch', 'PH2 (shamy) reads shokry statements', { session: 'ph2' }, `select count(*) from public.employee_monthly_statements where branch='فرع شكري'`, (v) => true, eq(0)],
  ['F cross-branch', 'BM (shokry) cannot update PH2 checklist', { session: 'bm' }, `with x as (update public.manager_daily_checklist set completed=true where staff_id='${STAFF.ph2}' returning 1) select count(*) from x`, (v) => true, eq(0)],
  ['F cross-branch', 'BM (shokry) cannot insert weekly evaluation', { session: 'bm' }, `with x as (insert into public.manager_weekly_evaluations(id,evaluation_type,subject_staff_id,branch,week_start,week_end,status) values (gen_random_uuid(),'pharmacist','${STAFF.ph2}','فرع الشامي','2026-10-10','2026-10-16','draft') returning 1) select count(*) from x`, (v) => true, (v) => v === '1' || denied(v)],
  ['F cross-branch', 'PH2 queue scope is own branch only', { session: 'ph2' }, `select coalesce(public.dawaa_customer_service_queue_scope_v3(null),'<null>')`, (v) => true, (v) => !/\*|ALL/.test(v)],

  // ---------------- server context (cron / service_role) passthrough ----------------
  ['S server', 'service_role bind passthrough uuid', { role: 'service_role' }, `select public.dawaa_bind_actor_v1('${ACC.gm}'::uuid)`, (v) => true, eq(ACC.gm)],
  ['S server', 'service_role bind passthrough text', { role: 'service_role' }, `select public.dawaa_bind_actor_v1('system'::text)`, (v) => true, eq('system')],
  ['S server', 'service_role can still call loyalty internal', { role: 'service_role' }, `select has_function_privilege('service_role','public.submit_customer_loyalty_approval_internal_v1(uuid,date,date,numeric,text,text,text)','execute')`, eq('t'), eq('t')],
];

const results = [];
let pass = 0, fail = 0;
for (const [group, name, ctx, sql, pre, post] of cases) {
  const v = run(ctx, sql);
  const ok = (phase === 'pre' ? pre : post)(v);
  ok ? pass++ : fail++;
  results.push({ group, name, ctx: JSON.stringify(ctx), value: v.slice(0, 160), ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${group}] ${name} -> ${v.slice(0, 140)}`);
}
console.log(`\n${phase.toUpperCase()}: ${pass} pass, ${fail} fail, ${cases.length} cases`);
if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify({ phase, pass, fail, results }, null, 1));
process.exit(fail ? 1 : 0);
