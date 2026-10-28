#!/usr/bin/env node
// WhatsApp Master Brain — native PostgreSQL 17 verification (concurrency + lifecycle + finance).
//
// Runs ONLY against a local, network-isolated Docker container (default name
// dawaa-mb-verify-pg, started with --network none). Every scenario creates its own throw-away
// database from scripts/verification/fixtures/master-brain-native.sql plus the four reviewed
// migrations. No URLs, credentials, production data or remote databases are involved.
//
//   docker run -d --name dawaa-mb-verify-pg --network none -e POSTGRES_PASSWORD=local \
//     public.ecr.aws/supabase/postgres:17.6.1.132
//   node scripts/verification/test-master-brain-native-pg.mjs
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const CONTAINER = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-mb-verify-pg';
const ADMIN = 'supabase_admin';
const MIGRATIONS = [
  '20261026090000_whatsapp_action_materialization_lifecycle_v1.sql',
  '20261026091000_monthly_official_conversation_reviews_v1.sql',
  '20261026092000_customer_followup_obligations_v1.sql',
  '20261026093000_conversation_review_points_follow_approval_v1.sql',
  '20261026094000_conversation_reviews_official_view_truth_v1.sql',
];

const inspect = spawnSync('docker', ['inspect', '-f', '{{.HostConfig.NetworkMode}} {{.State.Running}}', CONTAINER], { encoding: 'utf8' });
if (inspect.status !== 0 || (inspect.stdout ?? '').trim() !== 'none true') {
  const detail = inspect.error?.message || (inspect.stdout ?? '').trim() || (inspect.stderr ?? '').trim() || 'docker unavailable';
  console.error(`[native-pg] container ${CONTAINER} must be running with --network none (got: ${detail})`);
  process.exit(2);
}

function psql(db, sql, { user = ADMIN } = {}) {
  return new Promise((done) => {
    const child = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-X', '-q', '-A', '-t', '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => done({ code, out: out.trim(), err: err.trim() }));
    child.stdin.end(sql);
  });
}
async function ok(db, sql) {
  const r = await psql(db, sql);
  if (r.code !== 0) throw new Error(`SQL failed: ${r.err}\n--- ${sql.slice(0, 400)}`);
  return r.out;
}
async function json(db, sql) {
  const out = await ok(db, sql);
  const last = out.split('\n').filter(Boolean).pop();
  return JSON.parse(last);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let counter = 0;
async function freshDb() {
  const db = `mb_${process.pid}_${++counter}`;
  await ok('postgres', `drop database if exists ${db}; create database ${db};`);
  await ok(db, readFileSync(resolve('scripts/verification/fixtures/master-brain-native.sql'), 'utf8'));
  for (const m of MIGRATIONS) await ok(db, readFileSync(resolve('supabase/migrations', m), 'utf8'));
  return db;
}
async function dropDb(db) { await psql('postgres', `drop database if exists ${db} with (force);`); }

const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE = '62f56d32-0000-4000-8000-000000000001';
const CUSTOMER = 'c959b2ed-0000-4000-8000-000000000001';
const CASE = `${SOURCE}:interaction:0:session:0`;
const ANALYSIS = '4a5ccf3f-0000-4000-8000-000000000001';
const FU_KEY = 'fu1|chat:test|2026-09-27T16:04:00.000Z|callback-requested|-';
const CP_KEY = 'fu1|chat:test|2026-09-27T16:04:00.000Z|complaint-followup|-';
const AS = `set test.actor='${ACTOR}';`;

// The Dr. Donia shape: one conversation, a callback request and a complaint for the same
// customer and branch, both `ready`, unassigned, without a target.
async function seedDonia(db) {
  await ok(db, `
    insert into staff_accounts(id, staff_id, username, name, role, staff_role, branch) values
      ('${ACTOR}', 'cs-staff-1', 'cs1', 'خدمة عملاء', 'customer_service_manager', 'customer_service', 'فرع شكري');
    insert into whatsapp_review_sources(id, customer_id, customer_name, customer_code, branch) values
      ('${SOURCE}', '${CUSTOMER}', 'عميل اختبار', '9001', 'فرع شكري');
    insert into sales_intelligence_case_analyses(analysis_id, case_id, evidence_snapshot) values
      ('${ANALYSIS}', '${CASE}', '${JSON.stringify({
        caseIntelligence: { followUp: { opportunities: [{ followUpKey: FU_KEY, status: 'actionable', blocker: null, customerId: CUSTOMER, reason: 'callback_requested' }] } },
        canonicalComplaintAssessment: { caseId: CASE, state: 'recovery_attempted', complaintMessageIds: ['m-complaint'] },
      })}');
    insert into sales_intelligence_cases(case_id, conversation_id, published_analysis_id) values ('${CASE}', '${SOURCE}', '${ANALYSIS}');
    insert into whatsapp_conversation_actions(source_id, action_key, action_type, status, branch, customer_id, customer_code, customer_name,
      due_at, reason, payload, followup_identity, created_by) values
      ('${SOURCE}', 'canonical-followup:${FU_KEY}', 'customer_followup', 'ready', 'فرع شكري', '${CUSTOMER}', '9001', 'عميل اختبار',
       '2026-09-28T09:00:00Z', 'العميل طلب معاودة التواصل',
       '{"caseId":"${CASE}","canonicalLifecycle":"active","canonicalAnalysisId":"${ANALYSIS}","canonicalReason":"callback_requested"}',
       '${FU_KEY}', 'si-canonical-followup-projection-v1'),
      ('${SOURCE}', 'canonical-complaint:${CP_KEY}', 'complaint_followup', 'ready', 'فرع شكري', '${CUSTOMER}', '9001', 'عميل اختبار',
       '2026-09-27T16:04:00Z', 'شكوى عميل', '{"caseId":"${CASE}","complaintMessageIds":["m-complaint"]}',
       '${CP_KEY}', 'si-canonical-complaint-projection-v1');`);
  const ids = await json(db, `select json_object_agg(action_type, id) from whatsapp_conversation_actions;`);
  return { followup: ids.customer_followup, complaint: ids.complaint_followup };
}

const counts = (db) => json(db, `select json_build_object(
  'tasks', (select count(*) from daily_followups),
  'open_tasks', (select count(*) from daily_followups where completed_at is null and cancelled_at is null),
  'obligations', (select count(*) from customer_followup_obligations),
  'open_obligations', (select count(*) from customer_followup_obligations where status='open'),
  'created_actions', (select count(*) from whatsapp_conversation_actions where status='created' and target_id is not null));`);

const results = [];
async function scenario(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.stack || error) });
    console.log(`  ✗ ${name}\n${String(error?.stack || error)}`);
  }
}

