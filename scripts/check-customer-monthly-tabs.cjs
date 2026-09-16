const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src/pages/CustomerMonthlyPerformance.tsx');
const src = fs.readFileSync(file, 'utf8');
const required = [
  "pageTab === 'overview'",
  "pageTab === 'cohorts'",
  "pageTab === 'attention'",
  "pageTab === 'improving'",
  "نظرة عامة",
  "فئات العملاء",
  "يحتاجون متابعة",
  "المتحسنون",
];
for (const token of required) {
  if (!src.includes(token)) {
    console.error(`[customer-monthly-tabs] missing: ${token}`);
    process.exit(1);
  }
}
console.log('[customer-monthly-tabs] PASS: compact tabbed layout is wired.');
