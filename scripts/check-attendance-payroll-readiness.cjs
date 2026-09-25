#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260830214000_attendance_payroll_readiness_v1.sql';
const servicePath = 'src/lib/payroll/attendancePayrollReadinessService.ts';
const payrollPagePath = 'src/pages/PayrollManagement.tsx';
const payrollSafetyGatePath = 'src/components/attendance/PayrollAttendanceSafetyGate.tsx';
const payrollComponentsPath = 'src/lib/payroll/payrollCompensationService.ts';
const failures = [];

if (!fs.existsSync(migrationPath)) {
  failures.push(`Missing attendance payroll readiness migration: ${migrationPath}`);
} else {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const lower = sql.toLowerCase();
  for (const token of [
    'dawaa_promote_biometric_attendance_v1',
    'get_attendance_payroll_readiness_v1',
    'v_subject_id',
    'device_id::text',
    'fingerprint_terminal',
    'candidate_worked_hours',
    'dawaa_can_manage_payroll_staff_v1',
    "status='accepted'",
    'max 18h',
  ]) {
    if (!lower.includes(token.toLowerCase())) failures.push(`Attendance readiness migration missing ${token}.`);
  }
  if (!/set\s+staff_id\s*=\s*v_subject_id/i.test(sql)) {
    failures.push('Biometric raw log must normalize staff_id to the canonical attendance subject.');
  }
  if (!/values\([\s\S]{0,400}v_subject_id/i.test(sql)) {
    failures.push('Promoted attendance rows must use the canonical attendance subject id.');
  }
  if (!/revoke\s+all\s+on\s+function\s+public\.dawaa_promote_biometric_attendance_v1\(\)[\s\S]{0,120}public,anon,authenticated/i.test(sql)) {
    failures.push('Biometric trigger function must not remain callable as a client RPC.');
  }
  if (/update\s+public\.staff_payroll_monthly_v13/i.test(sql) || /insert\s+into\s+public\.staff_payroll_monthly_v13/i.test(sql)) {
    failures.push('Attendance readiness must never write payroll monthly rows.');
  }
}

if (!fs.existsSync(servicePath)) {
  failures.push(`Missing attendance payroll readiness service: ${servicePath}`);
} else {
  const service = fs.readFileSync(servicePath, 'utf8');
  if (!service.includes("supabase.rpc('get_attendance_payroll_readiness_v1'")) {
    failures.push('Attendance readiness service must use the scoped server RPC.');
  }
  if (/\.from\(['"](?:biometric_attendance_logs|staff_attendance_logs)['"]\)/.test(service)) {
    failures.push('Attendance readiness service must not read raw attendance tables directly.');
  }
}

if (!fs.existsSync(payrollPagePath)) {
  failures.push(`Missing payroll page: ${payrollPagePath}`);
} else {
  const page = fs.readFileSync(payrollPagePath, 'utf8');

  if (!page.includes('PayrollAttendanceSafetyGate')) {
    failures.push('Payroll page must expose the canonical Payroll Attendance Safety Gate.');
  }
  if (!page.includes('PayrollTransparencyPanel')) {
    failures.push('Payroll page must expose the canonical payroll transparency panel.');
  }
  if (/candidateWorkedHours|candidate_worked_hours/.test(page)) {
    failures.push('Payroll page must not calculate or copy candidate fingerprint hours locally.');
  }
  if (/setMonthly\s*\(/.test(page)) {
    failures.push('Payroll page must not mutate a legacy monthly payroll row.');
  }
}

if (!fs.existsSync(payrollSafetyGatePath)) {
  failures.push(`Missing payroll safety gate: ${payrollSafetyGatePath}`);
} else {
  const gate = fs.readFileSync(payrollSafetyGatePath, 'utf8');
  for (const token of [
    'getPayrollFinalizationGate',
    'getPayrollFinalSnapshotPreview',
    'stagePayrollFinalSnapshot',
    'comparePayrollStagedSnapshot',
    'finalizePayrollSnapshotV2',
  ]) {
    if (!gate.includes(token)) failures.push(`Payroll safety gate missing canonical token: ${token}`);
  }
  if (/get_attendance_payroll_readiness_v1/.test(gate)) {
    failures.push('Financial finalization gate must not use the legacy biometric readiness reader as its ready flag.');
  }
}

if (!fs.existsSync(payrollComponentsPath)) {
  failures.push(`Missing payroll compensation service: ${payrollComponentsPath}`);
} else {
  const compensation = fs.readFileSync(payrollComponentsPath, 'utf8');
  if (!compensation.includes("get_payroll_components_v17")) {
    failures.push('Payroll compensation service must use the canonical payroll components RPC.');
  }
  if (/candidate_worked_hours|candidateWorkedHours/.test(compensation)) {
    failures.push('Compensation service must not substitute biometric candidate hours for canonical payroll components.');
  }
}

if (failures.length) {
  console.error('\nAttendance payroll readiness architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[attendance-payroll-readiness] PASS: biometric readiness is diagnostic-only; financial finalization uses the canonical safety gate/snapshot contract and payroll components remain independent.');
