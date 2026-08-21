import { normalizeBranchName } from '@/lib/branch';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { StaffSalesSummary } from '@/lib/dashboardSummaryService';
import {
  fetchStaffIdentityRows,
  groupStaffSalesPerformance,
  normalizeStaffName,
} from '@/lib/staffIdentityService';
import { getInvoiceNetValue } from '@/lib/analyticsService';
import {
  fetchSalesInvoicesPagedSafe,
  INVOICE_SELECT_STAFF,
  type SalesInvoiceQueryRow,
} from '@/lib/salesInvoiceQueries';

type Row = Record<string, unknown>;

export type SalesAnalyticsFilters = {
  startDate: string;
  endDate: string;
  branch?: string;
  doctor?: string;
};

export type SalesAnalyticsSummary = {
  kpis: {
    netSales: number;
    invoicesCount: number;
    avgInvoice: number;
    uniqueCustomers: number;
    activeDays: number;
  };
  dailyTrend: Array<{
    date: string;
    netSales: number;
    invoicesCount: number;
    avgInvoice: number;
    uniqueCustomers: number;
  }>;
  last5DaysByBranch: Array<{
    date: string;
    branch: string;
    netTotal: number;
    invoicesCount: number;
    avgInvoice: number;
    previousDayNetTotal: number | null;
    changePercent: number | null;
  }>;
  branchRows: Array<{
    branch: string;
    netSales: number;
    invoicesCount: number;
    avgInvoice: number;
    uniqueCustomers: number;
    share: number;
  }>;
  doctorRows: Array<{
    staffId: string | null;
    doctor: string;
    branch: string | null;
    netSales: number;
    invoicesCount: number;
    avgInvoice: number;
    uniqueCustomers: number;
    duplicateWarning: string | null;
  }>;
  customerCards: {
    important: number | null;
    stopped: number | null;
    threatened: number | null;
    invalidPhone: number | null;
  };
  dataHealth: {
    invoicesWithoutCustomer: number | null;
    invoicesWithoutDoctor: number | null;
    invoicesWithoutBranch: number | null;
  };
  sourceHealth: Array<{
    source: string;
    status: 'ready' | 'empty' | 'error';
    message: string | null;
  }>;
  errorsBySection: Record<string, string>;
};

const cache = new Map<string, SalesAnalyticsSummary>();

function isAll(value?: string | null) {
  return !value || value === 'الكل' || value === 'كل الفروع' || value === 'all';
}

function read(row: Row, keys: string[], fallback: unknown = null) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function invoiceAmount(row: Row) {
  return getInvoiceNetValue(row);
}

function customerKey(row: Row) {
  return String(read(row, ['customer_code', 'customer_phone', 'customer_name'], '') || '').trim();
}

function sellerName(row: Row) {
  return String(read(row, ['normalized_seller_name', 'seller_name', 'staff_name'], '') || '').trim();
}

function invoiceDate(row: Row) {
  return String(read(row, ['sale_date', 'invoice_date'], '') || '').slice(0, 10);
}

function invoiceBranch(row: Row) {
  return normalizeBranchName(read(row, ['branch_name', 'branch'], null));
}

