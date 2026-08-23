/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/lib/supabase';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';
import { getInvoiceNetValue } from '@/lib/analyticsService';
import { getInvoiceAmount as getCoreInvoiceAmount } from '@/lib/invoices/invoiceCore';

export const DASHBOARD_ALL_BRANCHES = 'كل الفروع';
const UNKNOWN_LABEL = 'غير محدد';
const RECENT_INVOICE_MAX_PAGES = 10;
type RpcRow = Record<string, unknown>;

type DashboardWorkspace = {
  summary?: RpcRow;
  daily_sales?: RpcRow[];
  branch_distribution?: RpcRow[];
  doctor_sales?: RpcRow[];
  audit?: RpcRow;
};

export type DashboardInvoiceRow = {
  id?: string | number | null;
  invoice_no?: string | number | null;
  invoice_number?: string | number | null;
  invoice_date?: string | null;
  sale_date?: string | null;
  branch?: string | null;
  branch_name?: string | null;
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
  normalized_seller_name?: string | null;
  staff_name?: string | null;
  doctor_name?: string | null;
  doctor_id?: string | number | null;
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
  dailySales: Array<{ sale_date: string; branch: string; daily_sales: number; invoices_count: number }>;
  monthlySales: Array<{ month_start: string; month_label: string; branch: string; sales_total: number; invoices_count: number; avg_invoice: number }>;
  branchDistribution: Array<{ branch: string; sales_total: number; invoices_count: number; avg_invoice: number; linked_customers: number }>;
  doctorSales: Array<{ doctor_name: string; branch: string; sales_total: number; invoices_count: number; avg_invoice: number; estimated_points: number; incentive_value: number }>;
  recentInvoices: DashboardInvoiceRow[];
  reconciliation: DashboardSalesReconciliation;
};

function normalizeDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

