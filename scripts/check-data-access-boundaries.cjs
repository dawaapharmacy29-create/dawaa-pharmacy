const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'src');

// Transitional invoice debt register. New direct sales_invoices reads are forbidden.
// This list must only shrink as consumers migrate to read models / canonical services.
const LEGACY_DIRECT_INVOICE_READERS = new Set([
  'src/lib/api/customers.ts',
  'src/lib/customerAnalyticsService.ts',
  'src/lib/customerProfileService.ts',
  'src/lib/dashboardSummaryService.ts',
  'src/lib/executiveDashboardDataService.ts',
  'src/lib/salesInvoiceSource.ts',
  'src/lib/salesInvoiceQueries.ts',
  'src/lib/staff/staffDataHealthService.ts',
  'src/lib/staff/staffPerformanceProfileService.ts',
  'src/lib/staffInvoiceTruthService.ts',
]);

const APPROVED_INVOICE_BOUNDARIES = new Set([
  'src/lib/invoiceImporter.ts',
  'src/lib/readModels/customerInvoiceReadModel.ts',
  'src/lib/readModels/invoiceDataHealthReadModel.ts',
  'src/lib/readModels/invoiceRecordReadModel.ts',
  'src/lib/readModels/unlinkedSellerNamesReadModel.ts',
  'src/pages/Invoices.tsx',
]);

// UI must not know the physical staff table. Existing violations are frozen debt and must only shrink.
const LEGACY_DIRECT_STAFF_UI_READERS = new Set([
  'src/pages/IncentiveMedicines.tsx',
  'src/pages/EmployeeOperatingSystem.tsx',
  'src/pages/ExecutiveDashboard2027.tsx',
  'src/components/reviews/ReviewsInsightsHub.tsx',
  'src/components/staff/StaffPerformanceDashboard.tsx',
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

function hasDirectAccess(content, table) {
  return new RegExp(`\\.from\\(\\s*['\"]${table}['\"]\\s*\\)`).test(content);
}

const invoiceOffenders = [];
const presentInvoiceLegacy = [];
const staffUiOffenders = [];
const presentStaffUiLegacy = [];

for (const file of walk(ROOT)) {
  const relative = repoPath(file);
  const content = fs.readFileSync(file, 'utf8');

  if (hasDirectAccess(content, 'sales_invoices')) {
    if (APPROVED_INVOICE_BOUNDARIES.has(relative)) {
      // Intentional boundary.
    } else if (LEGACY_DIRECT_INVOICE_READERS.has(relative)) {
      presentInvoiceLegacy.push(relative);
    } else {
      invoiceOffenders.push(relative);
    }
  }

  const isUi = relative.startsWith('src/pages/') || relative.startsWith('src/components/');
  if (isUi && hasDirectAccess(content, 'staff')) {
    if (LEGACY_DIRECT_STAFF_UI_READERS.has(relative)) presentStaffUiLegacy.push(relative);
    else staffUiOffenders.push(relative);
  }
}

const staleInvoiceDebt = [...LEGACY_DIRECT_INVOICE_READERS].filter(
  (file) => !presentInvoiceLegacy.includes(file)
);
if (staleInvoiceDebt.length) {
  console.error('\nArchitecture debt register is stale. These legacy readers no longer access sales_invoices:');
  staleInvoiceDebt.forEach((file) => console.error(`  - ${file}`));
  console.error('Remove them from LEGACY_DIRECT_INVOICE_READERS in the same PR.');
  process.exit(1);
}

const staleStaffUiDebt = [...LEGACY_DIRECT_STAFF_UI_READERS].filter(
  (file) => !presentStaffUiLegacy.includes(file)
);
if (staleStaffUiDebt.length) {
  console.error('\nStaff UI debt register is stale. These UI files no longer access staff directly:');
  staleStaffUiDebt.forEach((file) => console.error(`  - ${file}`));
  console.error('Remove them from LEGACY_DIRECT_STAFF_UI_READERS in the same PR.');
  process.exit(1);
}

if (invoiceOffenders.length) {
  console.error('\nArchitecture boundary violation: new direct sales_invoices access detected.');
  console.error('Use an approved read model/service boundary instead of querying the table from feature code.');
  invoiceOffenders.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}

if (staffUiOffenders.length) {
  console.error('\nArchitecture boundary violation: UI must not query the staff table directly.');
  console.error('Use the canonical staff directory/domain service boundary.');
  staffUiOffenders.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}

// Route-path integrity: literal routes in App.tsx must be unique.
const appPath = path.join(ROOT, 'App.tsx');
const appSource = fs.readFileSync(appPath, 'utf8');
const routePaths = [...appSource.matchAll(/<Route\s+path=["']([^"']+)["']/g)].map((match) => match[1]);
const routeCounts = new Map();
for (const routePath of routePaths) routeCounts.set(routePath, (routeCounts.get(routePath) || 0) + 1);
const duplicateRoutes = [...routeCounts.entries()].filter(([, count]) => count > 1);
if (duplicateRoutes.length) {
  console.error('\nRoute architecture violation: duplicate route paths detected in src/App.tsx:');
  duplicateRoutes.forEach(([routePath, count]) => console.error(`  - ${routePath} (${count} definitions)`));
  console.error('Each route must have one owner/definition before the route registry migration proceeds.');
  process.exit(1);
}

console.log(
  `Architecture boundaries OK. Legacy invoice readers: ${presentInvoiceLegacy.length}. Legacy direct staff UI readers: ${presentStaffUiLegacy.length}. Routes checked: ${routePaths.length}.`
);
