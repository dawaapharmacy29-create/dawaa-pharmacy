import { supabase } from '@/lib/supabase';
import { branchMatches } from '@/lib/branch';
import { cacheGet, cacheSet, invoiceCacheKey } from '@/lib/invoiceCache';
import { getInvoiceBranch } from '@/lib/invoices/invoiceCore';

export const INVOICE_SELECT_KPI =
  'sale_date, invoice_date, net_total, net_amount, discounted_amount, total_amount, amount, gross_total, gross_amount, branch, branch_name, seller_name, normalized_seller_name, staff_name, customer_code';

export const INVOICE_SELECT_STAFF =
  'id, invoice_number, invoice_no, sale_date, invoice_date, net_total, net_amount, discounted_amount, amount, gross_total, gross_amount, total_amount, ' +
  'branch, branch_name, seller_name, normalized_seller_name, staff_name, customer_code, customer_phone, customer_name, ' +
  'invoice_type, shift';

export const INVOICE_SELECT_FULL =
  'id, invoice_number, invoice_no, sale_date, invoice_date, net_total, net_amount, discounted_amount, amount, gross_total, gross_amount, total_amount, ' +
  'branch, branch_name, seller_name, normalized_seller_name, staff_name, customer_code, customer_phone, customer_name, ' +
  'customer_address, customer_segment, customer_type, invoice_type, invoice_category, shift, customer_id';

export const INVOICE_SELECT_CUSTOMER =
  'id, invoice_number, invoice_no, sale_date, invoice_date, net_total, net_amount, discounted_amount, amount, gross_total, gross_amount, total_amount, ' +
  'customer_name, customer_code, customer_phone, branch, branch_name, seller_name, normalized_seller_name, staff_name, invoice_type';

export const INVOICE_SELECT_TRUTH_OPTIONS = [
  'id,invoice_no,invoice_number,sale_date,invoice_date,branch,branch_name,net_total,net_amount,discounted_amount,amount,gross_total,gross_amount,total_amount,customer_code,customer_name,seller_name,normalized_seller_name,staff_name,status,save_status',
  'id,invoice_no,invoice_number,sale_date,invoice_date,branch,branch_name,net_amount,discounted_amount,amount,gross_amount,total_amount,customer_code,customer_name,seller_name,staff_name',
  'id,invoice_no,invoice_number,invoice_date,branch,discounted_amount,amount,gross_amount,total_amount,customer_code,customer_name,seller_name',
  'id,invoice_no,invoice_number,invoice_date,branch,amount,gross_amount,total_amount,customer_code,customer_name,seller_name',
  'id,invoice_date,branch,amount,total_amount,customer_code,customer_name,seller_name',
];

export type SalesInvoiceQueryRow = Record<string, unknown>;