console.log(`[native-pg] ${(await ok('postgres', 'select version()')).split(' on ')[0]} in container ${CONTAINER} (network none)`);

await scenario('Donia: two ready actions -> one execution task, two independent obligations, own due dates', async () => {
  const db = await freshDb();
  try {
    const a = await seedDonia(db);
    await ok(db, `${AS} select dawaa_materialize_whatsapp_action_v1('${a.followup}');`);
    await ok(db, `${AS} select dawaa_materialize_whatsapp_action_v1('${a.complaint}');`);
    assert.deepEqual(await counts(db), { tasks: 1, open_tasks: 1, obligations: 2, open_obligations: 2, created_actions: 2 });
    const obligations = await json(db, `select json_agg(json_build_object('type', obligation_type, 'due', due_date, 'key', client_request_id) order by obligation_type) from customer_followup_obligations;`);
    assert.deepEqual(obligations.map((o) => [o.type, o.due]), [['complaint', '2026-09-27'], ['general', '2026-09-28']]);
    assert.ok(obligations.every((o) => o.key.startsWith('whatsapp-action:')));
    const task = await json(db, `select json_build_object('due', next_followup_date, 'targets', (select count(distinct target_id) from whatsapp_conversation_actions)) from daily_followups;`);
    assert.equal(task.due, '2026-09-27'); // earliest promise, not overwritten by the later request
    assert.equal(task.targets, 1);
    // Retry of both actions: idempotent, no duplicate task or obligation.
    const retry = await json(db, `${AS} select dawaa_materialize_whatsapp_action_v1('${a.complaint}');`);
    assert.equal(retry.already_created, true);
    assert.deepEqual(await counts(db), { tasks: 1, open_tasks: 1, obligations: 2, open_obligations: 2, created_actions: 2 });
  } finally { await dropDb(db); }
});

