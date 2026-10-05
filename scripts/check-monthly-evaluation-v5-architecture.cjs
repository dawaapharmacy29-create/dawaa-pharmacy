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
const routeAdapter = read('src/pages/StaffMonthlyEvaluation.tsx');
const workflow = read('src/components/evaluations/MonthlyEvaluationWorkflowV5.tsx');
const audit = read('src/components/evaluations/MonthlyEvaluationAuditTrailV5.tsx');
const profiles = read('src/lib/evaluations/staffEvaluationProfilesV3.ts');
const inventoryEvidence = read('src/lib/evaluations/monthlyInventoryEvidence.ts');
const salesEvidence = read('src/lib/evaluations/monthlySalesQualityEvidence.ts');
const leadershipEvidence = read('src/lib/evaluations/monthlyLeadershipEvidence.ts');
const finalSnapshotEvidenceClosure = read('supabase/migrations/20261005113000_monthly_evaluation_final_snapshot_evidence_closure.sql');
const roleAwareServerEvidence = read('supabase/migrations/20261005125500_monthly_evaluation_role_aware_server_evidence_v5.sql');
const optimisticConcurrency = read('supabase/migrations/20261005130500_monthly_evaluation_optimistic_concurrency_v5.sql');
const backend = [
  read('supabase/migrations/20260929153000_monthly_evaluation_command_center_v5.sql'),
  read('supabase/migrations/20260929154500_monthly_evaluation_v5_hardening.sql'),
  read('supabase/migrations/20260929160000_monthly_evaluation_v5_read_api.sql'),
  read('supabase/migrations/20260929161000_monthly_evaluation_v5_draft_fix.sql'),
  read('supabase/migrations/20260930113000_monthly_evaluation_score_truth_v5.sql'),
  read('supabase/migrations/20260930123000_monthly_evaluation_role_coverage_v5.sql'),
  read('supabase/migrations/20260930154000_monthly_evaluation_trigger_execute_hardening_v5.sql'),
  read('supabase/migrations/20260930155500_monthly_evaluation_server_evidence_type_compat_v5.sql'),
  read('supabase/migrations/20261005121500_monthly_evaluation_manual_evidence_rationale_v5.sql'),
  read('supabase/migrations/20261005124500_monthly_evaluation_critical_gate_evidence_v5.sql'),
].join('\n');

