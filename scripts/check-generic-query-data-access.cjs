const fs = require('fs');
const path = require('path');

const ROOT = path.join(process.cwd(), 'src');

// These are pre-existing UI readers that use the generic query hook with a literal
// table name. Keep the baseline explicit and shrink it in the same PR as each migration.
const LEGACY_LITERAL_STAFF_UI_READERS = new Set([
  'src/pages/Delivery.tsx',
  'src/pages/IncentiveMedicines.tsx',
  'src/pages/OperationalModule.tsx',
  'src/pages/Points.tsx',
  'src/pages/Reviews.tsx',
  'src/pages/Schedule.tsx',
  'src/pages/ShiftNotes.tsx',
  'src/pages/ShiftPerformance.tsx',
  'src/pages/StagnantMedicines.tsx',
  'src/pages/Stories.tsx',
]);

// Pre-existing generic-query invoice readers. These must move to an approved
// invoice read model/service rather than scanning sales_invoices from UI pages.
const LEGACY_GENERIC_INVOICE_UI_READERS = new Set([
  'src/pages/Delivery.tsx',
  'src/pages/StagnantMedicines.tsx',
  'src/pages/WhatsappAnalytics.tsx',
]);

// These are pre-existing generic-query employee ledger readers. They must migrate
// to useEmployeeTransactions / the employee transaction read model rather than
// rebuilding financial truth in pages.
const LEGACY_GENERIC_EMPLOYEE_TRANSACTION_UI_READERS = new Set([
  'src/pages/Delivery.tsx',
  'src/pages/PenaltyIncentiveManagement.tsx',
  'src/pages/Points.tsx',
  'src/pages/WhatsappAnalytics.tsx',
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

function isUi(relative) {
  return relative.startsWith('src/pages/') || relative.startsWith('src/components/');
}

function hasLiteralGenericTable(content, table) {
  const pattern = new RegExp(`table\\s*:\\s*['\"]${table}['\"]`);
  return pattern.test(content);
}

function hasConstantGenericTable(content, constantName) {
  const pattern = new RegExp(`table\\s*:\\s*TABLES\\.${constantName}\\b`);
  return pattern.test(content);
}

const presentStaff = [];
const newStaff = [];
const presentInvoices = [];
const newInvoices = [];
const presentEmployeeTransactions = [];
const newEmployeeTransactions = [];

for (const file of walk(ROOT)) {
  const relative = repoPath(file);
  if (!isUi(relative)) continue;
  const content = fs.readFileSync(file, 'utf8');

  if (hasLiteralGenericTable(content, 'staff')) {
    if (LEGACY_LITERAL_STAFF_UI_READERS.has(relative)) presentStaff.push(relative);
    else newStaff.push(relative);
  }

  if (
    hasLiteralGenericTable(content, 'sales_invoices') ||
    hasConstantGenericTable(content, 'salesInvoices')
  ) {
    if (LEGACY_GENERIC_INVOICE_UI_READERS.has(relative)) presentInvoices.push(relative);
    else newInvoices.push(relative);
  }

  if (
    hasLiteralGenericTable(content, 'employee_transactions') ||
    hasConstantGenericTable(content, 'employeeTransactions')
  ) {
    if (LEGACY_GENERIC_EMPLOYEE_TRANSACTION_UI_READERS.has(relative)) {
      presentEmployeeTransactions.push(relative);
    } else {
      newEmployeeTransactions.push(relative);
    }
  }
}

function failOnStaleDebt(register, present, label) {
  const stale = [...register].filter((file) => !present.includes(file));
  if (!stale.length) return;
  console.error(`\n${label} debt register is stale:`);
  stale.forEach((file) => console.error(`  - ${file}`));
  console.error('Remove migrated files from the baseline in the same PR.');
  process.exit(1);
}

failOnStaleDebt(LEGACY_LITERAL_STAFF_UI_READERS, presentStaff, 'Literal staff generic-query');
failOnStaleDebt(LEGACY_GENERIC_INVOICE_UI_READERS, presentInvoices, 'Sales invoice generic-query');
failOnStaleDebt(
  LEGACY_GENERIC_EMPLOYEE_TRANSACTION_UI_READERS,
  presentEmployeeTransactions,
  'Employee transaction generic-query'
);

if (newStaff.length) {
  console.error('\nArchitecture violation: new UI generic-query staff reader detected.');
  newStaff.forEach((file) => console.error(`  - ${file}`));
  console.error('Use useStaffDirectory() / a staff read model instead.');
  process.exit(1);
}

if (newInvoices.length) {
  console.error('\nInvoice architecture violation: new generic sales_invoices UI reader detected.');
  newInvoices.forEach((file) => console.error(`  - ${file}`));
  console.error('Use an approved invoice read model/service instead of scanning sales_invoices in UI.');
  process.exit(1);
}

if (newEmployeeTransactions.length) {
  console.error('\nEmployee-domain architecture violation: new generic employee transaction reader detected.');
  newEmployeeTransactions.forEach((file) => console.error(`  - ${file}`));
  console.error('Use useEmployeeTransactions() / the employee transaction read model instead.');
  process.exit(1);
}

console.log(
  `Generic-query data access OK. Legacy literal staff UI readers: ${presentStaff.length}. Legacy sales invoice generic readers: ${presentInvoices.length}. Legacy employee transaction generic readers: ${presentEmployeeTransactions.length}.`
);
