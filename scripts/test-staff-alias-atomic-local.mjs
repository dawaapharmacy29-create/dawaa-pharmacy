// Synthetic fixture only. No network URL or hosted database credentials are accepted.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

const container = 'supabase_db_employee-core';
const database = `alias_test_${Date.now()}`;
const file = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function sql(text, { db = database, fail = false } = {}) {
  const r = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', db], { input: text, encoding: 'utf8' });
  if (r.error) throw r.error;
  if (!fail) assert.equal(r.status, 0, r.stderr);
  return r;
}
const pass = label => console.log(`PASS ${label}`);
sql(`create database ${database}`, { db: 'postgres' });
console.log(`Synthetic isolated database: ${container}/${database}`);
const sessionMigration = file('supabase/migrations/20261008120000_verified_staff_session_identity_v1.sql');
const sessionStart = sessionMigration.indexOf('create or replace function public.dawaa_session_account_id_v1()');
const sessionEnd = sessionMigration.indexOf('comment on function public.dawaa_session_account_id_v1()', sessionStart);
const parity = file('supabase/staging/41_shared_runtime_dependency_parity.sql');
const aliasStart = parity.indexOf('create table if not exists public.staff_identity_aliases');
const aliasEnd = parity.indexOf('create table if not exists public.shift_notes', aliasStart);
sql(`
 create schema extensions; create extension pgcrypto with schema extensions;
 create table public.staff(id uuid primary key, name text, role text, branch text, active boolean, is_active boolean);
 create table public.staff_accounts(id uuid primary key, active boolean default true, is_active boolean default true,
 can_login boolean default true, status text default 'active', permissions jsonb default '{}');
 create table public.staff_login_sessions(token_hash text primary key, staff_account_id uuid references staff_accounts,
 revoked_at timestamptz, expires_at timestamptz);
 ${sessionMigration.slice(sessionStart, sessionEnd)}
 ${sessionMigration.slice(sessionMigration.indexOf('create or replace function public.dawaa_request_context_is_client_v1()'),
 sessionMigration.indexOf('comment on function public.dawaa_request_context_is_client_v1()'))}
 create function public.dawaa_current_staff_account_id_strict() returns uuid language sql security definer
 set search_path=public as $$ select public.dawaa_session_account_id_v1() $$;
 -- Reduced permission fixture: explicit grants only, no role-default emulation.
 create function public.dawaa_current_actor_can(keys text[]) returns boolean language sql security definer
 set search_path=public as $$ select coalesce(bool_or((permissions->>k)::boolean),false)
 from staff_accounts, unnest(keys) k where id=public.dawaa_current_staff_account_id_strict() $$;
 ${parity.slice(aliasStart, aliasEnd)}
 insert into staff values
 ('00000000-0000-4000-8000-000000000001','د إسلام فاروق','doctor','شكري',true,true),
 ('00000000-0000-4000-8000-000000000002','إسلام السبع','delivery','شكري',true,true),
 ('00000000-0000-4000-8000-000000000003','إسلام فاروق','doctor','شكري',true,true),
 ('00000000-0000-4000-8000-000000000004','حساب قديم','doctor','شكري',false,false);
 insert into staff_accounts(id,permissions) values
 ('00000000-0000-4000-8000-000000000011','{"manage_staff_accounts":true}'),
 ('00000000-0000-4000-8000-000000000012','{}'),
 ('00000000-0000-4000-8000-000000000013','{"manage_staff_accounts":true}');
 update staff_accounts set active=false where id::text like '%0013';
 insert into staff_login_sessions select encode(extensions.digest(repeat(suffix,40),'sha256'),'hex'),id,null,now()+interval '1 hour'
 from (values ('m','00000000-0000-4000-8000-000000000011'::uuid),
 ('u','00000000-0000-4000-8000-000000000012'::uuid),('a','00000000-0000-4000-8000-000000000013'::uuid)) t(suffix,id);
`);
const migration = file('supabase/migrations/20261025112817_staff_alias_atomic_ownership_v1.sql');
const legacy = process.argv.includes('--legacy-catalog');
if(legacy) sql(file('supabase/tests/fixtures/staff_alias_legacy_catalog.sql'));
console.log(`Alias catalog fixture: ${legacy ? 'observed legacy policies/default trigger/indexes' : 'committed staging policies'}`);
sql("insert into staff_identity_aliases(staff_id,alias_name,normalized_alias) values ('00000000-0000-4000-8000-000000000001','historic','stale');");
assert.notEqual(sql(migration, {fail:true}).status,0);
assert.equal(sql("select normalized_alias from staff_identity_aliases").stdout.trim(),'stale');
assert.equal(sql("select to_regclass('public.staff_alias_audit_v1') is null").stdout.trim(),'t');
sql('delete from staff_identity_aliases;');
pass('stale legacy metadata aborts migration without rewriting evidence');
sql("insert into staff_identity_aliases(staff_id,alias_name,normalized_alias) values ('00000000-0000-4000-8000-000000000001','collision','collision'),('00000000-0000-4000-8000-000000000002','collision','collision');");
assert.notEqual(sql(migration,{fail:true}).status,0);
assert.equal(sql('select count(*) from staff_identity_aliases').stdout.trim(),'2');
assert.equal(sql("select to_regclass('public.staff_alias_audit_v1') is null").stdout.trim(),'t');
sql('delete from staff_identity_aliases;');
pass('legacy duplicate ownership aborts migration atomically without selecting a winner');
sql(migration);
pass('committed migration applies against staging alias schema and real token hash verifier');
const normalizerSource = file('src/lib/staffDuplicateAudit.ts').split('export function normalizeStaffName')[1].split('async function loadStaffAccountsByStaffId')[0];
const normalizerJs = ts.transpileModule(`function normalizeStaffName${normalizerSource}`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const normalize = new Function(`${normalizerJs}; return normalizeStaffName;`)();
for(const name of ['د إسلام فاروق','إسلام السبع','د/ إسلام فاروق','د. دنيا','دكتور أحمد','أستاذ محمد','م/ علي','  أماني  ','دنيا','دُنيا','A_B-C.,،','\tاسم  موظف\n','']) {
 const escaped = name.replaceAll("'","''");
 assert.equal(sql(`select public.dawaa_normalize_staff_alias_v1('${escaped}')`).stdout.trim(),normalize(name),name);
}
pass('SQL normalization matches canonical TypeScript normalization on Arabic/prefix/whitespace fixtures');
const actor = token => `set role anon; set request.headers='{"x-dawaa-session-token":"${token.repeat(40)}"}';`;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const insert = (n, name, extra = '') => `insert into staff_identity_aliases(staff_id,alias_name,normalized_alias${extra ? ',created_by' : ''}) values ('${id(n)}','${name}','forged'${extra ? ",'forged'" : ''});`;
function denied(label, query, code) {
 const r = sql(`\\set VERBOSITY verbose\n${query}`, { fail: true });
 assert.notEqual(r.status,0,label); assert.match(r.stderr, new RegExp(code),r.stderr); pass(label);
}
sql(actor('m') + insert(1,'د إسلام فاروق','actor') + insert(2,'إسلام السبع'));
assert.equal(sql('select count(distinct staff_id) from staff_identity_aliases').stdout.trim(),'2');
pass('Shokry doctor and courier remain separate staff ids');
sql(actor('m') + insert(1,'د اسلام'));
denied('exact pharmacist/courier short-name collision stays unresolved',actor('m')+insert(2,'اسلام'),'23505');
denied('similar normalized name cannot claim a second employee', actor('m') + insert(3,'د إسلام فاروق'), '23505');
denied('nonmanager cannot insert', actor('u') + insert(2,'غير مخول'), '42501');
denied('archived account cannot insert despite permission', actor('a') + insert(2,'مؤرشف'), '42501');
denied('unverified caller cannot insert', 'set role anon;' + insert(2,'مجهول'), '42501');
denied('inactive staff cannot receive active alias', actor('m') + insert(4,'قديم'), '23514');
denied('retired alias still requires an existing canonical staff id',actor('m')+`insert into staff_identity_aliases(staff_id,alias_name,active) values ('${id(999)}','مفقود',false);`,'23514');
// RLS may filter UPDATE to zero rows rather than throw: verify persisted state, not error shape.
sql(actor('u') + "update staff_identity_aliases set active=false;");
assert.equal(sql('select count(*) from staff_identity_aliases where active').stdout.trim(),'3');
pass('nonmanager UPDATE changes zero aliases under RLS');
sql(`create function public.alias_test_privileged_update() returns void language plpgsql security definer
 set search_path=pg_catalog,public as $$ begin update public.staff_identity_aliases set active=false; end $$;
 grant execute on function public.alias_test_privileged_update() to anon;`);
denied('security-definer RPC cannot bypass caller identity permission',actor('u')+'select public.alias_test_privileged_update();','42501');
sql('drop function public.alias_test_privileged_update();');
denied('owner reassignment forbidden', actor('m') + `update staff_identity_aliases set staff_id='${id(2)}' where staff_id='${id(1)}';`, '23514');
denied('creation provenance cannot be rewritten',actor('m')+"update staff_identity_aliases set created_by='forged';",'23514');
denied('audit deletion forbidden', actor('m') + 'delete from staff_alias_audit_v1;', '42501');
denied('TRUNCATE cannot bypass RLS or row triggers',actor('m')+'truncate staff_identity_aliases;','42501');
if(legacy) {
 denied('authenticated permissive legacy UPDATE still cannot bypass permission',actor('u').replace('role anon','role authenticated')+'update staff_identity_aliases set active=false;','42501');
} else {
 sql(actor('u').replace('role anon','role authenticated')+'update staff_identity_aliases set active=false;');
 assert.equal(sql('select count(*) from staff_identity_aliases where active').stdout.trim(),'3');
 pass('authenticated nonmanager UPDATE changes zero aliases under staging RLS');
}
sql(actor('m').replace('role anon','role authenticated')+insert(2,'مخول موثق'));
pass('authorized authenticated caller may create an alias with verified session');
denied('authenticated role without verified token cannot insert', 'set role authenticated;' + insert(2,'حساب مجهول'), '42501');
sql(`create or replace function public.dawaa_current_staff_account_id_strict() returns uuid language sql security definer
 set search_path=public as $$ select coalesce(public.dawaa_session_account_id_v1(),
 nullif(current_setting('alias_test.legacy_auth_actor',true),'')::uuid) $$;`);
denied('legacy authenticated identity without opaque staff session cannot mutate aliases',
 `set role authenticated; set alias_test.legacy_auth_actor='${id(11)}';`+insert(1,'هوية قديمة'),'42501');
sql(`create or replace function public.dawaa_current_staff_account_id_strict() returns uuid language sql security definer
 set search_path=public as $$ select public.dawaa_session_account_id_v1() $$;`);
sql(`update staff_login_sessions set revoked_at=now() where staff_account_id='${id(11)}';`);
denied('revoked session cannot write', actor('m') + insert(1,'ملغي'), '42501');
sql(`update staff_login_sessions set revoked_at=null,expires_at=now()-interval '1 minute' where staff_account_id='${id(11)}';`);
denied('expired session cannot write', actor('m') + insert(1,'منتهي'), '42501');
sql(`update staff_login_sessions set expires_at=now()+interval '1 hour' where staff_account_id='${id(11)}';`);
sql(`update staff set branch='الشامي' where id='${id(1)}';`);
assert.equal(sql(`select staff_id from staff_identity_aliases where alias_name='د إسلام فاروق'`).stdout.trim(),id(1));
pass('branch transfer preserves alias owner');
assert.equal(sql(`select count(*) from staff_identity_aliases where created_by='forged'`).stdout.trim(),'0');
pass('audit actor derived from verified session');
sql(actor('m') + "update staff_identity_aliases set active=false where alias_name='إسلام السبع'; update staff_identity_aliases set active=true where alias_name='إسلام السبع';");
pass('authorized retirement and reactivation');
sql(actor('m') + "update staff_identity_aliases set normalized_alias='forged';");
assert.equal(sql("select count(*) from staff_identity_aliases where normalized_alias='forged'").stdout.trim(),'0');
pass('UPDATE cannot forge the normalized reader key');
sql(actor('m')+insert(1,'اسم متقاعد')+"update staff_identity_aliases set active=false where alias_name='اسم متقاعد';"+insert(2,'اسم متقاعد'));
denied('reactivation cannot steal an occupied alias',actor('m')+`update staff_identity_aliases set active=true where alias_name='اسم متقاعد' and staff_id='${id(1)}';`,'23505');

function asyncSql(query) {
 const child = spawn('docker',['exec','-i',container,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',database]);
 let out='',err=''; child.stdout.on('data',b=>out+=b); child.stderr.on('data',b=>err+=b);
 const done = new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',status=>resolve({status,out,err}));});
 child.stdin.end(query); return done;
}
const first = asyncSql(`begin; ${actor('m')} ${insert(1,'سباق ذري')} select pg_sleep(3); commit;`);
// Wait for the first uncommitted insert to hold its unique-index transaction lock.
let ready=false;
for(let n=0;n<50;n++) {
 if(sql("select count(*) from pg_stat_activity where datname=current_database() and wait_event='PgSleep'").stdout.trim()==='1'){ready=true;break;}
 await new Promise(r=>setTimeout(r,50));
}
assert.ok(ready,'first transaction must hold an uncommitted alias');
const second = asyncSql(`\\set VERBOSITY verbose\n ${actor('m')} ${insert(2,'سباق ذري')}`);
const [a,b] = await Promise.all([first,second]);
assert.equal(a.status,0,a.err); assert.notEqual(b.status,0); assert.match(b.err,/23505/);
assert.equal(sql("select count(*) from staff_identity_aliases where alias_name='سباق ذري'").stdout.trim(),'1');
pass('two independent concurrent sessions: exactly one commits, other receives 23505');
assert.equal(sql("select count(*) from staff_alias_audit_v1 where new_record->>'alias_name'='سباق ذري'").stdout.trim(),'1');
pass('failed conflicting write leaves no audit ghost');
console.log('PASS ALL atomic alias database tests; synthetic database retained for inspection');
