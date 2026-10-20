// SQL-only synthetic replay: no external URLs, no Production connections or writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PGlite} from '@electric-sql/pglite';

for (const variable of ['DATABASE_URL','SUPABASE_DB_URL','SUPABASE_URL','VITE_SUPABASE_URL']) {
 if (process.env[variable]) throw Error('Isolated fixture refuses Production env: '+variable);
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const sql=readFileSync(path.join(root,'supabase/migrations/20261020090000_attendance_profile_processed_evidence_v1.sql'),'utf8');
const staffId='00000000-0000-0000-0000-000000000001';
const db=new PGlite();
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.staff_attendance_logs(
      staff_id uuid,shift_date date,status text,attendance_type text,
      recorded_at timestamptz,branch_name text
    );
    create function public.dawaa_current_staff_account_id_strict()
      returns uuid language sql stable security definer as $$
      select case when
        (current_setting('request.headers',true)::jsonb ->> 'x-dawaa-session-token')='fixture-valid-staff'
        then '00000000-0000-0000-0000-000000000099'::uuid else null end
      $$;
    create function public.attendance_employee_profile_v1(p_staff_id uuid,p_days integer default 30)
      returns jsonb language plpgsql stable security definer as $$
      begin
        if public.dawaa_current_staff_account_id_strict() is null then
          raise exception 'staff_session_required' using errcode='42501';
        end if;
        if p_staff_id <> '00000000-0000-0000-0000-000000000001'::uuid then
          raise exception 'no_employee_scope' using errcode='42501';
        end if;
        return jsonb_build_object(
          'staff',jsonb_build_object('id',p_staff_id,'name','Fixture staff'),
          'weekly_schedule','[]'::jsonb,
          'rates',jsonb_build_object('evaluated_days',0,'late_rate_pct',0),
          'recent_days','[]'::jsonb
        );
      end $$;
    insert into public.staff_attendance_logs(staff_id,shift_date,status,attendance_type,recorded_at,branch_name)
    values
      ('00000000-0000-0000-0000-000000000001',(now() at time zone 'Africa/Cairo')::date-1,'accepted','check_in',now()-interval '10 hour','المخزن'),
      ('00000000-0000-0000-0000-000000000001',(now() at time zone 'Africa/Cairo')::date-1,'accepted','check_out',now()-interval '2 hour','المخزن'),
      ('00000000-0000-0000-0000-000000000001',(now() at time zone 'Africa/Cairo')::date-2,'accepted','check_in',now()-interval '1 day','فرع الشامي'),
      ('00000000-0000-0000-0000-000000000001',(now() at time zone 'Africa/Cairo')::date-3,'manual_review','check_out',now()-interval '3 day','فرع شكري'),
      ('00000000-0000-0000-0000-000000000001',(now() at time zone 'Africa/Cairo')::date-3,'rejected','check_out',now()-interval '3 day','فرع شكري')
  `);
  await db.exec(sql);
  await db.exec('SET ROLE anon');
  let blocked=false;
  try {
    await db.query(`select public.attendance_employee_profile_evidence_v1(
      '00000000-0000-0000-0000-000000000001'::uuid,30)`);
  } catch (e) {blocked=/active staff session required|staff_session_required/.test(String(e));}
  assert(blocked,'anon without a verified staff session MUST NOT read evidence');
  await db.exec('RESET ROLE');
  await db.query(`select set_config('request.headers',
    '{"x-dawaa-session-token":"fixture-valid-staff"}',false)`);
  const one=await db.query(`
    select public.attendance_employee_profile_evidence_v1(
      '00000000-0000-0000-0000-000000000001'::uuid,30) as profile
  `);
  const x=one.rows[0].profile;
  assert.equal(x.staff.name,'Fixture staff');
  assert.equal(x.rates.evaluated_days,0,'absence of payroll snapshot remains explicit');
  assert.equal(x.recent_days.length,0,'must not fabricate approved attendance');
  assert.equal(x.processed_evidence.accepted_punches,3);
  assert.equal(x.processed_evidence.accepted_days,2);
  assert.equal(x.processed_evidence.complete_pair_days,1);
  assert.equal(x.processed_evidence.manual_review_punches,1);
  assert.equal(x.processed_evidence.rejected_punches,1);
  assert(x.processed_evidence.recent_days.some(d=>d.punch_branches.includes('المخزن')));
  assert(x.processed_evidence.recent_days.every(d=>!('payroll_eligible_hours' in d)));
  let differentDenied=false;
  try {
    await db.query(`select public.attendance_employee_profile_evidence_v1(
      '00000000-0000-0000-0000-000000000002'::uuid,30)`);
  } catch(e) {differentDenied=/no_employee_scope/.test(String(e));}
  assert(differentDenied,'cannot access a different employee');
  console.log('PASS: authorized profile evidence shows accepted device punches but no fabricated payroll days; anon without staff session blocked.');
} finally {
  await db.close();
}
