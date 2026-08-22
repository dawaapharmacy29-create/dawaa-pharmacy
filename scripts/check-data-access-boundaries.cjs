const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'src');

// Exact debt ratchet: these files may keep only the currently known number of
// direct sales_invoices readers. Any increase or decrease must update this map
// in the same PR, so legacy debt can only move intentionally toward zero.
const LEGACY_DIRECT_INVOICE_READER_BUDGETS = new Map([
  ['src/lib/api/customers.ts', 4],
  ['src/lib/staff/staffPerformanceProfileService.ts', 1],
]);

const APPROVED_INVOICE_BOUNDARIES = new Set([
  'src/lib/invoiceImporter.ts',
  'src/lib/readModels/customerInvoiceReadModel.ts',
  'src/lib/readModels/invoiceDataHealthReadModel.ts',
  'src/lib/readModels/invoiceRecordReadModel.ts',
  'src/lib/invoices/invoiceManagementService.ts',
]);

const LEGACY_DIRECT_STAFF_UI_READERS = new Set([
  'src/pages/IncentiveMedicines.tsx',
  'src/pages/EmployeeOperatingSystem.tsx',
  'src/pages/ExecutiveDashboard2027.tsx',
  'src/components/reviews/ReviewsInsightsHub.tsx',
  'src/components/staff/StaffPerformanceDashboard.tsx',
]);

const LEGACY_DIRECT_EMPLOYEE_TRANSACTION_UI_READERS = new Set([
  'src/pages/ReportsCenter.tsx',
  'src/pages/BranchInspection.tsx',
]);

const LEGACY_DIRECT_ATTENDANCE_UI_READERS = new Set([
  'src/pages/StaffMonthlyEvaluation.tsx',
]);

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

function countDirectAccess(content, table) {
  const pattern = new RegExp(`\\.from\\(\\s*['\"]${table}['\"]\\s*\\)`, 'g');
  return [...content.matchAll(pattern)].length;
}

function countBulkInvoicePaging(content) {
  const pattern = /selectAllPaged(?:<[^>]+>)?\s*\(\s*\{[\s\S]{0,2500}?table\s*:\s*['"]sales_invoices['"]/g;
  return [...content.matchAll(pattern)].length;
}

function hasDirectAccess(content, table) {
  return countDirectAccess(content, table) > 0;
}

const invoiceOffenders = [];
const bulkInvoicePagingOffenders = [];
const presentInvoiceLegacy = new Map();
const staffUiOffenders = [];
const presentStaffUiLegacy = [];
const employeeTxnUiOffenders = [];
const presentEmployeeTxnUiLegacy = [];
const attendanceUiOffenders = [];
const presentAttendanceUiLegacy = [];

for (const file of walk(ROOT)) {
  const relative = repoPath(file);
  const content = fs.readFileSync(file, 'utf8');

  const invoiceReadCount = countDirectAccess(content, 'sales_invoices');
  if (invoiceReadCount > 0) {
    if (APPROVED_INVOICE_BOUNDARIES.has(relative)) {
      // Intentional boundary.
    } else if (LEGACY_DIRECT_INVOICE_READER_BUDGETS.has(relative)) {
      presentInvoiceLegacy.set(relative, invoiceReadCount);
    } else {
      invoiceOffenders.push(`${relative} (${invoiceReadCount} direct reads)`);
    }
  }

  const bulkInvoicePagingCount = countBulkInvoicePaging(content);
  if (bulkInvoicePagingCount > 0 && !APPROVED_INVOICE_BOUNDARIES.has(relative)) {
    bulkInvoicePagingOffenders.push(`${relative} (${bulkInvoicePagingCount} bulk paged reads)`);
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

for (const [file, budget] of LEGACY_DIRECT_INVOICE_READER_BUDGETS) {
  const actual = presentInvoiceLegacy.get(file) || 0;
  if (actual !== budget) {
    console.error('\nInvoice direct-read debt ratchet changed.');
    console.error(`  - ${file}: expected ${budget}, found ${actual}`);
    if (actual < budget) {
      console.error('Good migration detected. Lower the budget in the same PR so the removed debt cannot return.');
    } else {
      console.error('New legacy debt detected. Route the read through an approved read model/RPC instead.');
    }
    process.exit(1);
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

if (bulkInvoicePagingOffenders.length) {
  console.error('\nArchitecture boundary violation: hidden bulk sales_invoices paging detected.');
  console.error('Route staff/customer analytics through scoped read models or aggregate RPCs instead of selectAllPaged raw invoice scans.');
  bulkInvoicePagingOffenders.forEach((file) => console.error(`  - ${file}`));
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

const legacyInvoiceReadTotal = [...presentInvoiceLegacy.values()].reduce((sum, count) => sum + count, 0);
console.log(
  `Architecture boundaries OK. Legacy invoice readers: ${presentInvoiceLegacy.size} files / ${legacyInvoiceReadTotal} direct reads. Hidden bulk invoice paging: 0 outside approved boundaries. Legacy direct staff UI readers: ${presentStaffUiLegacy.length}. Legacy employee transaction UI readers: ${presentEmployeeTxnUiLegacy.length}. Legacy attendance UI readers: ${presentAttendanceUiLegacy.length}. Routes checked: ${routePaths.length}. Legacy dot permissions: ${dotPermissionKeys.size}.`
);
