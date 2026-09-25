const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const service = fs.readFileSync(path.join(root, 'src/lib/payroll/payrollTransparencyService.ts'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/components/payroll/PayrollTransparencyPanel.tsx'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/PayrollManagement.tsx'), 'utf8');

function assertContains(text, needle, label) {
  if (!text.includes(needle)) {
    console.error('[payroll-transparency] missing ' + label + ': ' + needle);
    process.exit(1);
  }
}

assertContains(service, "employee_payroll_transparency_v1", 'canonical transparency RPC');
assertContains(panel, 'شفافية دورة الراتب V1', 'transparency panel');
assertContains(page, '<PayrollTransparencyPanel', 'payroll page integration');

console.log('[payroll-transparency] OK');
