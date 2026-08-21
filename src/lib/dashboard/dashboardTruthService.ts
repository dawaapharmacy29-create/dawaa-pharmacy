/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '@/lib/supabase';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';
import { getInvoiceNetValue } from '@/lib/analyticsService';
import {
  getInvoiceAmount as getCoreInvoiceAmount,
  getInvoiceBranch as getCoreInvoiceBranch,
  getInvoiceCustomerKey,
  getInvoiceDay,
  getInvoiceId,
  getInvoiceSellerName,
} from '@/lib/invoices/invoiceCore';

export const DASHBOARD_ALL_BRANCHES = 'كل الفروع';
const UNKNOWN_LABEL = 'غير محدد';
type RpcRow = Record<string, unknown>;

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

function invoiceDate(row: DashboardInvoiceRow) {
  return getInvoiceDay(row as Record<string, unknown>) || '';
}

function invoiceBranch(row: DashboardInvoiceRow) {
  return getCoreInvoiceBranch(row as Record<string, unknown>, UNKNOWN_LABEL);
}

function invoiceDoctorName(row: DashboardInvoiceRow) {
  return getInvoiceSellerName(row as Record<string, unknown>) || row.doctor_name || '';
}

function invoiceIdentityKey(row: DashboardInvoiceRow) {
  return getInvoiceId(row as Record<string, unknown>);
}

