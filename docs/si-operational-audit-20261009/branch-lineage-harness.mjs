// Isolated PGlite fixture; no network/database URL. Actual captured trigger body.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const db=new PGlite(); const dir=new URL('.',import.meta.url); const checks=[];
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push(name)};
try {
await db.exec(`create role anon; create role authenticated; create role service_role;
create table customers(id uuid primary key,branch text);
create table daily_followups(id text primary key,customer_id text,branch text,client_request_id text,updated_at timestamptz,updated_by text,completed_at timestamptz,cancelled_at timestamptz,archived_at timestamptz);
create table whatsapp_review_sources(id uuid primary key);
create table whatsapp_conversation_actions(id uuid primary key,source_id uuid,target_table text,target_id text);
create table customer_service_followup_events(followup_id text,event_type text,metadata jsonb);
create table customer_service_daily_queue_items(id text primary key,customer_id text,branch text,linked_followup_id text,queue_date date,status text,metadata jsonb);
`);
await db.exec(JSON.parse(fs.readFileSync(new URL('branch-sync-live-definition.json',dir))).definition);
await db.exec(`create trigger branch_sync after update on customers for each row execute function sync_customer_branch_to_open_followups_and_daily_queue();
insert into customers values('00000000-0000-0000-0000-000000000001','A');
insert into whatsapp_review_sources values('00000000-0000-0000-0000-000000000002');
insert into whatsapp_conversation_actions values
('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','daily_followups','direct'),
('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002','invoices','invoice'),
('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000099','daily_followups','orphan');
insert into daily_followups(id,customer_id,branch,client_request_id)
select x,'00000000-0000-0000-0000-000000000001','A',case when x='row' then 'whatsapp-action:00000000-0000-0000-0000-000000000004' when x='invalid' then 'whatsapp-action:bad' when x='missing' then 'whatsapp-action:00000000-0000-0000-0000-000000000099' else 'manual:'||x end
from unnest(array['manual','direct','row','event','invalid','missing','orphan','closed','cancelled','archived']) x;
update daily_followups set completed_at=now() where id='closed';
update daily_followups set cancelled_at=now() where id='cancelled';
update daily_followups set archived_at=now() where id='archived';
insert into customer_service_followup_events values('event','request_linked','{"client_request_id":"whatsapp-action:00000000-0000-0000-0000-000000000004"}');
insert into customer_service_daily_queue_items select id,'00000000-0000-0000-0000-000000000001','A',id,(now() at time zone 'Africa/Cairo')::date,'open','{"original":true}' from daily_followups;
insert into customer_service_daily_queue_items values('unlinked','00000000-0000-0000-0000-000000000001','A',null,(now() at time zone 'Africa/Cairo')::date,'open','{}'),('past','00000000-0000-0000-0000-000000000001','A','manual',(now() at time zone 'Africa/Cairo')::date-1,'open','{}'),('done','00000000-0000-0000-0000-000000000001','A','manual',current_date,'completed','{}');
update customers set branch='B';`);
check('baseline moves conversation followup',(await db.query("select branch from daily_followups where id='direct'")).rows[0].branch,'B');
await db.exec("update daily_followups set branch='A'; update customer_service_daily_queue_items set branch='A',metadata='{\"original\":true}';");
const sql=fs.readFileSync(new URL('../../supabase/migrations/20261009103000_preserve_conversation_followup_branch_v1.sql',dir),'utf8');
await db.exec(sql);await db.exec(sql);
await db.exec("update customers set branch='C';");
const rows=(await db.query('select id,branch from daily_followups order by id')).rows;
for(const r of rows) check('followup '+r.id,r.branch,['direct','row','event','closed','cancelled','archived'].includes(r.id)?'A':'C');
const queue=(await db.query('select id,branch,metadata from customer_service_daily_queue_items order by id')).rows;
for(const r of queue) {
const protectedRow=['direct','row','event','past','done'].includes(r.id);
check('queue '+r.id,r.branch,protectedRow?'A':'C');
if(protectedRow)check('metadata preserved '+r.id,r.metadata,{original:true});
}
check('null linkage is manual',(await db.query('select dawaa_followup_has_conversation_lineage_v1(null) as value')).rows[0].value,false);
for(const role of ['anon','authenticated','service_role'])check('helper ACL '+role,(await db.query(`select has_function_privilege('${role}','dawaa_followup_has_conversation_lineage_v1(text)','execute') as value`)).rows[0].value,role==='service_role');
await db.exec("update customers set branch=' '; update customers set branch=' ';");
check('blank branch leaves manual unchanged',(await db.query("select branch from daily_followups where id='manual'")).rows[0].branch,'C');
fs.writeFileSync(new URL('branch-lineage-repair-result.json',dir),JSON.stringify({engine:'PGlite',checks,properties_holding:checks.length,migration_applications:2,live_applied:false,native_concurrency_proven:false,real_rls_proven:false},null,2)+'\n');
console.log(`${checks.length} properties passed`);
} finally {await db.close()}
