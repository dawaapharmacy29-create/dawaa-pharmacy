// Opt-in extension of the existing full, LOCAL-ONLY database rehearsal.
// Replays captured runtime definitions, not reduced test.actor authorization stubs.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';

export async function runFollowupAuthorizationRehearsal({db,psql,query,read,step}) {
  assert.match(db,/^dawaa_staging_\d+$/,'only the existing disposable local runner database is accepted');
  const capture=JSON.parse(read('scripts/staging/fixtures/canonical-followup-runtime-definitions.json'));
  const schema=JSON.parse(read('scripts/staging/fixtures/canonical-followup-runtime-schema.json'));
  schema.columns.push(...JSON.parse(read('scripts/staging/fixtures/canonical-followup-daily-columns.json')));
  const grants=JSON.parse(read('scripts/staging/fixtures/canonical-followup-runtime-grants.json'));
  const quote=value=>`'${String(value).replaceAll("'","''")}'`;
  const ident=value=>`"${String(value).replaceAll('"','""')}"`;
  const execute=sql=>psql(db,sql);
  const q=sql=>query(db,sql);
  const invoiceBefore=await q("select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by s.id::text),'')) from sales_invoices s");
  const productsBefore=await q("select md5(coalesce(string_agg(to_jsonb(p)::text,'|' order by p.id::text),'')) from products p");
  // Extend the existing domain tables using catalog-captured column types/defaults, not guesses.
  for(const table of new Set(schema.columns.map(c=>c.table))) await execute(`create table if not exists public.${ident(table)}();`);
  const existingTypes=JSON.parse(await q("select coalesce(jsonb_object_agg(c.relname||'.'||a.attname,format_type(a.atttypid,a.atttypmod)),'{}') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and a.attnum>0 and not a.attisdropped"));
  for(const col of schema.columns) {
    await execute(`alter table public.${ident(col.table)} add column if not exists ${ident(col.column)} ${col.type};`);
    if(existingTypes[`${col.table}.${col.column}`] && existingTypes[`${col.table}.${col.column}`]!==col.type) {
      await execute(`alter table public.${ident(col.table)} alter column ${ident(col.column)} type ${col.type} using ${ident(col.column)}::${col.type};`);
    }
    if(col.default!==null) await execute(`alter table public.${ident(col.table)} alter column ${ident(col.column)} set default ${col.default};`);
  }
  for(const index of JSON.parse(read('scripts/staging/fixtures/canonical-followup-runtime-indexes.json'))) {
    await execute(`drop index if exists public.${ident(index.indexname)};${index.indexdef};`);
  }
  // The old bootstrap used a membership table. Exercise the ACTUAL V22 ownership/archival view.
  await execute('drop table public.whatsapp_operational_canonical_sources_v1 cascade;');
  await execute(`create view public.whatsapp_operational_canonical_sources_v1 as ${schema.canonicalView}`);
  for(const fn of capture.functions) await psql(db,fn.definition,{options:'-c check_function_bodies=off'});
  for(const fn of grants) {
    await execute(`revoke all on function public.${fn.signature} from public,anon,authenticated,service_role;`);
    for(const grant of fn.grants) await execute(`grant execute on function public.${fn.signature} to ${grant.role==='PUBLIC'?'public':ident(grant.role)};`);
  }
  for(const table of ['daily_followups','whatsapp_review_sources','whatsapp_conversation_actions']) {
    const policies=(await q(`select coalesce(json_agg(policyname),'[]') from pg_policies where schemaname='public' and tablename=${quote(table)}`));
    for(const name of JSON.parse(policies)) await execute(`drop policy ${ident(name)} on public.${ident(table)};`);
    await execute(`alter table public.${ident(table)} enable row level security;
      revoke all on public.${ident(table)} from public,anon,authenticated;
      grant select on public.${ident(table)} to anon,authenticated;`);
  }
  await execute('grant insert,update on whatsapp_review_sources,whatsapp_conversation_actions to anon,authenticated;');
  for(const policy of capture.policies) {
    const roles=policy.roles.slice(1,-1).split(',').map(r=>r==='public'?'public':ident(r)).join(',');
    await execute(`create policy ${ident(policy.policyname)} on public.${ident(policy.tablename)} as ${policy.permissive}
      for ${policy.cmd} to ${roles}${policy.qual?` using (${policy.qual})`:''}${policy.with_check?` with check (${policy.with_check})`:''};`);
  }
  const migration=read('supabase/migrations/20261018061544_canonical_followup_projection_lifecycle.sql');
  const before=await q(`select count(*) from whatsapp_conversation_actions`);
  await execute(migration); await execute(migration);
  assert.equal(await q(`select count(*) from whatsapp_conversation_actions`),before,'installation must not backfill');
  step('V29 candidate installs twice on full domain schema without business writes');

  const accounts={agent:'00000000-0000-4000-8000-0000000000a1',manager:'00000000-0000-4000-8000-0000000000a2',
    other:'00000000-0000-4000-8000-0000000000a3',inactive:'00000000-0000-4000-8000-0000000000a4'};
  // Entirely synthetic local sessions. Raw fixture tokens are never logged, returned or persisted
  // outside this disposable database process. Production session rows are never read/copied.
  const tokens={};
  for(const [name,id] of Object.entries(accounts)) {
    const token=randomBytes(32).toString('hex');tokens[name]=token;
    await execute(`insert into staff_login_sessions(staff_account_id,token_hash,expires_at)
      values(${quote(id)},${quote(createHash('sha256').update(token).digest('hex'))},now()+interval '1 hour');`);
  }
  const actor=(name,sql,extraHeaders={})=>`begin;set local role anon;set local request.headers=
    ${quote(JSON.stringify({...extraHeaders,...(name?{'x-dawaa-session-token':tokens[name]}:{})}))};${sql};commit;`;
  const as=async(name,sql,extraHeaders={})=>(await execute(actor(name,sql,extraHeaders))).stdout.trim().split('\n').at(-1);
  const denied=async(name,sql,error)=>{
    const result=await psql(db,actor(name,sql),{allowError:true});
    assert.notEqual(result.code,0,'unauthorized command must fail');
    assert.match(result.stderr,error);return result;
  };
  assert.equal(await as('agent','select dawaa_current_staff_account_id_strict()'),accounts.agent);
  assert.equal(await as(null,'select dawaa_current_staff_account_id_strict()',{'x-dawaa-user-id':accounts.manager}),'');
  assert.equal(await as('inactive','select dawaa_current_staff_account_id_strict()'),'');
  assert.equal(await as('agent',"select dawaa_current_actor_can(array['add_reviews'])"),'t');
  step('actual hashed-session resolver and role permission composition authorize the synthetic actor');
  await execute(`update staff_login_sessions set revoked_at=now() where staff_account_id='${accounts.agent}';`);
  assert.equal(await as('agent','select dawaa_current_staff_account_id_strict()'),'');
  await execute(`update staff_login_sessions set revoked_at=null,expires_at=now()-interval '1 minute' where staff_account_id='${accounts.agent}';`);
  assert.equal(await as('agent','select dawaa_current_staff_account_id_strict()'),'');
  await execute(`update staff_login_sessions set expires_at=now()+interval '1 hour' where staff_account_id='${accounts.agent}';`);
  assert.equal(await as(null,'select dawaa_current_staff_account_id_strict()',{'x-dawaa-session-token':randomBytes(32).toString('hex')}),'');
  step('actual session resolver rejects revoked, expired and unknown synthetic sessions');


  const source='00000000-0000-4000-8000-000000000091';
  const envelope='00000000-0000-4000-8000-000000000092';
  const analysis='00000000-0000-4000-8000-000000000093';
  const customer='00000000-0000-4000-8000-0000000000c1';
  const caseId=source+':interaction:0';
  const key='fu1|isolated-full-schema-v29|delivery-unresolved';
  const owner='si-canonical-followup-projection-v1';
  const opportunity={followUpKey:key,status:'actionable',blocker:null,customerId:customer,reason:'delivery_unresolved'};
  await execute(`insert into whatsapp_review_sources(id,source_filename,source_hash,branch,staff_id,customer_id,customer_name,customer_code,
      raw_text,conversation_started_at,conversation_ended_at,review_status)
    values('${source}','synthetic-v29-integration.txt','synthetic-v29-integration','فرع شكري','${accounts.agent}',
      '${customer}','Synthetic Customer One','SYN-C1','synthetic promise','2026-10-18T10:00:00Z','2026-10-18T10:05:00Z','ready_quick');
    insert into whatsapp_customer_cases_v22(id,case_key,case_type,case_state,root_source_id,source_ids,started_at,last_event_at)
      values('${envelope}','synthetic-v29-integration','order','open','${source}',array['${source}']::uuid[],'2026-10-18T10:00:00Z','2026-10-18T10:05:00Z');
    insert into sales_intelligence_cases(case_id,conversation_id,is_active,source_case_id_v22,case_started_at)
      values('${caseId}','${source}',true,'${envelope}','2026-10-18T10:00:00Z');
    insert into sales_intelligence_case_analyses
      select (jsonb_populate_record(null::sales_intelligence_case_analyses,to_jsonb(a)||${quote(JSON.stringify({
        analysis_id:analysis,case_id:caseId,analysis_version:1,is_current:true,superseded_at:null,superseded_by_analysis_id:null,
        evidence_snapshot:{caseIntelligence:{followUp:{opportunities:[opportunity]}}}
      }))}::jsonb)).* from sales_intelligence_case_analyses a limit 1;
    update sales_intelligence_cases set published_analysis_id='${analysis}' where case_id='${caseId}';`);
  assert.equal(await q(`select count(*) from whatsapp_operational_canonical_sources_v1 where source_id='${source}'`),'1');
  const row={source_id:source,action_key:'canonical-followup:'+key,action_type:'customer_followup',branch:'فرع شكري',
    customer_id:customer,customer_name:'Synthetic Customer One',customer_code:'SYN-C1',followup_identity:key,created_by:owner,
    reason:'Synthetic delivery promise',evidence:['synthetic-message'],payload:{caseId,canonicalAnalysisId:analysis,
      canonicalProjectionVersion:owner,canonicalReason:'delivery_unresolved',priority:'normal'}};
  const reconcile=`select dawaa_reconcile_canonical_followup_actions_v1('${source}',${quote(JSON.stringify({[caseId]:analysis}))}::jsonb,${quote(JSON.stringify([row]))}::jsonb)`;
  await denied('agent',reconcile,/permission denied/);
  await execute(`set role service_role;${reconcile};reset role;`);
  const action=await q(`select id from whatsapp_conversation_actions where followup_identity=${quote(key)}`);
  assert.ok(action);
  const materialize=`select dawaa_materialize_whatsapp_action_v1('${action}')`;
  assert.equal(await as('agent',`select count(*) from whatsapp_conversation_actions where id='${action}'`),'1');
  assert.equal(await as('other',`select count(*) from whatsapp_conversation_actions where id='${action}'`),'0');
  await denied(null,materialize,/not_authorized/);
  await denied('other',materialize,/whatsapp_action_access_denied/);
  await denied('inactive',materialize,/not_authorized/);
  await denied('agent',`select dawaa_materialize_whatsapp_action_core_v2('${action}')`,/permission denied/);
  step('real RLS and command checks deny missing/inactive/cross-branch actors and direct internal calls');

  await execute(`insert into staff_permission_overrides(staff_account_id,permission_key,allowed) values('${accounts.agent}','add_reviews',false);`);
  await denied('agent',materialize,/whatsapp_action_execute_permission_denied/);
  await execute(`delete from staff_permission_overrides where staff_account_id='${accounts.agent}' and permission_key='add_reviews';`);
  step('actual account permission override prevents materialization');

  // Current customer already has a synthetic open general follow-up from the baseline. It must link.
  const followupsBefore=await q('select count(*) from daily_followups');
  const result=JSON.parse(await as('agent',materialize));
  assert.equal(result.ok,true);
  const target=await q(`select target_id from whatsapp_conversation_actions where id='${action}'`);
  assert.ok(target);
  assert.equal(await q('select count(*) from daily_followups'),followupsBefore,'existing open general follow-up should link');
  assert.equal(await q(`select count(*) from daily_followups where id=${quote(target)} and branch='فرع شكري' and customer_id='${customer}'`),'1');
  const auditBefore=await q(`select count(*) from whatsapp_review_audit where source_id='${source}'`);
  const eventsBefore=await q(`select count(*) from customer_service_followup_events where followup_id=${quote(target)}`);
  const repeated=JSON.parse(await as('agent',materialize));
  assert.equal(repeated.already_created,true);
  assert.equal(await q(`select count(*) from whatsapp_review_audit where source_id='${source}'`),auditBefore);
  assert.equal(await q(`select count(*) from customer_service_followup_events where followup_id=${quote(target)}`),eventsBefore);
  step('actual materializer links a real isolated daily_followups record and retry preserves audit/target lineage');
  assert.equal(await q(`select count(*) from whatsapp_review_audit where source_id='${source}' and actor_id='${accounts.agent}' and action='operational_action_materialized'`),'1');
  await denied('manager',`update whatsapp_conversation_actions set payload=payload||'{"canonicalAnalysisId":"forged"}'::jsonb where id='${action}'`,/canonical_followup_provenance_is_system_owned/);
  await denied('agent',"insert into daily_followups(id) values('synthetic-direct-write-forbidden')",/permission denied/);
  await denied('agent',"select dawaa_materialize_whatsapp_action_v1('00000000-0000-4000-8000-0000000000e1')",/customer_request_materialization_permission_denied/);
  await denied('manager',"select dawaa_materialize_whatsapp_action_v1('00000000-0000-4000-8000-0000000000e1')",/customer_request_requires_explicit_approval/);
  step('real provenance trigger, audit actor, direct-write restriction and customer-request approval gates preserved');


  // A distinct customer exercises an actual INSERT through the real operational core.
  const otherCustomer='00000000-0000-4000-8000-0000000000c2';
  const fresh=JSON.parse(await as('manager',`select dawaa_create_or_link_customer_followup_v1('${otherCustomer}',
    'SYN-C2','Synthetic Customer Two',null,'فرع شكري','general','synthetic',null,'متوسطة',null,
    'synthetic-v29-new-followup','isolated-v29')`));
  assert.equal(fresh.created,true);
  assert.equal(await q(`select count(*) from daily_followups where id=${quote(fresh.followup_id)} and customer_id='${otherCustomer}' and branch='فرع شكري'`),'1');
  step('real authorized writer creates one fresh isolated follow-up');
  const complaintCall=`select dawaa_create_or_link_customer_followup_v1('${otherCustomer}',
    'SYN-C2','Synthetic Customer Two',null,'فرع شكري','complaint','synthetic complaint',null,'متوسطة',null,
    'synthetic-v29-complaint','isolated-v29')`;
  await denied('manager',complaintCall,/duplicate key value violates unique constraint/);
  step('captured runtime mismatch reproduced: complaint cannot link to an existing general follow-up');
  const guards=JSON.parse(read('scripts/staging/fixtures/canonical-followup-before-insert-guards.json'));
  for(const fn of guards.functions) await psql(db,fn.definition,{options:'-c check_function_bodies=off'});
  for(const trigger of guards.triggers) await execute(`drop trigger if exists ${ident(trigger.tgname)} on daily_followups;${trigger.definition};`);
  const rowsBeforeGuardProbe=await q('select count(*) from daily_followups');
  const guardedProbe=actor('manager',`${complaintCall};select jsonb_build_object('is_hidden',is_hidden,
    'is_duplicate',is_duplicate,'archived',archived_at is not null,'duplicate_of',duplicate_of)
    from daily_followups where client_request_id='synthetic-v29-complaint'`).replace(/commit;$/,'rollback;');
  const guardedResult=JSON.parse((await execute(guardedProbe)).stdout.trim().split('\n').at(-1));
  assert.deepEqual(guardedResult,{is_hidden:true,is_duplicate:true,archived:true,duplicate_of:fresh.followup_id});
  assert.equal(await q('select count(*) from daily_followups'),rowsBeforeGuardProbe,'diagnostic insert must roll back');
  step('actual BEFORE triggers reproduce a hidden archived duplicate; diagnostic transaction rolled back');

  // Existing source-only prerequisite, NOT a newly invented writer or production activation.
  await execute(read('supabase/migrations/20261009180000_customer_followup_one_open_case_contract_a_v1.sql'));
  const linked=JSON.parse(await as('manager',complaintCall));
  assert.equal(linked.followup_id,fresh.followup_id);
  assert.equal(linked.created,false);
  assert.equal(linked.linked_to_open_case,true);
  const events=await q(`select count(*) from customer_service_followup_events where followup_id=${quote(fresh.followup_id)}`);
  const linkedRetry=JSON.parse(await as('manager',complaintCall));
  assert.equal(linkedRetry.followup_id,fresh.followup_id);
  assert.equal(await q(`select count(*) from customer_service_followup_events where followup_id=${quote(fresh.followup_id)}`),events);
  assert.equal(await q(`select count(*) from daily_followups where customer_id='${otherCustomer}' and branch='فرع شكري' and completed_at is null and archived_at is null`),'1');
  step('existing Contract A candidate resolves the reproduced mismatch and complaint retry adds no duplicate event');
  const newCustomer='00000000-0000-4000-8000-0000000000c3';
  await execute(`insert into customers(id,customer_code,name,branch) values('${newCustomer}','SYN-C3','Synthetic Guard Customer','فرع شكري');`);
  const visibleBefore=await q('select count(*) from daily_followups where coalesce(is_hidden,false)=false');
  const guardedFresh=JSON.parse(await as('manager',`select dawaa_create_or_link_customer_followup_v1('${newCustomer}',
    'SYN-C3','Synthetic Guard Customer','01000000003','فرع شكري','general','synthetic guarded create',null,'متوسطة',null,
    'synthetic-v31-guarded-create','isolated-v31')`));
  assert.equal(guardedFresh.created,true);
  assert.equal(await q(`select count(*) from daily_followups where id=${quote(guardedFresh.followup_id)}
    and customer_id='${newCustomer}' and branch='فرع شكري' and coalesce(is_hidden,false)=false
    and coalesce(is_duplicate,false)=false and archived_at is null and created_by='${accounts.manager}'`),'1');
  assert.equal(Number(await q('select count(*) from daily_followups where coalesce(is_hidden,false)=false')),Number(visibleBefore)+1);
  step('candidate writer creates a visible fresh follow-up under all captured BEFORE guards, preserving actor and branch');
  // Positive customer-request execution through the captured canonical functions.
  // Synthetic local records only. Incentive AFTER triggers are not simulated here.
  const requestRuntime=JSON.parse(read('scripts/staging/fixtures/canonical-request-runtime.json'));
  for(const table of ['staff','customer_request_incentive_events']) await execute(`create table if not exists public.${ident(table)}();`);
  for(const col of requestRuntime.columns.filter(c=>['staff','customer_requests','customer_request_events','customer_request_incentive_events'].includes(c.table))) {
    await execute(`alter table public.${ident(col.table)} add column if not exists ${ident(col.column)} ${col.type};`);
    if(col.default!==null) await execute(`alter table public.${ident(col.table)} alter column ${ident(col.column)} set default ${col.default};`);
  }
  await execute('alter table customer_requests alter column customer_id type text using customer_id::text;');
  for(const fn of requestRuntime.functions) await psql(db,fn.definition,{options:'-c check_function_bodies=off'});
  const doctor='00000000-0000-4000-8000-0000000000d1';
  const requestAction='00000000-0000-4000-8000-0000000000e1';
  await execute(`insert into staff(id,name,branch,active,is_active) values('${doctor}','Synthetic Canonical Doctor','فرع شكري',true,true);
    update whatsapp_conversation_actions set product_id='00000000-0000-4000-8000-0000000000f1',staff_id='${doctor}',quantity=2,
      payload='{"approvalSource":"human_review_v2","approvedBy":"${accounts.manager}","approvedAt":"2026-10-19T06:00:00Z"}'::jsonb
    where id='${requestAction}';`);
  const requestsBefore=Number(await q('select count(*) from customer_requests'));
  const requestResult=JSON.parse(await as('manager',`select dawaa_materialize_whatsapp_action_v1('${requestAction}')`));
  assert.equal(requestResult.ok,true);
  assert.equal(Number(await q('select count(*) from customer_requests')),requestsBefore+1);
  const requestTarget=await q(`select target_id from whatsapp_conversation_actions where id='${requestAction}'`);
  assert.equal(await q(`select count(*) from customer_requests where id='${requestTarget}' and customer_id='${customer}' and doctor_id='${doctor}' and branch='فرع شكري' and product_code='SYN-PANADOL-EXTRA-24' and quantity=2`),'1');
  step('explicitly approved canonical request creates one isolated linked request with exact customer/product/staff/branch');
  const requestAudit=await q(`select count(*) from whatsapp_review_audit where source_id='00000000-0000-4000-8000-000000000051'`);
  const requestEvents=await q(`select count(*) from customer_request_events where request_id='${requestTarget}'`);
  await denied('manager',`select dawaa_materialize_whatsapp_action_v1('${requestAction}')`,/customer_request_requires_explicit_approval/);
  step('captured V29 request retry defect reproduced after successful creation, without additional writes');
  await execute(read('supabase/migrations/20261019093000_customer_request_materialization_retry_v1.sql'));
  await execute(read('supabase/migrations/20261019093000_customer_request_materialization_retry_v1.sql'));
  await denied('manager',"select dawaa_materialize_whatsapp_action_v1('00000000-0000-4000-8000-0000000000e2')",/customer_request_requires_explicit_approval/);
  const requestRetry=JSON.parse(await as('manager',`select dawaa_materialize_whatsapp_action_v1('${requestAction}')`));
  assert.equal(requestRetry.already_created,true);
  assert.equal(requestRetry.target_id,requestTarget);
  assert.equal(Number(await q('select count(*) from customer_requests')),requestsBefore+1);
  assert.equal(await q(`select count(*) from customer_request_events where request_id='${requestTarget}'`),requestEvents);
  assert.equal(await q(`select count(*) from whatsapp_review_audit where source_id='00000000-0000-4000-8000-000000000051'`),requestAudit);
  step('approved customer-request retry returns existing target without duplicate request, event or audit');
  await denied(null,`select dawaa_materialize_whatsapp_action_v1('${requestAction}')`,/not_authorized/);
  await denied('other',`select dawaa_materialize_whatsapp_action_v1('${requestAction}')`,/whatsapp_action_access_denied/);
  await denied('agent',`select dawaa_materialize_whatsapp_action_v1('${requestAction}')`,/customer_request_materialization_permission_denied/);
  await execute(`update whatsapp_conversation_actions set target_id='00000000-0000-4000-8000-000000000099' where id='${requestAction}';`);
  await denied('manager',`select dawaa_materialize_whatsapp_action_v1('${requestAction}')`,/customer_request_created_target_mismatch/);
  await execute(`update whatsapp_conversation_actions set target_id='${requestTarget}' where id='${requestAction}';`);
  step('completed retry still rejects missing/cross-branch/unprivileged actors and invalid target lineage');
  const complaintAction='00000000-0000-4000-8000-0000000000e9';
  await execute(`insert into whatsapp_conversation_actions(id,source_id,action_key,action_type,customer_id,customer_name,customer_code,branch,status,auto_eligible,reason,payload,created_by)
    values('${complaintAction}','${source}','synthetic-complaint-action','complaint_followup','${customer}','Synthetic Customer One','SYN-C1','فرع شكري','ready',false,'synthetic unresolved service complaint','{}','si-canonical-complaint-projection-v1');`);
  const complaintRows=await q('select count(*) from daily_followups');
  const complaintResult=JSON.parse(await as('manager',`select dawaa_materialize_whatsapp_action_v1('${complaintAction}')`));
  assert.equal(complaintResult.ok,true);
  const complaintTarget=await q(`select target_id from whatsapp_conversation_actions where id='${complaintAction}'`);
  assert.equal(complaintTarget,target,'complaint must link to the same existing open customer/branch follow-up');
  assert.equal(await q('select count(*) from daily_followups'),complaintRows);
  const complaintAudit=await q(`select count(*) from whatsapp_review_audit where source_id='${source}'`);
  const complaintEvents=await q(`select count(*) from customer_service_followup_events where followup_id='${complaintTarget}'`);
  const complaintRetry=JSON.parse(await as('manager',`select dawaa_materialize_whatsapp_action_v1('${complaintAction}')`));
  assert.equal(complaintRetry.already_created,true);
  assert.equal(await q('select count(*) from daily_followups'),complaintRows);
  assert.equal(await q(`select count(*) from whatsapp_review_audit where source_id='${source}'`),complaintAudit);
  assert.equal(await q(`select count(*) from customer_service_followup_events where followup_id='${complaintTarget}'`),complaintEvents);
  step('complaint action materializes into the single open case and retry creates no extra follow-up/event/audit');

  assert.equal(await q("select md5(coalesce(string_agg(to_jsonb(s)::text,'|' order by s.id::text),'')) from sales_invoices s"),invoiceBefore);
  assert.equal(await q("select md5(coalesce(string_agg(to_jsonb(p)::text,'|' order by p.id::text),'')) from products p"),productsBefore);
  step('invoice and product fingerprints unchanged throughout the isolated rehearsal');
  console.log('PRODUCTION_RETRY_FIX_NOT_APPLIED: the new request-retry migration is validated locally only. Historical captured writers are used to reproduce prior defects; this does not assert Contract A is absent from current Production.');
  return {status:'CANDIDATE_VALIDATED_PRODUCTION_RETRY_FIX_NOT_APPLIED',
    prerequisite:'20261009180000_customer_followup_one_open_case_contract_a_v1.sql',
    pendingMigration:'20261019093000_customer_request_materialization_retry_v1.sql',
    limits:['customer-request incentive AFTER triggers are not replayed','request retries tested serially; native concurrency gate separately covers follow-up publication'],
    runtimeProblem:'completed_customer_request_retry_rejected_by_ready_only_approval_guard',productionWrites:0};


}
