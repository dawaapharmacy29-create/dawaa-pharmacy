// Local-only PostgREST/session integration. Run the native Hero suite first.
// Uses its synthetic DB, exact committed session resolver bodies and the real
// generated refresh HTTP handler. Does not accept remote URLs or production keys.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const container = 'dawaa-wa-0815-local', db = 'hero_identity_v2';
const network = 'dawaa-identity-http-isolated', rest = 'dawaa-identity-http-rest';
const httpPg = 'dawaa-identity-http-pg';
let sqlContainer = container;
const base = 'http://127.0.0.1:58331';
const manager = '11111111-1111-4111-8111-111111111111';
const employee = '88888888-8888-4888-8888-888888888888';
const jwtSecret = randomBytes(32).toString('hex');
const dbPassword = randomBytes(24).toString('hex');
const valid = randomBytes(32).toString('hex'), ordinary = randomBytes(32).toString('hex');
const expired = randomBytes(32).toString('hex'), revoked = randomBytes(32).toString('hex');
const sha = value => createHash('sha256').update(value).digest('hex');
const results = [];
let server, gateway;
function docker(args, input) {
  const r = spawnSync('docker', args, { input, encoding:'utf8', timeout:30000 });
  if (r.status !== 0) throw Error((r.stderr || r.error?.message || 'Docker error').replaceAll(dbPassword,'[local password]'));
  return r.stdout.trim();
}
function sql(query) { return docker(['exec','-i',sqlContainer,'psql','-X','-qAt','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1'],query); }
function body(file, name, delimiter = '$function$') {
  const source = readFileSync(file,'utf8');
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `missing committed ${name}`);
  const end = source.indexOf(`${delimiter};`, source.indexOf(`as ${delimiter}`,start));
  assert.ok(end > start, `unterminated ${name}`);
  return source.slice(start,end+delimiter.length+1);
}
function jwt(role) {
  const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
  const p = Buffer.from(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',jwtSecret).update(`${h}.${p}`).digest('base64url')}`;
}
async function check(label, fn) { await fn(); results.push({label,status:'PASS'}); console.log('PASS '+label); }
async function rpc(name, args, token, extra = {}) {
  const r = await fetch(`${base}/rpc/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'x-dawaa-session-token':token}:{}),...extra},body:JSON.stringify(args)});
  return {status:r.status,body:await r.json()};
}

try {
  assert.equal(docker(['inspect','-f','{{.HostConfig.NetworkMode}}',container]),'none');
  // A real session token is hashed at rest; test credentials are never persisted in reports.
  sql(`create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;
    alter table staff_accounts add column if not exists auth_user_id uuid,
      add column if not exists is_active boolean default true, add column if not exists status text default 'active',
      add column if not exists username text, add column if not exists permissions jsonb default '{}'::jsonb,
      add column if not exists updated_at timestamptz, add column if not exists created_at timestamptz;
    create table if not exists user_profiles(auth_user_id uuid,staff_account_id uuid,active boolean,role text,permissions jsonb);
    create table if not exists staff_login_sessions(id uuid primary key default gen_random_uuid(),staff_account_id uuid references staff_accounts(id),token_hash text unique,expires_at timestamptz,revoked_at timestamptz);
    insert into staff_accounts(id,name,staff_name,active,is_active,status,can_login,role,permissions)
      values('${employee}','Synthetic Employee','موظف اختبار',true,true,'active',true,'pharmacist','{"approve_reviews":true}')
      on conflict(id) do update set active=true,is_active=true,status='active',can_login=true;
    insert into staff_login_sessions(staff_account_id,token_hash,expires_at,revoked_at) values
      ('${manager}','${sha(valid)}',now()+interval '1 hour',null),
      ('${employee}','${sha(ordinary)}',now()+interval '1 hour',null),
      ('${manager}','${sha(expired)}',now()-interval '1 minute',null),
      ('${manager}','${sha(revoked)}',now()+interval '1 hour',now());
    create or replace function get_user_permissions(p_user_id uuid) returns jsonb language sql stable security definer set search_path=public as $$ select permissions from staff_accounts where id=p_user_id $$;
    create or replace function dawaa_jsonb_has_true_any(p jsonb,keys text[]) returns boolean language sql immutable as $$ select exists(select 1 from unnest(keys) k where p->>k='true') $$;
    alter role authenticator password '${dbPassword}'; grant anon,authenticated,service_role to authenticator;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant select on staff_login_sessions,staff_accounts to service_role;`);
  const identity = 'supabase/migrations/20261008120000_verified_staff_session_identity_v1.sql';
  for (const name of ['dawaa_session_account_id_v1','dawaa_request_staff_identifier','dawaa_request_staff_id']) sql(body(identity,name));
  sql(body('supabase/migrations/20261016090000_staff_actor_session_identity_once_per_call_v1.sql','dawaa_current_staff_account_id_strict','$$'));
  sql(body('supabase/migrations/20260823184000_harden_db_authorization_permission_truth_v1.sql','dawaa_current_actor_can','$$'));
  // The role predicate is the committed staging contract; permission rows are synthetic.
  const helpers = readFileSync('supabase/staging/30_session_helpers.sql','utf8');
  const topStart = helpers.indexOf('create or replace function public.dawaa_actor_is_top_management_v1()');
  sql(helpers.slice(topStart,helpers.indexOf('$$;',topStart)+3));
  const row = JSON.parse(sql('select row_to_json(r) from whatsapp_product_identity_manager_reviews_v1 r where is_current'));
  const args = {p_source_id:row.source_id,p_case_id:row.case_id,
    p_analysis_id:sql('select analysis_id from sales_intelligence_current_case_analyses limit 1'),
    p_basket_item_id:row.basket_item_id,p_invoice_item_id:row.invoice_item_id,p_reviewer_note:'مراجعة محلية بهوية جلسة متحقق منها'};
  const money = () => sql("select json_build_object('staff',(select json_agg(s) from staff s),'ledger',(select json_agg(t) from employee_transactions t),'payroll',(select json_agg(p) from synthetic_payroll_snapshot p))");
  const initialMoney = money();
  docker(['network','create',network]);
  // Copy only this synthetic fixture into a second internal-network PG container.
  // A --network none container cannot be attached to a bridge network.
  const dump = docker(['exec',container,'pg_dump','-U','supabase_admin','-d',db,'--no-owner']);
  docker(['run','-d','--name',httpPg,'--network',network,'--memory','1024m',
    '-e','POSTGRES_USER=supabase_admin','-e',`POSTGRES_PASSWORD=${dbPassword}`,
    'public.ecr.aws/supabase/postgres:17.6.1.132']);
  let pgReady=false;
  for(let i=0;i<40;i++){const r=spawnSync('docker',['exec',httpPg,'pg_isready','-h','127.0.0.1','-U','supabase_admin'],{stdio:'ignore',timeout:3000});if(r.status===0){pgReady=true;break;}await new Promise(r=>setTimeout(r,500));}
  assert.ok(pgReady,'isolated HTTP PG not ready');
  docker(['exec',httpPg,'psql','-U','supabase_admin','-d','postgres','-c',`create database ${db}`]);
  sqlContainer=httpPg;sql(dump);
  sql(`alter role authenticator password '${dbPassword}'; grant anon,authenticated,service_role to authenticator;`);
  docker(['run','-d','--name',rest,'--network',network,'--memory','256m','-p','127.0.0.1:58331:3000',
    '-e',`PGRST_DB_URI=postgresql://authenticator:${dbPassword}@${httpPg}:5432/${db}`,
    '-e','PGRST_SERVER_HOST=0.0.0.0','-e','PGRST_SERVER_PORT=3000','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_DB_ANON_ROLE=anon','-e',`PGRST_JWT_SECRET=${jwtSecret}`,
    'public.ecr.aws/supabase/postgrest:v14.12']);
  let ready = false, lastReadiness = ''; 
  for (let i=0;i<80;i++) { try { const r=await fetch(base,{signal:AbortSignal.timeout(1500)}); lastReadiness=String(r.status)+': '+(await r.text()).slice(0,300); if(r.ok){ready=true;break;} } catch(error) {lastReadiness=String(error)+' '+String(error.cause?.message);}  await new Promise(r=>setTimeout(r,500)); }
  if(!ready){for(const name of [rest,httpPg]){const r=spawnSync('docker',['logs','--tail','30',name],{encoding:'utf8'});console.error(name,(r.stdout+'\n'+r.stderr).replaceAll(dbPassword,'[local password]').replaceAll(jwtSecret,'[local JWT secret]'));}}
  assert.ok(ready,'local PostgREST unavailable: '+lastReadiness);
  await check('HTTP RPC valid verified manager token is idempotent',async()=>{const r=await rpc('dawaa_confirm_whatsapp_product_identity_v1',args,valid);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.idempotent,true);assert.equal(r.body.review_id,row.id);});
  for (const [label,token,extra] of [['missing token',null,{}],['invalid token','invalid-token',{}],['expired token',expired,{}],['revoked token',revoked,{}],['ordinary employee',ordinary,{}],['spoofed manager header',null,{'x-dawaa-user-id':manager}]]) {
    await check(`HTTP RPC rejects ${label}`,async()=>{const r=await rpc('dawaa_confirm_whatsapp_product_identity_v1',args,token,extra);assert.ok([401,403].includes(r.status),JSON.stringify(r));});
  }
  await check('HTTP RPC rejects disabled manager',async()=>{sql(`update staff_accounts set can_login=false where id='${manager}'`);try {assert.ok([401,403].includes((await rpc('dawaa_confirm_whatsapp_product_identity_v1',args,valid)).status));}finally{sql(`update staff_accounts set can_login=true where id='${manager}'`);}});
  await check('HTTP manager reads exactly one current decision with preserved history',async()=>{const r=await rpc('dawaa_list_whatsapp_product_identity_reviews_v1',{p_case_id:row.case_id},valid);assert.equal(r.status,200,JSON.stringify(r.body));const current=r.body.filter(x=>x.isCurrent);assert.equal(current.length,1);assert.equal(current[0].id,row.id);assert.ok(r.body.length>=2,'history row missing');});
  await check('HTTP decision history rejects ordinary employee and missing token',async()=>{for(const token of [ordinary,null]){const r=await rpc('dawaa_list_whatsapp_product_identity_reviews_v1',{p_case_id:row.case_id},token);assert.ok([401,403].includes(r.status),JSON.stringify(r));}});
  await check('HTTP table ACL denies direct decision writes',async()=>{const r=await fetch(`${base}/whatsapp_product_identity_manager_reviews_v1`,{method:'POST',headers:{'Content-Type':'application/json','x-dawaa-session-token':valid},body:'{}'});assert.ok([401,403].includes(r.status));});
  // supabase-js addresses PostgREST under /rest/v1 (the Kong route in a full stack).
  // Mirror only that route to the isolated local PostgREST; no other upstream exists.
  gateway=createServer(async(req,res)=>{
    if(!req.url.startsWith('/rest/v1/')){res.statusCode=404;return res.end('{}');}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const headers={...req.headers};delete headers.host;delete headers['content-length'];
    const upstream=await fetch(base+req.url.slice('/rest/v1'.length),{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    res.statusCode=upstream.status;
    for(const [k,v] of upstream.headers) if(!['content-encoding','content-length','transfer-encoding'].includes(k)) res.setHeader(k,v);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  });
  await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  const gatewayUrl=`http://127.0.0.1:${gateway.address().port}`;
  process.env.SUPABASE_URL=gatewayUrl; process.env.VITE_SUPABASE_URL=gatewayUrl;
  process.env.VITE_SUPABASE_ANON_KEY=jwt('anon');process.env.SUPABASE_SERVICE_ROLE_KEY=jwt('service_role');
  delete process.env.VERCEL_ENV;
  await check('server-side service role can read the session table over HTTP',async()=>{const key=process.env.SUPABASE_SERVICE_ROLE_KEY;const r=await fetch(`${gatewayUrl}/rest/v1/staff_login_sessions?select=id&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});assert.equal(r.status,200,await r.text());});
  await check('anon key cannot read the session table over HTTP',async()=>{const key=process.env.VITE_SUPABASE_ANON_KEY;const r=await fetch(`${gatewayUrl}/rest/v1/staff_login_sessions?select=id&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`}});assert.ok([401,403].includes(r.status),String(r.status));});
  const {default:handler} = await import('../../api/sales-intelligence-refresh-source.js');
  server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;req.body=JSON.parse(raw||'{}');
    res.status=function(code){this.statusCode=code;return this;};
    try{await handler(req,res);}catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const api=`http://127.0.0.1:${server.address().port}/api/sales-intelligence-refresh-source`;
  const refresh=async token=>{const r=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:'{}'});return{status:r.status,body:await r.json()};};
  await check('real refresh HTTP handler rejects missing token',async()=>{const r=await refresh(null);assert.equal(r.status,401,JSON.stringify(r));});
  await check('real refresh HTTP handler rejects expired token',async()=>{const r=await refresh(expired);assert.equal(r.status,401,JSON.stringify(r));});
  await check('real refresh HTTP handler rejects employee without refresh permission',async()=>{
    sql(`update staff_accounts set permissions='{}' where id='${employee}'`);
    assert.equal((await refresh(ordinary)).status,403);
  });
  await check('real refresh HTTP handler authenticates manager before validating body',async()=>{const r=await refresh(valid);assert.equal(r.status,400,JSON.stringify(r));assert.equal(r.body.error,'source_id_or_file_name_required');});
  await check('HTTP/session checks do not change points or payroll',async()=>assert.equal(money(),initialMoney));
  mkdirSync('evidence',{recursive:true});
  writeFileSync('evidence/product-identity-http-result.json',JSON.stringify({status:'PASS',tests:results,
    limitations:['Sessions seeded as SHA-256 token hashes; password/login issuance not exercised','Permission data and tables are synthetic; resolver bodies are committed implementations','Refresh authentication tested over real HTTP; positive full refresh persistence covered separately by native Hero pipeline, not this small HTTP schema']},null,2));
} finally {
  if(server) await new Promise(resolve=>server.close(resolve));
  if(gateway) await new Promise(resolve=>gateway.close(resolve));
  spawnSync('docker',['rm','-f',rest],{stdio:'ignore',timeout:15000});
  spawnSync('docker',['rm','-f',httpPg],{stdio:'ignore',timeout:15000});
  spawnSync('docker',['network','rm',network],{stdio:'ignore',timeout:15000});
}
