// Native PostgreSQL regression for contract A: one open follow-up per customer + branch.
// Uses only a local throwaway database (psql/libpq environment: PGHOST, PGPORT, PGUSER, ...).
// Never point this at Supabase: the script refuses a non-local host.
// Loads the ACTUAL repository bodies (identity key, actor guard, event logger, the client wrapper,
// the predecessor find_or_create body), proves the predecessor surfaces a raw unique_violation
// under the Production open-case index, then applies the contract A migration (twice) and checks
// that application and database share one contract, including under concurrency.
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

function psql(db, sql, { allowError = false } = {}) {
  const result = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', '-d', db], {
    input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowError) throw new Error(`psql failed (${db}):\n${result.stderr}\n${result.stdout}`);
  return { ...result, code: result.status };
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
const RAW_UNIQUE = /duplicate key value|unique constraint|23505/i;

const contractA = read('supabase/migrations/20261009180000_customer_followup_one_open_case_contract_a_v1.sql');
const liveDefs = JSON.parse(read('docs/si-operational-audit-20261009/followup-core-live-definitions.json'));
const liveDef = (prefix) => liveDefs.find((d) => d.signature.startsWith(prefix)).definition;

function buildDatabase(name, { applyContractA = true, productionIndex = true } = {}) {
  psql('postgres', `drop database if exists ${name}; create database ${name};`);
  psql(name, read('supabase/tests/followup_contract_a_v1.fixture.sql'));
  // Historical core first, then the Production identity bodies captured in the audit.
  psql(name, read('supabase/migrations/20260720_customer_followup_find_or_create_open_case.sql'));
  psql(name, `${liveDef('dawaa_normalize_egyptian_mobile_v1')};\n${liveDef('dawaa_customer_identity_key_v1')};`);
  const authz = read('supabase/migrations/20260823184000_harden_db_authorization_permission_truth_v1.sql');
  psql(name, between(authz, 'create or replace function public.dawaa_jsonb_has_true_any', 'create or replace function public.dawaa_current_actor_can'));
  psql(name, between(authz, 'create or replace function public.dawaa_require_customer_service_actor_v1', '\n$$;') + '\n$$;');
  const command = read('supabase/migrations/20260719_customer_service_secure_command_center.sql');
  psql(name, between(command, 'create or replace function public.dawaa_parse_followup_datetime_v1', 'create or replace function public.dawaa_require_customer_service_actor_v1'));
  psql(name, between(command, 'create or replace function public.dawaa_log_customer_followup_event_v1', 'create or replace function public.dawaa_archive_customer_followup_v1'));
  psql(name, between(command, 'create or replace function public.dawaa_create_exceptional_followup_v2', 'create or replace function public.dawaa_complete_customer_followup_v1'));
  psql(name, between(read('supabase/migrations/20260720_customer_followup_duplicate_management.sql'),
    'create or replace function public.list_open_followup_duplicate_groups_v1', 'grant execute on function public.list_open_followup_duplicate_groups_v1'));
  psql(name, read('supabase/migrations/20261009100000_customer_followup_linked_retry_lineage_v1.sql'));
  const lifecycle = read('supabase/migrations/20260824180000_customer_followup_lifecycle_commands_v1.sql');
  psql(name, between(lifecycle, 'create or replace function public.dawaa_create_or_link_customer_followup_v1', 'create or replace function public.dawaa_save_customer_followup_result_v1'));
  psql(name, `revoke all on function public.find_or_create_open_customer_followup(text,text,text,text,text,text,text,text,text,date,text,text,text,text) from public, anon, authenticated;
    revoke all on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) from public, anon;
    grant execute on function public.dawaa_create_or_link_customer_followup_v1(text,text,text,text,text,text,text,text,text,date,text,text) to authenticated;
    revoke all on function public.dawaa_create_exceptional_followup_v2(text,text,text,text,text,text,text,text,text,text,text,text,text) from public, anon;
    grant execute on function public.dawaa_create_exceptional_followup_v2(text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;`);
  if (applyContractA) {
    psql(name, contractA);
    psql(name, contractA); // forward migration is re-runnable
  }
  if (!productionIndex) psql(name, 'drop index daily_followups_one_open_case_per_customer_branch_uidx;');
}

const SHOKRY = 'فرع شكري';
const ELSHAMY = 'فرع الشامي';
const as = (actor) => `set dawaa.test_actor = '00000000-0000-4000-8000-0000000000${actor}'; set role authenticated;`;
const lit = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const createOrLink = ({ code = 'SYN-001', name = 'Synthetic Customer A', branch = SHOKRY, type = 'general', key = null, actor = 'a2' }) =>
  `${as(actor)} select public.dawaa_create_or_link_customer_followup_v1(null, ${lit(code)}, ${lit(name)}, null, ${lit(branch)}, ${lit(type)},
     'synthetic details', 'synthetic reason', null, null, ${lit(key)}, 'contract_a_test');`;