function buildDailyTrend(rows: Row[]) {
  const byDate = new Map<
    string,
    { date: string; netSales: number; invoicesCount: number; customers: Set<string> }
  >();
  for (const row of rows) {
    const date = invoiceDate(row);
    if (!date) continue;
    const current = byDate.get(date) || {
      date,
      netSales: 0,
      invoicesCount: 0,
      customers: new Set<string>(),
    };
    current.netSales += invoiceAmount(row);
    current.invoicesCount += 1;
    const customer = customerKey(row);
    if (customer) current.customers.add(customer);
    byDate.set(date, current);
  }
  return [...byDate.values()]
    .map((row) => ({
      date: row.date,
      netSales: row.netSales,
      invoicesCount: row.invoicesCount,
      avgInvoice: row.invoicesCount ? row.netSales / row.invoicesCount : 0,
      uniqueCustomers: row.customers.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildBranchRows(rows: Row[], netSales: number) {
  const byBranch = new Map<
    string,
    { branch: string; netSales: number; invoicesCount: number; customers: Set<string> }
  >();
  for (const row of rows) {
    const branch = invoiceBranch(row) || 'غير محدد';
    const current = byBranch.get(branch) || {
      branch,
      netSales: 0,
      invoicesCount: 0,
      customers: new Set<string>(),
    };
    current.netSales += invoiceAmount(row);
    current.invoicesCount += 1;
    const customer = customerKey(row);
    if (customer) current.customers.add(customer);
    byBranch.set(branch, current);
  }
  return [...byBranch.values()]
    .map((row) => ({
      branch: row.branch,
      netSales: row.netSales,
      invoicesCount: row.invoicesCount,
      avgInvoice: row.invoicesCount ? row.netSales / row.invoicesCount : 0,
      uniqueCustomers: row.customers.size,
      share: netSales ? (row.netSales / netSales) * 100 : 0,
    }))
    .sort((a, b) => b.netSales - a.netSales);
}

function buildLastFiveDaysByBranch(rows: Row[]) {
  const byKey = new Map<
    string,
    { date: string; branch: string; netTotal: number; invoicesCount: number }
  >();
  for (const row of rows) {
    const date = invoiceDate(row);
    if (!date) continue;
    const branch = invoiceBranch(row) || 'غير محدد';
    const key = `${date}__${branch}`;
    const current = byKey.get(key) || { date, branch, netTotal: 0, invoicesCount: 0 };
    current.netTotal += invoiceAmount(row);
    current.invoicesCount += 1;
    byKey.set(key, current);
  }

  const dates = [...new Set([...byKey.values()].map((row) => row.date))].sort().slice(-5);
  const values = [...byKey.values()]
    .filter((row) => dates.includes(row.date))
    .map((row) => ({
      ...row,
      avgInvoice: row.invoicesCount ? row.netTotal / row.invoicesCount : 0,
      previousDayNetTotal: null as number | null,
      changePercent: null as number | null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch));

  const byDateBranch = new Map(values.map((row) => [`${row.date}__${row.branch}`, row]));
  for (const row of values) {
    const index = dates.indexOf(row.date);
    const previousDate = index > 0 ? dates[index - 1] : null;
    if (!previousDate) continue;
    const previous = byDateBranch.get(`${previousDate}__${row.branch}`);
    if (!previous) continue;
    row.previousDayNetTotal = previous.netTotal;
    row.changePercent = previous.netTotal
      ? ((row.netTotal - previous.netTotal) / previous.netTotal) * 100
      : null;
  }
  return values;
}

function buildStaffSales(rows: Row[]) {
  const byStaff = new Map<
    string,
    {
      saleDate: string;
      sellerName: string | null;
      branch: string | null;
      netTotal: number;
      invoicesCount: number;
      customers: Set<string>;
    }
  >();

  for (const row of rows) {
    const seller = sellerName(row);
    if (!seller) continue;
    const branch = invoiceBranch(row);
    const key = `${seller}|${branch || ''}`;
    const current = byStaff.get(key) || {
      saleDate: invoiceDate(row),
      sellerName: seller,
      branch,
      netTotal: 0,
      invoicesCount: 0,
      customers: new Set<string>(),
    };
    current.netTotal += invoiceAmount(row);
    current.invoicesCount += 1;
    const customer = customerKey(row);
    if (customer) current.customers.add(customer);
    byStaff.set(key, current);
  }

  return [...byStaff.values()].map((row) => ({
    saleDate: row.saleDate,
    sellerName: row.sellerName,
    branch: row.branch,
    netTotal: row.netTotal,
    invoicesCount: row.invoicesCount,
    avgInvoice: row.invoicesCount ? row.netTotal / row.invoicesCount : 0,
    uniqueCustomers: row.customers.size,
  })) satisfies StaffSalesSummary[];
}

async function countCustomers(filter: (query: any) => any) {
  const { count, error } = await filter(
    supabase.from('customer_metrics_summary').select('final_customer_key', { count: 'exact', head: true })
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function filterDoctor(rows: SalesInvoiceQueryRow[], doctor?: string) {
  if (isAll(doctor)) return rows;
  const target = normalizeStaffName(doctor);
  if (!target) return rows;
  return rows.filter((row) => normalizeStaffName(sellerName(row)) === target);
}

function missingDataHealth(rows: Row[]) {
  let invoicesWithoutCustomer = 0;
  let invoicesWithoutDoctor = 0;
  let invoicesWithoutBranch = 0;
  for (const row of rows) {
    if (!customerKey(row)) invoicesWithoutCustomer += 1;
    if (!sellerName(row)) invoicesWithoutDoctor += 1;
    if (!invoiceBranch(row)) invoicesWithoutBranch += 1;
  }
  return { invoicesWithoutCustomer, invoicesWithoutDoctor, invoicesWithoutBranch };
}

export async function loadSalesAnalyticsSummary(
  filters: SalesAnalyticsFilters,
  forceRefresh = false
): Promise<SalesAnalyticsSummary> {
  if (!isSupabaseConfigured) throw new Error('إعدادات Supabase غير موجودة.');
  const key = JSON.stringify(filters);
  if (!forceRefresh && cache.has(key)) return cache.get(key)!;

  const errorsBySection: Record<string, string> = {};
  const invoiceErrors: string[] = [];
  let invoiceRows: SalesInvoiceQueryRow[] = [];

  try {
    const loaded = await fetchSalesInvoicesPagedSafe({
      startDate: filters.startDate,
      endDate: filters.endDate,
      branch: filters.branch,
      selectOptions: [INVOICE_SELECT_STAFF],
      errors: invoiceErrors,
      noCache: forceRefresh,
    });
    invoiceRows = filterDoctor(loaded, filters.doctor);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorsBySection.sales = message;
    throw new Error(`تعذر تحميل مصدر المبيعات التحليلي: ${message}`);
  }

  if (invoiceErrors.length) errorsBySection.salesWarnings = invoiceErrors.join(' | ');

  const [staffIdentityResult, customerResult] = await Promise.allSettled([
    fetchStaffIdentityRows(),
    Promise.all([
      countCustomers((query) => query.in('segment', ['مهم جدًا', 'مهم'])),
      countCustomers((query) => query.eq('customer_status', 'متوقف')),
      countCustomers((query) => query.eq('customer_status', 'مهدد بالتوقف')),
      countCustomers((query) =>
        query.or('customer_phone.is.null,customer_phone.eq.,customer_phone.ilike.code:%')
      ),
    ]),
  ]);

  if (staffIdentityResult.status === 'rejected') {
    errorsBySection.staffIdentity = String(staffIdentityResult.reason);
  }
  if (customerResult.status === 'rejected') {
    errorsBySection.customerCards = String(customerResult.reason);
  }

  const dailyTrend = buildDailyTrend(invoiceRows);
  const netSales = invoiceRows.reduce((sum, row) => sum + invoiceAmount(row), 0);
  const invoicesCount = invoiceRows.length;
  const uniqueCustomers = new Set(invoiceRows.map(customerKey).filter(Boolean)).size;
  const staffIdentityRows =
    staffIdentityResult.status === 'fulfilled' ? staffIdentityResult.value : [];
  const staffSalesRows = buildStaffSales(invoiceRows);

  const doctorRows = groupStaffSalesPerformance(staffSalesRows, staffIdentityRows)
    .map((row) => ({
      staffId: row.staffId,
      doctor: row.displayName,
      branch: row.branch,
      netSales: row.netTotal,
      invoicesCount: row.invoicesCount,
      avgInvoice: row.avgInvoice,
      uniqueCustomers: row.uniqueCustomers,
      duplicateWarning: row.duplicateWarning,
    }))
    .filter((row) => row.doctor && row.doctor !== 'غير محدد')
    .sort((a, b) => b.netSales - a.netSales)
    .slice(0, 30);

  const data: SalesAnalyticsSummary = {
    kpis: {
      netSales,
      invoicesCount,
      avgInvoice: invoicesCount ? netSales / invoicesCount : 0,
      uniqueCustomers,
      activeDays: new Set(dailyTrend.filter((row) => row.netSales > 0).map((row) => row.date)).size,
    },
    dailyTrend,
    last5DaysByBranch: buildLastFiveDaysByBranch(invoiceRows),
    branchRows: buildBranchRows(invoiceRows, netSales),
    doctorRows,
    customerCards:
      customerResult.status === 'fulfilled'
        ? {
            important: customerResult.value[0],
            stopped: customerResult.value[1],
            threatened: customerResult.value[2],
            invalidPhone: customerResult.value[3],
          }
        : { important: null, stopped: null, threatened: null, invalidPhone: null },
    dataHealth: missingDataHealth(invoiceRows),
    sourceHealth: [
      {
        source: 'dawaa_sales_invoices_dashboard_v1',
        status: invoiceRows.length ? 'ready' : 'empty',
        message: invoiceErrors.length ? invoiceErrors.join(' | ') : null,
      },
    ],
    errorsBySection,
  };

  cache.set(key, data);
  return data;
}

export function clearSalesAnalyticsSummaryCache() {
  cache.clear();
}
