const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollTransparencyService.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/components/payroll/PayrollTransparencyPanel.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/PayrollManagement.tsx'), 'utf8');
const financialService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollFinancialCompositionService.ts'), 'utf8');
const kpiService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollKpiContextService.ts'), 'utf8');
const statementService = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollStatementService.ts'), 'utf8');

function assertContains(text, needle, label) {
  if (!text.includes(needle)) {
    console.error('[payroll-transparency] missing ' + label + ': ' + needle);
    process.exit(1);
  }
}

assertContains(service, "employee_payroll_transparency_v1", 'canonical transparency RPC');
assertContains(panel, 'شفافية دورة الراتب V1', 'transparency panel');
assertContains(page, '<PayrollTransparencyPanel', 'payroll page integration');
assertContains(financialService, 'employee_payroll_financial_composition_v1', 'financial composition RPC');
assertContains(panel, 'كشف راتب الموظف — معاينة شفافة', 'employee statement preview');
assertContains(kpiService, 'employee_payroll_kpi_context_v1', 'payroll KPI context RPC');
assertContains(panel, 'الأداء وKPIs', 'payroll KPI tab');
assertContains(statementService, 'employee_payroll_statement_v1', 'single statement RPC');
assertContains(panel, 'اتحسب / لم يتحسب', 'statement inclusion disclosure');
assertContains(panel, 'رصيد الإجازة السنوية', 'annual leave balance disclosure');
assertContains(panel, 'مبيعات الموظف خلال دورة الراتب', 'canonical employee sales KPI');
assertContains(kpiService, 'branch_breakdown', 'employee sales KPI typing');
if (page.includes("+ num(components?.monthlyIncentiveComponent)\n      + num(components?.listIncentiveComponent)\n      + num(automatedTruth?.automatedTotal)")) {
  console.error('[payroll-transparency] performance incentive double-count regression');
  process.exit(1);
}

console.log('[payroll-transparency] OK');
