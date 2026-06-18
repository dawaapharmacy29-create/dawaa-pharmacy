/**
 * salesInvoiceQueries.ts
 * ────────────────────────────────────────────────────────────────────────────
 * Optimized query builders for sales_invoices table.
 * Always use these instead of raw .from("sales_invoices") calls.
 *
 * Performance features:
 *  - SessionStorage cache (5-min TTL) for repeat loads
 *  - Parallel page batching (4 pages simultaneously vs sequential)
 *  - Consistent field projection (no select('*') overfetching)
 *  - Built-in date range helpers
 */

import { supabase } from "@/lib/supabase";
import { branchMatches } from "@/lib/branch";
import { cacheGet, cacheSet, invoiceCacheKey } from "@/lib/invoiceCache";

// ─── Field sets for different use cases ──────────────────────────────────────

/** Minimal fields for dashboard KPIs */
export const INVOICE_SELECT_KPI =
  "invoice_date, net_amount, discounted_amount, amount, gross_amount, total_amount, branch, seller_name, customer_code";

/** Fields needed for staff performance matching */
export const INVOICE_SELECT_STAFF =
  "id, invoice_number, invoice_no, invoice_date, net_amount, discounted_amount, amount, gross_amount, total_amount, " +
  "branch, seller_name, customer_code, customer_phone, customer_name, " +
  "invoice_type, shift";

/** Full fields including optional columns */
export const INVOICE_SELECT_FULL =
  "id, invoice_number, invoice_no, invoice_date, net_amount, discounted_amount, amount, gross_amount, total_amount, " +
  "branch, seller_name, customer_code, customer_phone, customer_name, " +
  "customer_address, customer_segment, customer_type, invoice_type, invoice_category, shift, " +
  "customer_id";

/** Fields for customer-specific queries */
export const INVOICE_SELECT_CUSTOMER =
  "id, invoice_number, invoice_no, invoice_date, net_amount, discounted_amount, amount, gross_amount, total_amount, " +
  "customer_name, customer_code, customer_phone, branch, seller_name, invoice_type";

export const INVOICE_SELECT_TRUTH_OPTIONS = [
  "id,invoice_no,invoice_number,invoice_date,branch,net_amount,discounted_amount,amount,gross_amount,total_amount,customer_code,customer_name,seller_name",
  "id,invoice_no,invoice_number,invoice_date,branch,discounted_amount,amount,gross_amount,total_amount,customer_code,customer_name,seller_name",
  "id,invoice_no,invoice_number,invoice_date,branch,amount,gross_amount,total_amount,customer_code,customer_name,seller_name",
  "id,invoice_date,branch,amount,total_amount,customer_code,customer_name,seller_name",
];

export type SalesInvoiceQueryRow = Record<string, unknown>;

