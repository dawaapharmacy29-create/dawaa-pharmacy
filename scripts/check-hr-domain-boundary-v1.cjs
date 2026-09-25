const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcRoot = path.join(root, 'src');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const files = walk(srcRoot);
const rel = (file) => path.relative(root, file).replaceAll('\\', '/');
const read = (file) => fs.readFileSync(file, 'utf8');

function fail(message) {
  console.error('[hr-domain-boundary] ' + message);
  process.exit(1);
}

const attendancePage = path.join(srcRoot, 'pages/AttendanceReport.tsx');
if (read(attendancePage).includes('supabase.rpc(')) {
  fail('AttendanceReport must use attendanceOperationsService; direct RPC calls are forbidden.');
}

const forbiddenLegacy = [
  'save_staff_payroll_monthly_v14',
  'save_staff_payroll_monthly_v15',
  'save_staff_payroll_monthly_v16',
  'save_staff_payroll_monthly_v17',
  'approve_attendance_day_resolution_v1',
  'assign_biometric_staff_mapping_v1',
  'assign_biometric_staff_mapping_v2',
  'attendance_sync_health_v1',
  'attendance_sync_health_v2',
  'attendance_sync_health_v3',
  'get_staff_attendance_detail_v1',
  'get_staff_attendance_detail_v2',
  'list_cross_branch_biometric_events_v1',
  'list_unmapped_biometric_staff_v1',
  'attendance_request_time_off_v1',
  'attendance_branch_review_time_off_v1',
  'attendance_gm_review_time_off_v1',
  'attendance_branch_time_off_queue_v1',
  'attendance_gm_time_off_queue_v1',
  'attendance_my_time_off_requests_v1',
  'attendance_cancel_time_off_request_v1',
];

for (const file of files) {
  const text = read(file);
  for (const legacy of forbiddenLegacy) {
    if (text.includes(legacy)) {
      fail(rel(file) + ' references legacy API ' + legacy);
    }
  }
}

const protectedTables = [
  "from('staff_payroll_monthly_v13').insert",
  "from('staff_payroll_monthly_v13').update",
  "from('employee_transactions').insert",
  "from('employee_transactions').update",
  "from('staff_payroll_manual_entries_v1').insert",
  "from('staff_payroll_manual_entries_v1').update",
];

for (const file of files) {
  const text = read(file);
  for (const token of protectedTables) {
    if (text.includes(token)) fail(rel(file) + ' writes directly to protected ledger/table: ' + token);
  }
}

const payrollPage = read(path.join(srcRoot, 'pages/PayrollManagement.tsx'));
if (payrollPage.includes('netSalaryPreview') || payrollPage.includes('overtimeValue')) {
  fail('PayrollManagement must not calculate payroll net/overtime locally.');
}
if (!payrollPage.includes('<PayrollManualEntriesPanel')) {
  fail('PayrollManagement must use the canonical manual-entry ledger.');
}

const manualService = read(path.join(srcRoot, 'lib/payroll/payrollManualLedgerService.ts'));
for (const required of [
  'create_staff_payroll_manual_entry_v1',
  'reverse_staff_payroll_manual_entry_v1',
  'list_staff_payroll_manual_entries_v1',
]) {
  if (!manualService.includes(required)) fail('manual ledger service missing ' + required);
}

console.log('[hr-domain-boundary] OK');