const exceptional = ({ code = 'SYN-001', name = 'Synthetic Customer A', branch = SHOKRY, actor = 'a2' }) =>
  `${as(actor)} select row_to_json(f)::jsonb from public.dawaa_create_exceptional_followup_v2(null, ${lit(code)}, ${lit(name)}, null, ${lit(branch)},
     'مهم', 'synthetic exceptional reason', null, null, null, null, null, null) f;`;
const json = (result) => JSON.parse(result.stdout.trim().split('\n').pop());
const openRows = (db, code = 'SYN-001', branch = SHOKRY) => query(db,
  `select count(*) from daily_followups where customer_code=${lit(code)} and branch=${lit(branch)}
     and completed_at is null and cancelled_at is null and archived_at is null`);

const suffix = `${process.pid}`;
const db = `dawaa_contract_a_${suffix}`;
let passed = 0;
const pass = (label) => { passed += 1; console.log(`PASS ${label}`); };
try {
  // ------------------------------------------------ 0. the predecessor body is the bug being fixed
  buildDatabase(db, { applyContractA: false });
  psql(db, createOrLink({ type: 'general' }));
  const before = psql(db, createOrLink({ type: 'complaint' }), { allowError: true });
  assert.notEqual(before.code, 0, 'predecessor should fail on a second request_type');
  assert.match(before.stderr, RAW_UNIQUE);
  pass('0 predecessor body raises a raw unique_violation for a second request_type (bug reproduced)');

  // ------------------------------------------------ sequential contract
  buildDatabase(db);
  // 1. customer A + Shokry with an open follow-up
  const first = json(psql(db, createOrLink({ type: 'general', key: 'retry-key-1' })));
  assert.equal(first.created, true);
  assert.equal(openRows(db), '1');
  pass('1 first request creates the one open follow-up for customer + branch');

  // 2. another request_type for the same customer + branch: no new row, no exception, linked
  const second = psql(db, createOrLink({ type: 'complaint', key: 'retry-key-2' }), { allowError: true });
  assert.equal(second.code, 0, second.stderr);
  const linked = json(second);
  assert.equal(linked.created, false);
  assert.equal(linked.linked_to_open_case, true);
  assert.equal(linked.followup_id, first.followup_id);
  assert.equal(linked.request_type, 'complaint');
  assert.equal(linked.case_request_type, 'general');
  assert.equal(openRows(db), '1');
  assert.equal(query(db, `select metadata->>'request_type' from customer_service_followup_events
    where followup_id=${lit(first.followup_id)} and event_type='request_linked'`), 'complaint');
  const third = json(psql(db, createOrLink({ type: 'recommendation' })));
  assert.equal(third.followup_id, first.followup_id);
  assert.equal(openRows(db), '1');
  pass('2 a different request_type links to the open case deterministically and records its type');

  const exc = psql(db, exceptional({}), { allowError: true });
  assert.equal(exc.code, 0, exc.stderr);
  assert.equal(json(exc).id, first.followup_id);
  assert.equal(openRows(db), '1');
  assert.equal(query(db, `select count(*) from customer_followup_events where followup_id=${lit(first.followup_id)}
    and event_type='request_linked' and event_payload->>'source'='exceptional'`), '1');
  pass('2b exceptional follow-up for a customer with an open case reuses it (no second row, no raw error)');

  // 2'. the command itself enforces the contract; it does not depend on the index error
  const appDb = `dawaa_contract_a_app_${suffix}`;
  buildDatabase(appDb, { productionIndex: false });
  const appFirst = json(psql(appDb, createOrLink({ type: 'general' })));
  assert.equal(json(psql(appDb, createOrLink({ type: 'complaint' }))).followup_id, appFirst.followup_id);
  assert.equal(json(psql(appDb, exceptional({}))).id, appFirst.followup_id);
  assert.equal(openRows(appDb), '1');
  psql('postgres', `drop database if exists ${appDb};`);
  pass("2' with the database index absent, the command still links (application and database share one contract)");

  // 3. same customer, other branch: independent row
  const other = json(psql(db, createOrLink({ branch: ELSHAMY, type: 'complaint' })));
  assert.equal(other.created, true);
  assert.notEqual(other.followup_id, first.followup_id);
  assert.equal(openRows(db, 'SYN-001', ELSHAMY), '1');
  assert.equal(openRows(db), '1');
  pass('3 the same customer in another branch gets an independent open follow-up');

  // 4. closed follow-up, then a new request opens a new case
  psql(db, `update daily_followups set completed_at=now(), status='تم' where id=${lit(first.followup_id)};`);
  const reopened = json(psql(db, createOrLink({ type: 'complaint' })));
  assert.equal(reopened.created, true);
  assert.notEqual(reopened.followup_id, first.followup_id);
  assert.equal(openRows(db), '1');
  const reExc = json(psql(db, exceptional({ code: 'SYN-002', name: 'Synthetic Customer B' })));
  assert.equal(query(db, `select request_type from daily_followups where id=${lit(reExc.id)}`), 'متابعة استثنائية');
  assert.equal(query(db, `select identity_key from daily_followups where id=${lit(reExc.id)}`), 'code:SYN-002');
  pass('4 after the open case is closed, a new request (any type) creates a new open case');

  // 5. retries: same key returns the same case; a linked request's retry is a replay too
  const replayFirst = json(psql(db, createOrLink({ type: 'general', key: 'retry-key-1' })));
  assert.equal(replayFirst.idempotent_replay, true);
  assert.equal(replayFirst.followup_id, first.followup_id);
  const replayLinked = json(psql(db, createOrLink({ type: 'complaint', key: 'retry-key-2' })));
  assert.equal(replayLinked.idempotent_replay, true);
  assert.equal(replayLinked.followup_id, first.followup_id);
  const wrongScope = psql(db, createOrLink({ type: 'general', key: 'retry-key-2' }), { allowError: true });
  assert.notEqual(wrongScope.code, 0);
  assert.match(wrongScope.stderr, /followup_client_request_scope_conflict/);
  assert.doesNotMatch(wrongScope.stderr, RAW_UNIQUE);
  assert.equal(query(db, `select count(*) from daily_followups where customer_code='SYN-001'`), '3');
  pass('5 retries return the same case (created or linked); a reused key with another type is a named conflict');

  // 7a. a hidden open case still blocks a second row in the DB; the command names the conflict
  psql(db, `update daily_followups set is_hidden=true where id=${lit(reopened.followup_id)};`);
  const hidden = psql(db, createOrLink({ type: 'general' }), { allowError: true });
  assert.notEqual(hidden.code, 0);
  assert.match(hidden.stderr, /followup_open_case_conflict/);
  assert.doesNotMatch(hidden.stderr, RAW_UNIQUE);
  const hiddenExc = psql(db, exceptional({}), { allowError: true });
  assert.match(hiddenExc.stderr, /followup_open_case_conflict/);
  assert.doesNotMatch(hiddenExc.stderr, RAW_UNIQUE);
  psql(db, `update daily_followups set is_hidden=false where id=${lit(reopened.followup_id)};`);
  pass('7a an open case the command may not link (hidden) gives a named error, never a raw unique_violation');

  // duplicate listing groups by customer + branch (contract A)
  psql(db, `drop index daily_followups_one_open_case_per_customer_branch_uidx;
    insert into daily_followups(id, customer_code, branch, identity_key, request_type) values ('legacy-dup', 'SYN-001', ${lit(SHOKRY)}, 'code:SYN-001', 'recommendation');`);
  const groups = query(db, `select open_count || ':' || canonical_id || ':' || array_to_string(duplicate_ids, ',') || ':' || request_type
    from list_open_followup_duplicate_groups_v1(null)`);
  assert.equal(groups, `2:${reopened.followup_id}:legacy-dup:complaint`);
  pass('L duplicate groups are per customer + branch, whatever the request_type');

  // ------------------------------------------------ 6. concurrency
  const raceDb = `dawaa_contract_a_race_${suffix}`;
  for (let round = 1; round <= 5; round += 1) {
    buildDatabase(raceDb);
    const [a, b, c] = await Promise.all([
      psqlAsync(raceDb, createOrLink({ code: 'SYN-RACE', type: 'general' })),
      psqlAsync(raceDb, createOrLink({ code: 'SYN-RACE', type: 'complaint' })),
      psqlAsync(raceDb, exceptional({ code: 'SYN-RACE' })),
    ]);
    for (const r of [a, b, c]) { assert.equal(r.code, 0, r.stderr); assert.doesNotMatch(r.stderr, RAW_UNIQUE); }
    assert.equal(openRows(raceDb, 'SYN-RACE'), '1');
    const ids = new Set([json(a).followup_id, json(b).followup_id, json(c).id]);
    assert.equal(ids.size, 1);
  }
  pass('6a concurrent requests of two types plus an exceptional one converge on one open case (5 rounds)');

  // 6a'. the application alone holds the contract: same races with the Production index absent
  for (let round = 1; round <= 5; round += 1) {
    buildDatabase(raceDb, { productionIndex: false });
    const [a, b, c] = await Promise.all([
      psqlAsync(raceDb, createOrLink({ code: 'SYN-RACE', type: 'general' })),
      psqlAsync(raceDb, createOrLink({ code: 'SYN-RACE', type: 'complaint' })),
      psqlAsync(raceDb, exceptional({ code: 'SYN-RACE' })),
    ]);
    for (const r of [a, b, c]) assert.equal(r.code, 0, r.stderr);
    assert.equal(openRows(raceDb, 'SYN-RACE'), '1');
  }
  pass("6a' without the database index, the command's own lock and lookup still give one open case");

  // 6b. a writer outside the command's lock commits first: the command links, no raw error
  buildDatabase(raceDb);
  const outside = psqlAsync(raceDb, `begin;
    insert into daily_followups(id, customer_code, customer_name, branch, identity_key, request_type, client_request_id)
      values ('outside-writer', 'SYN-OUT', 'Synthetic Customer C', ${lit(SHOKRY)}, 'code:SYN-OUT', 'general', 'legacy:outside');
    select pg_sleep(1.2); commit;`);
  await delay(300);
  const [inside, insideExc] = await Promise.all([
    psqlAsync(raceDb, createOrLink({ code: 'SYN-OUT', name: 'Synthetic Customer C', type: 'complaint' })),
    psqlAsync(raceDb, exceptional({ code: 'SYN-OUT', name: 'Synthetic Customer C' })),
  ]);
  assert.equal((await outside).code, 0);
  for (const r of [inside, insideExc]) { assert.equal(r.code, 0, r.stderr); assert.doesNotMatch(r.stderr, RAW_UNIQUE); }
  assert.equal(json(inside).followup_id, 'outside-writer');
  assert.equal(json(insideExc).id, 'outside-writer');
  assert.equal(openRows(raceDb, 'SYN-OUT'), '1');
  pass('6b a unique_violation from a writer outside the lock is converted into a deterministic link');

  // 6c. the database index stays the final safety net
  const direct = psql(raceDb, `insert into daily_followups(id, customer_code, branch, identity_key, request_type)
    values ('direct-second', 'SYN-OUT', ${lit(SHOKRY)}, 'code:SYN-OUT', 'complaint');`, { allowError: true });
  assert.notEqual(direct.code, 0);
  assert.match(direct.stderr, /daily_followups_one_open_case_per_customer_branch_uidx/);
  pass('6c a direct second open row is still rejected by the database index');

  // security: clients cannot reach the core directly; the wrapper still needs a staff session
  const core = psql(raceDb, `set role authenticated; select public.find_or_create_open_customer_followup(null,'SYN-SEC','x',null,${lit(SHOKRY)},'general',null,null,null,null,'00000000-0000-4000-8000-0000000000a2','x',null,'t');`, { allowError: true });
  assert.match(core.stderr, /permission denied for function find_or_create_open_customer_followup/);
  const noSession = psql(raceDb, `set role authenticated; select public.dawaa_create_or_link_customer_followup_v1(null,'SYN-SEC','x',null,${lit(SHOKRY)});`, { allowError: true });
  assert.notEqual(noSession.code, 0);
  const wrongBranch = psql(raceDb, createOrLink({ code: 'SYN-SEC', branch: ELSHAMY, actor: 'a1' }), { allowError: true });
  assert.notEqual(wrongBranch.code, 0);
  assert.equal(query(raceDb, `select count(*) from daily_followups where customer_code='SYN-SEC'`), '0');
  assert.equal(query(raceDb, `select string_agg(p.proname || '=' || array_to_string(p.proconfig, ';'), ',' order by p.proname) from pg_proc p
    where p.proname in ('find_or_create_open_customer_followup', 'dawaa_create_exceptional_followup_v2')`),
    'dawaa_create_exceptional_followup_v2=search_path=public, auth, pg_catalog,find_or_create_open_customer_followup=search_path=public, pg_catalog');
  pass('S core not client-callable; wrapper needs a staff session and branch scope; search_path pinned');

  psql('postgres', `drop database if exists ${raceDb};`);
  psql('postgres', `drop database if exists ${db};`);
  console.log(`contract A: ${passed} checks passed`);
} catch (error) {
  console.error(error);
  console.error(`contract A: FAILED after ${passed} passing checks`);
  process.exit(1);
}