type PageResult = { data: SalesInvoiceQueryRow[]; error: Error | null };

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_MAX_PAGES = 500;
const PARALLEL_BATCH = 5;
const PAGE_TIMEOUT_MS = 15000;
const PAGE_RETRIES = 2;
const lastGoodResults = new Map<string, SalesInvoiceQueryRow[]>();
const inFlightLoads = new Map<string, Promise<SalesInvoiceQueryRow[]>>();

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function nextDay(dateText: string) {
  const date = new Date(`${dateText}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isAllBranchesSelection(branch?: string) {
  const raw = String(branch || '').trim().toLowerCase();
  return !raw || raw === 'all' || raw.includes('كل');
}

function isSchemaError(error: Error | null) {
  if (!error) return false;
  const message = String(error.message || '').toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('column') && message.includes('not found') ||
    message.includes('pgrst204') ||
    message.includes('42703') ||
    message.includes('schema cache')
  );
}

function withTimeout<T>(promise: PromiseLike<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    Promise.resolve(promise).then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

async function fetchOnePageOnce(
  page: number,
  selectField: string,
  startDate: string,
  endDate: string,
  pageSize: number,
): Promise<PageResult> {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  const endExclusive = nextDay(endDate);
  const result = await withTimeout(
    supabase
      .from('sales_invoices')
      .select(selectField)
      .gte('invoice_date', startDate)
      .lt('invoice_date', endExclusive)
      .order('invoice_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
    PAGE_TIMEOUT_MS,
    `sales_invoices page ${page}`,
  );
  return {
    data: (result.data || []) as unknown as SalesInvoiceQueryRow[],
    error: result.error as Error | null,
  };
}

async function fetchOnePage(
  page: number,
  selectField: string,
  startDate: string,
  endDate: string,
  pageSize: number,
): Promise<PageResult> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= PAGE_RETRIES; attempt += 1) {
    try {
      const result = await fetchOnePageOnce(page, selectField, startDate, endDate, pageSize);
      if (!result.error) return result;
      lastError = result.error;
      if (isSchemaError(lastError)) break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (isSchemaError(lastError)) break;
    }
    if (attempt < PAGE_RETRIES) await sleep(250 * 2 ** attempt);
  }
  return { data: [], error: lastError || new Error(`تعذر تحميل صفحة الفواتير ${page}`) };
}

async function loadSalesInvoicesPaged(options: {
  startDate: string;
  endDate: string;
  branch?: string;
  selectOptions?: string[];
  errors?: string[];
  pageSize?: number;
  maxPages?: number;
  noCache?: boolean;
}, cacheKey: string): Promise<SalesInvoiceQueryRow[]> {
  const errors = options.errors || [];
  const pageSize = options.pageSize || DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages || DEFAULT_MAX_PAGES;
  const selects = options.selectOptions?.length ? options.selectOptions : INVOICE_SELECT_TRUTH_OPTIONS;
  const allBranches = isAllBranchesSelection(options.branch);

  const filterRow = (row: SalesInvoiceQueryRow) =>
    allBranches || branchMatches(options.branch || '', getInvoiceBranch(row));

  let selectIndex = 0;
  let page0result = await fetchOnePage(0, selects[selectIndex], options.startDate, options.endDate, pageSize);
  while (page0result.error && selectIndex < selects.length - 1) {
    selectIndex += 1;
    page0result = await fetchOnePage(0, selects[selectIndex], options.startDate, options.endDate, pageSize);
  }

  if (page0result.error) {
    errors.push(`sales_invoices: ${page0result.error.message}`);
    const fallback = lastGoodResults.get(cacheKey) || cacheGet<SalesInvoiceQueryRow[]>(cacheKey);
    if (fallback?.length) return fallback;
    throw page0result.error;
  }

  const rows: SalesInvoiceQueryRow[] = page0result.data.filter(filterRow);
  if (page0result.data.length < pageSize) {
    cacheSet(cacheKey, rows);
    lastGoodResults.set(cacheKey, rows);
    return rows;
  }

  const workingSelect = selects[selectIndex];
  let batchStart = 1;
  let completed = false;

  while (batchStart < maxPages && !completed) {
    const batchEnd = Math.min(batchStart + PARALLEL_BATCH, maxPages);
    const pageNumbers = Array.from({ length: batchEnd - batchStart }, (_, index) => batchStart + index);
    const batchResults = await Promise.all(
      pageNumbers.map((page) => fetchOnePage(page, workingSelect, options.startDate, options.endDate, pageSize)),
    );

    for (let index = 0; index < batchResults.length; index += 1) {
      const result = batchResults[index];
      const page = pageNumbers[index];
      if (result.error) {
        errors.push(`sales_invoices page ${page}: ${result.error.message}`);
        const fallback = lastGoodResults.get(cacheKey) || cacheGet<SalesInvoiceQueryRow[]>(cacheKey);
        if (fallback?.length) return fallback;
        throw result.error;
      }
      rows.push(...result.data.filter(filterRow));
      if (result.data.length < pageSize) {
        completed = true;
        break;
      }
    }
    batchStart = batchEnd;
  }

  if (!completed && batchStart >= maxPages) {
    const error = new Error(`تم الوصول للحد الأقصى لصفحات الفواتير (${maxPages}) قبل اكتمال التحميل`);
    errors.push(error.message);
    const fallback = lastGoodResults.get(cacheKey) || cacheGet<SalesInvoiceQueryRow[]>(cacheKey);
    if (fallback?.length) return fallback;
    throw error;
  }

  cacheSet(cacheKey, rows);
  lastGoodResults.set(cacheKey, rows);
  return rows;
}

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
  const cacheKey = invoiceCacheKey(options.startDate, options.endDate, options.branch || '');

  if (!options.noCache) {
    const cached = cacheGet<SalesInvoiceQueryRow[]>(cacheKey);
    if (cached?.length) return cached;
  }

  const existingLoad = inFlightLoads.get(cacheKey);
  if (existingLoad) return existingLoad;

  const loadPromise = loadSalesInvoicesPaged(options, cacheKey).finally(() => {
    if (inFlightLoads.get(cacheKey) === loadPromise) inFlightLoads.delete(cacheKey);
  });
  inFlightLoads.set(cacheKey, loadPromise);
  return loadPromise;
}

export function invoicesByDateRange(start: string, end: string, fields = INVOICE_SELECT_KPI) {
  return supabase.from('sales_invoices').select(fields).gte('invoice_date', start).lte('invoice_date', end);
}

export function invoicesByBranchAndDate(branch: string, start: string, end: string, fields = INVOICE_SELECT_KPI) {
  const query = invoicesByDateRange(start, end, fields);
  return branch && branch !== 'all' ? query.eq('branch', branch) : query;
}

export function invoicesBySellerNames(
  sellerNames: string[],
  start: string,
  end: string,
  fields = INVOICE_SELECT_STAFF,
  limit = 5000,
) {
  if (!sellerNames.length) return supabase.from('sales_invoices').select(fields).limit(0);
  return supabase
    .from('sales_invoices')
    .select(fields)
    .in('seller_name', sellerNames)
    .gte('invoice_date', start)
    .lte('invoice_date', end)
    .limit(limit);
}

export async function countInvoicesBySeller(sellerName: string, start: string, end: string): Promise<number> {
  const { count, error } = await supabase
    .from('sales_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('seller_name', sellerName)
    .gte('invoice_date', start)
    .lte('invoice_date', end);
  if (error) return 0;
  return count ?? 0;
}