function isLinkedInvoice(row: DashboardInvoiceRow) {
  const code = getInvoiceCustomerKey(row as Record<string, unknown>);
  const name = String(row.customer_name || '').trim();
  return Boolean(code && !['0', '-', 'null', 'NULL'].includes(code) && !name.includes('غير مسجل'));
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

async function fetchAggregatedTruth(params: { startDate: string; endDate: string; branch: string; errors?: string[]; noCache?: boolean }): Promise<DashboardSalesTruth> {
  const branch = params.branch || DASHBOARD_ALL_BRANCHES;
  const range = { p_start: params.startDate, p_end: params.endDate, p_branch: branch };
  const [summaryRows, dailyRows, branchRows, doctorRows, auditRows] = await Promise.all([
    rpcRows<RpcRow>('get_dashboard_sales_summary_v171', range),
    rpcRows<RpcRow>('get_dashboard_daily_sales_v171', range),
    rpcRows<RpcRow>('get_dashboard_branch_distribution_v171', range),
    rpcRows<RpcRow>('get_dashboard_doctor_sales_v171', range),
    rpcRows<RpcRow>('get_dashboard_sales_truth_audit_v1', range),
  ]);
  const rawSummary = summaryRows[0];
  if (!rawSummary) throw new Error('Dashboard sales summary returned no row');
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
  const dailySales = dailyRows.map((row) => ({ sale_date: String(row.sale_date || '').slice(0, 10), branch: String(row.branch || UNKNOWN_LABEL), daily_sales: numberRow(row, 'daily_sales'), invoices_count: numberRow(row, 'invoices_count') }));
  const branchDistribution = branchRows.map((row) => ({ branch: String(row.branch || UNKNOWN_LABEL), sales_total: numberRow(row, 'sales_total'), invoices_count: numberRow(row, 'invoices_count'), avg_invoice: numberRow(row, 'avg_invoice'), linked_customers: numberRow(row, 'linked_customers') }));
  const doctorSales = mapDoctorRows(doctorRows);

  const today = localToday();
  const recentEnd = params.endDate < today ? params.endDate : today;
  const safeRecentEnd = recentEnd < params.startDate ? params.endDate : recentEnd;
  const recentStart = [params.startDate, daysBefore(safeRecentEnd, 4)].sort().at(-1) || params.startDate;
  const recentInvoices = await fetchSalesInvoicesPagedSafe({ startDate: recentStart, endDate: safeRecentEnd, branch, errors: params.errors, noCache: true }) as DashboardInvoiceRow[];
  const audit = auditRows[0] || {};
  const cleanTotal = numberRow(audit, 'clean_total') || summary.sales_total;
  const cleanRows = numberRow(audit, 'clean_rows') || summary.invoices_count;
  const dates = dailySales.map((row) => row.sale_date).filter(Boolean).sort();
  return {
    sourceRows: recentInvoices,
    cycleRows: recentInvoices,
    summary,
    dailySales,
    monthlySales: [],
    branchDistribution,
    doctorSales,
    recentInvoices,
    reconciliation: {
      source: 'dashboard_aggregate_rpcs_v171', dashboardTotal: summary.sales_total, sqlEquivalentTotal: cleanTotal,
      difference: Math.abs(summary.sales_total - cleanTotal), invoicesCount: summary.invoices_count, rowsRead: cleanRows,
      selectedStartDate: params.startDate, selectedEndDate: params.endDate,
      branchesIncluded: branchDistribution.map((row) => row.branch).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ar')),
      firstInvoiceDate: dates[0] || null, lastInvoiceDate: dates.at(-1) || null,
      missingBranchCount: 0, missingDoctorCount: 0, missingInvoiceKeyCount: 0,
      missingCustomerCodeCount: summary.unregistered_customer_invoices,
    },
  };
}

function buildFallbackTruth(rows: DashboardInvoiceRow[]) {
  // IMPORTANT: rows already come from dawaa_sales_invoices_dashboard_v1. That view is the
  // single source of truth for the exact five excluded codes + non-final invoices. Never add
  // wholesale/B2B exclusions here or fallback totals will diverge from the RPC path.
  const invoiceRows = rows.filter((row) => Boolean(invoiceDate(row)));
  const linkedRows = invoiceRows.filter(isLinkedInvoice);
  const total = invoiceRows.reduce((sum, row) => sum + dashboardInvoiceAmount(row), 0);
  const daily = new Map<string, { sale_date: string; branch: string; daily_sales: number; invoices_count: number }>();
  const branches = new Map<string, { branch: string; sales_total: number; invoices_count: number; avg_invoice: number; linked_customers: number }>();
  const branchCustomers = new Map<string, Set<string>>();
  for (const row of invoiceRows) {
    const day = invoiceDate(row); const branch = invoiceBranch(row); const amount = dashboardInvoiceAmount(row);
    const dk = `${day}__${branch}`; const d = daily.get(dk) || { sale_date: day, branch, daily_sales: 0, invoices_count: 0 };
    d.daily_sales += amount; d.invoices_count += 1; daily.set(dk, d);
    const b = branches.get(branch) || { branch, sales_total: 0, invoices_count: 0, avg_invoice: 0, linked_customers: 0 };
    b.sales_total += amount; b.invoices_count += 1; branches.set(branch, b);
    if (isLinkedInvoice(row)) {
      if (!branchCustomers.has(branch)) branchCustomers.set(branch, new Set());
      branchCustomers.get(branch)?.add(String(row.customer_code || '').trim());
    }
  }
  const linkedSales = linkedRows.reduce((sum, row) => sum + dashboardInvoiceAmount(row), 0);
  return {
    summary: {
      invoices_count: invoiceRows.length, sales_total: total, avg_invoice: invoiceRows.length ? total / invoiceRows.length : 0,
      linked_invoices: linkedRows.length, unregistered_customer_invoices: invoiceRows.length - linkedRows.length,
      linked_sales: linkedSales, unregistered_customer_sales: total - linkedSales,
      customer_link_rate_percent: invoiceRows.length ? linkedRows.length / invoiceRows.length * 100 : 0,
      linked_customers: new Set(linkedRows.map((row) => String(row.customer_code || '').trim()).filter(Boolean)).size,
    },
    dailySales: [...daily.values()].sort((a, b) => `${a.sale_date}__${a.branch}`.localeCompare(`${b.sale_date}__${b.branch}`)),
    branchDistribution: [...branches.values()].map((row) => ({ ...row, avg_invoice: row.invoices_count ? row.sales_total / row.invoices_count : 0, linked_customers: branchCustomers.get(row.branch)?.size || 0 })).sort((a, b) => b.sales_total - a.sales_total),
  };
}

async function fetchFallbackTruth(params: { startDate: string; endDate: string; branch: string; errors?: string[]; noCache?: boolean }): Promise<DashboardSalesTruth> {
  const rows = await fetchSalesInvoicesPagedSafe({ startDate: params.startDate, endDate: params.endDate, branch: params.branch, errors: params.errors, noCache: true }) as DashboardInvoiceRow[];
  const truth = buildFallbackTruth(rows);
  let doctorSales: DashboardSalesTruth['doctorSales'] = [];
  try {
    const doctorRows = await rpcRows<RpcRow>('get_dashboard_doctor_sales_v171', { p_start: params.startDate, p_end: params.endDate, p_branch: params.branch });
    doctorSales = mapDoctorRows(doctorRows);
  } catch (error) {
    params.errors?.push(`doctor sales fallback: ${error instanceof Error ? error.message : String(error)}`);
  }
  const anchor = rows.map(invoiceDate).filter(Boolean).sort().at(-1) || params.endDate;
  const recentStart = daysBefore(anchor, 4);
  const recentInvoices = rows.filter((row) => { const day = invoiceDate(row); return day >= recentStart && day <= anchor; });
  const total = truth.summary.sales_total;
  return {
    sourceRows: rows, cycleRows: rows, ...truth, monthlySales: [], doctorSales, recentInvoices,
    reconciliation: {
      source: 'dawaa_sales_invoices_dashboard_v1_fallback', dashboardTotal: total, sqlEquivalentTotal: total, difference: 0,
      invoicesCount: truth.summary.invoices_count, rowsRead: rows.length,
      selectedStartDate: params.startDate, selectedEndDate: params.endDate,
      branchesIncluded: [...new Set(rows.map(invoiceBranch))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ar')),
      firstInvoiceDate: rows.map(invoiceDate).filter(Boolean).sort()[0] || null, lastInvoiceDate: anchor || null,
      missingBranchCount: rows.filter((row) => !String(row.branch_name || row.branch || '').trim()).length,
      missingDoctorCount: rows.filter((row) => !String(invoiceDoctorName(row) || '').trim()).length,
      missingInvoiceKeyCount: rows.filter((row) => !invoiceIdentityKey(row)).length,
      missingCustomerCodeCount: rows.filter((row) => !String(row.customer_code || '').trim()).length,
    },
  };
}

export async function fetchDashboardSalesTruth(params: { startDate: string; endDate: string; branch: string; errors?: string[]; noCache?: boolean }): Promise<DashboardSalesTruth> {
  try {
    return await fetchAggregatedTruth(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.errors?.push(`dashboard aggregate RPCs: ${message}`);
    if (import.meta.env.DEV) console.warn('[DashboardTruth] aggregate path failed; using clean-view fallback', error);
    return fetchFallbackTruth(params);
  }
}
