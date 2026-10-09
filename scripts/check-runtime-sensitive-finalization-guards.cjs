#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const failures = [];

const attendanceRel = 'supabase/migrations/20261009120500_attendance_materialize_verified_actor_guard_v2.sql';
const payrollRel = 'supabase/migrations/20261009121000_payroll_finalize_preview_route_alignment_v1.sql';

function read(rel) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    failures.push(`Missing runtime-sensitive guard migration: ${rel}`);
    return '';
  }
  return fs.readFileSync(full, 'utf8');
}

function mustContain(label, text, tokens) {
  for (const token of tokens) {
    if (!text.includes(token)) failures.push(`${label} missing ${token}`);
  }
}

const attendance = read(attendanceRel);
const payroll = read(payrollRel);

mustContain('Attendance materialization authorization guard', attendance, [
  'dawaa_current_staff_account_id_strict()',
  'coalesce(sa.active,false) = true',
  'coalesce(sa.can_login,false) = true',
  'dawaa_actor_is_top_management_v1()',
  "raise exception 'not_authorized_for_attendance_materialization'",
  'dawaa_materialize_attendance_range_route_aware_v1(p_start, p_end, p_branch)',
  'revoke all on function public.materialize_attendance_range_v2(date,date,text) from public',
]);
if (/create or replace function public\.materialize_attendance_range_v2[\s\S]*?language\s+sql/i.test(attendance)) {
  failures.push('Attendance materialization browser boundary must keep the PL/pgSQL authorization guard, not a bare SQL wrapper.');
}

mustContain('Payroll staged-preview route alignment', payroll, [
  "pg_get_functiondef('public.finalize_payroll_snapshot_v2(uuid)'::regprocedure)",
  "v_snapshot.payload ? 'preview_route'",
  'public.compare_payroll_final_snapshot_v2(p_snapshot_id)',
  'public.compare_payroll_final_snapshot_v1(p_snapshot_id)',
  'compare anchor not found exactly once',
]);

const migrationNames = fs.existsSync(MIGRATIONS)
  ? fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()
  : [];

function rejectLaterRedefinition(afterName, signatureNeedle, label) {
  const index = migrationNames.indexOf(afterName);
  if (index < 0) return;
  for (const name of migrationNames.slice(index + 1)) {
    const text = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');
    if (text.toLowerCase().includes(signatureNeedle.toLowerCase())) {
      failures.push(`${label} is redefined after its guard by ${name}; review the newer definition and update this guard deliberately.`);
    }
  }
}

rejectLaterRedefinition(
  path.basename(attendanceRel),
  'create or replace function public.materialize_attendance_range_v2(',
  'materialize_attendance_range_v2'
);
rejectLaterRedefinition(
  path.basename(payrollRel),
  'create or replace function public.finalize_payroll_snapshot_v2(',
  'finalize_payroll_snapshot_v2'
);

if (failures.length) {
  console.error('[runtime-sensitive-finalization-guards] FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('[runtime-sensitive-finalization-guards] OK');
