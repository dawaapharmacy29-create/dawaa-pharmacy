#!/usr/bin/env node
const fs = require('node:fs');

const migrationPath = 'supabase/migrations/20260830214000_attendance_payroll_readiness_v1.sql';
const servicePath = 'src/lib/payroll/attendancePayrollReadinessService.ts';
const payrollEntryPath = 'src/pages/PayrollManagement.tsx';
const payrollWorkspacePath = 'src/pages/PayrollManagementV2.tsx';
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

if (!fs.existsSync(payrollEntryPath)) {
  failures.push(`Missing payroll compatibility entrypoint: ${payrollEntryPath}`);
} else {
  const entry = fs.readFileSync(payrollEntryPath, 'utf8');
  if (!entry.includes("export { default } from './PayrollManagementV2';")) {
    failures.push('Live PayrollManagement entrypoint must route to Workspace V2.');
  }
}

if (!fs.existsSync(payrollWorkspacePath)) {
  failures.push(`Missing live payroll workspace: ${payrollWorkspacePath}`);
} else {
  const page = fs.readFileSync(payrollWorkspacePath, 'utf8');
  for (const token of ['fetchAttendancePayrollReadiness', 'candidateWorkedHours']) {
    if (!page.includes(token)) failures.push(`Payroll Workspace V2 missing readiness token: ${token}`);
  }
  if (!/جاهزية البصمة(?: للرواتب)?/.test(page)) {
    failures.push('Payroll Workspace V2 must expose biometric payroll-readiness status to the operator.');
  }
  if (!page.includes('لا تضرب في قيمة الساعة الشهرية')) {
    failures.push('Payroll Workspace V2 must explicitly keep fingerprint hours separate from the monthly-hour-unit base salary formula.');
  }
  if (/candidateWorkedHours[\s\S]{0,180}setMonthly/.test(page)) {
    failures.push('Payroll Workspace V2 must not automatically copy candidate fingerprint hours into the payroll row.');
  }
  if (!page.includes("workspaceTab === 'overview'")) {
    failures.push('Payroll readiness must stay inside the progressive overview path instead of becoming an eager global load.');
  }
  if (!page.includes('scopeRef.current !== requestScope')) {
    failures.push('Payroll readiness must preserve stale-response protection when staff or cycle changes.');
  }
}

if (failures.length) {
  console.error('\nAttendance payroll readiness architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[attendance-payroll-readiness] PASS: fingerprint promotion is canonical, trigger-only, live Workspace V2 exposes scoped read-only readiness, and base salary uses the independent compensation formula.');
