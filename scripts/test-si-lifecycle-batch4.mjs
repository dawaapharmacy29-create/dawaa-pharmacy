// Local-only Batch 4 matrix: existing PGlite mode or an explicitly selected loopback Native PG17 fixture.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const modulePath=process.env.DAWAA_PGLITE_MODULE;
const native=Boolean(process.env.DAWAA_NATIVE_PG_URL);
const db=native ? await (await import('./verification/nativePgFixture.mjs')).nativePgFixture()
 : new (await import(modulePath?pathToFileURL(modulePath).href:'@electric-sql/pglite')).PGlite();
const root=path.resolve('docs/whatsapp-master-brain-lifecycle-v4-20261017');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const install=()=>db.exec(read(native?'sql/phase-a-release-candidate.sql':'sql/phase-a-candidate.sql'));
const catalog=JSON.parse(read('baseline/catalog.json'));
let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log(`PASS ${name}`);};
const query=async(sql,args=[])=> (await db.query(sql,args)).rows;
const scalar=async(sql,args=[])=>Object.values((await query(sql,args))[0])[0];
await db.exec(`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF; END $$; CREATE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;`);
for(const table of [...new Set(catalog.columns.map(c=>c.table))]){
 const cols=catalog.columns.filter(c=>c.table===table).map(c=>`"${c.column}" ${c.type==='_text'?'text[]':c.type==='_uuid'?'uuid[]':c.type}${c.default?' DEFAULT '+c.default:''}${c.nullable==='NO'?' NOT NULL':''}`);
 await db.exec(`CREATE TABLE public.${table} (${cols.join(',')});`);
}
await db.exec(`ALTER TABLE sales_intelligence_cases ADD PRIMARY KEY(case_id);
ALTER TABLE sales_intelligence_case_analyses ADD PRIMARY KEY(analysis_id);
CREATE UNIQUE INDEX one_current ON sales_intelligence_case_analyses(case_id) WHERE is_current;
CREATE TABLE proof_revocations (id uuid, reason text);
CREATE FUNCTION public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(uuid,text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN INSERT INTO proof_revocations VALUES($1,$2); RETURN '{}'::jsonb; END $$;`);
await db.exec(read('baseline/sales_intelligence_write_case_analysis.sql'));
await db.exec(read('baseline/sales_intelligence_reconcile_case_set_v1.sql'));
await db.exec(read('baseline/dawaa_archive_superseded_whatsapp_source_v35.sql'));
await db.exec('CREATE VIEW sales_intelligence_current_case_analyses AS '+read('baseline/current-case-analyses-select.sql'));
await db.exec(`
CREATE FUNCTION public.dawaa_current_staff_account_id_strict() RETURNS uuid LANGUAGE sql AS $$ SELECT '11111111-1111-4111-8111-111111111111'::uuid $$;
CREATE FUNCTION public.dawaa_current_actor_can(text[]) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE whatsapp_conversation_actions(source_id uuid,assigned_to_id uuid,assigned_at timestamptz,work_status text,started_at timestamptz,completed_at timestamptz,outcome text,outcome_note text,followup_attempts integer,last_followup_at timestamptz,recovered_invoice_id uuid,recovered_at timestamptz);
CREATE TABLE whatsapp_customer_journeys(id uuid,root_source_id uuid);
CREATE TABLE whatsapp_customer_journey_sessions(journey_id uuid,source_id uuid);
CREATE TABLE whatsapp_evidence_facts_v17(source_id uuid);
CREATE TABLE whatsapp_response_turns_v18(source_id uuid);
CREATE TABLE whatsapp_sales_opportunities_v17(root_source_id uuid);
CREATE TABLE whatsapp_customer_story_events(source_id uuid);
`);
const md5=async(name)=>scalar('select md5(prosrc) from pg_proc where proname=$1',[name]);
const expected='9fd2f5976e2419ca7154d203b29da5fc';
if(native){
 await db.exec('CREATE FUNCTION dawaa_sync_whatsapp_invoice_evidence_v17() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;');
 for(const trigger of catalog.triggers) await db.exec(trigger);
}
await test('exact production v1 and analysis writer bodies',async()=>{
 assert.equal(await md5('sales_intelligence_reconcile_case_set_v1'),expected);
 assert.equal(await md5('sales_intelligence_write_case_analysis'),'c6c53c94a20cfdbf2946371398790d98');
});
const source='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const row=(hash='h')=>({case_type:'sales_opportunity',case_status:'closed',pipeline_status:'analyzed',overall_evidence_level:'strong',case_started_at:'2026-01-01',historical_closure_level:'none',commercial_confirmation_state:'none',protocol_applicability:'not_applicable',attribution_level:'none',integrity_evaluation_scope:'not_evaluable',semantic_source_hash:hash,pipeline_version:'v1',engine_version_case_segmentation:'1',engine_version_historical_closure:'1',engine_version_commercial_confirmation:'1',engine_version_protocol_applicability:'1'});
async function reset(){await db.exec(`TRUNCATE sales_intelligence_cases,sales_intelligence_case_analyses,whatsapp_review_sources,whatsapp_customer_cases_v22,conversation_sales_reviews,proof_revocations;
INSERT INTO whatsapp_review_sources(id,review_status,source_hash) VALUES('${source}','new','source-hash'),('${other}','new','other-hash');`);}
async function c(id='a',s=source){await db.query("INSERT INTO sales_intelligence_cases(case_id,conversation_id,is_active,case_started_at,source_case_id_v22) VALUES($1,$2,$3,'2026-01-01','44444444-4444-4444-8444-444444444444') ON CONFLICT DO NOTHING",[id,s,!native]);}
async function write(id='a',hash='h',staged=true){return scalar(`SELECT public.${staged?'sales_intelligence_stage_case_analysis_v1':'sales_intelligence_write_case_analysis'}($1,$2::jsonb)`,[id,JSON.stringify(row(hash))]);}
async function reconcile(ids=['a'],mapping={},s=source){return scalar('SELECT public.sales_intelligence_reconcile_case_set_v2($1,$2::text[],$3::jsonb)',[s,ids,JSON.stringify(mapping)]);}
async function pointer(id='a'){return (await query('SELECT published_analysis_id FROM sales_intelligence_cases WHERE case_id=$1',[id]))[0].published_analysis_id;}
async function current(id='a'){return scalar('SELECT analysis_id FROM sales_intelligence_case_analyses WHERE case_id=$1 AND is_current',[id]);}
async function initial(){await c();const a=await write('a','old',false);await db.query('SELECT sales_intelligence_reconcile_case_set_v1($1,$2::text[])',[source,['a']]);return a.analysis_id;}
if(native) await test('exact strict precheck on synthetic baseline cohort and captured column/trigger contracts',async()=>{
 await reset();
 for(let i=1;i<=53;i++){
  const id='00000000-0000-4000-8000-'+String(i).padStart(12,'0');const key='precheck-'+i;
  await db.query('insert into whatsapp_review_sources(id,review_status,source_hash) values($1,$2,$3)',[id,i<=39?'archived':'new',key]);
  await c(key,id);await db.query('update sales_intelligence_cases set is_active=true where case_id=$1',[key]);
  if(i<=16){const a=await write(key,'baseline',false);await db.query('update sales_intelligence_case_analyses set is_current=false,superseded_at=now() where analysis_id=$1',[a.analysis_id]);await db.query('update sales_intelligence_cases set published_analysis_id=$1 where case_id=$2',[a.analysis_id,key]);}
 }
 await db.exec(read('sql/precheck.sql'));
});
await test('baseline v1 publishes current analysis',async()=>{await reset();const old=await initial();assert.equal(await pointer(),old);});
await test('baseline exhibits archival inconsistency',async()=>{await db.query("UPDATE whatsapp_review_sources SET review_status='archived' WHERE id=$1",[source]);await db.query('SELECT sales_intelligence_reconcile_case_set_v1($1,$2::text[])',[source,['a']]);assert.equal(await scalar("select is_active from sales_intelligence_cases where case_id='a'"),true);});
await install();
async function matrix(prefix){
 await test(prefix+' first case staged, not published',async()=>{await reset();await c();const a=await write();assert.equal(a.is_current,false);assert.equal(await pointer(),null);});
 await test(prefix+' first complete source publishes',async()=>{const a=await write();const r=await reconcile(['a'],{a:a.analysis_id});assert.equal(r.ok,true);assert.equal(await pointer(),a.analysis_id);assert.equal(await current(),a.analysis_id);});
 await test(prefix+' duplicate stage retry no duplicate analysis',async()=>{const a=await write(),b=await write();assert.equal(a.analysis_id,b.analysis_id);assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses'),1);});
 await test(prefix+' reanalysis stages without pointer/current drift',async()=>{const old=await pointer();await write('a','new');assert.equal(await scalar("select analysis_id from sales_intelligence_current_case_analyses where case_id='a'"),old);assert.equal(await current(),old);assert.equal(await pointer(),old);});
 await test(prefix+' partial failed source preserves old publication',async()=>{await c('b');const a=await write('a','new');const result=await reconcile(['a','b'],{a:a.analysis_id});assert.equal(result.ok,false);assert.equal(await current(),await pointer());assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses where is_current'),1);});
 await test(prefix+' retry publishes full source and supersedes old',async()=>{const a=await write('a','new'),b=await write('b');assert.equal((await reconcile(['a','b'],{a:a.analysis_id,b:b.analysis_id})).ok,true);assert.equal(await current(),await pointer());assert.equal(await current('b'),await pointer('b'));assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses where superseded_at is not null'),1);});
 await test(prefix+' duplicate reconcile is idempotent',async()=>{const before=await scalar('select count(*)::int from sales_intelligence_case_analyses');const a=await write('a','new'),b=await write('b');await reconcile(['a','b'],{a:a.analysis_id,b:b.analysis_id});assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses'),before);});
 await test(prefix+' resegmentation retires stale case and clears pointer/current',async()=>{const b=await write('b');await reconcile(['b'],{b:b.analysis_id});assert.equal(await pointer(),null);assert.equal(await scalar("select count(*)::int from sales_intelligence_case_analyses where case_id='a' and is_current"),0);assert.equal(await scalar("select is_active from sales_intelligence_cases where case_id='a'"),false);});
 await test(prefix+' foreign case fails closed without unrelated changes',async()=>{await c('foreign',other);const f=await write('foreign');assert.equal((await reconcile(['foreign'],{foreign:f.analysis_id})).ok,false);assert.equal(await pointer('foreign'),null);});
 await test(prefix+' superseded analysis cannot be republished',async()=>{const id=await scalar("select analysis_id from sales_intelligence_case_analyses where case_id='a' and superseded_at is not null limit 1");assert.equal((await reconcile(['a'],{a:id})).ok,false);});
 await test(prefix+' malformed/missing mapping has no partial lifecycle writes',async()=>{const before=await pointer('b');assert.equal((await reconcile(['b'],{b:'bad-uuid'})).ok,false);assert.equal(await pointer('b'),before);});
 await test(prefix+' duplicate case set rejected',async()=>{assert.equal((await reconcile(['b','b'],{})).ok,false);});
 await test(prefix+' pointer drift repaired by exact candidate',async()=>{await db.exec("update sales_intelligence_cases set published_analysis_id=null where case_id='b'");const b=await write('b');await reconcile(['b'],{b:b.analysis_id});assert.equal(await pointer('b'),b.analysis_id);});
 await test(prefix+' historical missing-current needs fresh staged analysis',async()=>{await c('history');const h=await write('history','old',false);await db.exec("update sales_intelligence_case_analyses set is_current=false,superseded_at=now() where case_id='history'");assert.equal((await reconcile(['history'],{history:h.analysis_id})).ok,false);const n=await write('history','fresh');assert.equal((await reconcile(['history'],{history:n.analysis_id})).ok,true);});
 await test(prefix+' archived source never reactivated',async()=>{await db.query("update whatsapp_review_sources set review_status='archived' where id=$1",[source]);const h=await write('history','fresh');const count=await scalar('select count(*)::int from sales_intelligence_case_analyses');assert.equal((await reconcile(['history'],{history:h.analysis_id})).ok,true);assert.equal(await scalar('select count(*)::int from sales_intelligence_cases where conversation_id=$1 and is_active',[source]),0);assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses'),count);});
 await test(prefix+' archived retry preserves history and retired timestamps',async()=>{const before=await scalar("select jsonb_agg(to_jsonb(c) order by case_id) from sales_intelligence_cases c where conversation_id=$1",[source]);await reconcile([],{});assert.deepEqual(await scalar("select jsonb_agg(to_jsonb(c) order by case_id) from sales_intelligence_cases c where conversation_id=$1",[source]),before);});
 await test(prefix+' zero-case source retires full previous set',async()=>{await reset();await initial();assert.equal((await reconcile([],{})).ok,true);assert.equal(await pointer(),null);assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses where is_current'),0);});
 await test(prefix+' missing source rejected',async()=>{assert.equal((await reconcile([],{},'33333333-3333-4333-8333-333333333333')).ok,false);});
}
await matrix('candidate');
const v2md5=await md5('sales_intelligence_reconcile_case_set_v2');
await test('archive also retires staged inactive cases and stale inactive pointers without deleting history',async()=>{
 await reset();await c();const a=await write();
 await db.exec("update sales_intelligence_cases set is_active=false,published_analysis_id='"+a.analysis_id+"' where case_id='a'");
 await db.query("update whatsapp_review_sources set review_status='archived' where id=$1",[source]);
 await reconcile([],{});
 assert.equal(await pointer(),null);
 assert.equal(await scalar("select retire_reason from sales_intelligence_cases where case_id='a'"),'archived_source');
 assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses'),1);
});
await test('exact rollback to baseline',async()=>{await db.exec(read('sql/rollback.sql'));assert.equal(await md5('sales_intelligence_reconcile_case_set_v1'),expected);assert.equal(await md5('dawaa_archive_superseded_whatsapp_source_v35'),'fd7b5e40f631e4633049147cb2933ee7');assert.equal(await scalar("select count(*)::int from pg_proc where proname='sales_intelligence_reconcile_case_set_v2'"),0);});
await test('reapply candidate exact body',async()=>{await install();assert.equal(await md5('sales_intelligence_reconcile_case_set_v2'),v2md5);});
await matrix('reapply');
if(!native) await db.exec(read('sql/archive-candidate.sql'));
await test('future archival routes atomically through canonical reconcile',async()=>{await reset();await initial();await db.query("update whatsapp_review_sources set review_status='archived' where id=$1",[source]);assert.equal(await scalar('select count(*)::int from sales_intelligence_cases where conversation_id=$1 and is_active',[source]),0);assert.equal(await pointer(),null);});
await test('archive trigger cannot recurse and retains historical analyses',async()=>{assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses'),1);assert.equal(await scalar("select count(*)::int from pg_trigger where tgname='sales_intelligence_source_archived_v1'"),1);});
if(!native) await db.exec(read('sql/archive-writer-candidate.sql'));
await test('real v35 archival path preserves SI case and analysis history',async()=>{
 await reset();const old=await initial();
 await db.query("update whatsapp_review_sources set source_filename='fixture.txt',conversation_started_at='2026-01-01',conversation_ended_at='2026-01-02',message_count=2 where id=$1",[source]);
 const result=await scalar("select dawaa_archive_superseded_whatsapp_source_v35('fixture.txt','2026-01-01','2026-01-02',2,$1::uuid[])",[[other,'33333333-3333-4333-8333-333333333333']]);
 assert.equal(result.archived,1);assert.equal(result.deletedDerived.sales_intelligence_cases,0);
 assert.equal(await scalar('select count(*)::int from sales_intelligence_cases'),1);
 assert.equal(await scalar('select count(*)::int from sales_intelligence_case_analyses'),1);
 assert.equal(await scalar("select is_active from sales_intelligence_cases where case_id='a'"),false);
 assert.equal(await pointer(),null);
 assert.equal(await scalar('select analysis_id from sales_intelligence_case_analyses'),old);
});
await test('proof revoke failure rolls back source archival and lifecycle atomically',async()=>{
 await reset();const old=await initial();
 const v22='44444444-4444-4444-8444-444444444444';
 await db.query("insert into whatsapp_customer_cases_v22(id,case_json,case_key,root_source_id,case_type,case_state,started_at,last_event_at) values($1,$2::jsonb,'fixture','11111111-1111-4111-8111-111111111111','order','open','2026-01-01','2026-01-01')",[v22,JSON.stringify({canonicalSaleProof:{salesCaseId:'a'}})]);
 await db.query("update sales_intelligence_cases set source_case_id_v22=$1 where case_id='a'",[v22]);
 await db.exec("CREATE OR REPLACE FUNCTION public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(uuid,text,jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$;");
 await assert.rejects(()=>db.query("update whatsapp_review_sources set review_status='archived' where id=$1",[source]));
 assert.equal(await pointer(),old);assert.equal(await current(),old);
 assert.equal(await scalar('select review_status from whatsapp_review_sources where id=$1',[source]),'new');
});
await test('rollback restores exact owner ACL security and config as well as bodies',async()=>{
 await db.exec(read('sql/rollback.sql'));
 for(const [name,config] of [['sales_intelligence_reconcile_case_set_v1',['search_path=public, pg_catalog']],['sales_intelligence_write_case_analysis',['search_path=public, pg_temp']],['dawaa_archive_superseded_whatsapp_source_v35',['search_path=public']]]){
  const r=(await query('select pg_get_userbyid(proowner) owner,prosecdef,proconfig,proacl::text acl from pg_proc where proname=$1',[name]))[0];
  assert.equal(r.owner,'postgres');assert.equal(r.prosecdef,true);assert.deepEqual(r.proconfig,config);
  assert.equal(r.acl,name==='dawaa_archive_superseded_whatsapp_source_v35'?'{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}':'{postgres=X/postgres,service_role=X/postgres}');
 }
 assert.equal(await md5('sales_intelligence_reconcile_case_set_v1'),expected);
 assert.equal(await md5('sales_intelligence_write_case_analysis'),'c6c53c94a20cfdbf2946371398790d98');
 assert.equal(await md5('dawaa_archive_superseded_whatsapp_source_v35'),'fd7b5e40f631e4633049147cb2933ee7');
});
await test('final reapply after full rollback restores all candidates',async()=>{
 await install();if(!native) await db.exec(read('sql/archive-candidate.sql'));if(!native) await db.exec(read('sql/archive-writer-candidate.sql'));
 assert.equal(await md5('sales_intelligence_reconcile_case_set_v2'),v2md5);
});
await test('single transaction release bundle installs all candidates after rollback',async()=>{
 await db.exec(read('sql/rollback.sql'));
 await db.exec(read('sql/phase-a-release-candidate.sql'));
 assert.equal(await md5('sales_intelligence_reconcile_case_set_v2'),v2md5);
 assert.equal(await md5('dawaa_archive_superseded_whatsapp_source_v35'),'5209146fa7e69c228de39ca7cfc0c9e9');
});
await test('read-only Phase A postcheck executes and validates all candidate hashes and unchanged data',async()=>{
 const casesHash=await scalar("select md5(coalesce(string_agg(to_jsonb(c)::text,'|' order by case_id),'')) from sales_intelligence_cases c");
 const analysesHash=await scalar("select md5(coalesce(string_agg(to_jsonb(a)::text,'|' order by analysis_id),'')) from sales_intelligence_case_analyses a");
 const sql=read('sql/postcheck-phase-a.sql').replace(":'expected_cases'","'"+casesHash+"'").replace(":'expected_analyses'","'"+analysesHash+"'");
 const results=await db.exec(sql);
 const rows=results.flatMap(r=>r.rows);
 assert.equal(rows.filter(r=>'body_matches' in r).length,4);
 assert.ok(rows.filter(r=>'body_matches' in r).every(r=>r.body_matches===true));
 assert.ok(rows.find(r=>'no_case_changes' in r).no_case_changes);
 assert.ok(rows.find(r=>'no_analysis_or_history_changes' in r).no_analysis_or_history_changes);
});
await test('read-only historical postcheck executes and detects no unrelated changes/history deletion in fixture',async()=>{
 const cases=await scalar("select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from sales_intelligence_cases c");
 const ids=await scalar("select coalesce(jsonb_agg(analysis_id::text),'[]'::jsonb) from sales_intelligence_case_analyses");
 const quote=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'";
 const sql=read('sql/postcheck-after-approved-repair.sql').replaceAll(":'baseline_cases'",quote(cases)).replaceAll(":'baseline_analysis_ids'",quote(ids)).replaceAll(":'approved_source_ids'",quote([source]));
 const results=await db.exec(sql);
 assert.ok(results.slice(-4,-1).every(r=>r.rows.length===0));
});
await test('automatic reviews retire while human review and all history remain',async()=>{
 await reset();await initial();
 await db.exec("insert into conversation_sales_reviews(evaluation_kind,sales_intelligence_case_id,is_current) values('automatic','a',true),('manual','a',true)");
 await reconcile([],{});
 assert.equal(await scalar("select count(*)::int from conversation_sales_reviews where evaluation_kind='automatic' and is_current"),0);
 assert.equal(await scalar("select count(*)::int from conversation_sales_reviews where evaluation_kind='manual' and is_current"),1);
 assert.equal(await scalar('select count(*)::int from conversation_sales_reviews'),2);
});
await test(native?'strict precheck rejects installed candidate state':'strict Production precheck refuses different local PostgreSQL version',async()=>{
 await assert.rejects(()=>db.exec(read('sql/precheck.sql')),native?/function baseline drift/:/role\/version drift/);
 await db.exec('ROLLBACK');
});
if(native) await (await import('./verification/batch4NativeConcurrency.mjs')).runNativeConcurrency({db,test,reset,c,write,reconcile,query,scalar,row,source,other,pointer,current});
console.log(JSON.stringify({passed,failed:0,baselineMd5:expected,v2md5,postgres:await scalar('select version()')}));
await db.close();
