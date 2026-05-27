/**
 * Sales Invoice Repository
 * مركزي لجلب فواتير المبيعات مع التصفح الصحيح (Pagination)
 * يحل مشكلة limit الافتراضي في Supabase
 */

import { supabase } from "@/lib/supabase";
import type { SalesInvoiceRow } from "@/lib/analyticsFromInvoices";

export interface SalesInvoiceFilters {
  startDate?: string;
  endDate?: string;
  branch?: string;
  shift_name?: string;
  seller_name?: string;
  invoice_type?: string;
}

export interface FetchAllSalesInvoicesResult {
  invoices: SalesInvoiceRow[];
  rowsFetched: number;
  error: string | null;
}

const PAGE_SIZE = 1000;
const MAX_ROWS = 200000; // Safety limit to prevent infinite loops

/**
 * جلب جميع فواتير المبيعات مع التصفح الصحيح
 * يستخدم .range() للتأكد من جلب كل الصفوف وليس فقط أول 1000
 */
export async function fetchAllSalesInvoices(
  filters: SalesInvoiceFilters = {}
): Promise<FetchAllSalesInvoicesResult> {
  try {
    const allInvoices: SalesInvoiceRow[] = [];
    let from = 0;
    let hasMore = true;
    let totalRowsFetched = 0;

    while (hasMore && totalRowsFetched < MAX_ROWS) {
      const to = Math.min(from + PAGE_SIZE - 1, MAX_ROWS - 1);

      let query = supabase
        .from("sales_invoices")
        .select("*");

      // Apply date filters at query level
      if (filters.startDate) {
        query = query.gte("invoice_date", filters.startDate);
      }
      if (filters.endDate) {
        const dayAfter = new Date(filters.endDate);
        dayAfter.setDate(dayAfter.getDate() + 1);
        query = query.lt("invoice_date", dayAfter.toISOString().slice(0, 10));
      }

      // Apply other filters at query level
      if (filters.branch) {
        query = query.eq("branch", filters.branch);
      }
      if (filters.shift_name) {
        query = query.eq("shift_name", filters.shift_name);
      }
      if (filters.seller_name) {
        query = query.eq("seller_name", filters.seller_name);
      }
      if (filters.invoice_type) {
        query = query.eq("invoice_type", filters.invoice_type);
      }

      // Use range for pagination
      query = query.range(from, to);

      // Order by date for consistency
      query = query.order("invoice_date", { ascending: false });

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching sales invoices:", error);
        return {
          invoices: allInvoices,
          rowsFetched: totalRowsFetched,
          error: error.message,
        };
      }

      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }

      allInvoices.push(...(data as SalesInvoiceRow[]));
      totalRowsFetched += data.length;

      // If we got fewer rows than PAGE_SIZE, we've reached the end
      if (data.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        from += PAGE_SIZE;
      }
    }

    console.log(`fetchAllSalesInvoices: Fetched ${totalRowsFetched} rows with filters:`, filters);

    return {
      invoices: allInvoices,
      rowsFetched: totalRowsFetched,
      error: null,
    };
  } catch (error) {
    console.error("Exception in fetchAllSalesInvoices:", error);
    return {
      invoices: [],
      rowsFetched: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * جلب جميع فواتير المبيعات بدون فلاتر (للاستخدام عند الحاجة لكل البيانات)
 */
export async function fetchAllSalesInvoicesUnfiltered(): Promise<FetchAllSalesInvoicesResult> {
  return fetchAllSalesInvoices({});
}

/**
 * حساب إجمالي المبيعات من الفواتير
 * يستخدم net_amount ?? amount ?? gross_amount
 */
export function calculateNetTotal(invoices: SalesInvoiceRow[]): number {
  return invoices.reduce((sum, invoice) => {
    const value = invoice.net_amount ?? invoice.amount ?? invoice.gross_amount ?? 0;
    return sum + (typeof value === "number" ? value : parseFloat(String(value)) || 0);
  }, 0);
}

/**
 * حساب إجمالي gross_amount
 */
export function calculateGrossTotal(invoices: SalesInvoiceRow[]): number {
  return invoices.reduce((sum, invoice) => {
    const value = invoice.gross_amount ?? 0;
    return sum + (typeof value === "number" ? value : parseFloat(String(value)) || 0);
  }, 0);
}

/**
 * حساب إجمالي amount
 */
export function calculateAmountTotal(invoices: SalesInvoiceRow[]): number {
  return invoices.reduce((sum, invoice) => {
    const value = invoice.amount ?? 0;
    return sum + (typeof value === "number" ? value : parseFloat(String(value)) || 0);
  }, 0);
}

/**
 * حساب عدد العملاء الفريدين
 */
export function calculateUniqueCustomers(invoices: SalesInvoiceRow[]): number {
  const customers = new Set(
    invoices
      .map((inv) => inv.customer_code || inv.customer_name || inv.customer_phone)
      .filter(Boolean)
  );
  return customers.size;
}

/**
 * الحصول على معلومات تشخيصية للفواتير
 */
export interface SalesInvoiceDiagnostics {
  rows_fetched_from_supabase: number;
  invoices_count_after_filters: number;
  first_invoice: string | null;
  last_invoice: string | null;
  net_total: number;
  gross_total: number;
  amount_total: number;
  current_filters: SalesInvoiceFilters;
}

export function getSalesInvoiceDiagnostics(
  invoices: SalesInvoiceRow[],
  filters: SalesInvoiceFilters,
  rowsFetched: number
): SalesInvoiceDiagnostics {
  const dates = invoices
    .map((inv) => inv.invoice_date?.slice(0, 10))
    .filter(Boolean)
    .sort();

  return {
    rows_fetched_from_supabase: rowsFetched,
    invoices_count_after_filters: invoices.length,
    first_invoice: dates[0] || null,
    last_invoice: dates[dates.length - 1] || null,
    net_total: calculateNetTotal(invoices),
    gross_total: calculateGrossTotal(invoices),
    amount_total: calculateAmountTotal(invoices),
    current_filters: filters,
  };
}
