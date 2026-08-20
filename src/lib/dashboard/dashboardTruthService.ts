/* eslint-disable no-useless-escape, @typescript-eslint/no-explicit-any */
import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';
import {
  getInvoiceNetValue,
  isCancelledInvoice,
  normalizeDoctorName,
} from '@/lib/analyticsService';
import {
  getInvoiceAmount as getCoreInvoiceAmount,
  getInvoiceBranch as getCoreInvoiceBranch,
  getInvoiceCustomerKey,
  getInvoiceDay,
  getInvoiceId,
  getInvoiceSellerName,
} from '@/lib/invoices/invoiceCore';

export const DASHBOARD_ALL_BRANCHES = '\u0643\u0644 \u0627\u0644\u0641\u0631\u0648\u0639';
const UNKNOWN_LABEL = '\u063A\u064A\u0631 \u0645\u062D\u062F\u062F';

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
  return getCoreInvoiceAmount(row as Record<string, unknown>) || getInvoiceNetValue(row as Record<string, unknown>);
}

function invoiceDate(row: DashboardInvoiceRow) {
  return getInvoiceDay(row as Record<string, unknown>) || '';
}

function invoiceIdentityKey(row: DashboardInvoiceRow) {
  return getInvoiceId(row as Record<string, unknown>);
}

function invoiceBranch(row: DashboardInvoiceRow) {
  return getCoreInvoiceBranch(row as Record<string, unknown>, UNKNOWN_LABEL);
}

function invoiceDoctorName(row: DashboardInvoiceRow) {
  return getInvoiceSellerName(row as Record<string, unknown>) || row.doctor_name || '';
}

function daysBefore(dateText: string, daysBack: number) {
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  date.setDate(date.getDate() - daysBack);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localToday() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
    .replace(/^(\u062F|\u062F\u0643\u062A\u0648\u0631|\u0627\u0644\u062F\u0643\u062A\u0648\u0631)\s+/, '')
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
  const code = getInvoiceCustomerKey(row as Record<string, unknown>);
  const name = normalizeText(row.customer_name);
  return Boolean(
    code &&
    !['0', 'null', 'NULL', '-'].includes(code) &&
    !name.includes('\u0639\u0645\u064A\u0644 \u063A\u064A\u0631 \u0645\u0633\u062C\u0644') &&
    !name.includes('\u063A\u064A\u0631 \u0645\u0633\u062C\u0644')
  );
}

