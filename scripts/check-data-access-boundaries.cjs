const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'src');

// Transitional debt register. New direct sales_invoices reads are forbidden.
// This list must only shrink as consumers migrate to read models / canonical services.
const LEGACY_DIRECT_READERS = new Set([
  'src/components/customers/CustomerQuickDetailsModal.tsx',
  'src/lib/api/customers.ts',
  'src/lib/classificationService.ts',
  'src/lib/customerAnalyticsService.ts',
  'src/lib/customerProfileService.ts',
  'src/lib/dashboardSummaryService.ts',
  'src/lib/dataIntegrityService.ts',
  'src/lib/executiveDashboardDataService.ts',
  'src/lib/salesInvoiceSource.ts',
  'src/lib/salesInvoiceQueries.ts',
  'src/lib/staff/staffDataHealthService.ts',
  'src/lib/staff/staffPerformanceProfileService.ts',
  'src/lib/staffIdentityMapping.ts',
  'src/lib/staffInvoiceTruthService.ts',
]);

// Architectural boundaries where direct access is intentional.
const APPROVED_BOUNDARIES = new Set([
  'src/lib/invoiceImporter.ts',
  'src/lib/readModels/customerInvoiceReadModel.ts',
  'src/pages/Invoices.tsx',
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

function repoPath(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, '/');
}

const directAccessPattern = /\.from\(\s*['\"]sales_invoices['\"]\s*\)/g;
const offenders = [];
const presentLegacy = [];

for (const file of walk(ROOT)) {
  const relative = repoPath(file);
  const content = fs.readFileSync(file, 'utf8');
  if (!directAccessPattern.test(content)) continue;
  directAccessPattern.lastIndex = 0;

  if (APPROVED_BOUNDARIES.has(relative)) continue;
  if (LEGACY_DIRECT_READERS.has(relative)) {
    presentLegacy.push(relative);
    continue;
  }
  offenders.push(relative);
}

const staleAllowlist = [...LEGACY_DIRECT_READERS].filter((file) => !presentLegacy.includes(file));
if (staleAllowlist.length) {
  console.log('Architecture debt reduced. Remove these files from LEGACY_DIRECT_READERS:');
  staleAllowlist.forEach((file) => console.log(`  - ${file}`));
}

if (offenders.length) {
  console.error('\nArchitecture boundary violation: new direct sales_invoices access detected.');
  console.error('Use an approved read model/service boundary instead of querying the table from feature code.');
  offenders.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}

console.log(`Data-access boundary OK. Legacy direct readers remaining: ${presentLegacy.length}.`);
