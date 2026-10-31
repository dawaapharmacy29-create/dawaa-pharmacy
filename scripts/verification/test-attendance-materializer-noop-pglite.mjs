// Isolated PostgreSQL-compatible integration test. No production connection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Usually resolved from the repository's declared dependency. The override
// enables a minimal isolated installation without installing the full app.
const pgliteModule = process.env.DAWAA_PGLITE_MODULE
  ? pathToFileURL(process.env.DAWAA_PGLITE_MODULE).href
  : '@electric-sql/pglite';
const { PGlite } = await import(pgliteModule);

const db = new PGlite();
const setup = `
create role anon;
create role authenticated;
create role service_role;
create table public.attendance_daily_summary (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid, attendance_date date, branch text, first_in timestamptz,
  last_out timestamptz, total_hours numeric, late_minutes integer,
  early_leave_minutes integer, missing_punch boolean, status text, source text,
  schedule_id uuid, scheduled_start_at timestamptz, scheduled_end_at timestamptz,
  candidate_hours numeric, payroll_eligible_hours numeric, resolution_status text,
  resolution_version integer, resolution_snapshot jsonb, approved_at timestamptz,
  approved_by text, approved_by_name text, approval_note text, updated_at timestamptz,
  resolution_origin text, review_required boolean, resolved_at timestamptz,
  time_off_request_id uuid, policy_version text, sync_complete_through timestamptz
);
create unique index attendance_daily_summary_staff_date_uidx on public.attendance_daily_summary(staff_id,attendance_date)
where staff_id is not null and attendance_date is not null;
create table public.attendance_resolution_audit (
  resolution_id uuid, staff_id uuid, attendance_date date, action text,
  actor_id text, actor_name text, note text, snapshot jsonb
);
create table public.test_materializer_updates (row_id uuid, changed_at timestamptz default clock_timestamp());
create function public.test_count_update() returns trigger language plpgsql as $$
begin insert into public.test_materializer_updates(row_id) values(new.id); return new; end $$;
create trigger attendance_update_counter after update on public.attendance_daily_summary
for each row execute function public.test_count_update();
create table public.test_builder_state (staff_id uuid primary key, hours numeric not null default 8,
  watermark timestamptz not null default '2026-10-30 06:00+00', system_resolvable boolean not null default false);
create or replace function public.dawaa_build_attendance_day_resolution_v2(p_staff_id uuid,p_day date)
returns jsonb language sql stable as $$
select jsonb_build_object('finalizable',true,'system_resolvable',s.system_resolvable,
 'resolution_status','matched','candidate_hours',s.hours,'late_minutes',0,
 'early_leave_minutes',0,'branch','فرع شكري','policy_version','test-v2',
 'sync_complete_through',s.watermark,'reason','fixture')
from public.test_builder_state s where s.staff_id=p_staff_id $$;
create or replace function public.dawaa_build_attendance_day_resolution_v3(p_staff_id uuid,p_day date)
returns jsonb language sql stable as $$
select jsonb_build_object('finalizable',true,'system_resolvable',s.system_resolvable,
 'resolution_status','matched','candidate_hours',s.hours,'late_minutes',0,
 'early_leave_minutes',0,'branch','فرع شكري','resolved_policy_version','test-v3',
 'sync_complete_through',s.watermark,'reason','fixture')
from public.test_builder_state s where s.staff_id=p_staff_id $$;
create function public.dawaa_sync_attendance_impact_for_resolution_v2(p_resolution_id uuid)
returns void language plpgsql as $$begin null; end$$;
`;
await db.exec(setup);

for (const file of [
  'supabase/migrations/20261031115900_attendance_v2_skip_timestamp_only_rematerialization.sql',
  'supabase/migrations/20261031121000_attendance_v3_skip_timestamp_only_rematerialization.sql',
]) {
  try {
    await db.exec(readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Migration failed (${file}): ${error.message}`);
    process.exitCode = 1;
    await db.close();
    process.exit();
  }
}

const getCount = async (table) => Number((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n);
for (const [v, staff] of [
  ['v2','11111111-1111-4111-8111-111111111111'],
  ['v3','22222222-2222-4222-8222-222222222222'],
]) {
  const func = `public.dawaa_materialize_attendance_day_internal_${v}`;
  await db.query('insert into public.test_builder_state(staff_id) values ($1)',[staff]);
  const materialize = () => db.query(`select ( ${func}($1::uuid, '2026-10-29'::date)).id as id`,[staff]);
  const first = (await materialize()).rows[0].id;
  assert.ok(first, `${v}: first materialization returns ID`);
  const initialAudit = await getCount('attendance_resolution_audit');
  await materialize();
  assert.equal(await getCount('test_materializer_updates'), v==='v2'?0:3, `${v}: identical repeat never updates`);
  assert.equal(await getCount('attendance_resolution_audit'), initialAudit, `${v}: duplicate evidence not re-audited`);
  await db.query('update public.test_builder_state set hours=9 where staff_id=$1',[staff]);
  await materialize();
  assert.equal(await getCount('test_materializer_updates'),v==='v2'?1:4,`${v}: hours change written`);
  await db.query("update public.test_builder_state set watermark='2026-10-30 07:00+00' where staff_id=$1",[staff]);
  await materialize();
  assert.equal(await getCount('test_materializer_updates'),v==='v2'?2:5,`${v}: evidence watermark change written`);
  await db.query('update public.test_builder_state set system_resolvable=true where staff_id=$1',[staff]);
  await materialize();
  assert.equal(await getCount('test_materializer_updates'),v==='v2'?3:6,`${v}: approval/financial transition written`);
  const result = (await db.query('select status,payroll_eligible_hours,resolution_snapshot->>\'candidate_hours\' as hours from public.attendance_daily_summary where staff_id=$1',[staff])).rows[0];
  assert.equal(result.status,'approved');
  assert.equal(Number(result.payroll_eligible_hours),9);
  assert.equal(result.hours,'9');
  await materialize();
  assert.equal(await getCount('test_materializer_updates'),v==='v2'?3:6,`${v}: approved day immutable`);
  console.log(`PASS ${v}: no-op, evidence audit, changed hours, watermark, approved payroll, protected approved`);
}
await db.close();
