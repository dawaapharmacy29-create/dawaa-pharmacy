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

export function parseNumericValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value)
    .trim()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬،]/g, "")
    .replace(/جنيه|ج\.م|egp/gi, "")
    .replace(/[^0-9.\-]/g, "");
  const parts = text.split(".");
  if (parts.length > 2) text = parts.slice(0, -1).join("") + "." + parts.at(-1);
  const numberValue = Number.parseFloat(text);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function firstNumericValue(row: SalesInvoiceLike, keys: string[]): number {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      const parsed = parseNumericValue(value);
      if (parsed !== 0) return parsed;
    }
  }
  return 0;
}

export function getSalesValue(row: SalesInvoiceLike) {
  return firstNumericValue(row, ["net_amount", "discounted_amount", "amount"]);
}

export function getGrossSalesValue(row: SalesInvoiceLike) {
  return firstNumericValue(row, ["gross_amount", "original_amount", "net_amount", "discounted_amount", "amount"]);
}

export function getDiscountValue(row: SalesInvoiceLike) {
  const explicit = firstNumericValue(row, ["discount_amount", "discount", "ق.الخصم"]);
  return explicit || Math.max(0, getGrossSalesValue(row) - getSalesValue(row));
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
    if (!matchesFilter(row.shift_name ?? row.shift, filters.shift)) return false;
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
  console.warn("Raw invoice loading is disabled for analytics. Use summary services instead.", { maxRows });
  return [] as SalesInvoiceLike[];
}

export async function getSalesTotals(filters: SalesAnalyticsFilters = {}): Promise<SalesTotals> {
  let query = supabase
    .from("sales_daily_summary")
    .select("sale_date, branch, shift_name, seller_name, invoice_type, invoices_count, net_total, gross_total, discount_total, unique_customers")
    .order("sale_date", { ascending: true })
    .limit(5000);

  if (filters.from) query = query.gte("sale_date", filters.from);
  if (filters.to) query = query.lte("sale_date", filters.to);
  if (filters.branch && !ALL_FILTERS.has(filters.branch)) query = query.eq("branch", filters.branch);
  if (filters.doctor && !ALL_FILTERS.has(filters.doctor)) query = query.eq("seller_name", filters.doctor);
  if (filters.shift && !ALL_FILTERS.has(filters.shift)) query = query.eq("shift_name", filters.shift);
  if (filters.invoiceType && !ALL_FILTERS.has(filters.invoiceType)) query = query.eq("invoice_type", filters.invoiceType);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data || []) as SalesInvoiceLike[];
  const netSales = rows.reduce((sum, row) => sum + firstNumericValue(row, ["net_total"]), 0);
  const grossSales = rows.reduce((sum, row) => sum + firstNumericValue(row, ["gross_total", "net_total"]), 0);
  const discounts = rows.reduce((sum, row) => sum + firstNumericValue(row, ["discount_total"]), 0);
  const invoiceCount = rows.reduce((sum, row) => sum + firstNumericValue(row, ["invoices_count"]), 0);
  const customerCount = rows.reduce((sum, row) => sum + firstNumericValue(row, ["unique_customers"]), 0);
  const dates = rows.map((row) => String(row.sale_date || "")).filter(Boolean).sort();

  return {
    invoiceCount,
    grossSales,
    discounts,
    netSales,
    averageInvoice: invoiceCount ? netSales / invoiceCount : 0,
    customerCount,
    firstInvoiceDate: dates[0] ?? null,
    lastInvoiceDate: dates[dates.length - 1] ?? null,
  };
}

export function getSalesOverview(_filters: SalesAnalyticsFilters = {}) {
  return {};
}

export function getShiftAnalysis(_filters: SalesAnalyticsFilters = {}) {
  return {};
}

export function getDoctorAnalysis(_filters: SalesAnalyticsFilters = {}) {
  return {};
}

export function getCustomerAnalysis(_filters: SalesAnalyticsFilters = {}) {
  return {};
}

export function getDashboardSummary(_filters: SalesAnalyticsFilters = {}) {
  return {};
}