function nextDay(dateText: string) {
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isAllBranchesSelection(branch?: string) {
  const raw = String(branch || "").trim().toLowerCase();
  return !raw || raw === "all" || raw.includes("كل");
}

// ─── Single-page fetcher (shared across serial and parallel paths) ───────────

async function fetchOnePage(
  page: number,
  selectField: string,
  startDate: string,
  endDate: string,
  pageSize: number
): Promise<{ data: SalesInvoiceQueryRow[]; error: Error | null }> {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const endExclusive = nextDay(endDate);
  const result = await supabase
    .from("sales_invoices")
    .select(selectField)
    .gte("invoice_date", startDate)
    .lt("invoice_date", endExclusive)
    .order("invoice_date", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to);
  return {
    data: (result.data || []) as unknown as SalesInvoiceQueryRow[],
    error: result.error as Error | null,
  };
}

// ─── Main paginated fetcher (cached + parallel) ───────────────────────────────

/**
 * Fetches all sales invoices in a date range with:
 * - SessionStorage caching (5-min TTL) for repeat tab loads
 * - Parallel batch fetching (4 pages at a time) instead of sequential
 * - Automatic column-set fallback if a column doesn't exist
 *
 * Pass `noCache: true` to bypass cache (e.g. after user clicks Refresh).
 */
export async function fetchSalesInvoicesPagedSafe(options: {
  startDate: string;
  endDate: string;
  branch?: string;
  selectOptions?: string[];
  errors?: string[];
  pageSize?: number;
  maxPages?: number;
  noCache?: boolean;
}) {
  const errors = options.errors || [];
  const pageSize = options.pageSize || 1000;
  const maxPages = options.maxPages || 500;
  const selects = options.selectOptions?.length ? options.selectOptions : INVOICE_SELECT_TRUTH_OPTIONS;
  const allBranches = isAllBranchesSelection(options.branch);
  const PARALLEL_BATCH = 4;

  // ── Cache check ────────────────────────────────────────────────────────────
  const cacheKey = invoiceCacheKey(options.startDate, options.endDate, options.branch || "");
  if (!options.noCache) {
    const cached = cacheGet<SalesInvoiceQueryRow[]>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const rows: SalesInvoiceQueryRow[] = [];

  // ── Determine working selectIndex from page 0 ─────────────────────────────
  let selectIndex = 0;
  let page0result = await fetchOnePage(0, selects[selectIndex], options.startDate, options.endDate, pageSize);

  while (page0result.error && selectIndex < selects.length - 1) {
    selectIndex += 1;
    page0result = await fetchOnePage(0, selects[selectIndex], options.startDate, options.endDate, pageSize);
  }

  if (page0result.error) {
    errors.push(`sales_invoices: ${page0result.error.message}`);
    return rows;
  }

  const filterRow = (row: SalesInvoiceQueryRow) => allBranches || branchMatches(options.branch || "", row.branch);
  rows.push(...page0result.data.filter(filterRow));

  // ── If page 0 wasn't full, we have everything ─────────────────────────────
  if (page0result.data.length < pageSize) {
    cacheSet(cacheKey, rows);
    return rows;
  }

  // ── Parallel batch fetching for remaining pages ───────────────────────────
  const workingSelect = selects[selectIndex];
  let batchStart = 1;

  while (batchStart < maxPages) {
    const batchEnd = Math.min(batchStart + PARALLEL_BATCH, maxPages);
    const pagePromises: Promise<{ data: SalesInvoiceQueryRow[]; error: Error | null }>[] = [];

    for (let p = batchStart; p < batchEnd; p++) {
      pagePromises.push(fetchOnePage(p, workingSelect, options.startDate, options.endDate, pageSize));
    }

    const batchResults = await Promise.all(pagePromises);
    let allDone = false;

    for (const result of batchResults) {
      if (result.error) {
        errors.push(`sales_invoices page: ${result.error.message}`);
        allDone = true;
        break;
      }
      rows.push(...result.data.filter(filterRow));
      if (result.data.length < pageSize) {
        allDone = true;
        break;
      }
    }

    if (allDone) break;
    batchStart = batchEnd;
  }

  cacheSet(cacheKey, rows);
  return rows;
}

// ─── Query builders ───────────────────────────────────────────────────────────

/**
 * Build a date-filtered invoices query.
 * @param start - ISO date string (inclusive)
 * @param end   - ISO date string (inclusive)
 * @param fields - Select projection (use INVOICE_SELECT_* constants)
 */
export function invoicesByDateRange(start: string, end: string, fields = INVOICE_SELECT_KPI) {
  return supabase
    .from("sales_invoices")
    .select(fields)
    .gte("invoice_date", start)
    .lte("invoice_date", end);
}

/**
 * Build a branch + date filtered query.
 */
export function invoicesByBranchAndDate(
  branch: string,
  start: string,
  end: string,
  fields = INVOICE_SELECT_KPI
) {
  const q = invoicesByDateRange(start, end, fields);
  return branch && branch !== "all" ? q.eq("branch", branch) : q;
}

/**
 * Build a seller-name filtered query.
 */
export function invoicesBySellerNames(
  sellerNames: string[],
  start: string,
  end: string,
  fields = INVOICE_SELECT_STAFF,
  limit = 5000
) {
  if (sellerNames.length === 0) {
    return supabase.from("sales_invoices").select(fields).limit(0);
  }
  return supabase
    .from("sales_invoices")
    .select(fields)
    .in("seller_name", sellerNames)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .limit(limit);
}

/**
 * Count invoices for a seller in a period (lightweight — no data transfer).
 */
export async function countInvoicesBySeller(
  sellerName: string,
  start: string,
  end: string
): Promise<number> {
  const { count, error } = await supabase
    .from("sales_invoices")
    .select("id", { count: "exact", head: true })
    .eq("seller_name", sellerName)
    .gte("invoice_date", start)
    .lte("invoice_date", end);

  if (error) return 0;
  return count ?? 0;
}
