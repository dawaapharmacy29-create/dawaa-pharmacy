#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260830220000_attendance_daily_resolution_v1.sql';
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push(`Missing attendance resolution migration: ${migrationPath}`);
} else {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const lower = sql.toLowerCase();

  for (const token of [
    'dawaa_build_attendance_day_resolution_v1',
    'get_attendance_day_resolution_v1',
    'approve_attendance_day_resolution_v1',
    'payroll_eligible_hours',
    'resolution_snapshot',
    'where ss.staff_id=p_staff_id',
    "status='approved'",
    'attendance_resolution_override_requires_hours_and_note',
  ]) {
    if (!lower.includes(token.toLowerCase())) failures.push(`Attendance resolution migration missing ${token}.`);
  }

  if (!/revoke\s+all\s+on\s+table\s+public\.attendance_daily_summary\s+from\s+anon,\s*authenticated/i.test(sql)) {
    failures.push('attendance_daily_summary must not remain directly writable/readable by browser roles.');
  }
  if (/where\s+(?:ss\.)?(?:staff_name|employee_name)\s*=/i.test(sql)) {
    failures.push('Financial attendance schedule resolution must not fall back to name matching.');
  }
  if (!/where\s+staff_id=p_staff_id\s+and\s+attendance_date=p_attendance_date\s+and\s+status='approved'/i.test(sql)) {
    failures.push('Approved daily snapshots must be returned without live reinterpretation.');
  }
  if (/insert\s+into\s+public\.staff_payroll_monthly_v13/i.test(sql) || /update\s+public\.staff_payroll_monthly_v13/i.test(sql)) {
    failures.push('Attendance resolution must not write monthly payroll rows.');
  }
}

if (failures.length) {
  console.error('\nAttendance resolution architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[attendance-resolution] PASS: canonical schedule identity, immutable approved snapshot, and no direct payroll writes.');
