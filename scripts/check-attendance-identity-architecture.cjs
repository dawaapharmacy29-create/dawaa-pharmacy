#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const migrationPath = path.join(
  ROOT,
  'supabase/migrations/20260823214500_canonicalize_staff_attendance_log_identity_v1.sql'
);
const backfillPath = path.join(
  ROOT,
  'supabase/migrations/20260823215500_backfill_staff_attendance_log_identity_v1.sql'
);
const rlsPath = path.join(
  ROOT,
  'supabase/migrations/20260823225200_harden_staff_attendance_logs_rls_v1.sql'
);
const legacyReadOnlyPath = path.join(
  ROOT,
  'supabase/migrations/20260823230000_retire_legacy_attendance_client_writes_v1.sql'
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

if (!fs.existsSync(backfillPath)) {
  failures.push('Missing deterministic attendance identity backfill migration.');
} else {
  const source = fs.readFileSync(backfillPath, 'utf8');
  if (!source.includes('direct_account_matches')) {
    failures.push('Attendance backfill must preserve direct account-id matching.');
  }
  if (!source.includes('unique_name_branch') || !source.includes('candidate_count=1')) {
    failures.push('Attendance backfill must only use unique active name+branch candidates.');
  }
  if (!/sa\.active\s*=\s*true/i.test(source) || !/sa\.can_login\s*=\s*true/i.test(source)) {
    failures.push('Attendance backfill candidates must be active and login-enabled accounts.');
  }
  if (!/coalesce\(u\.branch,''\)\s*=\s*coalesce\(l\.branch_name,''\)/i.test(source)) {
    failures.push('Attendance name matching must also require the same branch.');
  }
  if (!/set\s+staff_id\s*=\s*r\.subject_id[\s\S]{0,120}created_by\s*=\s*r\.account_id/i.test(source)) {
    failures.push('Attendance backfill must set canonical subject and account executor IDs together.');
  }
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(source)) {
    failures.push('Attendance backfill must not hardcode generated account/staff UUIDs.');
  }
}

if (!fs.existsSync(rlsPath)) {
  failures.push('Missing scoped staff attendance log RLS migration.');
} else {
  const source = fs.readFileSync(rlsPath, 'utf8');
  for (const token of [
    'dawaa_can_read_staff_attendance_log',
    'dawaa_current_attendance_subject_id',
    'dawaa_current_staff_account_id_strict',
    'staff_attendance_logs_insert_own',
    'staff_attendance_logs_select_scoped',
  ]) {
    if (!source.includes(token)) failures.push(`Attendance RLS migration must include ${token}.`);
  }
  for (const role of ['general_manager', 'executive_manager', 'branches_manager', 'branch_manager', 'shift_supervisor_morning', 'shift_supervisor_evening']) {
    if (!source.includes(role)) failures.push(`Attendance read scope must explicitly cover ${role}.`);
  }
  if (!/staff_id\s*=\s*public\.dawaa_current_attendance_subject_id\(\)/i.test(source)) {
    failures.push('Attendance insert policy must restrict writes to the canonical current subject.');
  }
  if (!/created_by\s*=\s*public\.dawaa_current_staff_account_id_strict\(\)/i.test(source)) {
    failures.push('Attendance insert policy must bind created_by to the canonical current account.');
  }
  if (/\busing\s*\(\s*true\s*\)/i.test(source) || /\bwith\s+check\s*\(\s*true\s*\)/i.test(source)) {
    failures.push('Attendance RLS must not reintroduce unconditional true policies.');
  }
  if (/create\s+policy[\s\S]{0,160}for\s+(update|delete)/i.test(source)) {
    failures.push('Modern attendance logs must remain append-only for clients.');
  }
}

if (!fs.existsSync(legacyReadOnlyPath)) {
  failures.push('Missing legacy attendance read-only migration.');
} else {
  const source = fs.readFileSync(legacyReadOnlyPath, 'utf8');
  for (const policy of ['attendance_auth_insert', 'attendance_insert_app', 'attendance_auth_update', 'attendance_update_app']) {
    if (!source.includes(policy)) failures.push(`Legacy attendance retirement must drop ${policy}.`);
  }
  if (/create\s+policy/i.test(source)) {
    failures.push('Legacy attendance retirement must not create new client write policies.');
  }
}

const legacyAttendanceReaders = new Set();
const allowedLegacyAttendanceReaders = new Set([
  'src/lib/readModels/attendanceReadModel.ts',
  'src/lib/attendance/attendanceReportRows.ts',
  // Temporary debt: this page still duplicates the monthly evidence queries and should be
  // migrated to employeeMonthlyEvidenceService before removing the legacy table entirely.
  'src/pages/StaffMonthlyEvaluation.tsx',
]);

function scanLegacyAttendanceAccess(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanLegacyAttendanceAccess(full);
      continue;
    }
    if (!/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) continue;
    const source = fs.readFileSync(full, 'utf8');
    const relative = path.relative(ROOT, full).replaceAll('\\', '/');
    const accessPattern = /\.from\(\s*['"]attendance['"]\s*\)/g;
    const writePattern = /\.from\(\s*['"]attendance['"]\s*\)[\s\S]{0,300}\.(?:insert|update|upsert|delete)\s*\(/g;

    if (accessPattern.test(source)) legacyAttendanceReaders.add(relative);
    if (writePattern.test(source)) {
      failures.push(`Legacy attendance table must remain read-only in app source: ${relative}.`);
    }
  }
}
scanLegacyAttendanceAccess(path.join(ROOT, 'src'));

for (const reader of legacyAttendanceReaders) {
  if (!allowedLegacyAttendanceReaders.has(reader)) {
    failures.push(`New direct legacy attendance reader is not allowed: ${reader}. Use a canonical attendance read model.`);
  }
}

if (failures.length) {
  console.error('\nAttendance identity architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`[attendance-identity-architecture] PASS: modern attendance uses canonical scoped append-only storage; legacy attendance is read-only and limited to ${legacyAttendanceReaders.size} approved compatibility readers.`);
