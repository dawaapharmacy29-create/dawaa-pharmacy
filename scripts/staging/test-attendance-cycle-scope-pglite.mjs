// 100% isolated attendance migrations rehearsal: PGlite in-memory, no Production.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

for (const name of ['DATABASE_URL','SUPABASE_DB_URL','SUPABASE_URL','VITE_SUPABASE_URL']) {
  if (process.env[name]) throw new Error('Isolated test refuses remote DB URL: ' + name);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name) => readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
const db = new PGlite();
try {
  await db.exec(`
    create table public.staff (
      id uuid primary key, name text, role text, branch text,
      active boolean, is_active boolean, visible_in_schedule boolean
    );
    create table public.attendance_daily_summary (
      id uuid primary key, staff_id uuid, attendance_date date,
      status text, resolution_version integer, resolution_origin text,
      resolution_status text, candidate_hours numeric, payroll_eligible_hours numeric,
      schedule_id uuid, approved_by_name text, approval_note text, time_off_request_id uuid
    );
    create table public.staff_overtime_approvals (
      staff_id uuid, attendance_date date, status text, overtime_hours numeric,
      source_resolution_id uuid, source_resolution_fingerprint text
    );
    create table public.attendance_manual_requests (
      staff_id uuid, attendance_date date, requested_time timestamptz,status text
    );
    create table public.staff_time_off_requests (
      staff_id uuid, start_date date, end_date date, status text
    );
    create table public.attendance_manual_actions_audit (
      target_id uuid, action_type text, new_value jsonb, created_at timestamptz
    );
    create table public.fixture_builds (
      staff_id uuid, attendance_date date,
      v2_status text, v2_hours numeric, v3_status text, v3_hours numeric
    );
    create function public.dawaa_current_actor_can(text[])
      returns boolean language sql stable as $$ select true $$;
    create function public.dawaa_staff_attendance_log_read_scope_v1()
      returns table(read_mode text, subject_id uuid, branch_scope text)
      language sql stable as $$ select 'all'::text,null::uuid,null::text $$;
    create function public.attendance_resolution_fingerprint_v2(uuid)
      returns text language sql stable as $$ select 'fixture'::text $$;
    create function public.dawaa_current_staff_account_id_strict()
      returns uuid language sql stable as $$
      select '00000000-0000-0000-0000-000000000099'::uuid $$;
    create function public.dawaa_can_read_staff_attendance_log(uuid,text)
      returns boolean language sql stable as $$ select true $$;
    create function public.dawaa_build_attendance_day_resolution_v2(uuid,date)
      returns jsonb language sql stable as $$
      select coalesce((select jsonb_build_object(
        'resolution_status',v2_status,'candidate_hours',v2_hours,'schedule_id',null)
        from public.fixture_builds b where b.staff_id=$1 and b.attendance_date=$2),
        jsonb_build_object('resolution_status','no_schedule','candidate_hours',0))
      $$;
    create function public.dawaa_build_attendance_day_resolution_v3(uuid,date)
      returns jsonb language sql stable as $$
      select coalesce((select jsonb_build_object(
        'resolution_status',v3_status,'candidate_hours',v3_hours,'schedule_id',null)
        from public.fixture_builds b where b.staff_id=$1 and b.attendance_date=$2),
        jsonb_build_object('resolution_status','needs_event_review','candidate_hours',0))
      $$;
    insert into public.staff values
      ('00000000-0000-0000-0000-000000000001','Standard','pharmacist','فرع الشامي',true,true,true),
      ('00000000-0000-0000-0000-000000000002','Flexible','pharmacist','فرع شكري',true,true,true),
      ('00000000-0000-0000-0000-000000000003','Hidden historical','pharmacist','فرع الشامي',false,false,false),
      ('00000000-0000-0000-0000-000000000004','Manager decision','pharmacist','فرع الشامي',true,true,true);
    insert into public.attendance_daily_summary(
      id,staff_id,attendance_date,status,resolution_version,resolution_origin,
      resolution_status,candidate_hours,payroll_eligible_hours,approval_note)
    values
      ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','2026-10-10','approved',2,'system','on_time',8,8,null),
      ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','2026-10-10','approved',3,'system','flexible_present',6,6,null),
      ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000003','2026-10-10','approved',2,'system','on_time',4,4,null),
      ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','2026-10-10','approved',2,'manual_manager_decision','manager_approved_manual_checkout_0800',7,7,'قرار الإدارة'),
      ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000004','2026-10-11','approved',99,'system','unknown_version',3,null,null);
    insert into public.fixture_builds values
      ('00000000-0000-0000-0000-000000000001','2026-10-10','on_time',8,'flexible_present',5),
      ('00000000-0000-0000-0000-000000000002','2026-10-10','no_schedule',0,'flexible_present',6),
      ('00000000-0000-0000-0000-000000000003','2026-10-10','on_time',4,'needs_event_review',0),
      ('00000000-0000-0000-0000-000000000004','2026-10-10','missing_checkout',0,'flexible_present',7);
  `);
  await db.exec(read('20261019090000_attendance_truth_historical_visibility_v1.sql'));
  await db.exec(read('20261019123000_attendance_drift_canonical_engine_route_v1.sql'));

  const one = async (sql) => (await db.query(sql)).rows[0];
  const { report } = await one(`
    select public.attendance_truth_cycle_v2('2026-10-10'::date,'2026-10-11'::date,null) as report
  `);
  const truth = typeof report === 'string' ? JSON.parse(report) : report;
  assert.equal(truth.summary.staff_count, 4);
  assert.equal(truth.summary.approved_days, 5);
  assert.equal(Number(truth.summary.worked_hours), 28);
  assert(truth.rows.some((r) => r.staff_name === 'Hidden historical'));

  const { n: flexible } = await one(`
    select public.attendance_resolution_financial_drift_count_v1(
      '00000000-0000-0000-0000-000000000002'::uuid,
      '2026-10-10'::date,'2026-10-11'::date) as n
  `);
  assert.equal(flexible, 0, 'saved V3 flexible day must not be compared with V2');

  const { n: manager } = await one(`
    select public.attendance_resolution_financial_drift_count_v1(
      '00000000-0000-0000-0000-000000000004'::uuid,
      '2026-10-10'::date,'2026-10-11'::date) as n
  `);
  assert.equal(manager, 2, 'manager mismatch + unknown version require inspection');

  const { result } = await one(`
    select public.delivery_attendance_financial_drift_guard_v1(
      '00000000-0000-0000-0000-000000000004'::uuid,
      '2026-10-10'::date,'2026-10-11'::date) as result
  `);
  const guard = typeof result === 'string' ? JSON.parse(result) : result;
  assert.equal(guard.explained_override_count, 1);
  assert.equal(guard.unexplained_drift_count, 1);

  const { total } = await one(`
    select count(*)::int as total from public.attendance_daily_summary
    where status='approved'
  `);
  assert.equal(total, 5, 'both migrations must leave approved days unchanged');
  console.log('PASS: isolated PGlite historical visibility, V2/V3, manual decisions and unknown-version blockers');
} finally {
  await db.close();
}
