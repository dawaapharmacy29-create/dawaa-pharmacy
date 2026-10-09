const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollTransparencyService.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/components/payroll/PayrollTransparencyPanel.tsx'), 'utf8');
const deliveryPanel = fs.readFileSync(path.join(root, 'src/components/payroll/DeliveryPayrollBreakdownPanel.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/PayrollManagement.tsx'), 'utf8');
const workspaceV2 = fs.readFileSync(path.join(root, 'src/pages/PayrollManagementV2.tsx'), 'utf8');
const staffPayrollRoute = fs.readFileSync(path.join(root, 'src/pages/StaffPayroll.tsx'), 'utf8');
assertContains(page, 'buildEmployeePayrollStatementPdf', 'finalized V2 employee statement PDF export');
assertContains(page, "source === 'finalized_v2'", 'source-aware finalized V2 PDF export');
assertContains(staffPayrollRoute, "./PayrollManagementV2", 'Payroll Workspace V2 route');
assertContains(workspaceV2, 'scopeRef.current !== requestScope', 'stale-response protection');
assertContains(workspaceV2, "workspaceTab === 'adjustments' ? <PayrollManualEntriesPanel", 'lazy adjustment tab mount');
assertContains(workspaceV2, 'showFinalizationTools', 'on-demand finalization tools');
assertContains(workspaceV2, 'showCycleOverview', 'on-demand cycle preflight');
const financialService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollFinancialCompositionService.ts'), 'utf8');
const kpiService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollKpiContextService.ts'), 'utf8');
const statementService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollStatementService.ts'), 'utf8');
const finalizedSnapshotService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollFinalizedSnapshotService.ts'), 'utf8');
const statementPdf = fs.readFileSync(path.join(root, 'src/lib/payroll/employeePayrollStatementPdf.ts'), 'utf8');
const legacyStatementPdf = fs.readFileSync(path.join(root, 'src/lib/payroll/employeePayrollStatementPdfLegacy.ts'), 'utf8');
const statementMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260925155000_employee_payroll_statement_v1.sql'), 'utf8');
const deliveryCutoverMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261008110750_delivery_payroll_current_cutover_v1.sql'), 'utf8');
const deliveryRosterMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261008110929_delivery_payroll_roster_v1.sql'), 'utf8');
const deliveryOvertimeHardeningMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261008111238_delivery_payroll_overtime_multiplier_search_path_hardening.sql'), 'utf8');
const deliveryIndexHardeningMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261008111322_delivery_payroll_index_hardening.sql'), 'utf8');
const incentiveTruthService = fs.readFileSync(path.join(root, 'src/lib/incentives/payrollIncentiveTruthService.ts'), 'utf8');
const currentFinalizationService = fs.readFileSync(path.join(root, 'src/lib/hr/payrollCurrentFinalizationService.ts'), 'utf8');
const payrollContractService = fs.readFileSync(path.join(root, 'src/lib/hr/payrollContractService.ts'), 'utf8');
const workforceRouter = fs.readFileSync(path.join(root, 'src/lib/hr/workforceService.ts'), 'utf8');

function assertContains(text, needle, label) {
  if (!text.includes(needle)) {
    console.error('[payroll-transparency] missing ' + label + ': ' + needle);
    process.exit(1);
  }
}