function buildFallbackTruth(rows: DashboardInvoiceRow[]) {
  const invoiceRows = rows.filter((row) => invoiceDate(row) && !isCancelledInvoice(row as Record<string, unknown>));
  const linkedRows = invoiceRows.filter(isLinkedInvoice);
  const total = invoiceRows.reduce((sum, row) => sum + dashboardInvoiceAmount(row), 0);
  const dailyMap = new Map<string, { sale_date: string; branch: string; daily_sales: number; invoices_count: number }>();
  const branchMap = new Map<string, { branch: string; sales_total: number; invoices_count: number; avg_invoice: number; linked_customers: number }>();
  const branchCustomers = new Map<string, Set<string>>();
  const doctorMap = new Map<string, { doctor_name: string; branch: string; sales_total: number; invoices_count: number; avg_invoice: number; estimated_points: number; incentive_value: number }>();
  const monthMap = new Map<string, { month_start: string; month_label: string; branch: string; sales_total: number; invoices_count: number; avg_invoice: number }>();

  for (const row of invoiceRows) {
    const day = invoiceDate(row);
    const branch = invoiceBranch(row);
    const amount = dashboardInvoiceAmount(row);
    const dailyKey = `${day}__${branch}`;
    const daily = dailyMap.get(dailyKey) || { sale_date: day, branch, daily_sales: 0, invoices_count: 0 };
    daily.daily_sales += amount;
    daily.invoices_count += 1;
    dailyMap.set(dailyKey, daily);

    const branchRow = branchMap.get(branch) || { branch, sales_total: 0, invoices_count: 0, avg_invoice: 0, linked_customers: 0 };
    branchRow.sales_total += amount;
    branchRow.invoices_count += 1;
    branchMap.set(branch, branchRow);

    if (isLinkedInvoice(row)) {
      if (!branchCustomers.has(branch)) branchCustomers.set(branch, new Set());
      branchCustomers.get(branch)?.add(String(row.customer_code || '').trim());
    }

    const month = day.slice(0, 7);
    const monthKey = `${month}__${branch}`;
    const monthRow = monthMap.get(monthKey) || { month_start: `${month}-01`, month_label: month, branch, sales_total: 0, invoices_count: 0, avg_invoice: 0 };
    monthRow.sales_total += amount;
    monthRow.invoices_count += 1;
    monthMap.set(monthKey, monthRow);

    const doctorSource = invoiceDoctorName(row);
    if (isDoctorName(doctorSource)) {
      const doctor = normalizeDoctorName(doctorSource);
      const doctorKey = `${doctor}__${branch}`;
      const doctorRow = doctorMap.get(doctorKey) || { doctor_name: doctor, branch, sales_total: 0, invoices_count: 0, avg_invoice: 0, estimated_points: 0, incentive_value: 0 };
      doctorRow.sales_total += amount;
      doctorRow.invoices_count += 1;
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
    return { ...row, avg_invoice: row.invoices_count ? row.sales_total / row.invoices_count : 0, estimated_points: points, incentive_value: points * 3 };
  });
  const monthlySales = [...monthMap.values()].map((row) => ({
    ...row,
    avg_invoice: row.invoices_count ? row.sales_total / row.invoices_count : 0,
  }));

  return {
    summary: {
      invoices_count: invoiceRows.length,
      sales_total: total,
      avg_invoice: invoiceRows.length ? total / invoiceRows.length : 0,
      linked_invoices: linkedRows.length,
      unregistered_customer_invoices: invoiceRows.length - linkedRows.length,
      linked_sales: linkedRows.reduce((sum, row) => sum + dashboardInvoiceAmount(row), 0),
      unregistered_customer_sales: invoiceRows.filter((row) => !isLinkedInvoice(row)).reduce((sum, row) => sum + dashboardInvoiceAmount(row), 0),
      customer_link_rate_percent: invoiceRows.length ? (linkedRows.length / invoiceRows.length) * 100 : 0,
      linked_customers: new Set(linkedRows.map((row) => String(row.customer_code || '').trim()).filter(Boolean)).size,
    },
    dailySales: [...dailyMap.values()].sort((a, b) => `${a.sale_date}__${a.branch}`.localeCompare(`${b.sale_date}__${b.branch}`)),
    branchDistribution: branchDistribution.sort((a, b) => b.sales_total - a.sales_total),
    doctorSales: doctorSales.sort((a, b) => b.sales_total - a.sales_total).slice(0, 60),
    monthlySales: monthlySales.sort((a, b) => `${a.month_start}__${a.branch}`.localeCompare(`${b.month_start}__${b.branch}`)),
  };
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
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function fetchMonthlySalesFromTruth(endDate: string, branch: string, months = 5): Promise<RpcRow[]> {
  const anchor = new Date(`${endDate}T12:00:00`);
  if (Number.isNaN(anchor.getTime())) return [];
  const jobs = Array.from({ length: Math.max(1, months) }, (_, index) => {
    const monthDate = new Date(anchor.getFullYear(), anchor.getMonth() - (months - 1 - index), 1, 12, 0, 0);
    const key = monthKey(monthDate);
    const start = `${key}-01`;
    const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 12, 0, 0);
    const naturalEnd = `${monthKey(lastDay)}-${String(lastDay.getDate()).padStart(2, '0')}`;
    const end = key === endDate.slice(0, 7) && endDate < naturalEnd ? endDate : naturalEnd;
    return { key, start, end };
  });

  return Promise.all(
    jobs.map(async ({ key, start, end }) => {
      const summaryRows = await rpcRows<RpcRow>('get_dashboard_sales_summary_v171', {
        p_start: start,
        p_end: end,
        p_branch: branch,
      });
      const summary = summaryRows[0] || {};
      const invoices = numberRow(summary, 'invoices_count');
      const sales = numberRow(summary, 'sales_total');
      return {
        month_start: `${key}-01`,
        month_label: key,
        branch,
        sales_total: sales,
        invoices_count: invoices,
        avg_invoice: invoices ? sales / invoices : 0,
      };
    })
  );
}

