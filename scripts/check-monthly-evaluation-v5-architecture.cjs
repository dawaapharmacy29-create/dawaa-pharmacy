const fs = require('fs');

const failures = [];

function read(path) {
  if (!fs.existsSync(path)) {
    failures.push(`Missing required file: ${path}`);
    return '';
  }
  return fs.readFileSync(path, 'utf8');
}

const page = read('src/pages/StaffMonthlyEvaluationGeneral.tsx');
const workflow = read('src/components/evaluations/MonthlyEvaluationWorkflowV5.tsx');
const audit = read('src/components/evaluations/MonthlyEvaluationAuditTrailV5.tsx');
const navigationGuard = read('src/contexts/NavigationGuardContext.tsx');
const financialTruth = read('src/lib/evaluations/monthlyEvaluationFinancialTruth.ts');
const profiles = read('src/lib/evaluations/staffEvaluationProfilesV3.ts');
const employeeMonthlyEvidence = read('src/lib/staff/employeeMonthlyEvidenceService.ts');
const canonicalAttendanceTruth = read('supabase/migrations/20261002213000_monthly_evaluation_canonical_attendance_truth_v5.sql');
const backend = [
  read('supabase/migrations/20260929153000_monthly_evaluation_command_center_v5.sql'),
  read('supabase/migrations/20260929154500_monthly_evaluation_v5_hardening.sql'),
  read('supabase/migrations/20260929160000_monthly_evaluation_v5_read_api.sql'),
  read('supabase/migrations/20260929161000_monthly_evaluation_v5_draft_fix.sql'),
  read('supabase/migrations/20260930113000_monthly_evaluation_score_truth_v5.sql'),
  read('supabase/migrations/20260930123000_monthly_evaluation_role_coverage_v5.sql'),
  read('supabase/migrations/20260930154000_monthly_evaluation_trigger_execute_hardening_v5.sql'),
  read('supabase/migrations/20260930155500_monthly_evaluation_server_evidence_type_compat_v5.sql'),
  read('supabase/migrations/20261001011000_monthly_evaluation_attendance_finalization_gate_v5.sql'),
  read('supabase/migrations/20261001012500_monthly_evaluation_followup_executor_truth_v5.sql'),
].join('\n');

for (const rpc of [
  'list_staff_for_monthly_evaluation_v5',
  'get_staff_monthly_evaluation_v5',
  'save_staff_monthly_evaluation_v5',
]) {
  if (!page.includes(rpc)) failures.push(`Monthly evaluation page must use canonical V5 RPC: ${rpc}`);
}

for (const legacy of [
  'save_staff_monthly_evaluation_v3',
  "rpc('get_staff_monthly_evaluation_safe'",
  "rpc('list_staff_for_monthly_evaluation_safe'",
]) {
  if (page.includes(legacy)) failures.push(`Monthly evaluation page still references legacy API: ${legacy}`);
}

if (!page.includes('MonthlyEvaluationWorkflowV5')) failures.push('V5 workflow stepper is not wired into the page.');
if (!page.includes('MonthlyEvaluationAuditTrailV5')) failures.push('V5 audit trail is not wired into the page.');
if (!page.includes("type: 'monthly_evaluation_ready'")) failures.push('Final approval must notify the employee through the canonical notification domain.');
if (!page.includes('weakSectionsMissingNotes')) failures.push('Weak-score rationale guard is missing from the client.');
if (!page.includes('criticalGateMissingReason')) failures.push('Critical-gate rationale guard is missing from the client.');
if (!page.includes('usePendingFormNavigationGuard')) failures.push('Monthly evaluation unsaved-change guard is not registered.');
if (!page.includes('requestEvaluationContextChange')) failures.push('Employee/cycle/branch switches must pass through the unsaved-change guard.');
if (!navigationGuard.includes('requestAction')) failures.push('Navigation guard must support guarded in-page context changes.');

if (/points_incentive_egp\s*\*\s*effectiveEvaluationMultiplierPct/.test(page)) {
  failures.push('Client-side final incentive recomputation is forbidden; read the canonical server financial truth.');
}
if (page.includes("gate.blocksFully ? 'إيقاف الحافز'")) {
  failures.push('Critical Gate UI must not claim all financial bonus is stopped; competition bonus is independent.');
}
if (!page.includes('معامل حافز النقاط الأساسي')) {
  failures.push('Critical Gate UI must name the points-incentive multiplier explicitly.');
}
if (!page.includes('final_approval_snapshot')) {
  failures.push('Published monthly evaluation/PDF must read from the persisted final approval snapshot.');
}
if (!page.includes('finalSnapshotHash: refreshedHash')) {
  failures.push('Employee notification must be traceable to the server final snapshot hash.');
}
if (!page.includes('resolveMonthlyEvaluationFinancialTruth')) {
  failures.push('Monthly evaluation/PDF must use the canonical frozen-statement financial truth boundary.');
}
if (!financialTruth.includes("source: 'settled_statement'") || !financialTruth.includes('points_closing') || !financialTruth.includes('incentive_amount')) {
  failures.push('Closed monthly statements must freeze both closing points and incentive amount together.');
}
if (!financialTruth.includes("source: 'points_truth'") || !financialTruth.includes('final_points') || !financialTruth.includes('final_incentive_egp')) {
  failures.push('Live Points Truth must remain the pre-settlement financial source.');
}

