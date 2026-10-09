// Read-only audit reproduction in an in-memory PostgreSQL WASM engine.
// Usage: node followup-core-harness.mjs /absolute/path/to/pglite/dist/index.js
// No network client, environment database URL, or application migration is used.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

if (!process.argv[2] || !path.isAbsolute(process.argv[2])) throw Error('absolute_pglite_module_path_required');
const { PGlite } = await import(pathToFileURL(process.argv[2]).href);
const root = path.dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
const checks = [];
try {
  await db.exec(`
    create table daily_followups (
      id uuid primary key default gen_random_uuid(), date text, customer_id text,
      customer_name text, name text, phone text, customer_phone text, customer_code text,
      branch text, status text, followup_status text, contact_status text, followup_type text,
      request_type text, request_details text, followup_reason text, priority text,
      next_followup_date date, created_by text, created_by_name text, requested_by_staff_id text,
      request_source text, identity_key text, client_request_id text unique,
      is_hidden boolean default false, is_duplicate boolean default false,
      duplicate_of uuid, created_at timestamptz default now(), updated_at timestamptz,
      completed_at timestamptz, cancelled_at timestamptz, archived_at timestamptz
    );
    create table customer_service_followup_events (
      id uuid primary key default gen_random_uuid(), followup_id uuid,
      event_type text, event_status text, actor_staff_id text, actor_name text,
      notes text, metadata jsonb
    );
    create function resolve_staff_account_safe(text)
    returns table(id text, active boolean, can_login boolean, role text, name text)
    language sql as $$ select 'fixture-actor', true, true, 'customer_service', 'Fixture actor'
      where $1 = 'fixture-actor' $$;
    create table whatsapp_review_sources(id uuid primary key, staff_id uuid, branch text);
    create table whatsapp_conversation_actions(
      id uuid primary key default gen_random_uuid(), source_id uuid, action_key text,
      followup_identity text unique, status text, action_type text, auto_eligible boolean,
      customer_id uuid, product_id uuid, staff_id uuid, branch text, quantity numeric,
      due_at timestamptz, reason text, payload jsonb default '{}', customer_name text,
      customer_code text, customer_phone text, product_name text, target_table text,
      target_id text, last_error text, updated_at timestamptz,
      unique(source_id,action_key)
    );
    create table staff_accounts(id uuid primary key, name text, username text, role text, staff_role text);
    create table whatsapp_review_audit(
      source_id uuid, action text, actor_id text, actor_name text, actor_role text,
      before_state jsonb, after_state jsonb, note text
    );
    insert into staff_accounts values('00000000-0000-4000-8000-000000000001','Fixture actor','fixture','customer_service',null);
    create function dawaa_current_staff_account_id_strict() returns uuid language sql as
      $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
    create function dawaa_can_read_conversation_review_row_v2(uuid,uuid,uuid,text,uuid)
      returns boolean language sql as $$ select true $$;
    create function dawaa_create_or_link_customer_followup_v1(
      text,text,text,text,text,text,text,text,text,date,text,text)
      returns jsonb language plpgsql as $$ begin
      return find_or_create_open_customer_followup($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        'fixture-actor','Fixture actor',$11,$12); end $$;
  `);
  for (const row of JSON.parse(fs.readFileSync(path.join(root,'followup-core-live-definitions.json'),'utf8'))) {
    await db.exec(row.definition);
  }
  async function run({key, customer='fixture-customer', branch='فرع الشامي', actor='fixture-actor'}) {
    const {rows} = await db.query(`select find_or_create_open_customer_followup(
      $1,null,'Synthetic customer',null,$2,'general','Synthetic obligation',
      'Audit reason','متوسطة',null,$3,'Fixture actor',$4,'audit_fixture') as result`,
      [customer,branch,actor,key]);
    return rows[0].result;
  }
  const a = await run({key:'obligation:A'});
  assert.equal(a.created,true);
  const replayA = await run({key:'obligation:A'});
  assert.equal(replayA.followup_id,a.followup_id);
  assert.equal(replayA.idempotent_replay,true);
  checks.push({name:'same creation key retry',holds:true});

  const b = await run({key:'obligation:B'});
  assert.equal(b.followup_id,a.followup_id);
  assert.equal(b.linked_to_open_case,true);
  checks.push({name:'distinct obligation links existing open case',holds:true});

  await run({key:'obligation:B'});
  const events = await db.query(`select count(*)::int as count
    from customer_service_followup_events where metadata->>'client_request_id'='obligation:B'`);
  assert.equal(events.rows[0].count,2);
  checks.push({name:'linked obligation retry has one lineage event',holds:false,actualEventCount:2});

  await db.query('update daily_followups set completed_at=now() where id=$1',[a.followup_id]);
  const replayB = await run({key:'obligation:B'});
  assert.notEqual(replayB.followup_id,a.followup_id);
  assert.equal(replayB.created,true);
  checks.push({name:'linked obligation retry after completion reuses original work',holds:false,
    actual:'creates a second follow-up because the first case stores A, not B, in client_request_id'});

  const collision = await run({key:'obligation:A',customer:'different-fixture-customer',branch:'فرع شكري'});
  assert.equal(collision.followup_id,a.followup_id);
  checks.push({name:'replayed key checks customer and branch scope',holds:false,
    actual:'returns original ID without comparing supplied customer or branch'});

  for (const [name,args,error] of [
    ['missing actor',{key:'missing-actor',actor:null},/actor_staff_id_required/],
    ['inactive or unknown actor',{key:'unknown-actor',actor:'unknown'},/active_staff_account_required/],
    ['missing branch',{key:'missing-branch',branch:null},/branch_required/],
  ]) {
    await assert.rejects(()=>run(args),error);
    checks.push({name,holds:true});
  }

  const sourceId='00000000-0000-4000-8000-000000000002';
  await db.query('insert into whatsapp_review_sources values($1,null,$2)',[sourceId,'فرع الشامي']);
  async function action(key,identity,customer='00000000-0000-4000-8000-000000000003') {
    const {rows}=await db.query(`insert into whatsapp_conversation_actions(
      source_id,action_key,followup_identity,status,action_type,customer_id,
      branch,customer_name,reason) values($1,$2,$3,'proposed','customer_followup',$4,$5,
      'Synthetic customer','Synthetic obligation') returning id`,[sourceId,key,identity,customer,'فرع الشامي']);
    return rows[0].id;
  }
  async function materialize(id) {
    const {rows}=await db.query('select dawaa_materialize_whatsapp_action_core_v2($1) as result',[id]);
    return rows[0].result;
  }
  const actionA=await action('fixture:A','semantic:A');
  const actionB=await action('fixture:B','semantic:B');
  const targetA=await materialize(actionA);
  const targetB=await materialize(actionB);
  assert.equal(targetA.target_id,targetB.target_id);
  checks.push({name:'existing action materializer links distinct obligations to one open case',holds:true});
  await db.query('update daily_followups set completed_at=now() where id=$1',[targetA.target_id]);
  const retryActionB=await materialize(actionB);
  assert.equal(retryActionB.already_created,true);
  assert.equal(retryActionB.target_id,targetA.target_id);
  checks.push({name:'persisted created action retains linked target after completion and retry',holds:true});
  await assert.rejects(()=>action('fixture:duplicate','semantic:B'),/duplicate key/);
  checks.push({name:'queue semantic identity unique constraint rejects duplicate proposal',holds:true,
    limit:'fixture copies the inspected live index; durable semantic key itself is not proved'});
  const failingAction=await action('fixture:rollback','semantic:rollback','00000000-0000-4000-8000-000000000004');
  await db.exec("alter table whatsapp_review_audit add constraint audit_fixture_failure check(action <> 'operational_action_materialized') not valid");
  await assert.rejects(()=>materialize(failingAction),/audit_fixture_failure/);
  const rollback=await db.query(`select
    (select status from whatsapp_conversation_actions where id=$1) as status,
    (select count(*)::int from daily_followups where customer_id=$2) as followup_count`,
    [failingAction,'00000000-0000-4000-8000-000000000004']);
  assert.equal(rollback.rows[0].status,'proposed');
  assert.equal(rollback.rows[0].followup_count,0);
  checks.push({name:'failed materialization rolls back target creation and action status together',holds:true});

  const report={engine:'PGlite in-memory PostgreSQL',scope:'actual captured follow-up core, action materializer core, and identity helpers; synthetic tables and stub actor/access wrappers',checks,
    passedExistingProperties:checks.filter(x=>x.holds).length,
    reproducedContractGaps:checks.filter(x=>!x.holds).length,
    limitations:['single embedded backend; no multi-connection concurrency proof','no live table triggers, RLS, grants, real public wrapper, or full schema parity proof','actor/access checks and follow-up wrapper are fixture stubs; no Production authorization claim','no application or protected migration applied'],
    productionMutations:0,applicationMigrationsApplied:0};
  fs.writeFileSync(path.join(root,'followup-core-harness-result.json'),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
} catch (error) {
  process.stderr.write(JSON.stringify({error:error.message,code:error.code})+'\n');
  process.exitCode=1;
} finally {
  await db.close();
}
