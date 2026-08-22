import { normalizeBranchName } from '@/lib/branch';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { SalesDailySummary, StaffSalesSummary } from '@/lib/dashboardSummaryService';
import {
  fetchStaffIdentityRows,
  groupStaffSalesPerformance,
} from '@/lib/staffIdentityService';

export const SALES_ANALYTICS_SOURCE_ID = 'sales_invoices_live';
export const SALES_ANALYTICS_PHYSICAL_SOURCE = 'dawaa_sales_invoices_dashboard_v1';

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
  dailySales: SalesDailySummary[];
  staffSalesSummary: StaffSalesSummary[];
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

type RpcPayload = {
  kpis?: Record<string, unknown>;
  dailyTrend?: Array<Record<string, unknown>>;
  dailySales?: Array<Record<string, unknown>>;
  last5DaysByBranch?: Array<Record<string, unknown>>;
  branchRows?: Array<Record<string, unknown>>;
  staffSales?: Array<Record<string, unknown>>;
  dataHealth?: Record<string, unknown>;
};

const cache = new Map<string, SalesAnalyticsSummary>();

function isAll(value?: string | null) {
  return !value || value === 'الكل' || value === 'كل الفروع' || value === 'all';
}

function toNumber(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function toNullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

async function countCustomers(filter: (query: any) => any) {
  const { count, error } = await filter(
    supabase.from('customer_metrics_summary').select('final_customer_key', { count: 'exact', head: true })
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function normalizeRpcPayload(data: unknown, fallbackDate: string) {
  const payload = (data && typeof data === 'object' ? data : {}) as RpcPayload;
  const kpisRaw = payload.kpis || {};
  const dataHealthRaw = payload.dataHealth || {};

  const kpis = {
    netSales: toNumber(kpisRaw.netSales),
    invoicesCount: toNumber(kpisRaw.invoicesCount),
    avgInvoice: toNumber(kpisRaw.avgInvoice),
    uniqueCustomers: toNumber(kpisRaw.uniqueCustomers),
    activeDays: toNumber(kpisRaw.activeDays),
  };

  const dailyTrend = (payload.dailyTrend || [])
    .map((row) => ({
      date: text(row.date),
      netSales: toNumber(row.netSales),
      invoicesCount: toNumber(row.invoicesCount),
      avgInvoice: toNumber(row.avgInvoice),
      uniqueCustomers: toNumber(row.uniqueCustomers),
    }))
    .filter((row) => row.date);

  const dailySales = (payload.dailySales || [])
    .map((row) => ({
      saleDate: text(row.saleDate),
      branch: text(row.branch) || null,
      shift: text(row.shift) || null,
      netTotal: toNumber(row.netTotal),
      invoicesCount: toNumber(row.invoicesCount),
      avgInvoice: toNumber(row.avgInvoice),
      uniqueCustomers: toNumber(row.uniqueCustomers),
    }))
    .filter((row) => row.saleDate)
    .sort((a, b) => a.saleDate.localeCompare(b.saleDate) || String(a.branch || '').localeCompare(String(b.branch || ''))) satisfies SalesDailySummary[];

  const branchRows = (payload.branchRows || [])
    .map((row) => ({
      branch: text(row.branch) || 'غير محدد',
      netSales: toNumber(row.netSales),
      invoicesCount: toNumber(row.invoicesCount),
      avgInvoice: toNumber(row.avgInvoice),
      uniqueCustomers: toNumber(row.uniqueCustomers),
      share: toNumber(row.share),
    }))
    .sort((a, b) => b.netSales - a.netSales);

  const last5DaysByBranch = (payload.last5DaysByBranch || [])
    .map((row) => ({
      date: text(row.date),
      branch: text(row.branch) || 'غير محدد',
      netTotal: toNumber(row.netTotal),
      invoicesCount: toNumber(row.invoicesCount),
      avgInvoice: toNumber(row.avgInvoice),
      previousDayNetTotal: toNullableNumber(row.previousDayNetTotal),
      changePercent: toNullableNumber(row.changePercent),
    }))
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.branch.localeCompare(b.branch));

  const staffSales = (payload.staffSales || []).map((row) => ({
    saleDate: text(row.saleDate) || fallbackDate,
    sellerName: text(row.sellerName) || null,
    branch: text(row.branch) || null,
    netTotal: toNumber(row.netTotal),
    invoicesCount: toNumber(row.invoicesCount),
    avgInvoice: toNumber(row.avgInvoice),
    uniqueCustomers: toNumber(row.uniqueCustomers),
  })) satisfies StaffSalesSummary[];

  const dataHealth = {
    invoicesWithoutCustomer: toNumber(dataHealthRaw.invoicesWithoutCustomer),
    invoicesWithoutDoctor: toNumber(dataHealthRaw.invoicesWithoutDoctor),
    invoicesWithoutBranch: toNumber(dataHealthRaw.invoicesWithoutBranch),
  };

  return { kpis, dailyTrend, dailySales, branchRows, last5DaysByBranch, staffSales, dataHealth };
}

export async function loadSalesAnalyticsSummary(
  filters: SalesAnalyticsFilters,
  forceRefresh = false
): Promise<SalesAnalyticsSummary> {
  if (!isSupabaseConfigured) throw new Error('إعدادات Supabase غير موجودة.');
  const key = JSON.stringify(filters);
  const cached = cache.get(key);
  if (!forceRefresh && cached) return cached;

  const errorsBySection: Record<string, string> = {};
  const branchParam = isAll(filters.branch) ? null : normalizeBranchName(filters.branch);
  const doctorParam = isAll(filters.doctor) ? null : text(filters.doctor) || null;

  const [salesResult, staffIdentityResult, customerResult] = await Promise.allSettled([
    (async () => {
      const { data, error } = await supabase.rpc('get_sales_analytics_summary_v1', {
        p_start: filters.startDate,
        p_end: filters.endDate,
        p_branch: branchParam,
        p_doctor: doctorParam,
      });
      if (error) throw new Error(error.message);
      return normalizeRpcPayload(data, filters.endDate);
    })(),
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

  if (salesResult.status === 'rejected') {
    const message = salesResult.reason instanceof Error
      ? salesResult.reason.message
      : String(salesResult.reason);
    errorsBySection.sales = message;
    if (cached) {
      return {
        ...cached,
        errorsBySection: { ...cached.errorsBySection, sales: message },
        sourceHealth: [{
          source: SALES_ANALYTICS_SOURCE_ID,
          status: cached.kpis.invoicesCount > 0 ? 'ready' : 'empty',
          message: `تم عرض آخر قراءة سليمة مؤقتًا: ${message}`,
        }],
      };
    }
    throw new Error(`تعذر تحميل مصدر المبيعات التحليلي: ${message}`);
  }

  if (staffIdentityResult.status === 'rejected') {
    errorsBySection.staffIdentity = String(staffIdentityResult.reason);
  }
  if (customerResult.status === 'rejected') {
    errorsBySection.customerCards = String(customerResult.reason);
  }

  const sales = salesResult.value;
  const staffIdentityRows = staffIdentityResult.status === 'fulfilled' ? staffIdentityResult.value : [];
  const doctorRows = groupStaffSalesPerformance(sales.staffSales, staffIdentityRows)
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

  const result: SalesAnalyticsSummary = {
    kpis: sales.kpis,
    dailyTrend: sales.dailyTrend,
    dailySales: sales.dailySales,
    staffSalesSummary: sales.staffSales,
    last5DaysByBranch: sales.last5DaysByBranch,
    branchRows: sales.branchRows,
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
    dataHealth: sales.dataHealth,
    sourceHealth: [{
      source: SALES_ANALYTICS_SOURCE_ID,
      status: sales.kpis.invoicesCount > 0 ? 'ready' : 'empty',
      message: null,
    }],
    errorsBySection,
  };

  cache.set(key, result);
  return result;
}

export function clearSalesAnalyticsSummaryCache() {
  cache.clear();
}
