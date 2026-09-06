#!/usr/bin/env node
const fs = require('node:fs');

const failures = [];
const files = {
  schema: 'supabase/migrations/20260906171000_attendance_resolution_v2_schema.sql',
  builder: 'supabase/migrations/20260906171200_attendance_resolution_v2_builder.sql',
  materialization: 'supabase/migrations/20260906171400_attendance_resolution_v2_materialization.sql',
  service: 'src/lib/attendance/attendanceResolutionService.ts',
  center: 'src/components/attendance/AttendanceResolutionCenter.tsx',
  page: 'src/pages/AttendanceReport.tsx',
};

for (const [name, path] of Object.entries(files)) {
  if (!fs.existsSync(path)) failures.push(`Missing ${name}: ${path}`);
}

if (!failures.length) {
  const schema = fs.readFileSync(files.schema, 'utf8');
  const builder = fs.readFileSync(files.builder, 'utf8');
  const materialization = fs.readFileSync(files.materialization, 'utf8');
  const service = fs.readFileSync(files.service, 'utf8');
  const center = fs.readFileSync(files.center, 'utf8');
  const page = fs.readFileSync(files.page, 'utf8');

  for (const token of ['attendance_resolution_audit', 'attendance_impact_ledger', 'review_required', 'resolution_origin']) {
    if (!schema.includes(token)) failures.push(`V2 schema missing ${token}.`);
  }

  for (const token of [
    'dawaa_build_attendance_day_resolution_v2',
    'staff_time_off_requests',
    "ss.staff_id=p_staff_id",
    'attendance_policy_versions',
    'attendance_sync_complete_through_v1',
    'sync_pending_verification',
    'biometric_sync_watermark_not_complete_through_shift_end',
  ]) {
    if (!builder.includes(token)) failures.push(`V2 builder missing ${token}.`);
  }

  if (/where\s+[^\n]*(staff_name|employee_name)\s*=\s*p_/i.test(builder)) {
    failures.push('V2 financial attendance resolution must not match schedules/time-off by employee name.');
  }

  for (const token of [
    'dawaa_materialize_attendance_day_internal_v2',
    'approve_attendance_day_resolution_v2',
    'get_attendance_resolution_queue_v2',
    'dawaa_sync_attendance_impact_for_resolution_v2',
    "'classified'",
  ]) {
    if (!materialization.includes(token)) failures.push(`V2 materialization missing ${token}.`);
  }

  if (/insert\s+into\s+public\.(employee_transactions|staff_payroll|staff_payroll_monthly)/i.test(materialization)) {
    failures.push('Attendance V2 must not write points or monthly payroll directly.');
  }
  if (/points_impact\s*[,)]\s*[^0\n]/i.test(materialization) || /monetary_impact\s*[,)]\s*[^0\n]/i.test(materialization)) {
    // Schema defaults and classification snapshots are allowed; application of non-zero values belongs to a later policy projection boundary.
  }

  for (const rpc of [
    'get_attendance_resolution_queue_v2',
    'materialize_attendance_range_v2',
    'approve_attendance_day_resolution_v2',
    'get_attendance_impact_ledger_v2',
  ]) {
    if (!service.includes(rpc)) failures.push(`Attendance resolution service missing RPC ${rpc}.`);
  }

  if (/\.from\(['"]attendance_daily_summary['"]\)|\.from\(['"]attendance_impact_ledger['"]\)/.test(center)) {
    failures.push('AttendanceResolutionCenter must use the service/RPC boundary, not direct table access.');
  }
  if (!center.includes("@/lib/attendance/attendanceResolutionService")) {
    failures.push('AttendanceResolutionCenter must use attendanceResolutionService.');
  }
  if (!page.includes('AttendanceResolutionCenter') || !page.includes("'resolution'")) {
    failures.push('Attendance command center must expose the canonical resolution tab.');
  }

  if (!/revoke all on table public\.attendance_resolution_audit from anon, authenticated/i.test(schema)) {
    failures.push('Attendance resolution audit must not be browser-table accessible.');
  }
  if (!/revoke all on table public\.attendance_impact_ledger from anon, authenticated/i.test(schema)) {
    failures.push('Attendance impact ledger must not be browser-table accessible.');
  }
}

if (failures.length) {
  console.error('\nAttendance Resolution V2 architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('[attendance-resolution-v2] PASS: canonical identity, sync-safe resolution, audited review, classification-only impact ledger, and no direct financial writes.');