for (const step of ['بيانات الدورة', 'تقييم المحاور', 'النقاط والمخالفات', 'الخلاصة والتطوير', 'المراجعة والاعتماد']) {
  if (!workflow.includes(step)) failures.push(`Workflow is missing step: ${step}`);
}

if (!audit.includes('get_staff_monthly_evaluation_audit_v5')) failures.push('Audit component must read the V5 audit API.');
if (!profiles.includes('DEFAULT_RUBRIC')) failures.push('Every evaluation profile must have a five-star rubric fallback.');

for (const token of [
  'staff_monthly_evaluation_audit',
  'list_staff_for_monthly_evaluation_v5',
  'get_staff_monthly_evaluation_v5',
  'save_staff_monthly_evaluation_v5',
  "Africa/Cairo",
  'between 0 and 5',
  'يجب تقييم كل المحاور قبل الاعتماد النهائي',
  '1 أو 2 نجمة',
  'monthly_evaluation_canonical_weight_mismatch',
  'invalid_monthly_evaluation_critical_gate',
  'legacy_monthly_evaluation_critical_gate_points_retired',
  'monthly_evaluation_section_score_must_be_integer_star',
  'dawaa_monthly_evaluation_server_evidence_v5',
  'monthly_evaluation_server_evidence_unavailable',
  'monthly_evaluation_final_snapshot_v5',
  'monthly_evaluation_final_snapshot_missing_from_audit',
  'monthly_evaluation_audit_is_immutable',
  'revoke all on function public.trg_monthly_evaluation_audit_immutable_v5()',
  'f.requested_by_staff_id=p_staff_id::text',
  'a.staff_id=p_staff_id::text',
  'dawaa_monthly_evaluation_branch_manager_subject_allowed_v5',
  'attendance_pending_review_days',
  'attendance_conflict_days',
  'handled_by_staff_id',
  'assigned_to_staff_id',
]) {
  if (!backend.includes(token)) failures.push(`V5 backend contract is missing: ${token}`);
}

if (!canonicalAttendanceTruth.includes("from public.attendance_daily_summary d")) failures.push('Canonical evaluation attendance truth must read finalized daily summaries.');
if (!canonicalAttendanceTruth.includes("from public.attendance_impact_ledger l")) failures.push('Canonical evaluation attendance truth must read classified attendance impacts.');
if (!canonicalAttendanceTruth.includes("l.impact_status='classified'")) failures.push('Canonical evaluation attendance truth must ignore superseded/reversed impacts.');
if (!canonicalAttendanceTruth.includes("'attendance_pending_review_days'")) failures.push('Canonical evaluation attendance truth must expose unresolved-day count.');
if (!canonicalAttendanceTruth.includes("'attendance_conflict_days'")) failures.push('Canonical evaluation attendance truth must expose active conflict count.');
if (/from\s+public\.attendance\s/i.test(canonicalAttendanceTruth)) failures.push('Legacy attendance table is forbidden in the canonical monthly-evaluation attendance path.');
if (/from\s+public\.staff_attendance_logs\s/i.test(canonicalAttendanceTruth)) failures.push('Raw attendance logs are forbidden in the canonical monthly-evaluation approval path.');

if (employeeMonthlyEvidence.includes("readAttendanceRange")) failures.push('Monthly evaluation evidence must not read legacy/raw attendance range.');
if (!employeeMonthlyEvidence.includes("listAttendanceImpactLedger")) failures.push('Monthly evaluation evidence must read canonical attendance impact ledger.');
if (!employeeMonthlyEvidence.includes("listAttendanceResolutionQueue")) failures.push('Monthly evaluation evidence must read canonical attendance resolution queue.');

if (!employeeMonthlyEvidence.includes("row.impact_status === 'classified'")) failures.push('Monthly evaluation attendance coaching must count classified impacts only.');
if (employeeMonthlyEvidence.includes("row.impact_status !== 'reversed'")) failures.push('Monthly evaluation must not treat non-reversed legacy impacts as current truth.');

if (failures.length) {
  console.error('Monthly Evaluation V5 architecture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Monthly Evaluation V5 architecture check passed.');
