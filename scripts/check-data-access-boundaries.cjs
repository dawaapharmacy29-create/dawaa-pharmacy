const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'src');

const LEGACY_DIRECT_INVOICE_READERS = new Set([
  'src/lib/api/customers.ts',
  'src/lib/customerAnalyticsService.ts',
  'src/lib/customerProfileService.ts',
  'src/lib/dashboardSummaryService.ts',
  'src/lib/executiveDashboardDataService.ts',
  'src/lib/salesInvoiceSource.ts',
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

const LEGACY_DIRECT_STAFF_UI_READERS = new Set([
  'src/pages/IncentiveMedicines.tsx',
  'src/pages/EmployeeOperatingSystem.tsx',
  'src/pages/ExecutiveDashboard2027.tsx',
  'src/components/reviews/ReviewsInsightsHub.tsx',
  'src/components/staff/StaffPerformanceDashboard.tsx',
]);

// Financial employee ledger is a shared domain boundary. Existing UI reads are frozen migration debt.
const LEGACY_DIRECT_EMPLOYEE_TRANSACTION_UI_READERS = new Set([
  'src/pages/ReportsCenter.tsx',
  'src/pages/BranchInspection.tsx',
]);

// Attendance UI must consume attendance/domain projections rather than raw attendance rows.
const LEGACY_DIRECT_ATTENDANCE_UI_READERS = new Set([
  'src/pages/StaffMonthlyEvaluation.tsx',
]);

// Baseline only: these existed before the snake_case contract was enforced.
// This set must shrink as permission data + consumers are migrated.
const LEGACY_DOT_PERMISSION_KEYS = new Set([
  'customer_welcome_messages.view',
  'customer_welcome_messages.create',
  'customer_welcome_messages.update',
  'employee_operating_system.view',
  'employee_operating_system.manage',
  'dashboard.view',
  'customers.view',
  'customers.create',
  'customers.edit',
  'customers.delete',
  'team.view',
  'team.create',
  'team.edit',
  'team.delete',
  'shifts.view',
  'shifts.create',
  'shifts.edit',
  'leaves.view',
  'leaves.create',
  'leaves.manage',
  'permissions.view',
  'permissions.edit',
  'points.view',
  'points.manage',
  'evaluations.view',
  'evaluations.create',
  'reports.view',
  'reports.export',
  'settings.view',
  'settings.edit',
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
const employeeTxnUiOffenders = [];
const presentEmployeeTxnUiLegacy = [];
const attendanceUiOffenders = [];
const presentAttendanceUiLegacy = [];

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
  if (!isUi) continue;

  if (hasDirectAccess(content, 'staff')) {
    if (LEGACY_DIRECT_STAFF_UI_READERS.has(relative)) presentStaffUiLegacy.push(relative);
    else staffUiOffenders.push(relative);
  }

  if (hasDirectAccess(content, 'employee_transactions')) {
    if (LEGACY_DIRECT_EMPLOYEE_TRANSACTION_UI_READERS.has(relative)) {
      presentEmployeeTxnUiLegacy.push(relative);
    } else {
      employeeTxnUiOffenders.push(relative);
    }
  }

  if (hasDirectAccess(content, 'attendance')) {
    if (LEGACY_DIRECT_ATTENDANCE_UI_READERS.has(relative)) {
      presentAttendanceUiLegacy.push(relative);
    } else {
      attendanceUiOffenders.push(relative);
    }
  }
}

function failOnStaleDebt(register, present, label) {
  const stale = [...register].filter((file) => !present.includes(file));
  if (!stale.length) return;
  console.error(`\n${label} debt register is stale. These legacy readers are no longer direct readers:`);
  stale.forEach((file) => console.error(`  - ${file}`));
  console.error('Remove migrated files from the legacy register in the same PR.');
  process.exit(1);
}

failOnStaleDebt(LEGACY_DIRECT_INVOICE_READERS, presentInvoiceLegacy, 'Invoice');
failOnStaleDebt(LEGACY_DIRECT_STAFF_UI_READERS, presentStaffUiLegacy, 'Staff UI');
failOnStaleDebt(
  LEGACY_DIRECT_EMPLOYEE_TRANSACTION_UI_READERS,
  presentEmployeeTxnUiLegacy,
  'Employee transaction UI'
);
failOnStaleDebt(LEGACY_DIRECT_ATTENDANCE_UI_READERS, presentAttendanceUiLegacy, 'Attendance UI');

if (invoiceOffenders.length) {
  console.error('\nArchitecture boundary violation: new direct sales_invoices access detected.');
  invoiceOffenders.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}

if (staffUiOffenders.length) {
  console.error('\nArchitecture boundary violation: UI must not query the staff table directly.');
  staffUiOffenders.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}

if (employeeTxnUiOffenders.length) {
  console.error('\nEmployee-domain architecture violation: UI must not query employee_transactions directly.');
  console.error('Use the points/incentive/payroll domain boundary; final financial truth must not be rebuilt in pages.');
  employeeTxnUiOffenders.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}

if (attendanceUiOffenders.length) {
  console.error('\nEmployee-domain architecture violation: UI must not query attendance directly.');
  console.error('Use an attendance projection/domain service keyed by canonical staff_id.');
  attendanceUiOffenders.forEach((file) => console.error(`  - ${file}`));
  process.exit(1);
}

const appSource = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
const routePaths = [...appSource.matchAll(/<Route\s+path=["']([^"']+)["']/g)].map((match) => match[1]);
const routeCounts = new Map();
for (const routePath of routePaths) routeCounts.set(routePath, (routeCounts.get(routePath) || 0) + 1);
const duplicateRoutes = [...routeCounts.entries()].filter(([, count]) => count > 1);
if (duplicateRoutes.length) {
  console.error('\nRoute architecture violation: duplicate route paths detected in src/App.tsx:');
  duplicateRoutes.forEach(([routePath, count]) => console.error(`  - ${routePath} (${count} definitions)`));
  process.exit(1);
}

const permissionSources = [
  path.join(ROOT, 'lib/core/permissionSystem.ts'),
  path.join(ROOT, 'lib/permissionMatrix.ts'),
].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const dotPermissionKeys = new Set(
  [...permissionSources.matchAll(/['\"]([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)['\"]/g)].map((match) => match[1])
);
const newDotPermissionKeys = [...dotPermissionKeys].filter((key) => !LEGACY_DOT_PERMISSION_KEYS.has(key));
if (newDotPermissionKeys.length) {
  console.error('\nPermission architecture violation: new dot-notation permission keys detected:');
  newDotPermissionKeys.forEach((key) => console.error(`  - ${key}`));
  console.error('Use snake_case permission keys. Existing dot-notation keys are migration-only legacy debt.');
  process.exit(1);
}

const staleDotPermissionDebt = [...LEGACY_DOT_PERMISSION_KEYS].filter((key) => !dotPermissionKeys.has(key));
if (staleDotPermissionDebt.length) {
  console.error('\nPermission debt register is stale. These legacy dot keys are no longer present:');
  staleDotPermissionDebt.forEach((key) => console.error(`  - ${key}`));
  console.error('Remove migrated keys from LEGACY_DOT_PERMISSION_KEYS in the same PR.');
  process.exit(1);
}

console.log(
  `Architecture boundaries OK. Legacy invoice readers: ${presentInvoiceLegacy.length}. Legacy direct staff UI readers: ${presentStaffUiLegacy.length}. Legacy employee transaction UI readers: ${presentEmployeeTxnUiLegacy.length}. Legacy attendance UI readers: ${presentAttendanceUiLegacy.length}. Routes checked: ${routePaths.length}. Legacy dot permissions: ${dotPermissionKeys.size}.`
);
