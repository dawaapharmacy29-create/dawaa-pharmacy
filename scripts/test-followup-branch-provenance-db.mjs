// Native PostgreSQL regression for the follow-up branch provenance guard.
// Uses only a local throwaway database (psql/libpq environment: PGHOST, PGPORT, PGUSER, ...).
// Never point this at Supabase: the script refuses a non-local host.
// It loads the ACTUAL repository bodies of the three legacy writers, the hardening wrappers, the
// customer branch sync trigger and lineage predicate, then the new forward migration (twice).
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.PGHOST || '';
if (host && !['localhost', '127.0.0.1', '::1'].includes(host) && !host.startsWith('/')) {
  throw new Error(`refusing non-local PGHOST ${host}`);
}
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const between = (text, start, end) => {
  const from = text.indexOf(start);
  const to = end ? text.indexOf(end, from + start.length) : text.length;
  if (from < 0 || to < 0) throw new Error(`slice not found: ${start}`);
  return text.slice(from, to);
};

function psql(db, sql, { allowError = false, extraArgs = [] } = {}) {
  const result = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-d', db, ...extraArgs], {
    input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowError) {
    throw new Error(`psql failed (${db}):\n${result.stderr}\n${result.stdout}`);
  }
  return result;
}
const query = (db, sql) => psql(db, sql).stdout.trim();

