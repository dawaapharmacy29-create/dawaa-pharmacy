const fs = require('node:fs');
const path = require('node:path');

const target = path.join(process.cwd(), 'src/lib/dashboard/dashboardTruthService.ts');
let source = fs.readFileSync(target, 'utf8');

const marker = "const cycleRows = (await fetchSalesInvoicesPagedSafe({";
if (source.includes(marker)) {
  console.log('Dashboard cycle-first sales fix already applied.');
  process.exit(0);
}

const start = source.indexOf('export async function fetchDashboardSalesTruth(params: {');
if (start < 0) {
  console.warn('[dashboard-cycle-first] target function not found; skipping safely.');
  process.exit(0);
}

const replacement = [
  'export async function fetchDashboardSalesTruth(params: {',
  '  startDate: string;',
  '  endDate: string;',
  '  branch: string;',
  '  errors?: string[];',
  '  noCache?: boolean;',
  '}): Promise<DashboardSalesTruth> {',
  '  const errors = params.errors || [];',
  '',
  '  // Load the selected cycle first so the headline KPIs never wait for six months of history.',
  '  const cycleRows = (await fetchSalesInvoicesPagedSafe({',
  '    startDate: params.startDate,',
  '    endDate: params.endDate,',
  '    branch: params.branch,',
  '    errors,',
  '    noCache: params.noCache,',
  '  })) as DashboardInvoiceRow[];',
  '  const cycleRowsWithDate = cycleRows.filter((row) => invoiceDate(row));',
  '  const cycleTruth = buildTruth(cycleRowsWithDate);',
  '',
  '  // Historical rows are only needed for the monthly chart. Failure here must not zero the dashboard.',
  '  const sourceStart = monthStartFor(params.endDate, 5);',
  '  let sourceRows = cycleRowsWithDate;',
  '  try {',
  '    const historyRows = (await fetchSalesInvoicesPagedSafe({',
  '      startDate: sourceStart,',
  '      endDate: params.endDate,',
  '      branch: params.branch,',
  '      errors,',
  '      noCache: params.noCache,',
  '    })) as DashboardInvoiceRow[];',
  '    const validHistoryRows = historyRows.filter((row) => invoiceDate(row));',
  '    if (validHistoryRows.length) sourceRows = validHistoryRows;',
  '  } catch (error) {',
  "    errors.push('dashboard history: ' + (error instanceof Error ? error.message : String(error)));",
  '  }',
  '',
  '  const monthlyTruth = buildTruth(sourceRows);',
  '  const recentAnchorDate = latestInvoiceDate(',
  '    cycleRowsWithDate.length ? cycleRowsWithDate : sourceRows,',
  '    params.endDate',
  '  );',
  '  const recentInvoices = invoicesBetween(',
  '    cycleRowsWithDate.length ? cycleRowsWithDate : sourceRows,',
  '    daysBefore(recentAnchorDate, 4),',
  '    recentAnchorDate',
  '  );',
  '  const sqlEquivalentTotal = cycleRowsWithDate.reduce(',
  '    (sum, row) => sum + dashboardInvoiceAmount(row),',
  '    0',
  '  );',
  '  const branchesIncluded = [...new Set(cycleRowsWithDate.map((row) => invoiceBranch(row)))]',
  '    .filter(Boolean)',
  "    .sort((a, b) => a.localeCompare(b, 'ar'));",
  '',
  '  return {',
  '    sourceRows,',
  '    cycleRows: cycleRowsWithDate,',
  '    summary: cycleTruth.summary,',
  '    dailySales: cycleTruth.dailySales,',
  '    monthlySales: monthlyTruth.monthlySales,',
  '    branchDistribution: cycleTruth.branchDistribution,',
  '    doctorSales: cycleTruth.doctorSales,',
  '    recentInvoices,',
  '    reconciliation: {',
  "      source: 'sales_invoices_cycle_first',",
  '      dashboardTotal: cycleTruth.summary.sales_total,',
  '      sqlEquivalentTotal,',
  '      difference: Math.abs(cycleTruth.summary.sales_total - sqlEquivalentTotal),',
  '      invoicesCount: cycleTruth.summary.invoices_count,',
  '      rowsRead: cycleRowsWithDate.length,',
  '      selectedStartDate: params.startDate,',
  '      selectedEndDate: params.endDate,',
  '      branchesIncluded,',
  '      firstInvoiceDate: firstInvoiceDate(cycleRowsWithDate),',
  "      lastInvoiceDate: latestInvoiceDate(cycleRowsWithDate, ''),",
  "      missingBranchCount: cycleRowsWithDate.filter((row) => !String(row.branch_name || row.branch || '').trim()).length,",
  "      missingDoctorCount: cycleRowsWithDate.filter((row) => !String(invoiceDoctorName(row) || '').trim()).length,",
  '      missingInvoiceKeyCount: cycleRowsWithDate.filter((row) => !invoiceIdentityKey(row)).length,',
  "      missingCustomerCodeCount: cycleRowsWithDate.filter((row) => !String(row.customer_code || '').trim()).length,",
  '    },',
  '  };',
  '}',
  '',
].join('\n');

source = source.slice(0, start) + replacement;
fs.writeFileSync(target, source, 'utf8');
console.log('Dashboard cycle-first sales fix applied.');