await scenario('Donia: closing the complaint never closes the callback; the task cannot close with two open obligations', async () => {
  const db = await freshDb();
  try {
    const a = await seedDonia(db);
    await ok(db, `${AS} select dawaa_materialize_whatsapp_action_v1('${a.followup}'); select dawaa_materialize_whatsapp_action_v1('${a.complaint}');`);
    const blocked = await psql(db, `update daily_followups set completed_at = now(), followup_status = 'تم';`);
    assert.notEqual(blocked.code, 0);
    assert.match(blocked.err, /followup_task_has_open_obligations/);
    const complaint = await ok(db, `select id from customer_followup_obligations where obligation_type='complaint';`);
    const closed = await json(db, `${AS} select dawaa_close_customer_followup_obligation_v1('${complaint}', 'fulfilled', 'تم حل الشكوى واستبدال العلبة');`);
    assert.equal(closed.open_obligations_remaining, 1);
    const state = await json(db, `select json_object_agg(obligation_type, status) from customer_followup_obligations;`);
    assert.deepEqual(state, { complaint: 'fulfilled', general: 'open' });
    assert.deepEqual(await counts(db), { tasks: 1, open_tasks: 1, obligations: 2, open_obligations: 1, created_actions: 2 });
    assert.equal(await ok(db, 'select next_followup_date from daily_followups;'), '2026-09-28');
    // Replay of the same close is idempotent; a conflicting close is refused.
    const replay = await json(db, `${AS} select dawaa_close_customer_followup_obligation_v1('${complaint}', 'fulfilled', 'تم حل الشكوى واستبدال العلبة');`);
    assert.equal(replay.idempotent_replay, true);
    const conflict = await psql(db, `${AS} select dawaa_close_customer_followup_obligation_v1('${complaint}', 'cancelled', 'غير ذلك');`);
    assert.match(conflict.err, /obligation_already_closed/);
    // With one open obligation left, closing the task closes exactly that one with the task outcome.
    await ok(db, `update daily_followups set completed_at = now(), followup_status = 'تم التواصل';`);
    const final = await json(db, `select json_object_agg(obligation_type, json_build_object('status', status, 'outcome', outcome)) from customer_followup_obligations;`);
    assert.deepEqual(final, { complaint: { status: 'fulfilled', outcome: 'تم حل الشكوى واستبدال العلبة' }, general: { status: 'fulfilled', outcome: 'تم التواصل' } });
  } finally { await dropDb(db); }
});

await scenario('Duplicate merge moves open obligations to the surviving task (none lost)', async () => {
  const db = await freshDb();
  try {
    const a = await seedDonia(db);
    await ok(db, `${AS} select dawaa_materialize_whatsapp_action_v1('${a.followup}'); select dawaa_materialize_whatsapp_action_v1('${a.complaint}');`);
    await ok(db, `insert into daily_followups(id, branch, identity_key, customer_name, status) values ('survivor', 'فرع شكري', 'other-identity', 'عميل اختبار', 'not_started');`);
    await ok(db, `update daily_followups set duplicate_of = 'survivor', is_duplicate = true where id <> 'survivor';`);
    const moved = await json(db, `select json_build_object('on_survivor', count(*) filter (where followup_id='survivor' and status='open'), 'total', count(*)) from customer_followup_obligations;`);
    assert.deepEqual(moved, { on_survivor: 2, total: 2 });
  } finally { await dropDb(db); }
});

await scenario('Concurrency: the same action executed by two sessions at once -> one task, one obligation', async () => {
  const db = await freshDb();
  try {
    const a = await seedDonia(db);
    const run = () => psql(db, `${AS} begin; select dawaa_materialize_whatsapp_action_v1('${a.complaint}'); select pg_sleep(1.2); commit;`);
    const [x, y] = await Promise.all([run(), sleep(200).then(run)]);
    assert.equal(x.code, 0, x.err);
    assert.equal(y.code, 0, y.err);
    const outputs = [x.out, y.out].map((o) => JSON.parse(o.split('\n').filter((l) => l.startsWith('{')).pop()));
    assert.deepEqual(outputs.map((o) => o.already_created).sort(), [false, true]);
    assert.deepEqual(await counts(db), { tasks: 1, open_tasks: 1, obligations: 1, open_obligations: 1, created_actions: 1 });
  } finally { await dropDb(db); }
});

await scenario('Concurrency: both Donia actions executed at once -> one task, two obligations, no lost request', async () => {
  const db = await freshDb();
  try {
    const a = await seedDonia(db);
    const run = (id) => psql(db, `${AS} begin; select dawaa_materialize_whatsapp_action_v1('${id}'); select pg_sleep(1.2); commit;`);
    const [x, y] = await Promise.all([run(a.followup), sleep(150).then(() => run(a.complaint))]);
    assert.equal(x.code, 0, x.err);
    assert.equal(y.code, 0, y.err);
    assert.deepEqual(await counts(db), { tasks: 1, open_tasks: 1, obligations: 2, open_obligations: 2, created_actions: 2 });
  } finally { await dropDb(db); }
});

