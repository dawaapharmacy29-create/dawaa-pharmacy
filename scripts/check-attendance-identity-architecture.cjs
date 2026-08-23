#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const migrationPath = path.join(
  ROOT,
  'supabase/migrations/20260823214500_canonicalize_staff_attendance_log_identity_v1.sql'
);
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push('Missing canonical attendance identity migration.');
} else {
  const source = fs.readFileSync(migrationPath, 'utf8');
  for (const token of [
    'dawaa_current_attendance_subject_id',
    'dawaa_normalize_staff_attendance_log_identity_v1',
    'trg_dawaa_normalize_staff_attendance_log_identity_v1',
    'staff_attendance_identity_health_v1',
    'dawaa_current_staff_account_id_strict',
  ]) {
    if (!source.includes(token)) failures.push(`Attendance identity migration must include ${token}.`);
  }

  if (!/before\s+insert\s+on\s+public\.staff_attendance_logs/i.test(source)) {
    failures.push('Attendance identity normalization must run before staff_attendance_logs inserts.');
  }
  if (!/new\.staff_id\s*:=\s*v_subject_id/i.test(source)) {
    failures.push('Attendance insert trigger must canonicalize staff_id.');
  }
  if (!/new\.created_by\s*:=\s*v_account_id/i.test(source)) {
    failures.push('Attendance insert trigger must canonicalize created_by to the account id.');
  }
  if (!/return\s+v_account_id/i.test(source)) {
    failures.push('Synthetic/non-UUID staff identifiers must fall back to the canonical account UUID.');
  }
  if (/\bupdate\s+public\.staff_attendance_logs\b/i.test(source)) {
    failures.push('Identity canonicalization migration must not silently rewrite historical attendance rows.');
  }
}

if (failures.length) {
  console.error('\nAttendance identity architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[attendance-identity-architecture] PASS: new attendance logs are canonicalized at the database boundary and legacy rows remain audit-visible for explicit review.');
