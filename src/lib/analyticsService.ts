import { supabase } from "@/lib/supabase";

export type SalesAnalyticsFilters = {
  from?: string;
  to?: string;
  branch?: string;
  doctor?: string;
  shift?: string;
  invoiceType?: string;
};

export type SalesTotals = {
  invoiceCount: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  averageInvoice: number;
  customerCount: number;
  firstInvoiceDate: string | null;
  lastInvoiceDate: string | null;
};

export type SalesInvoiceLike = Record<string, unknown>;

const ALL_FILTERS = new Set(["", "الكل", "كل الفروع", "كل الدكاترة", "كل الشيفتات", "كل الأنواع"]);

export function getSalesValue(row: SalesInvoiceLike) {
  return Number(row.net_amount ?? row.amount ?? row.gross_amount ?? 0) || 0;
}

export function getGrossSalesValue(row: SalesInvoiceLike) {
  return Number(row.gross_amount ?? row.amount ?? row.net_amount ?? 0) || 0;
}

export function getDiscountValue(row: SalesInvoiceLike) {
  return Number(row.discount_amount ?? 0) || Math.max(0, getGrossSalesValue(row) - getSalesValue(row));
}

function invoiceDate(row: SalesInvoiceLike) {
  return String(row.invoice_date ?? row.invoice_datetime ?? row.analysis_datetime ?? "").slice(0, 10);
}

function matchesFilter(actual: unknown, expected?: string) {
  if (!expected || ALL_FILTERS.has(expected)) return true;
  return String(actual ?? "").trim() === expected;
}

export function filterSalesInvoices(rows: SalesInvoiceLike[], filters: SalesAnalyticsFilters = {}) {
  return rows.filter((row) => {
    const date = invoiceDate(row);
    if (filters.from && date && date < filters.from) return false;
    if (filters.to && date && date > filters.to) return false;
    if (!matchesFilter(row.branch, filters.branch)) return false;
    if (!matchesFilter(row.seller_name ?? row.doctor_name ?? row.staff_name, filters.doctor)) return false;
    if (!matchesFilter(row.shift, filters.shift)) return false;
    if (!matchesFilter(row.invoice_type, filters.invoiceType)) return false;
    return true;
  });
}

export function getSalesTotalsFromRows(rows: SalesInvoiceLike[], filters: SalesAnalyticsFilters = {}): SalesTotals {
  const filtered = filterSalesInvoices(rows, filters);
  const dates = filtered.map(invoiceDate).filter(Boolean).sort();
  const netSales = filtered.reduce((sum, row) => sum + getSalesValue(row), 0);
  const grossSales = filtered.reduce((sum, row) => sum + getGrossSalesValue(row), 0);
  const discounts = filtered.reduce((sum, row) => sum + getDiscountValue(row), 0);
  const customers = new Set(
    filtered
      .map((row) => String(row.customer_id ?? row.customer_code ?? row.customer_phone ?? row.customer_name ?? "").trim())
      .filter(Boolean),
  );

  return {
    invoiceCount: filtered.length,
    grossSales,
    discounts,
    netSales,
    averageInvoice: filtered.length ? netSales / filtered.length : 0,
    customerCount: customers.size,
    firstInvoiceDate: dates[0] ?? null,
    lastInvoiceDate: dates[dates.length - 1] ?? null,
  };
}

export async function fetchSalesInvoicesForAnalytics(maxRows = 100000) {
  const pageSize = 1000;
  const rows: SalesInvoiceLike[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await supabase
      .from("sales_invoices")
      .select("*")
      .order("invoice_date", { ascending: false })
      .range(from, Math.min(from + pageSize - 1, maxRows - 1));

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as SalesInvoiceLike[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

export async function getSalesTotals(filters: SalesAnalyticsFilters = {}) {
  const rows = await fetchSalesInvoicesForAnalytics();
  return getSalesTotalsFromRows(rows, filters);
}