await scenario('Concurrency: a task close racing a new linked request is refused, the request is kept', async () => {
  const db = await freshDb();
  try {
    const a = await seedDonia(db);
    await ok(db, `${AS} select dawaa_materialize_whatsapp_action_v1('${a.followup}');`);
    const link = psql(db, `${AS} begin; select dawaa_materialize_whatsapp_action_v1('${a.complaint}'); select pg_sleep(1.5); commit;`);
    await sleep(400);
    const close = await psql(db, `update daily_followups set completed_at = now(), followup_status = 'تم';`);
    const linked = await link;
    assert.equal(linked.code, 0, linked.err);
    assert.notEqual(close.code, 0);
    assert.match(close.err, /followup_task_has_open_obligations/);
    assert.deepEqual(await counts(db), { tasks: 1, open_tasks: 1, obligations: 2, open_obligations: 2, created_actions: 2 });
  } finally { await dropDb(db); }
});

await scenario('Concurrency: two sessions closing the same obligation -> exactly one outcome recorded', async () => {
  const db = await freshDb();
  try {
    const a = await seedDonia(db);
    await ok(db, `${AS} select dawaa_materialize_whatsapp_action_v1('${a.followup}'); select dawaa_materialize_whatsapp_action_v1('${a.complaint}');`);
    const id = await ok(db, `select id from customer_followup_obligations where obligation_type='complaint';`);
    const close = (outcome) => psql(db, `${AS} begin; select dawaa_close_customer_followup_obligation_v1('${id}', 'fulfilled', '${outcome}'); select pg_sleep(1); commit;`);
    const [x, y] = await Promise.all([close('النتيجة أ'), sleep(150).then(() => close('النتيجة ب'))]);
    assert.equal([x, y].filter((r) => r.code === 0).length, 1);
    assert.match([x, y].find((r) => r.code !== 0).err, /obligation_already_closed/);
    const events = await ok(db, `select count(*) from customer_service_followup_events where event_type='obligation_closed';`);
    assert.equal(events, '1');
  } finally { await dropDb(db); }
});

await scenario('Stale complaint after reanalysis cannot be executed (current-projection guard)', async () => {
  const db = await freshDb();
  try {
    const a = await seedDonia(db);
    await ok(db, `update sales_intelligence_case_analyses set evidence_snapshot = jsonb_set(evidence_snapshot, '{canonicalComplaintAssessment,state}', '"resolved"');`);
    const r = await psql(db, `${AS} select dawaa_materialize_whatsapp_action_v1('${a.complaint}');`);
    assert.match(r.err, /canonical_complaint_requires_current_projection/);
    assert.deepEqual(await counts(db), { tasks: 0, open_tasks: 0, obligations: 0, open_obligations: 0, created_actions: 0 });
  } finally { await dropDb(db); }
});

const STAFF = '44444444-4444-4444-8444-444444444444';
async function seedReview(db, id, fields) {
  const cols = { id, staff_id: STAFF, conversation_date: '2026-10-05T10:00:00Z', final_score: 90, total_score: 90, impact_status: 'approved', point_impact: 5, doctor_points_impact: 5, reviewer_id: 'cs-reviewer', reviewer_role: 'team_dawaa_alpha', evaluation_kind: 'واتساب', ...fields };
  const keys = Object.keys(cols);
  await ok(db, `insert into conversation_sales_reviews(${keys.join(',')}) values (${keys.map((k) => cols[k] === null ? 'null' : `'${cols[k]}'`).join(',')});`);
}
const tx = (db, review, status, delta = 5) => psql(db, `insert into employee_transactions(staff_id, points, points_delta, source, source_id, status, month_cycle) values ('${STAFF}', ${Math.abs(delta)}, ${delta}, 'conversation_evaluation', '${review}', '${status}', '2026-10');`);
const txStatus = (db, review) => ok(db, `select string_agg(status, ',' order by created_at) from employee_transactions where source_id = '${review}';`);

