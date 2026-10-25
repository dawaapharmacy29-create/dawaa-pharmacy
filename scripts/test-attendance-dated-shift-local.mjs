// Executes the committed RPC against isolated PostgreSQL/WASM fixtures. No network.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
let passed=0;
try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table staff(id uuid primary key,name text,role text,branch text);
 create table shift_schedules(id uuid primary key default gen_random_uuid(),staff_id uuid,staff_name text,employee_name text,
 role text,branch text,day_name text,shift_start text,shift_end text,start_time time,end_time time,hours numeric,is_off boolean,
 is_day_off boolean,is_different boolean,has_custom_time boolean,shift_date date,date date,status text,source text,notes text,effective_from date,effective_to date);
 create table attendance_daily_summary(id uuid default gen_random_uuid(),staff_id uuid,attendance_date date,status text);
 create table staff_time_off_requests(staff_id uuid,status text,request_kind text,start_date date,end_date date);
 create function dawaa_time_off_can_decide_staff_v1(uuid) returns boolean language sql as $$select current_setting('test.allowed',true)='true'$$;
 create function employee_operating_actor_id() returns text language sql as $$select 'verified-fixture-actor'::text$$;
 create function attendance_schedule_for_date_v1(uuid,date) returns table(schedule_id uuid) language sql as $$select '00000000-0000-0000-0000-000000000002'::uuid$$;
 create function dawaa_materialize_attendance_day_internal_v2(uuid,date) returns attendance_daily_summary language plpgsql as $$
 declare r attendance_daily_summary; begin
 update attendance_daily_summary set status=case when current_setting('test.auto',true)='true' then 'approved' else 'pending_review' end where staff_id=$1 and attendance_date=$2 returning * into r;return r;end;$$;
 insert into staff values('00000000-0000-0000-0000-000000000001','fixture staff','pharmacist','fixture branch');
 insert into shift_schedules(id,staff_id,shift_start,shift_end) values('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','09:00','17:00');
 insert into attendance_daily_summary(staff_id,attendance_date,status) values('00000000-0000-0000-0000-000000000001','2026-10-24','pending_review');
 set test.allowed='true';`);
 await db.exec(readFileSync('supabase/migrations/20261025120000_attendance_dated_shift_decision_v1.sql','utf8'));
 const staff='00000000-0000-0000-0000-000000000001';
 const call=(date,start='22:00',end='06:00',note='documented evidence')=>`select resolve_dated_shift_from_attendance_v1('${staff}','${date}','${start}','${end}','${note}') result`;
 async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
 async function rejects(sql,expected){await db.exec('savepoint scenario');let message='';try{await db.exec(sql);}catch(e){message=e.message;}await db.exec('rollback to savepoint scenario');assert.ok(message.includes(expected),message || 'expected rejection');}
 await db.exec('begin');
 await test('overnight one-day override preserves recurring schedule and audit',async()=>{
 const result=await db.query(call('2026-10-24'));assert.equal(result.rows[0].result.success,true);assert.equal(result.rows[0].result.materialization.status,'pending_review');
 const r=await db.query("select hours,shift_date,effective_from,effective_to from shift_schedules where source='attendance_dated_shift_correction_v1'");assert.equal(Number(r.rows[0].hours),8);
 const recurring=await db.query("select shift_start,shift_end from shift_schedules where id='00000000-0000-0000-0000-000000000002'");assert.deepEqual(recurring.rows[0],{shift_start:'09:00',shift_end:'17:00'});
 const audit=await db.query('select actor_id,note from attendance_dated_shift_corrections_v1');assert.equal(audit.rows[0].actor_id,'verified-fixture-actor');assert.equal(audit.rows[0].note,'documented evidence');});
 await test('duplicate correction rejected',()=>rejects(call('2026-10-24'),'dated_shift_correction_already_exists'));
 await test('equal times rejected',()=>rejects(call('2026-10-23','09:00','09:00'),'shift_correction_requires_date_times_and_reason'));
 await test('over 18 hours rejected',()=>rejects(call('2026-10-23','01:00','23:00'),'shift_correction_exceeds_18_hours'));
 await test('invalid SQL clock rejected',()=>rejects(call('2026-10-23','25:00','06:00'),'out of range'));
 await test('approved day immutable',async()=>{await db.exec(`insert into attendance_daily_summary(staff_id,attendance_date,status) values('${staff}','2026-10-22','approved')`);await rejects(call('2026-10-22'),'approved_attendance_cannot_be_rewritten');});
 await test('authorization helper rejection preserved',async()=>{await db.exec("set test.allowed='false'");await rejects(call('2026-10-21'),'not_authorized_for_attendance_shift_correction');await db.exec("set test.allowed='true'");});
 await test('automatic approval causes full correction rollback (known release blocker)',async()=>{
 await db.exec(`insert into attendance_daily_summary(staff_id,attendance_date,status) values('${staff}','2026-10-20','pending_review');set test.auto='true'`);
 await rejects(call('2026-10-20'),'date_shift_correction_requires_explicit_manager_attendance_approval');
 const r=await db.query("select count(*)::int n from shift_schedules where shift_date='2026-10-20'");assert.equal(r.rows[0].n,0);
 await db.exec("set test.auto='false'");});
 await test('custom-session anon currently lacks execute (known release blocker)',async()=>{const r=await db.query("select has_function_privilege('anon','resolve_dated_shift_from_attendance_v1(uuid,date,time,time,text)','EXECUTE') allowed");assert.equal(r.rows[0].allowed,false);});
 await db.exec('rollback');console.log(`Local SQL contract: ${passed} passed, 0 failed. Authorization/session dependencies are fixtures; production RLS is not proven.`);
} finally {await db.close();}
