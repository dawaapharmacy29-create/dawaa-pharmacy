import { normalizeBranchName } from '@/lib/branch';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';
import {
  getInvoiceNetValue,
  isCancelledInvoice,
  normalizeDoctorName,
} from '@/lib/analyticsService';

export const DASHBOARD_ALL_BRANCHES = '\u0643\u0644 \u0627\u0644\u0641\u0631\u0648\u0639';
const UNKNOWN_LABEL = '\u063A\u064A\u0631 \u0645\u062D\u062F\u062F';

export type DashboardInvoiceRow = {
  id?: string | number | null;
  invoice_no?: string | number | null;
  invoice_number?: string | number | null;
  invoice_date?: string | null;
  branch?: string | null;
  amount?: number | string | null;
  net_amount?: number | string | null;
  discounted_amount?: number | string | null;
  gross_amount?: number | string | null;
  total_amount?: number | string | null;
  invoice_total?: number | string | null;
  net_total?: number | string | null;
  total?: number | string | null;
  status?: string | null;
  save_status?: string | null;
  customer_code?: string | number | null;
  customer_name?: string | null;
  seller_name?: string | null;
};

export type DashboardSalesReconciliation = {
  source: string;
  dashboardTotal: number;
  sqlEquivalentTotal: number;
  difference: number;
  invoicesCount: number;
  rowsRead: number;
  selectedStartDate: string;
  selectedEndDate: string;
  branchesIncluded: string[];
  firstInvoiceDate: string | null;
  lastInvoiceDate: string | null;
  missingBranchCount: number;
  missingDoctorCount: number;
  missingInvoiceKeyCount: number;
  missingCustomerCodeCount: number;
};

export type DashboardSalesTruth = {
  sourceRows: DashboardInvoiceRow[];
  cycleRows: DashboardInvoiceRow[];
  summary: {
    invoices_count: number;
    sales_total: number;
    avg_invoice: number;
    linked_invoices: number;
    unregistered_customer_invoices: number;
    linked_sales: number;
    unregistered_customer_sales: number;
    customer_link_rate_percent: number;
    linked_customers: number;
  };
  dailySales: Array<{
    sale_date: string;
    branch: string;
    daily_sales: number;
    invoices_count: number;
  }>;
  monthlySales: Array<{
    month_start: string;
    month_label: string;
    branch: string;
    sales_total: number;
    invoices_count: number;
    avg_invoice: number;
  }>;
  branchDistribution: Array<{
    branch: string;
    sales_total: number;
    invoices_count: number;
    avg_invoice: number;
    linked_customers: number;
  }>;
  doctorSales: Array<{
    doctor_name: string;
    branch: string;
    sales_total: number;
    invoices_count: number;
    avg_invoice: number;
    estimated_points: number;
    incentive_value: number;
  }>;
  recentInvoices: DashboardInvoiceRow[];
  reconciliation: DashboardSalesReconciliation;
};