function psqlAsync(db, sql) {
  return new Promise((resolve) => {
    const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-d', db]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(sql);
  });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const migration = read('supabase/migrations/20261009170000_followup_branch_provenance_guard_v1.sql');

function buildDatabase(name) {
  psql('postgres', `drop database if exists ${name}; create database ${name};`);
  psql(name, read('supabase/tests/followup_branch_provenance_guard_v1.fixture.sql'));
  // Actual repository definitions, in their historical order.
  psql(name, between(read('supabase/migrations/20260720_customer_followup_find_or_create_open_case.sql'),
    'create or replace function public.dawaa_normalize_egyptian_mobile_v1', 'create or replace function public.dawaa_customer_identity_key_v1'));
  psql(name, between(read('supabase/migrations/20260824150000_harden_customer_requests_rls_v2.sql'),
    'create or replace function public.dawaa_customer_request_branch_key', 'create or replace function public.dawaa_can_access_customer_request_branch'));
  psql(name, read('supabase/migrations/20260720_customer_followup_customer_correction.sql'));
  psql(name, read('supabase/migrations/20260720_customer_followup_duplicate_management.sql'));
  psql(name, read('supabase/migrations/20260721_transfer_customer_followup_branch_v1.sql'));
  psql(name, between(read('supabase/migrations/20260726232000_dedupe_followups_and_fix_canonical_branch.sql'),
    'create or replace function public.normalize_customer_followup_branch', '-- Run once during migration.'));
  const hardening = read('supabase/migrations/20261005131000_followup_writer_surface_hardening_v2.sql');
  psql(name, between(hardening, 'create or replace function public.dawaa_current_followup_actor_v2', '-- Active UI writer: follow-up result import.'));
  psql(name, between(hardening, 'revoke all on function public.repair_customer_followup_duplicates_and_branches()',
    'revoke all on function public.settle_doctor_self_logged_followup'));
  psql(name, JSON.parse(read('docs/si-operational-audit-20261009/branch-sync-live-definition.json')).definition);
  psql(name, `create trigger customer_branch_sync after update on public.customers
    for each row execute function public.sync_customer_branch_to_open_followups_and_daily_queue();`);
  psql(name, read('supabase/migrations/20261009103000_preserve_conversation_followup_branch_v1.sql'));
  psql(name, migration);
  psql(name, migration); // forward migration is re-runnable
}

const suffix = `${process.pid}`;
const mainDb = `dawaa_branch_guard_${suffix}`;
const raceDb = `dawaa_branch_guard_race_${suffix}`;
let passed = 0;
try {
  // ---------------------------------------------------------------- sequential invariants
  buildDatabase(mainDb);
  const run = psql(mainDb, read('supabase/tests/followup_branch_provenance_guard_v1.test.sql'), { allowError: true });
  const passes = (run.stderr.match(/NOTICE:\s+PASS /g) || []).length;
  if (run.status !== 0) {
    process.stdout.write(run.stderr);
    throw new Error('sequential SQL assertions failed');
  }
  passed += passes;
  console.log(`sequential: ${passes} SQL assertions passed`);

  // ---------------------------------------------------------------- concurrency (separate sessions)
  const actor = (id) => `set dawaa.test_actor = '00000000-0000-4000-8000-0000000000${id}'; set role authenticated;`;
  const transfer = (id, branch) => `select public.transfer_customer_followup_branch_v1('${id}','${branch}',null,null,'race');`;

  // C1: the same manual transfer submitted twice at once converges to one effect.
  buildDatabase(raceDb);
  let [a, b] = await Promise.all([
    psqlAsync(raceDb, `${actor('a1')} ${transfer('f-manual', 'فرع الشامي')}`),
    psqlAsync(raceDb, `${actor('a1')} ${transfer('f-manual', 'فرع الشامي')}`),
  ]);
  assert.equal(a.code, 0, a.stderr); assert.equal(b.code, 0, b.stderr);
  assert.equal(query(raceDb, `select count(*) from customer_followup_audit_log where action='branch_transferred'`), '1');
  assert.equal(query(raceDb, `select count(*) from customer_branch_overrides where active`), '1');
  assert.equal(query(raceDb, `select string_agg(id||'='||branch, ',' order by id) from daily_followups where id in ('f-conv','f-key','f-manual')`),
    'f-conv=فرع شكري,f-key=فرع شكري,f-manual=فرع الشامي');
  passed += 1; console.log('PASS C1 concurrent duplicate transfer converges to one effect');

  // C2: correction waits for an in-flight transfer of the same row, then applies to the new state.
  buildDatabase(raceDb);
  const holder = psqlAsync(raceDb, `${actor('a2')} begin; ${transfer('f-manual', 'فرع الشامي')} select pg_sleep(1.5); commit;`);
  await delay(400);
  const correction = await psqlAsync(raceDb, `${actor('a2')}
    select public.correct_customer_followup_data_v1('f-manual',null,'C001',null,'فرع شكري',null,null,'race');`);
  a = await holder;
  assert.equal(a.code, 0, a.stderr); assert.equal(correction.code, 0, correction.stderr);
  assert.equal(query(raceDb, `select branch from daily_followups where id='f-manual'`), 'فرع شكري');
  assert.equal(query(raceDb, `select string_agg(id||'='||branch, ',' order by id) from daily_followups where id in ('f-conv','f-key','f-event')`),
    'f-conv=فرع شكري,f-event=فرع الشامي,f-key=فرع شكري');
  passed += 1; console.log('PASS C2 correction during transfer is serialized and never moves conversation rows');

  // C3: lineage committed while a manual transfer sweeps the same customer. The newly linked
  // follow-up is never moved: the sweep either skips it or the backstop aborts the whole transfer.
  buildDatabase(raceDb);
  psql(raceDb, `insert into daily_followups(id,customer_id,customer_code,customer_phone,phone,branch,client_request_id,created_at)
    values ('f-late','00000000-0000-4000-8000-0000000000c1','C001','01011111111','01011111111','فرع شكري','manual:f-late',now());`);
  const linker = psqlAsync(raceDb, `begin;
    select 1 from daily_followups where id='f-late' for update;
    insert into customer_service_followup_events(followup_id,event_type,event_status,metadata)
      values ('f-late','request_linked','open','{"client_request_id":"whatsapp-action:00000000-0000-4000-8000-0000000000e2"}');
    select pg_sleep(1.5); commit;`);
  await delay(400);
  const sweep = await psqlAsync(raceDb, `${actor('a2')} ${transfer('f-manual', 'فرع الشامي')}`);
  a = await linker;
  assert.equal(a.code, 0, a.stderr);
  assert.equal(query(raceDb, `select branch from daily_followups where id='f-late'`), 'فرع شكري');
  if (sweep.code !== 0) {
    assert.match(sweep.stderr, /conversation_followup_branch_is_source_owned/);
    assert.equal(query(raceDb, `select branch from daily_followups where id='f-manual'`), 'فرع شكري');
    assert.equal(query(raceDb, `select count(*) from customer_followup_audit_log`), '0');
  }
  passed += 1; console.log(`PASS C3 lineage committed mid-sweep is never moved (${sweep.code === 0 ? 'skipped' : 'transfer rolled back'})`);

  // C4: customer home-branch change concurrent with a source realignment.
  buildDatabase(raceDb);
  psql(raceDb, `alter table daily_followups disable trigger zzz_daily_followups_conversation_branch_guard_v1;
    update daily_followups set branch='فرع الشامي' where id='f-key';
    alter table daily_followups enable trigger zzz_daily_followups_conversation_branch_guard_v1;`);
  [a, b] = await Promise.all([
    psqlAsync(raceDb, `${actor('a2')} ${transfer('f-key', 'فرع شكري')}`),
    psqlAsync(raceDb, `update customers set branch='فرع الشامي' where customer_code='C001';`),
  ]);
  assert.equal(a.code, 0, a.stderr); assert.equal(b.code, 0, b.stderr);
  assert.equal(query(raceDb, `select string_agg(id||'='||branch, ',' order by id) from daily_followups where id in ('f-conv','f-key','f-manual')`),
    'f-conv=فرع شكري,f-key=فرع شكري,f-manual=فرع الشامي');
  passed += 1; console.log('PASS C4 customer branch change racing a realignment leaves conversation rows on their source branch');

  // C5: two writers on the same conversation row: realign retry x2 + stale transfer.
  buildDatabase(raceDb);
  psql(raceDb, `alter table daily_followups disable trigger zzz_daily_followups_conversation_branch_guard_v1;
    update daily_followups set branch='فرع الشامي' where id='f-key';
    alter table daily_followups enable trigger zzz_daily_followups_conversation_branch_guard_v1;`);
  const results = await Promise.all([
    psqlAsync(raceDb, `${actor('a2')} ${transfer('f-key', 'فرع شكري')}`),
    psqlAsync(raceDb, `${actor('a2')} ${transfer('f-key', 'فرع شكري')}`),
  ]);
  for (const r of results) assert.equal(r.code, 0, r.stderr);
  const stale = await psqlAsync(raceDb, `${actor('a2')} ${transfer('f-key', 'فرع الشامي')}`);
  assert.notEqual(stale.code, 0);
  assert.match(stale.stderr, /conversation_followup_branch_is_source_owned/);
  assert.equal(query(raceDb, `select count(*) from customer_followup_audit_log where action='branch_realigned_to_source'`), '1');
  assert.equal(query(raceDb, `select branch from daily_followups where id='f-key'`), 'فرع شكري');
  passed += 1; console.log('PASS C5 concurrent realign retry is idempotent and a stale writer cannot restore the old branch');

  console.log(`PASS: ${passed} native PostgreSQL assertions (${process.env.PGHOST || 'local socket'})`);
} finally {
  psql('postgres', `drop database if exists ${mainDb}; drop database if exists ${raceDb};`, { allowError: true });
}