async function fetchAggregatedTruth(params: {
  startDate: string;
  endDate: string;
  branch: string;
  errors?: string[];
  noCache?: boolean;
}): Promise<DashboardSalesTruth> {
  const branch = params.branch || DASHBOARD_ALL_BRANCHES;
  const rangeParams = { p_start: params.startDate, p_end: params.endDate, p_branch: branch };
  const [summaryRows, dailyRows, branchRows, doctorRows, monthlyRows, auditRows] = await Promise.all([
    rpcRows<RpcRow>('get_dashboard_sales_summary_v171', rangeParams),
    rpcRows<RpcRow>('get_dashboard_daily_sales_v171', rangeParams),
    rpcRows<RpcRow>('get_dashboard_branch_distribution_v171', rangeParams),
    rpcRows<RpcRow>('get_dashboard_doctor_sales_v171', rangeParams),
    fetchMonthlySalesFromTruth(params.endDate, branch, 5),
    rpcRows<RpcRow>('get_dashboard_sales_truth_audit_v1', rangeParams),
  ]);

  const summaryRow = summaryRows[0];
  if (!summaryRow) throw new Error('Dashboard sales summary returned no row');

  const summary = {
    invoices_count: numberRow(summaryRow, 'invoices_count'),
    sales_total: numberRow(summaryRow, 'sales_total'),
    avg_invoice: numberRow(summaryRow, 'avg_invoice'),
    linked_invoices: numberRow(summaryRow, 'linked_invoices'),
    unregistered_customer_invoices: numberRow(summaryRow, 'unregistered_customer_invoices'),
    linked_sales: numberRow(summaryRow, 'linked_sales'),
    unregistered_customer_sales: numberRow(summaryRow, 'unregistered_customer_sales'),
    customer_link_rate_percent: numberRow(summaryRow, 'customer_link_rate_percent'),
    linked_customers: numberRow(summaryRow, 'linked_customers'),
  };

  const dailySales = dailyRows.map((row) => ({
    sale_date: String(row.sale_date || '').slice(0, 10),
    branch: String(row.branch || UNKNOWN_LABEL),
    daily_sales: numberRow(row, 'daily_sales'),
    invoices_count: numberRow(row, 'invoices_count'),
  }));

  const branchDistribution = branchRows.map((row) => ({
    branch: String(row.branch || UNKNOWN_LABEL),
    sales_total: numberRow(row, 'sales_total'),
    invoices_count: numberRow(row, 'invoices_count'),
    avg_invoice: numberRow(row, 'avg_invoice'),
    linked_customers: numberRow(row, 'linked_customers'),
  }));

  const doctorSales = doctorRows.map((row) => {
    const salesTotal = numberRow(row, 'sales_total');
    const points = Math.round(salesTotal / 1000);
    return {
      doctor_name: String(row.doctor_name || 'غير مربوط'),
      branch: String(row.branch || UNKNOWN_LABEL),
      sales_total: salesTotal,
      invoices_count: numberRow(row, 'invoices_count'),
      avg_invoice: numberRow(row, 'avg_invoice'),
      estimated_points: points,
      incentive_value: points * 3,
    };
  });

  const monthlySales = monthlyRows.map((row) => ({
    month_start: String(row.month_start || '').slice(0, 10),
    month_label: String(row.month_label || ''),
    branch: String(row.branch || UNKNOWN_LABEL),
    sales_total: numberRow(row, 'sales_total'),
    invoices_count: numberRow(row, 'invoices_count'),
    avg_invoice: numberRow(row, 'avg_invoice'),
  }));

  const today = localToday();
  const recentEnd = params.endDate < today ? params.endDate : today;
  const safeRecentEnd = recentEnd < params.startDate ? params.endDate : recentEnd;
  const recentStartCandidate = daysBefore(safeRecentEnd, 4);
  const recentStart = recentStartCandidate < params.startDate ? params.startDate : recentStartCandidate;
  const recentInvoices = (await fetchSalesInvoicesPagedSafe({
    startDate: recentStart,
    endDate: safeRecentEnd,
    branch,
    errors: params.errors,
    noCache: params.noCache,
  })) as DashboardInvoiceRow[];

  const audit = auditRows[0] || {};
  const branchesIncluded = branchDistribution.map((row) => row.branch).filter(Boolean).sort((a, b) => a.localeCompare(b, 'ar'));
  const firstInvoiceDate = dailySales.map((row) => row.sale_date).filter(Boolean).sort()[0] || null;
  const lastInvoiceDate = dailySales.map((row) => row.sale_date).filter(Boolean).sort().at(-1) || null;
  const cleanTotal = numberRow(audit, 'clean_total') || summary.sales_total;
  const cleanRows = numberRow(audit, 'clean_rows') || summary.invoices_count;

  return {
    sourceRows: recentInvoices,
    cycleRows: recentInvoices,
    summary,
    dailySales,
    monthlySales,
    branchDistribution,
    doctorSales,
    recentInvoices,
    reconciliation: {
      source: 'dashboard_aggregate_rpcs_v171',
      dashboardTotal: summary.sales_total,
      sqlEquivalentTotal: cleanTotal,
      difference: Math.abs(summary.sales_total - cleanTotal),
      invoicesCount: summary.invoices_count,
      rowsRead: cleanRows,
      selectedStartDate: params.startDate,
      selectedEndDate: params.endDate,
      branchesIncluded,
      firstInvoiceDate,
      lastInvoiceDate,
      missingBranchCount: 0,
      missingDoctorCount: 0,
      missingInvoiceKeyCount: 0,
      missingCustomerCodeCount: summary.unregistered_customer_invoices,
    },
  };
}

