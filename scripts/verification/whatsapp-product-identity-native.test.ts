import { it, expect } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runSalesIntelligencePipeline } from '../../src/lib/salesIntelligence/salesIntelligencePipeline';
import { buildCanonicalProduct, countNormalizedNames } from '../../src/lib/salesIntelligence/pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../../src/lib/salesIntelligence/pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../../src/lib/salesIntelligence/pharmacyProducts/pharmacyProductResolverV2';
import { fetchVerifiedProductIdentityReviews } from '../../src/lib/salesIntelligence/persistence/productIdentityReviewEvidenceRepository';

// Test-only transport: real SQL in a network-disabled container. Authorization helpers
// use explicit local test settings; this is NOT a verified-session end-to-end test.
const container = process.env.DAWAA_NATIVE_PG_CONTAINER || 'dawaa-wa-0815-local';
mkdirSync('evidence', {recursive:true});
const database = 'hero_identity_v2';
function sql(text: string, db = database) {
  const r = spawnSync('docker', ['exec','-i',container,'psql','-X','-qAt','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1'], {input:text,encoding:'utf8',timeout:60000});
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message || 'SQL failed');
  return r.stdout.trim();
}
function json(text: string) { return JSON.parse(sql(text)); }
const literal = (x: unknown) => "'" + String(x).replaceAll("'", "''") + "'";
const source = '22222222-2222-4222-8222-222222222222';
const analysis = '33333333-3333-4333-8333-333333333333';
const product = '44444444-4444-4444-8444-444444444444';
const line = '55555555-5555-4555-8555-555555555555';
const actor = '11111111-1111-4111-8111-111111111111';
const asManager = `set test.actor_id='${actor}'; set test.top_management='true'; set test.can_approve_reviews='true';`;
const catalogRow = {id:product,product_code:'TEST-HERO-2',name:'HERO BABY MILK 2',normalized_name:'hero baby milk 2',category:null,price:280,source:'synthetic'};
const catalog = buildPharmacyProductIndex([buildCanonicalProduct(catalogRow,countNormalizedNames([catalogRow]),normalizePharmacyText)]);
const raw = `[10/27/26, 6:10:00 PM] عميل اختبار: السلام عليكم عايزه علبه لبن هيرو بيبي 2\n[10/27/26, 6:11:00 PM] You: تحت أمر حضرتك`;
function analyze(reviews: any[] = []) {
  return runSalesIntelligencePipeline({conversationId:source,rawWhatsAppExportText:raw,
    trustedConversationStartedAt:'2026-10-27T15:10:00.000Z',customerIdHint:'40000000-0000-4000-8000-000000000001',
    customerCodeHint:'SYNTH-900001',customerNameHint:'عميل اختبار',customerIdentityStatus:'resolved',
    trustedInvoiceId:'SYNTH-INVOICE-1',trustedInvoiceNumber:'SYNTH-1',productIndex:catalog,
    resolveInvoiceCandidates:()=>[{id:'SYNTH-INVOICE-1',invoice_number:'SYNTH-1',customer_id:'40000000-0000-4000-8000-000000000001',customer_code:'SYNTH-900001',invoice_datetime:'2026-10-27T15:18:00.000Z',net_amount:280}],
    verifiedProductIdentityReviews:reviews}).caseAnalyses[0];
}
// Implements only the read-model transport used by the real repository, with bound
// identifiers and quoted literals. There is no HTTP client or remote URL.
const client = {from(table: string) {
  if (!['whatsapp_product_identity_manager_reviews_v1','whatsapp_review_sources','sales_invoice_items_v21'].includes(table)) throw Error('table refused');
  return {select(columns: string) { return {eq() { return this; }, in(column: string, values: string[]) {
    if (!/^[a-z_,]+$/.test(columns) || !/^[a-z_]+$/.test(column)) throw Error('identifier refused');
    const query = (limit=100000) => Promise.resolve({data:json(`select coalesce(json_agg(q),'[]') from (select ${columns} from public.${table} where ${table === 'whatsapp_product_identity_manager_reviews_v1' ? 'is_current and ' : ''}${column} in (${values.map(literal).join(',')}) limit ${limit}) q`),error:null});
    return {limit:query,then:(resolve: any,reject: any)=>query().then(resolve,reject)};
  }}}};
}};