export function dashboardNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = normalizeDigits(String(value ?? '')).replace(/[,،\s]/g, '').replace(/[^\d.-]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function dashboardInvoiceAmount(row: DashboardInvoiceRow) {
  return getCoreInvoiceAmount(row as Record<string, unknown>) || getInvoiceNetValue(row as Record<string, unknown>);
}

function daysBefore(dateText: string, daysBack: number) {
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  date.setDate(date.getDate() - daysBack);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

async function rpcRows<T extends RpcRow>(name: string, params: Record<string, unknown>): Promise<T[]> {
  const result = await (supabase as any).rpc(name, params);
  if (result.error) throw new Error(result.error.message || `${name} failed`);
  if (Array.isArray(result.data)) return result.data as T[];
  if (result.data && typeof result.data === 'object') return [result.data as T];
  return [];
}

function numberRow(row: RpcRow, key: string) {
  return dashboardNumber(row[key]);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export async function fetchMonthlySalesFromTruth(endDate: string, branch: string, months = 5): Promise<RpcRow[]> {
  const anchor = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(anchor.getTime())) return [];
  const jobs = Array.from({ length: Math.max(1, months) }, (_, index) => {
    const monthDate = new Date(anchor.getFullYear(), anchor.getMonth() - (months - 1 - index), 1, 12);
    const key = monthKey(monthDate);
    const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 12);
    const naturalEnd = `${monthKey(lastDay)}-${String(lastDay.getDate()).padStart(2, '0')}`;
    return { key, start: `${key}-01`, end: key === endDate.slice(0, 7) && endDate < naturalEnd ? endDate : naturalEnd };
  });

  return Promise.all(jobs.map(async ({ key, start, end }) => {
    const rows = await rpcRows<RpcRow>('get_dashboard_sales_summary_v171', { p_start: start, p_end: end, p_branch: branch });
    const summary = rows[0] || {};
    const invoices = numberRow(summary, 'invoices_count');
    const sales = numberRow(summary, 'sales_total');
    return { month_start: `${key}-01`, month_label: key, branch, sales_total: sales, invoices_count: invoices, avg_invoice: invoices ? sales / invoices : 0 };
  }));
}

function mapDoctorRows(rows: RpcRow[]) {
  return rows.map((row) => {
    const sales = numberRow(row, 'sales_total');
    const count = numberRow(row, 'invoices_count');
    const points = Math.round(sales / 1000);
    return {
      doctor_name: String(row.doctor_name || UNKNOWN_LABEL),
      branch: String(row.branch || UNKNOWN_LABEL),
      sales_total: sales,
      invoices_count: count,
      avg_invoice: numberRow(row, 'avg_invoice') || (count ? sales / count : 0),
      estimated_points: points,
      incentive_value: points * 3,
    };
  });
}

async function fetchRecentInvoicesBounded(params: { startDate: string; endDate: string; branch: string; errors?: string[] }) {
  const today = localToday();
  const recentEnd = params.endDate < today ? params.endDate : today;
  const safeRecentEnd = recentEnd < params.startDate ? params.endDate : recentEnd;
  const recentStart = [params.startDate, daysBefore(safeRecentEnd, 4)].sort().at(-1) || params.startDate;
  try {
    return (await fetchSalesInvoicesPagedSafe({
      startDate: recentStart,
      endDate: safeRecentEnd,
      branch: params.branch,
      errors: params.errors,
      pageSize: 1000,
      maxPages: RECENT_INVOICE_MAX_PAGES,
      noCache: true,
    })) as DashboardInvoiceRow[];
  } catch (error) {
    params.errors?.push(`recent invoices: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function fetchWorkspace(range: Record<string, unknown>): Promise<DashboardWorkspace> {
  const { data, error } = await supabase.rpc('get_dashboard_workspace_v1', range as any);
  if (error) throw new Error(error.message || 'get_dashboard_workspace_v1 failed');
  return (data || {}) as DashboardWorkspace;
}

async function fetchAggregatedTruth(params: { startDate: string; endDate: string; branch: string; errors?: string[] }): Promise<DashboardSalesTruth> {
  const branch = params.branch || DASHBOARD_ALL_BRANCHES;
  const range = { p_start: params.startDate, p_end: params.endDate, p_branch: branch };
  const workspace = await fetchWorkspace(range);
  const rawSummary = workspace.summary;
  if (!rawSummary) throw new Error('Dashboard workspace returned no summary');

  const summary = {
    invoices_count: numberRow(rawSummary, 'invoices_count'),
    sales_total: numberRow(rawSummary, 'sales_total'),
    avg_invoice: numberRow(rawSummary, 'avg_invoice'),
    linked_invoices: numberRow(rawSummary, 'linked_invoices'),
    unregistered_customer_invoices: numberRow(rawSummary, 'unregistered_customer_invoices'),
    linked_sales: numberRow(rawSummary, 'linked_sales'),
    unregistered_customer_sales: numberRow(rawSummary, 'unregistered_customer_sales'),
    customer_link_rate_percent: numberRow(rawSummary, 'customer_link_rate_percent'),
    linked_customers: numberRow(rawSummary, 'linked_customers'),
  };

  const dailySales = (workspace.daily_sales || []).map((row) => ({
    sale_date: String(row.sale_date || '').slice(0, 10),
    branch: String(row.branch || UNKNOWN_LABEL),
    daily_sales: numberRow(row, 'daily_sales'),
    invoices_count: numberRow(row, 'invoices_count'),
  }));
  const branchDistribution = (workspace.branch_distribution || []).map((row) => ({
    branch: String(row.branch || UNKNOWN_LABEL),
    sales_total: numberRow(row, 'sales_total'),
    invoices_count: numberRow(row, 'invoices_count'),
    avg_invoice: numberRow(row, 'avg_invoice'),
    linked_customers: numberRow(row, 'linked_customers'),
  }));
  const doctorSales = mapDoctorRows(workspace.doctor_sales || []);

  // Detail is deliberately secondary: the dashboard remains usable even if this bounded read fails.
  const recentInvoices = await fetchRecentInvoicesBounded({ ...params, branch });
  const audit = workspace.audit || {};
  const cleanTotal = numberRow(audit, 'clean_total') || summary.sales_total;
  const cleanRows = numberRow(audit, 'clean_rows') || summary.invoices_count;
  const dates = dailySales.map((row) => row.sale_date).filter(Boolean).sort();

  return {
    sourceRows: recentInvoices,
    cycleRows: [],
    summary,
    dailySales,
    monthlySales: [],
    branchDistribution,
    doctorSales,
    recentInvoices,
    reconciliation: {
      source: 'dashboard_workspace_v1',
      dashboardTotal: summary.sales_total,
      sqlEquivalentTotal: cleanTotal,
      difference: Math.abs(summary.sales_total - cleanTotal),
      invoicesCount: summary.invoices_count,
      rowsRead: cleanRows,
      selectedStartDate: params.startDate,
      selectedEndDate: params.endDate,
      branchesIncluded: branchDistribution.map((row) => row.branch).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ar')),
      firstInvoiceDate: dates[0] || null,
      lastInvoiceDate: dates.at(-1) || null,
      missingBranchCount: 0,
      missingDoctorCount: 0,
      missingInvoiceKeyCount: 0,
      missingCustomerCodeCount: summary.unregistered_customer_invoices,
    },
  };
}

export async function fetchDashboardSalesTruth(params: { startDate: string; endDate: string; branch: string; errors?: string[]; noCache?: boolean }): Promise<DashboardSalesTruth> {
  try {
    return await fetchAggregatedTruth(params);
  } catch (firstError) {
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      return await fetchAggregatedTruth(params);
    } catch (secondError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
      const secondMessage = secondError instanceof Error ? secondError.message : String(secondError);
      params.errors?.push(`dashboard workspace: ${firstMessage}; retry: ${secondMessage}`);
      throw secondError;
    }
  }
}