await scenario('Finance: only officially approved reviews can carry payable points', async () => {
  const db = await freshDb();
  try {
    const human = '10000000-0000-4000-8000-000000000001';
    const pending = '10000000-0000-4000-8000-000000000002';
    const auto = '10000000-0000-4000-8000-000000000003';
    const autoMgr = '10000000-0000-4000-8000-000000000004';
    const superseded = '10000000-0000-4000-8000-000000000005';
    await seedReview(db, human, {});
    await seedReview(db, pending, { impact_status: 'pending' });
    await seedReview(db, auto, { evaluation_kind: 'automatic', automatic_evaluation_version: 'auto-v1', reviewer_id: null, reviewer_role: null });
    await seedReview(db, autoMgr, { evaluation_kind: 'automatic', automatic_evaluation_version: 'auto-v1', reviewer_id: null, manager_reviewed_at: '2026-10-06T10:00:00Z', manager_reviewed_by: 'manager-1' });
    await seedReview(db, superseded, { is_current: false, superseded_at: '2026-10-07T00:00:00Z' });
    assert.equal((await tx(db, human, 'approved')).code, 0, 'customer-service approved review is payable without a general-manager review');
    assert.match((await tx(db, pending, 'approved')).err, /conversation_review_points_require_approved_review/);
    assert.equal((await tx(db, pending, 'pending')).code, 0, 'pending points stay visible, not payable');
    assert.match((await tx(db, auto, 'active')).err, /conversation_review_points_require_approved_review/);
    assert.equal((await tx(db, autoMgr, 'approved')).code, 0, 'automatic analysis explicitly approved by a manager');
    assert.match((await tx(db, superseded, 'pending')).err, /conversation_review_points_require_current_review/);
  } finally { await dropDb(db); }
});

await scenario('Finance: points follow review approval (revoked -> pending, superseded -> cancelled, re-approved -> approved)', async () => {
  const db = await freshDb();
  try {
    const id = '10000000-0000-4000-8000-000000000011';
    await seedReview(db, id, {});
    await tx(db, id, 'active');
    await ok(db, `update conversation_sales_reviews set impact_status = 'pending' where id = '${id}';`);
    assert.equal(await txStatus(db, id), 'pending');
    await ok(db, `update conversation_sales_reviews set impact_status = 'approved' where id = '${id}';`);
    assert.equal(await txStatus(db, id), 'approved');
    await ok(db, `update conversation_sales_reviews set is_current = false, superseded_at = now() where id = '${id}';`);
    assert.equal(await txStatus(db, id), 'cancelled');
  } finally { await dropDb(db); }
});

await scenario('Finance: a stale +6 reward never becomes payable for a -20 review', async () => {
  const db = await freshDb();
  try {
    const id = '10000000-0000-4000-8000-000000000012';
    await seedReview(db, id, { impact_status: 'pending', point_impact: -20, doctor_points_impact: -20 });
    assert.equal((await tx(db, id, 'pending', 6)).code, 0, 'historic inconsistent points remain nonpayable');
    await ok(db, `update conversation_sales_reviews set impact_status='approved' where id='${id}';`);
    assert.equal(await txStatus(db, id), 'pending', 'approval must not revive the mismatched reward');
    assert.match((await tx(db, id, 'approved', 6)).err, /conversation_review_points_delta_mismatch/);
    assert.equal((await tx(db, id, 'approved', -20)).code, 0, 'the matching deduction can become payable once explicitly approved');
  } finally { await dropDb(db); }
});

await scenario('Finance: changing an approved review impact revokes stale points without rewriting history', async () => {
  const db = await freshDb();
  try {
    const id = '10000000-0000-4000-8000-000000000013';
    await seedReview(db, id, {});
    assert.equal((await tx(db, id, 'approved')).code, 0);
    await ok(db, `update conversation_sales_reviews set point_impact=-3, doctor_points_impact=-3 where id='${id}';`);
    assert.equal(await txStatus(db, id), 'pending', 'old +5 cannot stay payable after the official impact becomes -3');
    assert.match((await tx(db, id, 'approved', 5)).err, /conversation_review_points_delta_mismatch/);
  } finally { await dropDb(db); }
});

await scenario('Concurrency: a payable insert racing an approval revocation never leaves payable points', async () => {
  const db = await freshDb();
  try {
    const id = '10000000-0000-4000-8000-000000000021';
    await seedReview(db, id, {});
    const revoke = psql(db, `begin; update conversation_sales_reviews set impact_status = 'pending' where id = '${id}'; select pg_sleep(1.2); commit;`);
    await sleep(300);
    const insert = await tx(db, id, 'approved');
    await revoke;
    assert.match(insert.err, /conversation_review_points_require_approved_review/);
    const payable = await ok(db, `select count(*) from employee_transactions where source_id = '${id}' and status in ('active','approved');`);
    assert.equal(payable, '0');
  } finally { await dropDb(db); }
});

