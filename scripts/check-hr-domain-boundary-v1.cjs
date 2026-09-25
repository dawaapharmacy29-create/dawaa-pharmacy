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
const hrQualityPage = path.join(srcRoot, 'pages/HRDataQuality.tsx');
if (read(hrQualityPage).includes('supabase.rpc(')) {
  fail('HRDataQuality must use domain services; direct RPC calls are forbidden.');
}
const syncCommandCenter = path.join(srcRoot, 'components/attendance/AttendanceSyncCommandCenter.tsx');
if (read(syncCommandCenter).includes('supabase.rpc(')) {
  fail('AttendanceSyncCommandCenter must use attendanceOperationsService; direct RPC calls are forbidden.');
}
const crossBranchPanel = path.join(srcRoot, 'components/attendance/CrossBranchPunchesPanel.tsx');
if (read(crossBranchPanel).includes('supabase.rpc(')) {
  fail('CrossBranchPunchesPanel must use attendanceOperationsService; direct RPC calls are forbidden.');
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
  'dawaa_sync_attendance_points_deduction_v1',
  'attendance_deduction_pending_review_v1',
  'attendance_deduction_review_decide_v1',
  'attendance_deduction_adjust_v1',
  'payroll_cycle_finalization_overview_v1',
  'record_employee_points_transaction_v3',
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
  "from('staff_evaluation_incentive_multipliers').insert",
  "from('staff_evaluation_incentive_multipliers').update",
  "from('staff_evaluation_incentive_multipliers').upsert",
  "from('staff_evaluation_incentive_multipliers').delete",
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
if (payrollPage.includes('supabase.rpc(') || payrollPage.includes('supabase.from(')) {
  fail('PayrollManagement must use HR/payroll domain services; direct Supabase access is forbidden.');
}
const legacyPayrollHistory = read(path.join(srcRoot, 'lib/payroll/payrollLegacyHistoryService.ts'));
if (payrollPage.includes('netSalaryPreview') || payrollPage.includes('overtimeValue')) {
  fail('PayrollManagement must not calculate payroll net/overtime locally.');
}
if (!payrollPage.includes('<PayrollManualEntriesPanel')) {
  fail('PayrollManagement must use the canonical manual-entry ledger.');
}
if (payrollPage.includes('staff_payroll_monthly_v13')) {
  fail('PayrollManagement must not read V13 directly; legacy history is isolated behind payrollLegacyHistoryService.');
}
if (!legacyPayrollHistory.includes("in('status', ['approved', 'paid'])")) {
  fail('V13 compatibility reader must be restricted to approved/paid historical rows.');
}

const employeeTransactionService = read(path.join(srcRoot, 'services/employeeTransactionService.ts'));
if (!employeeTransactionService.includes('recordEmployeePointEvent') || !employeeTransactionService.includes('record_employee_points_transaction_v4')) {
  fail('employeeTransactionService must create point events through the canonical V4 command.');
}
if (/\.(?:insert|update|upsert|delete)\s*\(/.test(employeeTransactionService)) {
  fail('employeeTransactionService must not mutate employee_transactions directly.');
}

const manualService = read(path.join(srcRoot, 'lib/payroll/payrollManualLedgerService.ts'));
for (const required of [
  'create_staff_payroll_manual_entry_v1',
  'reverse_staff_payroll_manual_entry_v1',
  'list_staff_payroll_manual_entries_v1',
]) {
  if (!manualService.includes(required)) fail('manual ledger service missing ' + required);
}
const manualLedgerMigration = read(path.join(root, 'supabase/migrations/20260925134000_payroll_manual_ledger_cutover_v1.sql'));
for (const required of [
  'not_authorized_for_payroll_manual_entry_list',
  'finalized_payroll_cycle_is_immutable',
]) {
  if (!manualLedgerMigration.includes(required)) fail('manual ledger migration missing protection ' + required);
}

const monthlyEvaluationPage = read(path.join(srcRoot, 'pages/StaffMonthlyEvaluationGeneral.tsx'));
if (!monthlyEvaluationPage.includes("save_staff_monthly_evaluation_v2")) {
  fail('monthly evaluation must use the atomic V2 evaluation + multiplier command.');
}
if (monthlyEvaluationPage.includes('staff_evaluation_incentive_multipliers')) {
  fail('monthly evaluation must not mutate incentive multipliers directly.');
}

const attendanceOps = read(path.join(srcRoot, 'lib/attendance/attendanceOperationsService.ts'));
if (!attendanceOps.includes('attendance_policy_v3_cutover_readiness_v1')) {
  fail('attendance operations must expose explicit V3 cutover readiness.');
}

console.log('[hr-domain-boundary] OK');
