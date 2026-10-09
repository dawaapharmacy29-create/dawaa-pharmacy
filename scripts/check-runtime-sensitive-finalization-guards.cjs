#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const failures = [];

const attendanceRel = 'supabase/migrations/20261009120500_attendance_materialize_verified_actor_guard_v2.sql';
const payrollRel = 'supabase/migrations/20261009121000_payroll_finalize_preview_route_alignment_v1.sql';
const classificationRel = 'supabase/migrations/20261009121500_payroll_delivery_classification_fail_closed_v1.sql';
const driftRel = 'supabase/migrations/20261009122000_payroll_attendance_drift_fail_closed_v1.sql';

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
const classification = read(classificationRel);
const drift = read(driftRel);

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

mustContain('Payroll delivery classification fail-closed boundary', classification, [
  'create or replace function public.dawaa_delivery_payroll_classification_strict_v1',
  "not (v_class ? 'payroll_eligible')",
  "jsonb_typeof(v_class->'payroll_eligible') <> 'boolean'",
  "raise exception 'delivery_payroll_classification_unavailable'",
  'public.payroll_finalization_gate_v2(uuid,text)',
  'public.payroll_finalization_gate_current_v1(uuid,text)',
  'public.employee_payroll_financial_composition_v3(uuid,text)',
  'public.employee_payroll_financial_composition_compat_v1(uuid,text)',
  'public.employee_payroll_financial_composition_current_v1(uuid,text)',
  'public.employee_payroll_transparency_v2(uuid,text)',
  'public.employee_payroll_transparency_current_v1(uuid,text)',
  'public.employee_payroll_statement_v2(uuid,text)',
  'public.finalize_payroll_snapshot_v3(uuid)',
  'expected one legacy fallback',
]);
if (!classification.includes("dawaa_delivery_payroll_classification_strict_v1(p_staff_id,p_month_cycle)")) {
  failures.push('Payroll classification migration must route staff/month decisions through the strict classification boundary.');
}
if (!classification.includes("dawaa_delivery_payroll_classification_strict_v1(v_snapshot.staff_id,v_snapshot.month_cycle)")) {
  failures.push('Payroll finalization must route staged snapshot decisions through the strict classification boundary.');
}

mustContain('Payroll attendance financial-drift fail-closed boundary', drift, [
  "pg_get_functiondef('public.payroll_finalization_gate_v2(uuid,text)'::regprocedure)",
  'attendance_resolution_financial_drift_count_v1(p_staff_id,v_start,v_end)',
  "raise exception ''attendance_financial_drift_check_unavailable''",
  'expected one zero-on-error fallback',
]);
if (!drift.includes('v_financial_drift:=0')) {
  failures.push('Payroll drift migration must explicitly identify and replace the legacy zero-on-error fallback.');
}

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

for (const [signatureNeedle, label] of [
  ['create or replace function public.dawaa_delivery_payroll_classification_strict_v1(', 'strict delivery classification boundary'],
  ['create or replace function public.payroll_finalization_gate_v2(', 'payroll_finalization_gate_v2'],
  ['create or replace function public.payroll_finalization_gate_current_v1(', 'payroll_finalization_gate_current_v1'],
  ['create or replace function public.employee_payroll_financial_composition_v3(', 'employee_payroll_financial_composition_v3'],
  ['create or replace function public.employee_payroll_financial_composition_compat_v1(', 'employee_payroll_financial_composition_compat_v1'],
  ['create or replace function public.employee_payroll_financial_composition_current_v1(', 'employee_payroll_financial_composition_current_v1'],
  ['create or replace function public.employee_payroll_transparency_v2(', 'employee_payroll_transparency_v2'],
  ['create or replace function public.employee_payroll_transparency_current_v1(', 'employee_payroll_transparency_current_v1'],
  ['create or replace function public.employee_payroll_statement_v2(', 'employee_payroll_statement_v2'],
  ['create or replace function public.finalize_payroll_snapshot_v3(', 'finalize_payroll_snapshot_v3'],
]) {
  rejectLaterRedefinition(path.basename(classificationRel), signatureNeedle, label);
}

rejectLaterRedefinition(
  path.basename(driftRel),
  'create or replace function public.payroll_finalization_gate_v2(',
  'payroll_finalization_gate_v2 drift safety'
);

if (failures.length) {
  console.error('[runtime-sensitive-finalization-guards] FAILED');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('[runtime-sensitive-finalization-guards] OK');
