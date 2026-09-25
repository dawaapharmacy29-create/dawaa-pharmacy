const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollTransparencyService.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/components/payroll/PayrollTransparencyPanel.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/PayrollManagement.tsx'), 'utf8');
const financialService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollFinancialCompositionService.ts'), 'utf8');
const kpiService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollKpiContextService.ts'), 'utf8');
const statementService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollStatementService.ts'), 'utf8');
const statementPdf = fs.readFileSync(path.join(root, 'src/lib/payroll/employeePayrollStatementPdf.ts'), 'utf8');
const statementMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260925155000_employee_payroll_statement_v1.sql'), 'utf8');
const incentiveTruthService = fs.readFileSync(path.join(root, 'src/lib/incentives/payrollIncentiveTruthService.ts'), 'utf8');

function assertContains(text, needle, label) {
  if (!text.includes(needle)) {
    console.error('[payroll-transparency] missing ' + label + ': ' + needle);
    process.exit(1);
  }
}

assertContains(service, "employee_payroll_transparency_v1", 'canonical transparency RPC');
assertContains(panel, 'شفافية دورة الراتب V1', 'transparency panel');
assertContains(page, '<PayrollTransparencyPanel', 'payroll page integration');
assertContains(financialService, 'employee_payroll_financial_composition_v2', 'canonical financial composition RPC');
if (financialService.includes('employee_payroll_financial_composition_v1')) {
  console.error('[payroll-transparency] frontend must not depend on financial composition V1 compatibility');
  process.exit(1);
}
assertContains(panel, 'كشف راتب الموظف — معاينة شفافة', 'employee statement preview');
assertContains(kpiService, 'employee_payroll_kpi_context_v1', 'payroll KPI context RPC');
assertContains(panel, 'الأداء وKPIs', 'payroll KPI tab');
assertContains(statementService, 'employee_payroll_statement_v1', 'single statement RPC');
const readinessUi = fs.readFileSync(path.join(root, 'src/components/attendance/PayrollCycleReadinessOverview.tsx'), 'utf8');
assertContains(readinessUi, 'خطة إغلاق الـBlockers', 'actionable payroll readiness plan');
assertContains(readinessUi, 'row.blockers.slice', 'per-employee blocker reasons');
assertContains(readinessUi, 'onOpenStaffCompensation', 'compensation remediation action');
assertContains(readinessUi, 'Payroll Identity Queue', 'missing/disabled payroll identity disclosure');
assertContains(readinessUi, '/staff-accounts', 'payroll identity remediation route');
assertContains(statementMigration, 'deterministic_without_generated_at_v1', 'deterministic snapshot fingerprint schema');
assertContains(statementMigration, 'dawaa_jsonb_strip_generated_at_v1', 'volatile timestamp stripping');
assertContains(statementMigration, "'employee_statement',v_statement", 'employee statement frozen into snapshot');
assertContains(statementMigration, "'statement_mode','finalized_snapshot_v2'", 'finalized statement replay');
assertContains(panel, 'اتحسب / لم يتحسب', 'statement inclusion disclosure');
assertContains(panel, 'رصيد الإجازة السنوية', 'annual leave balance disclosure');
assertContains(panel, 'مبيعات الموظف خلال دورة الراتب', 'canonical employee sales KPI');
assertContains(statementPdf, "getEmployeePayrollStatementV1", 'statement PDF canonical service');
assertContains(statementService, 'employee_payroll_statement_v1', 'statement service canonical RPC');
assertContains(statementPdf, 'معاينة - غير نهائي', 'preview watermark');
assertContains(statementPdf, '/dawaa-logo-full.jpeg', 'Dawaa logo in statement header');
assertContains(statementPdf, 'الدخول / الخروج', 'attendance punch transparency');
assertContains(statementPdf, 'الإجازات والأذونات خلال الدورة', 'time off detail table');
assertContains(statementPdf, 'الحوافز والخصومات والنقاط', 'employee-visible transaction audit');
assertContains(statementPdf, 'التسويات المالية اليدوية', 'manual payroll ledger disclosure');
assertContains(statementPdf, 'Fingerprint', 'employee statement transparency: Fingerprint');
assertContains(statementPdf, 'مرجع الاعتماد:', 'employee statement transparency: مرجع الاعتماد:');
assertContains(statementPdf, 'ساعات الأساسي المحتسبة', 'employee statement transparency: ساعات الأساسي المحتسبة');
assertContains(statementPdf, 'الساعات الفعلية', 'employee statement transparency: الساعات الفعلية');
assertContains(panel, 'معاينة PDF', 'statement PDF preview action');
assertContains(kpiService, 'branch_breakdown', 'employee sales KPI typing');
if (incentiveTruthService.includes('const automatedTotal = grossAutomatedTotal - performanceIncentive')) {
  console.error('[payroll-transparency] incentive truth must expose the canonical server total without client-side subtraction');
  process.exit(1);
}
if (page.includes("+ num(components?.monthlyIncentiveComponent)\n      + num(components?.listIncentiveComponent)\n      + num(automatedTruth?.automatedTotal)")) {
  console.error('[payroll-transparency] performance incentive double-count regression');
  process.exit(1);
}

console.log('[payroll-transparency] OK');