await scenario('official_v1 (13 SQL readers): human reviews count as written, unapproved automatic and superseded never', async () => {
  const db = await freshDb();
  try {
    await seedReview(db, '10000000-0000-4000-8000-000000000041', {});
    await seedReview(db, '10000000-0000-4000-8000-000000000042', { impact_status: 'pending', final_score: 60, total_score: 60 });
    await seedReview(db, '10000000-0000-4000-8000-000000000043', { evaluation_kind: 'automatic', automatic_evaluation_version: 'auto-v1', reviewer_id: null });
    await seedReview(db, '10000000-0000-4000-8000-000000000044', { is_current: false, superseded_at: '2026-10-07T00:00:00Z' });
    await seedReview(db, '10000000-0000-4000-8000-000000000045', { impact_status: 'reversed' });
    const r = await json(db, `select json_build_object('ids', json_agg(right(id::text, 2) order by id), 'avg', round(avg(final_score), 1)) from conversation_sales_reviews_official_v1;`);
    assert.deepEqual(r, { ids: ['41', '42'], avg: 75 });
  } finally { await dropDb(db); }
});

await scenario('Cycle 26 -> 25 on the Cairo calendar, identical under UTC and Cairo sessions', async () => {
  const db = await freshDb();
  try {
    await seedReview(db, '10000000-0000-4000-8000-000000000031', { conversation_date: '2026-09-25T22:30:00Z' }); // 01:30 Cairo on the 26th
    await seedReview(db, '10000000-0000-4000-8000-000000000032', { conversation_date: '2026-09-25T20:00:00Z' }); // 23:00 Cairo on the 25th
    await seedReview(db, '10000000-0000-4000-8000-000000000033', { conversation_date: '2026-10-25T20:59:00Z' }); // 23:59 Cairo on the 25th
    await seedReview(db, '10000000-0000-4000-8000-000000000034', { conversation_date: '2026-10-25T21:30:00Z' }); // 00:30 Cairo on the 26th (EET after DST)
    for (const tz of ['UTC', 'Africa/Cairo', 'Asia/Tokyo']) {
      const r = await json(db, `set timezone = '${tz}'; select json_build_object(
        'oct', (dawaa_monthly_evaluation_server_evidence_v5('${STAFF}', '2026-10-01')->'counts'->>'conversation_reviews')::int,
        'sep', (dawaa_monthly_evaluation_server_evidence_v5('${STAFF}', '2026-09-01')->'counts'->>'conversation_reviews')::int,
        'nov', (dawaa_monthly_evaluation_server_evidence_v5('${STAFF}', '2026-11-01')->'counts'->>'conversation_reviews')::int);`);
      assert.deepEqual(r, { sep: 1, oct: 2, nov: 1 }, tz);
    }
  } finally { await dropDb(db); }
});

await scenario('Finalized payroll refuses review-sync changes and preserves both review and ledger', async () => {
  const db = await freshDb();
  try {
    const id = '10000000-0000-4000-8000-000000000095';
    await seedReview(db, id, {});
    assert.equal((await tx(db, id, 'approved')).code, 0);
    await ok(db, 'create table public.payroll_finalized_snapshots_v2 (staff_id uuid, month_cycle text);');
    await ok(db, readFileSync('supabase/migrations/20261005134000_points_payroll_freeze_boundary_v5.sql', 'utf8'));
    await ok(db, `insert into public.payroll_finalized_snapshots_v2 values ('${STAFF}', '2026-10');`);
    const result = await psql(db, `update conversation_sales_reviews set impact_status='pending' where id='${id}';`);
    assert.notEqual(result.code, 0);
    assert.match(result.err, /finalized_payroll_cycle_is_immutable/);
    const state = await json(db, `select json_build_object(
      'review', (select impact_status from conversation_sales_reviews where id='${id}'),
      'ledger', (select status from employee_transactions where source_id='${id}'))`);
    assert.deepEqual(state, { review: 'approved', ledger: 'approved' });
  } finally { await dropDb(db); }
});

const failed = results.filter((r) => !r.ok);
console.log(`[native-pg] ${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
