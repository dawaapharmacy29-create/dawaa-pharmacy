#!/usr/bin/env node
const fs = require('node:fs');

const failures = [];
const migrationPath = 'supabase/migrations/20260919023000_attendance_biometric_hardening_v2.sql';
const healthPath = 'src/components/attendance/AttendanceHealthStrip.tsx';
const approvalsPath = 'src/components/attendance/UnifiedApprovalsCenter.tsx';

for (const path of [migrationPath, healthPath, approvalsPath]) {
  if (!fs.existsSync(path)) failures.push('Missing attendance hardening file: ' + path);
}

if (!failures.length) {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const health = fs.readFileSync(healthPath, 'utf8');
  const approvals = fs.readFileSync(approvalsPath, 'utf8');

  const migrationTokens = [
    'branch_sync_status',
    'branch_activity_at',
    'same_employee_within_180_seconds',
    'no_matching_schedule_review',
    'ambiguous_middle_of_shift',
    'evidence_flags',
    "p_item_type in ('deduction','overtime')",
    'سبب القرار إجباري للخصم والأوفرتايم',
  ];

  for (const token of migrationTokens) {
    if (!migration.includes(token)) failures.push('Attendance biometric hardening missing: ' + token);
  }

  if (!health.includes('branch_activity_at') || !health.includes('events_last_24h')) {
    failures.push('Attendance health strip must consume per-branch activity and 24h event health.');
  }

  if (!approvals.includes('isBulkEligible')) {
    failures.push('Unified approvals must explicitly gate bulk-safe item types.');
  }
  if (!approvals.includes("it.item_type === 'deduction' || it.item_type === 'overtime'")) {
    failures.push('Sensitive attendance decisions must require individual notes.');
  }
  if (!approvals.includes('راجع الأدلة أولاً قبل الاعتماد')) {
    failures.push('Overtime approval must require evidence review before approval.');
  }
  if (approvals.includes('التوصية: {ctx.recommendation}')) {
    failures.push('Overtime UI must present evidence, not an automatic approval recommendation.');
  }

  const unsafeNoScheduleAcceptance = /no_matching_schedule[^\n]{0,120}decision['",\s:]+accepted/i.test(migration);
  if (unsafeNoScheduleAcceptance) {
    failures.push('No-schedule biometric events must not be auto-promoted as accepted attendance.');
  }
}

if (failures.length) {
  console.error('\nAttendance biometric hardening check failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('[attendance-biometric-hardening] PASS: branch health, duplicate safety, conservative semantics, overtime evidence and sensitive approval guards are present.');