if (!routeAdapter.includes("export { default } from '@/pages/StaffMonthlyEvaluationGeneral'")) {
  failures.push('Monthly evaluation route adapter must point only to StaffMonthlyEvaluationGeneral.');
}
for (const forbidden of ['CustomerServiceDoctorEvaluation', 'TEAM_DAWAA_CS_EVALUATOR_IDS', 'save_staff_monthly_evaluation', 'supabase.rpc']) {
  if (routeAdapter.includes(forbidden)) failures.push(`Monthly evaluation route adapter must stay logic-free; found: ${forbidden}`);
}

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
if (!page.includes('getInventoryEvidenceSufficiency')) failures.push('Inventory scoring must use the evidence-sufficiency contract.');
if (!page.includes('getSalesQualityEvidenceSufficiency')) failures.push('Sales-quality scoring must use the evidence-sufficiency contract.');
if (!page.includes('leadershipEvidenceRequirement')) failures.push('Leadership axes must use role-aware evidence requirements.');
if (!page.includes('axis_evidence_snapshot')) failures.push('Per-axis evidence state must be persisted with the evaluation snapshot.');
if (!page.includes('leadershipSectionsMissingNotes')) failures.push('Leadership manual evidence must require documented axis notes before approval.');
if (!page.includes('manualEvidenceSectionsMissingNotes')) failures.push('All manually-evidenced axes must require documented rationale before approval.');
if (!page.includes('criticalGateMissingRationales')) failures.push('Critical gates must require a separate documented rationale per gate.');
if (!inventoryEvidence.includes('getInventoryEvidenceSufficiency')) failures.push('Inventory evidence sufficiency helper is missing.');
if (!salesEvidence.includes('getSalesQualityEvidenceSufficiency')) failures.push('Sales-quality evidence sufficiency helper is missing.');
if (!leadershipEvidence.includes('leadershipEvidenceRequirement')) failures.push('Leadership evidence contract is missing.');
if (!finalSnapshotEvidenceClosure.includes("'axis_evidence_snapshot'")) failures.push('Final approved snapshot must freeze per-axis evidence.');
if (!finalSnapshotEvidenceClosure.includes("'points_truth'")) failures.push('Final approved snapshot must freeze canonical points truth.');
for (const token of [
  'monthly_evaluation_stale_write_reload_required',
  "old.updated_at is distinct from v_expected",
  "new.metrics_snapshot := coalesce(new.metrics_snapshot,'{}'::jsonb) - 'expected_updated_at'",
]) {
  if (!optimisticConcurrency.includes(token)) failures.push(`Optimistic concurrency guard missing: ${token}`);
}
if (!page.includes('expected_updated_at: evaluationUpdatedAt')) failures.push('Evaluation page must send the loaded row version on save.');
if (!page.includes('setEvaluationUpdatedAt(String(canonicalSaved.updated_at')) failures.push('Evaluation page must refresh the canonical row version after save.');
if (!page.includes('pointsForSave = await getStaffPointsDashboardV3(savingStaffId, cycleLabel)')) failures.push('Final approval must refresh canonical points truth immediately before save.');
if (!page.includes('points_truth: pointsForSave ?')) failures.push('Final approval snapshot must use the freshly loaded points truth.');
if (!page.includes('Date.now() - evidenceLoadedAt > 5 * 60_000')) failures.push('Final approval must reject stale client evidence state.');
if (!page.includes('invalidateEmployeeEvaluationHeaderCache(savingStaffId)')) failures.push('Evaluation save must invalidate the selected employee header cache.');
if (!page.includes("key.startsWith(\`\${savingStaffId}:\`)")) failures.push('Evaluation save must invalidate the selected employee evidence cache.');
if (!evidenceService.includes("const taskEvidenceRoles = new Set([")) failures.push('Monthly evidence loader must gate task evidence by consuming roles.');
if (!evidenceService.includes(".limit(201);\n  const modulesTruncated")) failures.push('Training module evidence must detect query truncation.');

for (const token of [
  "v_needs_reviews := v_role in ('doctor','delivery','customer_service')",
  "v_needs_followups := v_role in ('doctor','customer_service','purchasing')",
  "v_needs_attendance := v_role in ('doctor','assistant','inventory_assistant','delivery','customer_service','shift_supervisor')",
  "'not_required'",
]) {
  if (!roleAwareServerEvidence.includes(token)) failures.push(`Role-aware server evidence missing: ${token}`);
}

if (/points_incentive_egp\s*\*\s*effectiveEvaluationMultiplierPct/.test(page)) {
  failures.push('Client-side final incentive recomputation is forbidden; read the canonical server financial truth.');
}
if (!page.includes('pointsTruth?.final_incentive_egp')) {
  failures.push('Page must read final incentive from the canonical points truth.');
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

for (const step of ['الموظف والأدلة', 'التقييم بالأدلة', 'المحاور', 'النقاط والمخالفات', 'الخلاصة والتطوير', 'المراجعة والاعتماد']) {
  if (!workflow.includes(step)) failures.push(`Workflow is missing decision stage: ${step}`);
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
  'monthly_evaluation_manual_evidence_rationale_required',
  'monthly_evaluation_critical_gate_rationale_required',
  "'critical_gate_rationales'",
]) {
  if (!backend.includes(token)) failures.push(`V5 backend contract is missing: ${token}`);
}

if (failures.length) {
  console.error('Monthly Evaluation V5 architecture check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Monthly Evaluation V5 architecture check passed.');
