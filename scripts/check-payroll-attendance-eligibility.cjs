#!/usr/bin/env node
const fs = require('node:fs');

const eligibilityPath = 'supabase/migrations/20260830223000_payroll_attendance_eligibility_v1.sql';
const compatPath = 'supabase/migrations/20260830223500_payroll_v14_compatibility_gate_v1.sql';
const failures = [];

for (const path of [eligibilityPath, compatPath]) {
  if (!fs.existsSync(path)) failures.push(`Missing payroll attendance migration: ${path}`);
}

if (fs.existsSync(eligibilityPath)) {
  const sql = fs.readFileSync(eligibilityPath, 'utf8');
  const lower = sql.toLowerCase();
  for (const token of [
    "attendance_hours_mode text not null default 'manual'",
    'get_payroll_attendance_eligibility_v1',
    "a.status='approved'",
    'payroll_eligible_hours',
    "v_mode='resolved'",
    'cycle_not_closed',
    'unresolved_workdays',
  ]) {
    if (!lower.includes(token.toLowerCase())) failures.push(`Eligibility migration missing ${token}.`);
  }
  if (/from\s+public\.biometric_attendance_logs/i.test(sql) || /from\s+public\.staff_attendance_logs/i.test(sql)) {
    failures.push('Payroll eligibility must consume approved daily resolutions, not raw attendance evidence.');
  }
}

if (fs.existsSync(compatPath)) {
  const sql = fs.readFileSync(compatPath, 'utf8');
  if (!/save_staff_payroll_monthly_v14_core[\s\S]*save_staff_payroll_monthly_v15/i.test(sql)) {
    failures.push('Payroll compatibility layer must preserve an internal v14 core and gated v15 command.');
  }
  if (!/create or replace function public\.save_staff_payroll_monthly_v14\([\s\S]*select public\.save_staff_payroll_monthly_v15/i.test(sql)) {
    failures.push('Public v14 must be a compatibility facade to v15.');
  }
  if (!/revoke all on function public\.save_staff_payroll_monthly_v14_core[\s\S]*from public,anon,authenticated/i.test(sql)) {
    failures.push('Legacy payroll core must not be executable by browser roles.');
  }
  if (!/attendance_resolution_not_ready_for_payroll/i.test(sql)) {
    failures.push('Resolved attendance mode must block approval when attendance is not ready.');
  }
}

if (failures.length) {
  console.error('\nPayroll attendance eligibility architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[payroll-attendance-eligibility] PASS: manual rollout default, resolved snapshots gate approval, and no raw-attendance bypass.');