async function fetchFallbackTruth(params: {
  startDate: string;
  endDate: string;
  branch: string;
  errors?: string[];
  noCache?: boolean;
}): Promise<DashboardSalesTruth> {
  const rows = (await fetchSalesInvoicesPagedSafe({
    startDate: params.startDate,
    endDate: params.endDate,
    branch: params.branch,
    errors: params.errors,
    noCache: params.noCache,
  })) as DashboardInvoiceRow[];
  const truth = buildFallbackTruth(rows);
  const recentAnchorDate = rows.map(invoiceDate).filter(Boolean).sort().at(-1) || params.endDate;
  const recentStart = daysBefore(recentAnchorDate, 4);
  const recentInvoices = rows.filter((row) => {
    const day = invoiceDate(row);
    return day >= recentStart && day <= recentAnchorDate;
  });
  const branchesIncluded = [...new Set(rows.map(invoiceBranch))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ar'));
  const sqlEquivalentTotal = rows.reduce((sum, row) => sum + dashboardInvoiceAmount(row), 0);

  return {
    sourceRows: rows,
    cycleRows: rows,
    ...truth,
    recentInvoices,
    reconciliation: {
      source: 'dawaa_sales_invoices_dashboard_v1_fallback',
      dashboardTotal: truth.summary.sales_total,
      sqlEquivalentTotal,
      difference: Math.abs(truth.summary.sales_total - sqlEquivalentTotal),
      invoicesCount: truth.summary.invoices_count,
      rowsRead: rows.length,
      selectedStartDate: params.startDate,
      selectedEndDate: params.endDate,
      branchesIncluded,
      firstInvoiceDate: rows.map(invoiceDate).filter(Boolean).sort()[0] || null,
      lastInvoiceDate: recentAnchorDate || null,
      missingBranchCount: rows.filter((row) => !String(row.branch_name || row.branch || '').trim()).length,
      missingDoctorCount: rows.filter((row) => !String(invoiceDoctorName(row) || '').trim()).length,
      missingInvoiceKeyCount: rows.filter((row) => !invoiceIdentityKey(row)).length,
      missingCustomerCodeCount: rows.filter((row) => !String(row.customer_code || '').trim()).length,
    },
  };
}

export async function fetchDashboardSalesTruth(params: {
  startDate: string;
  endDate: string;
  branch: string;
  errors?: string[];
  noCache?: boolean;
}): Promise<DashboardSalesTruth> {
  try {
    return await fetchAggregatedTruth(params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.errors?.push(`dashboard aggregate RPCs: ${message}`);
    if (import.meta.env.DEV) console.warn('[DashboardTruth] aggregate path failed; using clean-view fallback', error);
    return fetchFallbackTruth(params);
  }
}