assertContains(service, "employee_payroll_transparency_current_v1", 'current transparency RPC');
assertContains(panel, 'DeliveryPayrollBreakdownPanel', 'delivery transparency extension');
assertContains(deliveryPanel, 'تفاصيل راتب الدليفري', 'explicit delivery payroll breakdown');
assertContains(deliveryPanel, 'Payroll canonical', 'attendance source disclosure');
assertContains(deliveryPanel, 'الأوردرات المحتسبة', 'countable order disclosure');
assertContains(deliveryPanel, 'المشاوير المعتمدة', 'approved trip disclosure');
assertContains(page, '<PayrollTransparencyPanel', 'payroll page integration');
assertContains(workspaceV2, 'PayrollTransparencyPanelLegacy', 'standard payroll transparency preservation');
assertContains(workspaceV2, 'PayrollTransparencyPanel', 'delivery-aware payroll transparency route');
assertContains(financialService, 'employee_payroll_financial_composition_current_v1', 'current financial composition RPC');
if (financialService.includes("supabase.rpc('employee_payroll_financial_composition_v1'")) {
  console.error('[payroll-transparency] frontend must not depend on financial composition V1 compatibility');
  process.exit(1);
}
assertContains(kpiService, 'employee_payroll_kpi_context_v1', 'payroll KPI context RPC');
assertContains(statementService, 'employee_payroll_statement_current_v1', 'current statement RPC');
assertContains(finalizedSnapshotService, 'list_payroll_finalized_snapshot_history_v3', 'lightweight finalized payroll history reader');
if (finalizedSnapshotService.includes('list_payroll_finalized_snapshots_v2')) {
  console.error('[payroll-transparency] history UI must not fetch full finalized snapshot payloads.');
  process.exit(1);
}
const readinessUi = fs.readFileSync(path.join(root, 'src/components/attendance/PayrollCycleReadinessOverview.tsx'), 'utf8');
assertContains(readinessUi, 'خطة إغلاق الـBlockers', 'actionable payroll readiness plan');
assertContains(readinessUi, 'row.issueCodes.slice', 'per-employee preflight issue reasons');
assertContains(readinessUi, 'onOpenStaffCompensation', 'compensation remediation action');
assertContains(readinessUi, 'Payroll Identity Queue', 'missing/disabled payroll identity disclosure');
assertContains(readinessUi, '/staff-accounts', 'payroll identity remediation route');
assertContains(readinessUi, 'Delivery Coverage', 'delivery payroll cycle coverage');
assertContains(statementMigration, 'deterministic_without_generated_at_v1', 'deterministic snapshot fingerprint schema');
assertContains(statementMigration, 'dawaa_jsonb_strip_generated_at_v1', 'volatile timestamp stripping');
assertContains(statementMigration, "'employee_statement',v_statement", 'employee statement frozen into snapshot');
assertContains(statementMigration, "'statement_mode','finalized_snapshot_v2'", 'finalized statement replay');
assertContains(legacyStatementPdf, 'معاينة - غير نهائي', 'preview watermark');
assertContains(legacyStatementPdf, '/dawaa-logo-full.jpeg', 'Dawaa logo in statement header');
assertContains(legacyStatementPdf, 'الدخول / الخروج', 'attendance punch transparency');
assertContains(legacyStatementPdf, 'الإجازات والأذونات خلال الدورة', 'time off detail table');
assertContains(legacyStatementPdf, 'الحوافز والخصومات والنقاط', 'employee-visible transaction audit');
assertContains(legacyStatementPdf, 'التسويات المالية اليدوية', 'manual payroll ledger disclosure');
assertContains(legacyStatementPdf, 'Fingerprint', 'employee statement transparency: Fingerprint');
assertContains(legacyStatementPdf, 'requireFinalized', 'final PDF frozen guard option');
assertContains(legacyStatementPdf, "statement_mode !== 'finalized_snapshot_v2'", 'final PDF statement mode guard');
assertContains(legacyStatementPdf, 'data.financial.frozen !== true', 'final PDF frozen data guard');
assertContains(statementPdf, 'تفاصيل راتب الدليفري', 'delivery PDF details page');
assertContains(statementPdf, 'buildLegacyEmployeePayrollStatementPdf', 'legacy PDF preservation wrapper');
assertContains(page, '{ requireFinalized: true }', 'finalized history PDF must require frozen statement');
if (page.includes('listFinalizedPayrollSnapshots(person.staffId, 24).catch(() => [])')) {
  console.error('[payroll-transparency] finalized payroll history errors must not be swallowed silently.');
  process.exit(1);
}
if (workspaceV2.includes('.catch(() => null)') || workspaceV2.includes('.catch(() => [])')) {
  console.error('[payroll-transparency] Workspace V2 must not silently convert payroll load failures into zero/empty truth.');
  process.exit(1);
}
assertContains(legacyStatementPdf, 'مرجع الاعتماد:', 'employee statement transparency: مرجع الاعتماد:');
assertContains(legacyStatementPdf, 'ساعات الأساسي المحتسبة', 'employee statement transparency: ساعات الأساسي المحتسبة');
assertContains(legacyStatementPdf, 'الساعات الفعلية', 'employee statement transparency: الساعات الفعلية');
assertContains(kpiService, 'branch_breakdown', 'employee sales KPI typing');
if (incentiveTruthService.includes('const automatedTotal = grossAutomatedTotal - performanceIncentive')) {
  console.error('[payroll-transparency] incentive truth must expose the canonical server total without client-side subtraction');
  process.exit(1);
}
if (page.includes("+ num(components?.monthlyIncentiveComponent)\n      + num(components?.listIncentiveComponent)\n      + num(automatedTruth?.automatedTotal)")) {
  console.error('[payroll-transparency] performance incentive double-count regression');
  process.exit(1);
}

assertContains(currentFinalizationService, 'payroll_finalization_gate_current_v1', 'current finalization gate RPC');
assertContains(currentFinalizationService, 'payroll_final_snapshot_preview_v2', 'delivery-aware snapshot preview');
assertContains(currentFinalizationService, 'stage_payroll_final_snapshot_v2', 'delivery-aware snapshot stage');
assertContains(currentFinalizationService, 'compare_payroll_final_snapshot_v2', 'delivery-aware snapshot compare');
assertContains(currentFinalizationService, 'review_payroll_staged_snapshot_v2', 'delivery-aware snapshot review');
assertContains(currentFinalizationService, 'list_payroll_snapshot_reviews_v2', 'delivery-aware review reader');
assertContains(payrollContractService, 'finalize_payroll_snapshot_v3', 'delivery-aware finalization RPC');
assertContains(workforceRouter, "export * from './workforceServiceLegacy'", 'legacy workforce compatibility router');
assertContains(deliveryCutoverMigration, 'delivery_payroll_activity_snapshots_v1', 'delivery payroll activity bridge schema');
assertContains(deliveryCutoverMigration, 'employee_payroll_statement_current_v1', 'current statement backend router');
assertContains(deliveryCutoverMigration, 'payroll_final_snapshot_preview_v2', 'delivery-aware snapshot backend');
assertContains(deliveryCutoverMigration, 'finalize_payroll_snapshot_v3', 'delivery-aware finalization backend');
assertContains(deliveryCutoverMigration, "revoke execute", 'RPC permission hardening');
assertContains(deliveryRosterMigration, 'dawaa_delivery_payroll_roster_v1', 'delivery payroll roster migration');
assertContains(deliveryOvertimeHardeningMigration, 'dawaa_overtime_multiplier_from_approval_v1(jsonb,text)', 'overtime multiplier search_path hardening');
assertContains(deliveryIndexHardeningMigration, 'idx_delivery_payroll_sync_audit_cycle_created', 'delivery sync audit index');
assertContains(deliveryIndexHardeningMigration, 'drop index if exists public.idx_delivery_payroll_rate_bands_policy', 'duplicate rate-band index cleanup');

console.log('[payroll-transparency] OK');
