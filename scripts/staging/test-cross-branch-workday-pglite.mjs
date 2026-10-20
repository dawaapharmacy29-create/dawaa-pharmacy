// In-memory PostgreSQL-compatible proof for workday-aware cross-branch punch audits.
// This script connects to no real devices or remote database and has no Production writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

for (const name of ['DATABASE_URL','SUPABASE_DB_URL','SUPABASE_URL','VITE_SUPABASE_URL']) {
  if (process.env[name]) throw new Error('Isolated test refuses environment URL: ' + name);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sql = readFileSync(path.join(root,
  'supabase/migrations/20261020070000_cross_branch_biometric_workday_v3.sql'), 'utf8');
const db = new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.staff_accounts(
      id uuid primary key,active boolean,can_login boolean
    );
    create table public.staff(id uuid primary key,name text,role text,branch text);
    create table public.biometric_attendance_logs(
      id uuid primary key,staff_id uuid,biometric_user_id text,punch_type text,
      device_id text,provider text,punch_time timestamptz,raw_payload jsonb,branch text
    );
    create table public.staff_attendance_logs(
      biometric_source_log_id uuid,staff_id uuid,shift_date date,
      status text,attendance_type text,created_at timestamptz
    );
    create table public.test_branch_schedule(staff_id uuid,work_day date,branch text);
    create function public.dawaa_current_staff_account_id_strict()
      returns uuid language sql stable as $$
      select '00000000-0000-0000-0000-000000000099'::uuid $$;
    create function public.dawaa_can_read_staff_attendance_log(uuid,text)
      returns boolean language sql stable as $$select true$$;
    create function public.dawaa_fingerprint_effective_time_v1(text,jsonb,timestamptz)
      returns timestamptz language sql stable as $$select $3$$;
    create function public.dawaa_biometric_source_branch_v1(jsonb,text)
      returns text language sql stable as $$select coalesce($1->>'source_branch',$2)$$;
    create function public.attendance_schedule_for_date_v1(uuid,date)
      returns table(schedule_id uuid, staff_id uuid, branch text, day_name text,
        shift_start time,shift_end time,is_off boolean,is_day_off boolean,source_kind text)
      language sql stable as $$
      select '90000000-0000-0000-0000-000000000001'::uuid,$1,b.branch,
        'الاثنين'::text,'09:00'::time,'17:00'::time,false,false,'weekly'::text
      from public.test_branch_schedule b
      where b.staff_id=$1 and b.work_day=$2 limit 1 $$;

    insert into public.staff_accounts values
      ('00000000-0000-0000-0000-000000000099',true,true);
    insert into public.staff values
      ('00000000-0000-0000-0000-000000000001','Night pharmacist','pharmacist','فرع الشامي'),
      ('00000000-0000-0000-0000-000000000002','Second person','pharmacist','فرع شكري');
    insert into public.test_branch_schedule values
      ('00000000-0000-0000-0000-000000000001','2026-10-19','فرع شكري'),
      ('00000000-0000-0000-0000-000000000001','2026-10-20','فرع الشامي'),
      ('00000000-0000-0000-0000-000000000002','2026-10-19','فرع شكري');
    insert into public.biometric_attendance_logs values
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
        '276','unknown','shami-device','zk_shami_direct_bridge',
        '2026-10-20 00:15:00+00','{}','فرع الشامي'),
      ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
        '276','unknown','shami-device','zk_shami_direct_bridge',
        '2026-10-20 07:00:00+00','{}','فرع الشامي'),
      ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',
        '276','unknown','shami-device','zk_shami_direct_bridge',
        '2026-10-19 08:00:00+00','{}','فرع الشامي'),
      ('10000000-0000-0000-0000-000000000004',NULL,
        '276','unknown','unknown-device','zk_shokry_direct_bridge',
        '2026-10-19 08:01:00+00','{}','فرع الشامي');
    insert into public.staff_attendance_logs values
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001',
        '2026-10-19','accepted','check_out',now()),
      ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001',
        '2026-10-20','accepted','check_in',now());
  `);
  await db.exec(sql);
  await db.exec(readFileSync(path.join(root,
    'supabase/migrations/20261020070001_cross_branch_v3_explicit_anon_revoke.sql'), 'utf8'));
  const permissions = (await db.query(`
    select has_function_privilege('anon', 'public.list_cross_branch_biometric_events_v3(date,date,text,integer)', 'EXECUTE') as anon,
           has_function_privilege('authenticated', 'public.list_cross_branch_biometric_events_v3(date,date,text,integer)', 'EXECUTE') as authenticated
  `)).rows[0];
  assert.equal(permissions.anon,false,'anonymous role may not call security-definer report');
  assert.equal(permissions.authenticated,true,'authenticated users must still pass per-employee RPC authorization');
  const query = async (statement) => (await db.query(statement)).rows;
  const rows = await query(`
    select staff_id::text,staff_name,home_branch,expected_branch,punch_branch,
      attendance_date::text as attendance_date,processing_status,attendance_type,
      day_evidence,biometric_user_id,punch_time
    from public.list_cross_branch_biometric_events_v3(
      '2026-10-19'::date,'2026-10-19'::date,null,20)
    order by staff_name,punch_time
  `);
  assert.equal(rows.length,2,'one accepted night checkout and one unlinked staff punch');
  const night = rows.find(r => r.staff_name==='Night pharmacist');
  assert(night,'next-calendar-day night checkout must be included in 19 Oct shift');
  assert.equal(night.attendance_date,'2026-10-19');
  assert.equal(night.processing_status,'accepted');
  assert.equal(night.attendance_type,'check_out');
  assert.equal(night.expected_branch,'فرع شكري');
  assert.equal(night.punch_branch,'فرع الشامي');
  assert.equal(night.day_evidence,'linked_attendance_shift_date');
  const second = rows.find(r => r.staff_name==='Second person');
  assert(second,'unlinked mapped person must remain observable with uncertainty');
  assert.equal(second.processing_status,'unlinked');
  assert.equal(second.day_evidence,'raw_calendar_day_fallback');
  assert(!rows.some(r => r.attendance_date==='2026-10-20'),
    'current date events should not leak into selected workday');
  const onlySecond = await query(`
    select staff_name from public.list_cross_branch_biometric_events_v3(
      '2026-10-19'::date,'2026-10-19'::date,'فرع شكري',20)
  `);
  assert.equal(onlySecond.length,2,'branch filter should use expected scheduled branch');
  const [count] = await query(`
    select count(*)::int as n from public.staff_attendance_logs
  `);
  assert.equal(count.n,2,'read-only RPC must not mutate accepted attendance');
  console.log('PASS: cross-branch v3 uses canonical night-shift day, accepted status, safe fallback, and no automatic code-based identity');
} finally {
  await db.close();
}
