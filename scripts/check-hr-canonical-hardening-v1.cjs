const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const hardening = path.join(root, 'supabase/migrations/20260924120000_hr_canonical_hardening_v1.sql');
const backfill = path.join(root, 'supabase/migrations/20260924121000_overtime_stale_cutover_backfill_v1.sql');
const systemCutover = path.join(root, 'supabase/migrations/20260924122000_overtime_system_rpc_cutover_v1.sql');
const attendanceService = path.join(root, 'src/lib/attendance/attendanceBreakdownService.ts');
const timeOffService = path.join(root, 'src/lib/timeOffService.ts');
const crossBranchPanel = path.join(root, 'src/components/attendance/CrossBranchPunchesPanel.tsx');
const crossBranchV2 = path.join(root, 'supabase/migrations/20260924124000_cross_branch_schedule_truth_v2.sql');
const payrollPage = path.join(root, 'src/pages/PayrollManagement.tsx');
const diagnosticGuard = path.join(root, 'supabase/migrations/20260924125000_attendance_diagnostic_actor_guard_v1.sql');
const missingPunchGuard = path.join(root, 'supabase/migrations/20260924180500_missing_punch_financial_and_cycle_guard_v2.sql');
const missingPunchCapability = path.join(root, 'supabase/migrations/20260924181000_missing_punch_deduction_capability_v1.sql');
const attendanceResolutionService = path.join(root, 'src/lib/attendance/attendanceResolutionService.ts');
const attendanceResolutionCenter = path.join(root, 'src/components/attendance/AttendanceResolutionCenter.tsx');

function fail(message) {
  console.error('[hr-canonical-hardening] ' + message);
  process.exit(1);
}
function read(file) {
  if (!fs.existsSync(file)) fail('missing file: ' + path.relative(root, file));
  return fs.readFileSync(file, 'utf8');
}
function assertContains(text, needle, label) {
  if (!text.includes(needle)) fail(label + ' is missing: ' + needle);
}

const migration = read(hardening);
const backfillSql = read(backfill);
const systemCutoverSql = read(systemCutover);
const attendance = read(attendanceService);
const timeOff = read(timeOffService);
const crossBranchUi = read(crossBranchPanel);
const crossBranchSql = read(crossBranchV2);
const payrollPageText = read(payrollPage);
const diagnosticGuardSql = read(diagnosticGuard);
const missingPunchGuardSql = read(missingPunchGuard);
const missingPunchCapabilitySql = read(missingPunchCapability);
const attendanceResolutionServiceText = read(attendanceResolutionService);
const attendanceResolutionCenterText = read(attendanceResolutionCenter);

assertContains(migration, 'return public.decide_overtime_approval_v3(p_id,p_decision,p_note);', 'V1 overtime compatibility wrapper');
assertContains(migration, 'dawaa_can_manage_payroll_staff_v1(v_target_username)', 'branch-scoped overtime authorization');
assertContains(migration, 'trg_hr_invalidate_overtime_on_attendance_change_v1', 'attendance->overtime invalidation trigger');
assertContains(migration, 'dawaa-detect-pending-overtime-v2', 'V2 detector cron');
assertContains(migration, 'dawaa-sync-attendance-overtime-reward-v2', 'V2 reward cron');
assertContains(migration, 'overtime_no_longer_eligible', 'approval-time overtime recalculation guard');
assertContains(backfillSql, "status='pending'", 'stale approved overtime backfill');
assertContains(systemCutoverSql, 'return public.dawaa_detect_pending_overtime_v2(p_lookback_days);', 'V1 detector compatibility wrapper');
assertContains(systemCutoverSql, 'return public.dawaa_sync_attendance_overtime_reward_v2(p_month_cycle);', 'V1 sync compatibility wrapper');
assertContains(systemCutoverSql, 'from public,anon,authenticated;', 'system RPC grant tightening');
assertContains(attendance, "supabase.rpc('decide_overtime_approval_v3'", 'frontend overtime decision path');
assertContains(timeOff, "supabase.rpc('decide_staff_time_off_request_v3'", 'frontend time-off decision path');
assertContains(crossBranchUi, "supabase.rpc('list_cross_branch_biometric_events_v2'", 'cross-branch UI canonical diagnostic path');
assertContains(crossBranchSql, "attendance_schedule_for_date_v1", 'cross-branch schedule-day resolver');
assertContains(crossBranchSql, "expected_branch", 'cross-branch expected branch contract');
assertContains(payrollPageText, 'PayrollAttendanceSafetyGate', 'canonical payroll safety gate UI');
if (/attendanceReadiness[^\n]{0,120}readyForPayroll/.test(payrollPageText)) fail('legacy biometric readiness must not gate financial payroll actions');
assertContains(diagnosticGuardSql, 'dawaa_current_staff_account_id_strict()', 'attendance diagnostic active actor check');
assertContains(diagnosticGuardSql, 'dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)', 'attendance diagnostic row scope');
assertContains(missingPunchGuardSql, "'missing-punch-cycle:'||p_staff_id::text||':'||v_cycle", 'missing punch cycle serialization');
assertContains(missingPunchGuardSql, "dawaa_current_actor_can(array['create_deduction','manage_points','manage_payroll'])", 'missing punch financial permission gate');
assertContains(missingPunchCapabilitySql, "'can_apply_deduction',v_can_apply_deduction", 'missing punch capability contract');
assertContains(attendanceResolutionServiceText, 'can_apply_deduction: boolean', 'missing punch capability type');
assertContains(attendanceResolutionCenterText, '!missingPunchContext.can_apply_deduction', 'missing punch UI financial gate');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const legacyFrontendCalls = [];
for (const file of walk(path.join(root, 'src'))) {
  const text = fs.readFileSync(file, 'utf8');
  if (/rpc\(\s*['"]decide_overtime_approval_v1['"]/.test(text)) {
    legacyFrontendCalls.push(path.relative(root, file));
  }
}

if (legacyFrontendCalls.length) {
  fail('legacy overtime V1 RPC is still called from app source: ' + legacyFrontendCalls.join(', '));
}

console.log('[hr-canonical-hardening] OK');
console.log('  - overtime decisions use V3');
console.log('  - V1 remains compatibility-only');
console.log('  - attendance changes invalidate prior approved overtime');
console.log('  - scheduled detector/reward cutover targets V2');
console.log('  - stale approved overtime backfill is present');
console.log('  - V1 detector/sync delegate to V2 and app-role EXECUTE is revoked');
console.log('  - cross-branch diagnostics compare punch branch against same-day schedule truth');
console.log('  - missing-punch occurrences are serialized per cycle and deductions require financial permission');
