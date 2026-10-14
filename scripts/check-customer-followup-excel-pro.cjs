const fs = require('node:fs');

const path = 'src/pages/CustomerMonthlyPerformance.tsx';
const source = fs.readFileSync(path, 'utf8');
const failures = [];

const required = [
  "import { exportCustomerFollowupWorkbook } from '@/lib/customerMonthlyPerformanceExcelExport';",
  'const exportRowsToExcel = async (',
  'await exportCustomerFollowupWorkbook({',
  'rows,',
  'branch,',
  'periodStart: period.start,',
  'periodEnd: period.end,',
  'previousStart: prevPeriod.start,',
  'previousEnd: prevPeriod.end,',
];

for (const token of required) {
  if (!source.includes(token)) failures.push(`missing committed exporter wiring: ${token}`);
}

if (failures.length) {
  console.error('[customer-followup-excel-pro] FAIL: production source is not fully committed.');
  failures.forEach((failure) => console.error(`- ${failure}`));
  console.error('Apply the intended source change explicitly and commit it; build scripts must never patch application source.');
  process.exit(1);
}

console.log('[customer-followup-excel-pro] PASS: professional Excel exporter is committed; no source mutation required.');