function normalizeDigits(value: string) {
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export function dashboardNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = normalizeDigits(String(value ?? ''))
    .replace(/[,،\s]/g, '')
    .replace(/[^\d.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function dashboardInvoiceAmount(row: DashboardInvoiceRow) {
  return getInvoiceNetValue(row as Record<string, unknown>);
}

function invoiceDate(row: DashboardInvoiceRow) {
  return String(row.invoice_date || '').slice(0, 10);
}

function invoiceIdentityKey(row: DashboardInvoiceRow) {
  return String(row.invoice_no ?? row.invoice_number ?? row.id ?? '').trim();
}

function normalizedBranch(branch?: string | null) {
  return normalizeBranchName(branch || '') || UNKNOWN_LABEL;
}

function isAllBranches(branch: string) {
  const raw = String(branch || '')
    .trim()
    .toLowerCase();
  return (
    !raw ||
    normalizeBranchName(branch) === normalizeBranchName(DASHBOARD_ALL_BRANCHES) ||
    raw.includes('all') ||
    raw.includes('\u0643\u0644') ||
    raw.includes('ÙƒÙ„')
  );
}

function monthStartFor(dateText: string, monthsBack = 5) {
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  date.setDate(1);
  date.setMonth(date.getMonth() - monthsBack);
  return date.toISOString().slice(0, 10);
}

function daysBefore(dateText: string, daysBack: number) {
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  date.setDate(date.getDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

function latestInvoiceDate(rows: DashboardInvoiceRow[], fallback: string) {
  return rows.map(invoiceDate).filter(Boolean).sort().at(-1) || fallback;
}

function firstInvoiceDate(rows: DashboardInvoiceRow[]) {
  return rows.map(invoiceDate).filter(Boolean).sort().at(0) || null;
}

function invoicesBetween(rows: DashboardInvoiceRow[], start: string, end: string) {
  return rows.filter((row) => {
    const day = invoiceDate(row);
    return day && day >= start && day <= end;
  });
}

function normalizeText(value: unknown) {
  return String(value ?? '')
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/[.\/\\()[\]{}:_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizedSellerName(value: unknown) {
  return normalizeText(value)
    .replace(
      /^(\u062F|\u062F\u0643\u062A\u0648\u0631|\u0627\u0644\u062F\u0643\u062A\u0648\u0631)\s+/,
      ''
    )
    .trim();
}

function isDoctorName(name: unknown) {
  const normalized = normalizedSellerName(name);
  if (!normalized) return false;
  const blocked = [
    '\u0627\u062D\u0645\u062F \u0627\u0644\u0628\u0637\u0644',
    '\u0627\u062D\u0645\u062F \u0648\u062C\u064A\u0647',
    '\u0645\u062D\u0645\u062F \u062D\u0627\u0641\u0638',
    '\u0645\u0635\u0637\u0641\u064A',
    '\u0645\u0635\u0637\u0641\u0649',
    '\u064A\u0648\u0633\u0641 \u0639\u0635\u0627\u0645',
    '\u062D\u0633\u064A\u0646',
    '\u064A\u0648\u0633\u0641 \u0639\u064A\u062F',
    '\u064A\u0648\u0633\u0641 \u0645\u0627\u0647\u0631',
  ];
  if (blocked.some((item) => normalized === normalizedSellerName(item))) return false;
  return (
    !normalized.includes('\u062A\u0648\u0635\u064A\u0644') &&
    !normalized.includes('\u0645\u0646\u062F\u0648\u0628') &&
    !normalized.includes('delivery')
  );
}

function isLinkedInvoice(row: DashboardInvoiceRow) {
  const code = String(row.customer_code ?? '').trim();
  const name = normalizeText(row.customer_name);
  return Boolean(
    code &&
    !['0', 'null', 'NULL', '-'].includes(code) &&
    !name.includes('\u0639\u0645\u064A\u0644 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644') &&
    !name.includes('\u063A\u064A\u0631 \u0645\u0633\u062C\u0644')
  );
}

function buildTruth(rows: DashboardInvoiceRow[]) {
  const invoiceRows = rows.filter(
    (row) => invoiceDate(row) && !isCancelledInvoice(row as Record<string, unknown>)
  );
  const invoiceKeys = new Set(invoiceRows.map(invoiceIdentityKey).filter(Boolean));
  const linkedRows = invoiceRows.filter(isLinkedInvoice);
  const linkedInvoiceKeys = new Set(linkedRows.map(invoiceIdentityKey).filter(Boolean));
  const unlinkedRows = invoiceRows.filter((row) => !isLinkedInvoice(row));
  const unlinkedInvoiceKeys = new Set(unlinkedRows.map(invoiceIdentityKey).filter(Boolean));
  const total = invoiceRows.reduce((sum, row) => sum + dashboardInvoiceAmount(row), 0);

  const dailyMap = new Map<
    string,
    { sale_date: string; branch: string; daily_sales: number; invoices_count: number }
  >();
  const dailyKeys = new Map<string, Set<string>>();
  const branchMap = new Map<
    string,
    {
      branch: string;
      sales_total: number;
      invoices_count: number;
      avg_invoice: number;
      linked_customers: number;
    }
  >();
  const branchKeys = new Map<string, Set<string>>();
  const branchCustomers = new Map<string, Set<string>>();
  const doctorMap = new Map<
    string,
    {
      doctor_name: string;
      branch: string;
      sales_total: number;
      invoices_count: number;
      avg_invoice: number;
      estimated_points: number;
      incentive_value: number;
    }
  >();
  const doctorKeys = new Map<string, Set<string>>();
  const monthMap = new Map<
    string,
    {
      month_start: string;
      month_label: string;
      branch: string;
      sales_total: number;
      invoices_count: number;
      avg_invoice: number;
    }
  >();
  const monthKeys = new Map<string, Set<string>>();

  for (const row of invoiceRows) {
    const day = invoiceDate(row);
    const branch = normalizedBranch(row.branch);
    const amount = dashboardInvoiceAmount(row);
    const key = invoiceIdentityKey(row);

    const dailyKey = `${day}__${branch}`;
    const daily = dailyMap.get(dailyKey) || {
      sale_date: day,
      branch,
      daily_sales: 0,
      invoices_count: 0,
    };
    daily.daily_sales += amount;
    if (!dailyKeys.has(dailyKey)) dailyKeys.set(dailyKey, new Set());
    if (key) dailyKeys.get(dailyKey)?.add(key);
    daily.invoices_count = dailyKeys.get(dailyKey)?.size || 0;
    dailyMap.set(dailyKey, daily);

    const branchRow = branchMap.get(branch) || {
      branch,
      sales_total: 0,
      invoices_count: 0,
      avg_invoice: 0,
      linked_customers: 0,
    };
    branchRow.sales_total += amount;
    if (!branchKeys.has(branch)) branchKeys.set(branch, new Set());
    if (key) branchKeys.get(branch)?.add(key);
    branchRow.invoices_count = branchKeys.get(branch)?.size || 0;
    branchMap.set(branch, branchRow);

    if (isLinkedInvoice(row)) {
      if (!branchCustomers.has(branch)) branchCustomers.set(branch, new Set());
      branchCustomers.get(branch)?.add(String(row.customer_code || '').trim());
    }

    const month = day.slice(0, 7);
    if (month) {
      const monthKey = `${month}__${branch}`;
      const monthRow = monthMap.get(monthKey) || {
        month_start: `${month}-01`,
        month_label: month,
        branch,
        sales_total: 0,
        invoices_count: 0,
        avg_invoice: 0,
      };
      monthRow.sales_total += amount;
      if (!monthKeys.has(monthKey)) monthKeys.set(monthKey, new Set());
      if (key) monthKeys.get(monthKey)?.add(key);
      monthRow.invoices_count = monthKeys.get(monthKey)?.size || 0;
      monthMap.set(monthKey, monthRow);
    }

    if (isDoctorName(row.seller_name)) {
      const doctor = normalizeDoctorName(row.seller_name);
      const doctorKey = `${doctor}__${branch}`;
      const doctorRow = doctorMap.get(doctorKey) || {
        doctor_name: doctor,
        branch,
        sales_total: 0,
        invoices_count: 0,
        avg_invoice: 0,
        estimated_points: 0,
        incentive_value: 0,
      };
      doctorRow.sales_total += amount;
      if (!doctorKeys.has(doctorKey)) doctorKeys.set(doctorKey, new Set());
      if (key) doctorKeys.get(doctorKey)?.add(key);
      doctorRow.invoices_count = doctorKeys.get(doctorKey)?.size || 0;
      doctorMap.set(doctorKey, doctorRow);
    }
  }

  const branchDistribution = [...branchMap.values()].map((row) => ({
    ...row,
    avg_invoice: row.invoices_count ? row.sales_total / row.invoices_count : 0,
    linked_customers: branchCustomers.get(row.branch)?.size || 0,
  }));

  const doctorSales = [...doctorMap.values()].map((row) => {
    const points = Math.round(row.sales_total / 1000);
    return {
      ...row,
      avg_invoice: row.invoices_count ? row.sales_total / row.invoices_count : 0,
      estimated_points: points,
      incentive_value: points * 3,
    };
  });

  const monthlySales = [...monthMap.values()].map((row) => ({
    ...row,
    avg_invoice: row.invoices_count ? row.sales_total / row.invoices_count : 0,
  }));

  return {
    summary: {
      invoices_count: invoiceKeys.size,
      sales_total: total,
      avg_invoice: invoiceKeys.size ? total / invoiceKeys.size : 0,
      linked_invoices: linkedInvoiceKeys.size,
      unregistered_customer_invoices: unlinkedInvoiceKeys.size,
      linked_sales: linkedRows.reduce((sum, row) => sum + dashboardInvoiceAmount(row), 0),
      unregistered_customer_sales: unlinkedRows.reduce(
        (sum, row) => sum + dashboardInvoiceAmount(row),
        0
      ),
      customer_link_rate_percent: invoiceKeys.size
        ? (linkedInvoiceKeys.size / invoiceKeys.size) * 100
        : 0,
      linked_customers: new Set(
        linkedRows.map((row) => String(row.customer_code || '').trim()).filter(Boolean)
      ).size,
    },
    dailySales: [...dailyMap.values()].sort((a, b) => a.sale_date.localeCompare(b.sale_date)),
    branchDistribution: branchDistribution.sort((a, b) => b.sales_total - a.sales_total),
    doctorSales: doctorSales.sort((a, b) => b.sales_total - a.sales_total).slice(0, 60),
    monthlySales: monthlySales.sort((a, b) =>
      `${a.month_start}__${a.branch}`.localeCompare(`${b.month_start}__${b.branch}`)
    ),
  };
}

export async function fetchDashboardSalesTruth(params: {
  startDate: string;
  endDate: string;
  branch: string;
  errors?: string[];
  noCache?: boolean;
}): Promise<DashboardSalesTruth> {
  const errors = params.errors || [];
  const sourceStart = monthStartFor(params.endDate, 5);
  const sourceRows = (await fetchSalesInvoicesPagedSafe({
    startDate: sourceStart,
    endDate: params.endDate,
    branch: params.branch,
    errors,
    noCache: params.noCache,
  })) as DashboardInvoiceRow[];
  const sourceRowsWithDate = sourceRows.filter((row) => invoiceDate(row));
  const cycleRows = invoicesBetween(sourceRowsWithDate, params.startDate, params.endDate);
  const cycleTruth = buildTruth(cycleRows);
  const monthlyTruth = buildTruth(sourceRowsWithDate);
  const recentAnchorDate = latestInvoiceDate(
    cycleRows.length ? cycleRows : sourceRowsWithDate,
    params.endDate
  );
  const recentInvoices = invoicesBetween(
    cycleRows.length ? cycleRows : sourceRowsWithDate,
    daysBefore(recentAnchorDate, 4),
    recentAnchorDate
  );
  const sqlEquivalentTotal = cycleRows.reduce((sum, row) => sum + dashboardInvoiceAmount(row), 0);
  const branchesIncluded = [...new Set(cycleRows.map((row) => normalizedBranch(row.branch)))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'ar'));

  return {
    sourceRows,
    cycleRows,
    summary: cycleTruth.summary,
    dailySales: cycleTruth.dailySales,
    monthlySales: monthlyTruth.monthlySales,
    branchDistribution: cycleTruth.branchDistribution,
    doctorSales: cycleTruth.doctorSales,
    recentInvoices,
    reconciliation: {
      source: 'sales_invoices_live',
      dashboardTotal: cycleTruth.summary.sales_total,
      sqlEquivalentTotal,
      difference: Math.abs(cycleTruth.summary.sales_total - sqlEquivalentTotal),
      invoicesCount: cycleTruth.summary.invoices_count,
      rowsRead: cycleRows.length,
      selectedStartDate: params.startDate,
      selectedEndDate: params.endDate,
      branchesIncluded,
      firstInvoiceDate: firstInvoiceDate(cycleRows),
      lastInvoiceDate: latestInvoiceDate(cycleRows, ''),
      missingBranchCount: cycleRows.filter((row) => !String(row.branch || '').trim()).length,
      missingDoctorCount: cycleRows.filter((row) => !String(row.seller_name || '').trim()).length,
      missingInvoiceKeyCount: cycleRows.filter((row) => !invoiceIdentityKey(row)).length,
      missingCustomerCodeCount: cycleRows.filter((row) => !String(row.customer_code || '').trim())
        .length,
    },
  };
}