it('native PostgreSQL decision -> real evidence repository -> real canonical reanalysis; invalidation and ACL matrix', async () => {
  expect(spawnSync('docker',['inspect','-f','{{.HostConfig.NetworkMode}} {{.State.Running}}',container],{encoding:'utf8'}).stdout.trim()).toBe('none true');
  sql(`drop database if exists ${database} with (force); create database ${database}`, 'postgres');
  const fixture = readFileSync('supabase/tests/whatsapp_invoice_link_confirmation_v1.fixture.sql','utf8');
  // Production-shaped staff_accounts intentionally lacks the obsolete display_name column.
  sql(fixture);
  sql(readFileSync('supabase/migrations/20261012121500_whatsapp_invoice_link_confirmation_v1.sql','utf8'));
  sql('alter table staff_accounts drop column display_name');
  const fix = readFileSync('supabase/migrations/20261027050000_whatsapp_invoice_link_confirmation_staff_name_runtime_fix.sql','utf8');
  sql(fix);
  const beforeDefinition = sql(`select md5(pg_get_functiondef('public.dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)'::regprocedure))`);
  sql(fix); // Different production migration number is represented by an already-fixed body.
  expect(sql(`select md5(pg_get_functiondef('public.dawaa_confirm_whatsapp_invoice_link_v1(uuid,text,text,text)'::regprocedure))`)).toBe(beforeDefinition);
  const original = analyze();
  const items = original.itemsByBasketId[original.activeBasket!.basketId];
  expect(items).toHaveLength(1);
  expect(original.humanReviewReasons).toContain('product_identity_unresolved');
  const item = items[0];
  sql(`alter table whatsapp_review_sources add column source_hash text;
    create table sales_intelligence_cases(case_id text primary key,published_analysis_id uuid);
    create table products(id uuid primary key, product_code text, name text);
    create table sales_invoice_items_v21(id uuid primary key,invoice_id text,product_id text,product_code text,quantity numeric,raw_data jsonb);
    create table sales_intelligence_current_case_analyses(case_id text primary key,analysis_id uuid,evidence_snapshot jsonb);
    create table sales_intelligence_current_attributions(case_id text primary key,analysis_id uuid,selected_invoice_id text);
    create table staff(id uuid primary key,points numeric);
    create table employee_transactions(id uuid primary key,points_delta numeric,amount numeric,status text);
    create table synthetic_payroll_snapshot(id integer primary key,amount numeric);
    insert into staff values('${actor}',17); insert into employee_transactions values('${actor}',17,0,'pending');
    insert into synthetic_payroll_snapshot values(1,7000);
    insert into staff_accounts(id,name,staff_name,active,can_login,role) values('${actor}','Synthetic Manager','مدير اختبار',true,true,'general_manager');
    insert into whatsapp_review_sources(id,customer_id,customer_code,branch,source_hash) values('${source}','40000000-0000-4000-8000-000000000001','SYNTH-900001','فرع اختبار','synthetic-hash-v1');
    insert into sales_invoices(id,invoice_number,customer_id,customer_code,branch) values('SYNTH-INVOICE-1','SYNTH-1','40000000-0000-4000-8000-000000000001','SYNTH-900001','فرع اختبار');
    insert into products values('${product}','TEST-HERO-2','HERO BABY MILK 2');
    insert into sales_invoice_items_v21 values('${line}','SYNTH-INVOICE-1','${product}','TEST-HERO-2',1,'{"returned":0}');
    insert into sales_intelligence_cases values(${literal(original.caseId)},'${analysis}');
    insert into sales_intelligence_current_case_analyses values(${literal(original.caseId)},'${analysis}',${literal(JSON.stringify({caseIntelligence:{caseId:original.caseId,basket:{activeItems:items}}}))});
    insert into sales_intelligence_current_attributions values(${literal(original.caseId)},'${analysis}','SYNTH-INVOICE-1');
    ${asManager} select dawaa_confirm_whatsapp_invoice_link_v1('${source}','SYNTH-INVOICE-1','SYNTH-1','ربط فاتورة اختبار مصطنعة');`);
  const migration = readFileSync('supabase/migrations/20261027090000_whatsapp_product_identity_manager_review_v1.sql','utf8');
  sql(migration);
  const lifecycle = readFileSync('supabase/migrations/20261027103443_whatsapp_product_identity_review_history_v2.sql','utf8');
  sql(lifecycle); sql(lifecycle);
  const financial = () => json(`select json_build_object('staff',(select json_agg(s) from staff s),'ledger',(select json_agg(t) from employee_transactions t),'payroll',(select json_agg(p) from synthetic_payroll_snapshot p))`);
  const initialMoney = financial();
  const call = `select dawaa_confirm_whatsapp_product_identity_v1('${source}',${literal(original.caseId)},'${analysis}',${literal(item.itemId)},'${line}','راجعت كود وكمية صنف الاختبار')`;
  const checks: string[] = [];
  function refused(label: string, text: string, message: string) {
    expect(()=>sql(text)).toThrow(message); checks.push(label);
  }
  refused('no verified session',`set role anon; ${call}`,'product_identity_review_not_authorized');
  refused('non-manager',`set role authenticated; set test.actor_id='${actor}'; set test.can_approve_reviews='true'; ${call}`,'product_identity_review_not_authorized');
  refused('manager without permission',`set role anon; set test.actor_id='${actor}'; set test.top_management='true'; ${call}`,'product_identity_review_not_authorized');
  refused('stale analysis',`${asManager} ${call.replace(analysis,'66666666-6666-4666-8666-666666666666')}`,'product_identity_analysis_not_current');
  sql('update staff_accounts set can_login=false where id='+literal(actor));
  refused('disabled manager',`${asManager} ${call}`,'verified_manager_account_required');
  sql('update staff_accounts set can_login=true where id='+literal(actor));
  sql(`insert into sales_invoice_items_v21 select '66666666-6666-4666-8666-666666666666',invoice_id,product_id,product_code,quantity,raw_data from sales_invoice_items_v21`);
  refused('duplicate product line',`${asManager} ${call}`,'product_identity_invoice_line_ambiguous');
  sql(`delete from sales_invoice_items_v21 where id<>'${line}'; update sales_invoice_items_v21 set raw_data='{"returned":1}'`);
  refused('full return',`${asManager} ${call}`,'product_identity_quantity_mismatch');
  sql(`update sales_invoice_items_v21 set raw_data='{"returned":0}'`);
  sql("update sales_invoice_items_v21 set product_code='WRONG'");
  refused('product mismatch',`${asManager} ${call}`,'product_identity_invoice_line_mismatch');
  sql("update sales_invoice_items_v21 set product_code='TEST-HERO-2', invoice_id='OTHER-INVOICE'");
  refused('invoice mismatch',`${asManager} ${call}`,'product_identity_invoice_line_mismatch');
  sql("update sales_invoice_items_v21 set invoice_id='SYNTH-INVOICE-1',quantity=2");
  refused('quantity mismatch',`${asManager} ${call}`,'product_identity_quantity_mismatch');
  sql('update sales_invoice_items_v21 set quantity=1');
  const saved = json(`${asManager} set role anon; ${call}`);
  expect(saved.ok).toBe(true); expect(saved.idempotent).toBe(false);
  expect(json(`${asManager} set role authenticated; ${call}`).idempotent).toBe(true);
  expect(financial()).toEqual(initialMoney);
  expect(analyze().humanReviewReasons).toContain('product_identity_unresolved'); // approval alone does not reanalyze
  const reviews = await fetchVerifiedProductIdentityReviews(client,[source]);
  expect(reviews[source]).toHaveLength(1);
  const refreshed = analyze(reviews[source]);
  expect(refreshed.humanReviewReasons).not.toContain('product_identity_unresolved');
  expect(refreshed.managerProductIdentityReviewIds).toEqual([saved.review_id]);
  expect(refreshed.salesOutcome).toEqual({...original.salesOutcome,needsHumanReview:false});
  expect(refreshed.attribution).toEqual(original.attribution);
  expect(financial()).toEqual(initialMoney);
  for (const role of ['anon','authenticated']) {
    for (const verb of ['select * from','delete from','update']) {
      const q = verb==='update' ? `update whatsapp_product_identity_manager_reviews_v1 set reviewer_note='tampered'` : `${verb} whatsapp_product_identity_manager_reviews_v1`;
      refused(`${role} direct ${verb}`,`set role ${role}; ${q}`,'permission denied');
    }
  }
  expect(sql(`select relrowsecurity from pg_class where oid='whatsapp_product_identity_manager_reviews_v1'::regclass`)).toBe('t');
  refused('unauthorized history',`set role anon; select dawaa_list_whatsapp_product_identity_reviews_v1(${literal(original.caseId)})`,'product_identity_reviews_not_authorized');
  const invalidations = [
    ['source changed',`update whatsapp_review_sources set source_hash='changed' where id='${source}'`,`update whatsapp_review_sources set source_hash='synthetic-hash-v1' where id='${source}'`],
    ['invoice link revoked',`update whatsapp_review_sources set invoice_link_confirmed=false where id='${source}'`,`update whatsapp_review_sources set invoice_link_confirmed=true where id='${source}'`],
    ['return after approval',`update sales_invoice_items_v21 set raw_data='{"returned":1}'`,`update sales_invoice_items_v21 set raw_data='{"returned":0}'`],
    ['quantity changed',`update sales_invoice_items_v21 set quantity=2`,`update sales_invoice_items_v21 set quantity=1`],
    ['duplicate after approval',`insert into sales_invoice_items_v21 select '66666666-6666-4666-8666-666666666666',invoice_id,product_id,product_code,quantity,raw_data from sales_invoice_items_v21`,`delete from sales_invoice_items_v21 where id<>'${line}'`],
  ];
  for (const [label,change,restore] of invalidations) {
    sql(change); const invalid = await fetchVerifiedProductIdentityReviews(client,[source]);
    expect(invalid).toEqual({}); expect(analyze(invalid[source]??[]).humanReviewReasons).toContain('product_identity_unresolved');
    checks.push(label); sql(restore);
  }
  const originalHistory = json("select to_jsonb(r) - 'is_current' from whatsapp_product_identity_manager_reviews_v1 r");
  const nextAnalysis = '77777777-7777-4777-8777-777777777777';
  sql(`update whatsapp_review_sources set source_hash='synthetic-hash-v2' where id='${source}';
    update sales_intelligence_cases set published_analysis_id='${nextAnalysis}';
    update sales_intelligence_current_case_analyses set analysis_id='${nextAnalysis}';
    update sales_intelligence_current_attributions set analysis_id='${nextAnalysis}'`);
  expect(await fetchVerifiedProductIdentityReviews(client,[source])).toEqual({});
  const nextCall = call.replace(analysis,nextAnalysis);
  refused('outdated analysis after source change',`${asManager} ${call}`,'product_identity_analysis_not_current');
  // Independent psql connections really contend on the source/publication row locks.
  const concurrent = () => new Promise<any>((resolve,reject) => {
    const child = spawn('docker',['exec','-i',container,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1']);
    let out='',err=''; child.stdout.on('data',d=>{out+=d});child.stderr.on('data',d=>{err+=d});
    child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(out.trim())):reject(Error(err)));
    child.stdin.end(`${asManager} set role anon; ${nextCall}`);
  });
  const races = await Promise.all([concurrent(),concurrent(),concurrent(),concurrent()]);
  expect(new Set(races.map(r=>r.review_id)).size).toBe(1);
  expect(races.filter(r=>!r.idempotent)).toHaveLength(1);
  const replacement = races[0].review_id;
  expect(replacement).not.toBe(saved.review_id);
  expect(sql('select count(*) from whatsapp_product_identity_manager_reviews_v1')).toBe('2');
  expect(sql('select count(*) from whatsapp_product_identity_manager_reviews_v1 where is_current')).toBe('1');
  expect(json(`select to_jsonb(r) - 'is_current' from whatsapp_product_identity_manager_reviews_v1 r where id='${saved.review_id}'`)).toEqual(originalHistory);
  expect(sql(`select supersedes_review_id from whatsapp_product_identity_manager_reviews_v1 where id='${replacement}'`)).toBe(saved.review_id);
  refused('history facts cannot be edited',`update whatsapp_product_identity_manager_reviews_v1 set reviewer_note='changed history' where id='${saved.review_id}'`,'product_identity_history_immutable');
  refused('history cannot be deleted',`delete from whatsapp_product_identity_manager_reviews_v1 where id='${saved.review_id}'`,'product_identity_history_immutable');
  const currentReviews = await fetchVerifiedProductIdentityReviews(client,[source]);
  expect(currentReviews[source].map(r=>r.reviewId)).toEqual([replacement]);
  const reanalyzed = analyze(currentReviews[source]);
  expect(reanalyzed.managerProductIdentityReviewIds).toEqual([replacement]);
  expect(reanalyzed.humanReviewReasons).not.toContain('product_identity_unresolved');
  expect(json(`${asManager} ${nextCall}`).idempotent).toBe(true);
  // A semantic no-op publication must also remain idempotent after validating its new ID.
  sql(`update sales_intelligence_cases set published_analysis_id='${analysis}'; update sales_intelligence_current_case_analyses set analysis_id='${analysis}'; update sales_intelligence_current_attributions set analysis_id='${analysis}'`);
  expect(json(`${asManager} ${call}`).review_id).toBe(replacement);
  checks.push('source renewal preserves history','four concurrent approvals -> one successor','only new decision consumed','unchanged evidence across analysis IDs is idempotent');
  sql(lifecycle); // Reapplying after history exists does not reactivate old rows.
  expect(sql('select count(*) from whatsapp_product_identity_manager_reviews_v1 where is_current')).toBe('1');
  expect(financial()).toEqual(initialMoney);
  writeFileSync('evidence/hero-identity-v2-result.json',JSON.stringify({status:'PASS',database,checks,reviewId:saved.review_id,caseId:original.caseId,
    beforeReasons:original.humanReviewReasons,afterReasons:refreshed.humanReviewReasons,financialUnchanged:true,
    limitation:'SQL transport + canonical pipeline; session authorization helpers are test settings; no HTTP endpoint/UI or full payroll projection exercised'},null,2));
},240000);
