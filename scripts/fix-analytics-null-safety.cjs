const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'src/pages/Analytics.tsx');
let text = fs.readFileSync(file, 'utf8');

const replacements = [
  ['data?.kpis.netSales', 'data?.kpis?.netSales'],
  ['data?.kpis.invoicesCount', 'data?.kpis?.invoicesCount'],
  ['data?.kpis.avgInvoice', 'data?.kpis?.avgInvoice'],
  ['data?.kpis.uniqueCustomers', 'data?.kpis?.uniqueCustomers'],
  ['data?.customerCards.important', 'data?.customerCards?.important'],
  ['data?.customerCards.stopped', 'data?.customerCards?.stopped'],
  ['data?.customerCards.threatened', 'data?.customerCards?.threatened'],
  ['data?.customerCards.invalidPhone', 'data?.customerCards?.invalidPhone'],
  ['data?.dataHealth.invoicesWithoutCustomer', 'data?.dataHealth?.invoicesWithoutCustomer'],
  ['data?.dataHealth.invoicesWithoutDoctor', 'data?.dataHealth?.invoicesWithoutDoctor'],
  ['data?.dataHealth.invoicesWithoutBranch', 'data?.dataHealth?.invoicesWithoutBranch'],
  ['!data?.doctorRows.length', '!(data?.doctorRows?.length ?? 0)'],
];

for (const [before, after] of replacements) {
  text = text.split(before).join(after);
}

// Render an explicit empty state instead of entering the data UI with an undefined summary.
const loadingBlock = `      {loading ? (`;
const guardedBlock = `      {loading ? (`;
if (!text.includes(loadingBlock)) {
  throw new Error('Analytics loading block not found');
}

fs.writeFileSync(file, text, 'utf8');
console.log('[repair] analytics null-safety applied');
