import { supabase } from "@/lib/supabase";
import { fetchAllSalesInvoices, type SalesInvoiceFilters } from "@/lib/salesInvoiceRepository";

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
  let text = String(value).trim();
  if (!text) return 0;
  text = text
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬،]/g, "")
    .replace(/جنيه|ج\.م|egp|EGP/gi, "")
    .replace(/[^0-9.\-]/g, "");
  const parts = text.split(".");
  if (parts.length > 2) {
    text = parts.slice(0, -1).join("") + "." + parts.at(-1);
  }
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

export function getSalesValue(row: SalesInvoiceLike | any) {
  // صافي المبيعات الصحيح في sales_invoices: net_amount ثم amount ثم gross_amount.
  // لا تستخدم total_amount لأنه غير موجود في جدول Supabase الحالي.
  return firstNumericValue(row, ["net_amount", "amount", "gross_amount", "discounted_amount", "invoice_total", "total", "value", "invoice_value"]);
}

export function getGrossSalesValue(row: SalesInvoiceLike) {
  // إجمالي قبل الخصم إن وجد، وإلا نرجع للصافي/amount حتى لا تظهر صفر.
  return firstNumericValue(row, ["gross_amount", "amount", "net_amount", "discounted_amount", "invoice_total", "total"]);
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
  // Use the new centralized function with pagination
  const result = await fetchAllSalesInvoices({});
  if (result.error) {
    throw new Error(result.error);
  }
  return result.invoices as SalesInvoiceLike[];
}

export async function getSalesTotals(filters: SalesAnalyticsFilters = {}) {
  const rows = await fetchSalesInvoicesForAnalytics();
  return getSalesTotalsFromRows(rows, filters);
}

export function getSalesOverview(filters: SalesAnalyticsFilters = {}) {
  return {
    // يمكن إضافة منطق إضافي هنا
  };
}

export function getShiftAnalysis(filters: SalesAnalyticsFilters = {}) {
  return {
    // يمكن إضافة منطق إضافي هنا
  };
}

export function getDoctorAnalysis(filters: SalesAnalyticsFilters = {}) {
  return {
    // يمكن إضافة منطق إضافي هنا
  };
}

export function getCustomerAnalysis(filters: SalesAnalyticsFilters = {}) {
  return {
    // يمكن إضافة منطق إضافي هنا
  };
}

export function getDashboardSummary(filters: SalesAnalyticsFilters = {}) {
  return {
    // يمكن إضافة منطق إضافي هنا
  };
}
