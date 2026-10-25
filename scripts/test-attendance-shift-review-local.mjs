// Executable dated-shift regression on an isolated PGlite database. No production credentials.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
const staff = '00000000-0000-0000-0000-000000000001';
const actor = '00000000-0000-0000-0000-000000000003';
const call = (date, start='16:00', end='00:00') =>
  `select public.resolve_dated_shift_from_attendance_v1('${staff}','${date}','${start}','${end}','documented shift change') as result`;
async function reject(sql, expected) {
  await db.exec('savepoint rejected');
  let message = '';
  try { await db.exec(sql); } catch(e) { message = e.message; }
  await db.exec('rollback to savepoint rejected');
  assert.ok(message.includes(expected), message || 'expected '+expected);
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table staff(id uuid primary key, name text, role text, branch text);
    create table shift_schedules(id uuid primary key default gen_random_uuid(),staff_id uuid,staff_name text,employee_name text,
      role text,branch text,day_name text,shift_start text,shift_end text,start_time time,end_time time,hours numeric,is_off boolean,
      is_day_off boolean,is_different boolean,has_custom_time boolean,shift_date date,date date,status text,source text,notes text,
      effective_from date,effective_to date);
    create table attendance_daily_summary(id uuid default gen_random_uuid(),staff_id uuid,attendance_date date,status text);
    create table staff_time_off_requests(staff_id uuid,status text,request_kind text,start_date date,end_date date);
    create table attendance_inline_review_holds_v1(staff_id uuid,attendance_date date,actor_id uuid,reason text,
      primary key(staff_id,attendance_date));
    create function dawaa_time_off_can_decide_staff_v1(uuid) returns boolean language sql
      as $$select current_setting('test.allowed',true)='true'$$;
    create function dawaa_session_account_id_v1() returns uuid language sql
      as $$select '00000000-0000-0000-0000-000000000003'::uuid$$;
    create function dawaa_current_staff_account_id_strict() returns uuid language sql
      as $$select '00000000-0000-0000-0000-000000000003'::uuid$$;
    create function employee_operating_actor_id() returns text language sql
      as $$select 'verified-fixture-actor'::text$$;
    create function attendance_schedule_for_date_v1(uuid,date) returns table(schedule_id uuid) language sql
      as $$select '00000000-0000-0000-0000-000000000002'::uuid$$;
    create function dawaa_materialize_attendance_day_internal_v2(uuid,date) returns attendance_daily_summary
      language plpgsql as $$begin raise exception 'unexpected_auto_materialization';end$$;
    create function dawaa_refresh_inline_attendance_review_v1(uuid,date) returns attendance_daily_summary
      language plpgsql as $$
      declare result attendance_daily_summary;
      begin
        if not exists (select 1 from attendance_inline_review_holds_v1
          where staff_id=$1 and attendance_date=$2) then
          raise exception 'missing_review_hold';
        end if;
        update attendance_daily_summary set status='pending_review'
          where staff_id=$1 and attendance_date=$2 returning * into result;
        if result.staff_id is null then raise exception 'missing_pending_day';end if;
        return result;
      end$$;
    insert into staff values('${staff}','synthetic staff','pharmacist','synthetic branch');
    insert into shift_schedules(id,staff_id,shift_start,shift_end)
      values('00000000-0000-0000-0000-000000000002','${staff}','09:00','17:00');
    insert into attendance_daily_summary(staff_id,attendance_date,status)
      values('${staff}','2026-10-18','pending_review');
    set test.allowed='true';
  `);
  await db.exec(readFileSync('supabase/migrations/20261025120000_attendance_dated_shift_decision_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261025160000_attendance_shift_review_no_autoapproval.sql','utf8'));
  await db.exec('begin');
  const changed = (await db.query(call('2026-10-18'))).rows[0].result;
  assert.equal(changed.success,true);
  assert.equal(changed.requires_review,true);
  assert.equal(changed.materialization.status,'pending_review');
  const day = (await db.query(`select status from attendance_daily_summary where staff_id='${staff}' and attendance_date='2026-10-18'`)).rows[0];
  assert.equal(day.status,'pending_review');
  const hold = (await db.query(`select actor_id,reason from attendance_inline_review_holds_v1 where staff_id='${staff}'`)).rows[0];
  assert.equal(hold.actor_id,actor);
  assert.equal(hold.reason,'shift');
  const schedule = (await db.query("select hours,shift_date from shift_schedules where source='attendance_dated_shift_correction_v1'")).rows[0];
  assert.equal(Number(schedule.hours),8);
  assert.equal(schedule.shift_date instanceof Date ? schedule.shift_date.toISOString().slice(0,10) : schedule.shift_date,'2026-10-18');
  assert.equal((await db.query("select count(*)::int n from attendance_dated_shift_corrections_v1")).rows[0].n,1);
  await reject(call('2026-10-18'),'dated_shift_correction_already_exists_review_first');
  await db.exec(`insert into attendance_daily_summary(staff_id,attendance_date,status) values('${staff}','2026-10-17','approved')`);
  await reject(call('2026-10-17'),'approved_attendance_cannot_be_rewritten');
  await db.exec('rollback');
  console.log('[attendance-shift-review-local] PASS: 8-hour 16:00–00:00 correction, audit, manager hold, pending recomputation, duplicate/approved guards, no auto materialization');
} finally { await db.close(); }
