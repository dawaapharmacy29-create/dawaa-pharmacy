import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  getBestCustomerPhone,
  isPseudoCustomer,
  isUuidLike,
  isValidEgyptPhone,
  normalizeCustomerSegment,
  normalizeCustomerStatus,
} from '@/lib/customerAnalyticsService';
import { normalizeBranchName } from '@/lib/branch';
import { getInvoiceKey } from '@/lib/dawaa2027';
import type {
  CustomerMetric,
  CustomerFollowupSummary,
  CustomerInvoiceSummary,
  PurchaseAnalysis,
} from '@/lib/api/customers';

type Row = Record<string, unknown>;

export type CustomerFullProfileParams = {
  customer_code?: string | null;
  customer_id?: string | null;
  final_customer_key?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  signal?: AbortSignal;
  forceRefresh?: boolean;
};

export type CustomerProfileNotes = {
  customerNotes: string | null;
  whatsappNotes: string | null;
  serviceNotes: string | null;
  teamNotes: string | null;
  handlingNotes: string | null;
  notes: string | null;
  address: string | null;
  phoneAlt: string | null;
  whatsappPhone: string | null;
};

export type MonthlyPurchaseTrendRow = {
  month: string;
  invoicesCount: number;
  netTotal: number;
  avgInvoice: number;
};

export type CustomerProfileMatchBy = 'code' | 'phone' | 'phoneTail' | 'name' | 'mixed' | 'none';

export type CustomerProfileInvoiceSource =
  | 'sales_invoices'
  | 'customer_metrics_summary'
  | 'mixed';

export type CustomerProfileDataHealth = {
  hasMetrics: boolean;
  hasCustomerRecord: boolean;
  hasValidPhone: boolean;
  isPseudoCustomer: boolean;
  invoicesLoaded: boolean;
  followupsLoaded: boolean;
  missingCustomerCode: boolean;
  matchedBy?: CustomerProfileMatchBy;
  invoicesMatchedCount?: number;
  invoiceSourceUsed?: CustomerProfileInvoiceSource;
  metricsFallbackUsed?: boolean;
  branchMostFrequent?: string | null;
  branchHighestValue?: string | null;
  branchLastPurchase?: string | null;
};

export type CustomerFullProfile = {
  profile: Row | null;
  metrics: CustomerMetric | null;
  flags: Record<string, boolean> | null;
  notes: CustomerProfileNotes;
  latestInvoices: CustomerInvoiceSummary[];
  latestFollowups: CustomerFollowupSummary[];
  monthlyPurchaseTrend: MonthlyPurchaseTrendRow[];
  purchaseAnalysis: PurchaseAnalysis | null;
  recommendations: string[];
  dataHealth: CustomerProfileDataHealth;
  errorsBySection: Record<string, string>;
  displayPhone: string | null;
};

const profileCache = new Map<string, CustomerFullProfile>();

export function normalizeCustomerCode(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw || isUuidLike(raw)) return '';
  return raw.replace(/^code:/i, '').trim();
}

export function normalizeCustomerKey(value: unknown) {
  return String(value ?? '').trim();
}

export function normalizePhone(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.toLowerCase().startsWith('code:')) return '';
  const digits = raw
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[^\d]/g, '')
    .replace(/^0020/, '0')
    .replace(/^20(?=1\d{9}$)/, '0');
  return digits;
}

export function safeNumber(value: unknown, fallback = 0) {
  const numeric = Number(value ?? fallback);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function formatCurrencyEGP(value: unknown) {
  return `${safeNumber(value).toLocaleString('ar-EG', { maximumFractionDigits: 0 })} جنيه`;
}

export function formatDateArabic(value: unknown) {
  if (!value) return 'غير محدد';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return date.toLocaleDateString('ar-EG');
}

function friendlyError(message: unknown) {
  const value = String(message || '').toLowerCase();
  if (value.includes('timeout')) return 'استغرق تحميل هذا الجزء وقتًا طويلًا';
  if (value.includes('does not exist') || value.includes('not found'))
    return 'مصدر هذا الجزء غير متاح';
  if (value.includes('permission denied')) return 'لا توجد صلاحية لقراءة هذا الجزء';
  return 'تعذر تحميل هذا الجزء الآن';
}

function readFirst(row: Row | null | undefined, keys: string[], fallback: unknown = null) {
  if (!row) return fallback;
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

const INVOICE_AMOUNT_KEYS = [
  'net_total',
  'net_amount',
  'discounted_amount',
  'amount',
  'gross_amount',
  'total_amount',
  'total',
] as const;

const INVOICE_DATE_KEYS = ['invoice_date', 'invoice_datetime', 'created_at'] as const;

const INVOICE_BRANCH_KEYS = ['branch', 'branch_name', 'store_branch'] as const;

const INVOICE_SELECT_OPTIONS = [
  'id,invoice_no,invoice_number,invoice_date,invoice_datetime,created_at,net_total,net_amount,discounted_amount,amount,gross_amount,total_amount,total,seller_name,branch,branch_name,store_branch,customer_code,customer_id,customer_phone,phone,customer_name,name',
  'id,invoice_no,invoice_number,invoice_date,created_at,net_amount,discounted_amount,amount,gross_amount,total_amount,branch,seller_name,customer_code,customer_phone,customer_name',
  'id,invoice_no,invoice_number,invoice_date,created_at,amount,total_amount,branch,seller_name,customer_code,customer_name',
  'id,invoice_date,amount,total_amount,branch,customer_code,customer_name,seller_name',
] as const;

const FALLBACK_SCAN_LIMIT = 5000;

type InvoiceMatchStrategy = 'code' | 'phone' | 'phoneTail' | 'name' | 'id';

type InvoiceFetchResult = {
  rows: Row[];
  matchedStrategies: InvoiceMatchStrategy[];
  selectUsed: string;
  successfulStrategies: InvoiceMatchStrategy[];
  failedStrategies: InvoiceMatchStrategy[];
  fallbackScanUsed: boolean;
};

function columnListHas(selectText: string, columnName: string) {
  return selectText
    .split(',')
    .map((column) => column.trim())
    .includes(columnName);
}

function readInvoiceRowCode(row: Row) {
  return normalizeCustomerCode(readFirst(row, ['customer_code'], ''));
}

function readInvoiceRowPhone(row: Row) {
  return normalizePhone(readFirst(row, ['customer_phone', 'phone'], ''));
}

function readInvoiceRowName(row: Row) {
  return sanitizeIlikeValue(String(readFirst(row, ['customer_name', 'name'], '') || ''));
}

function rowMatchesCustomer(row: Row, match: ReturnType<typeof resolveMatchParams>) {
  const { code, phone, phoneTail, name } = match;
  const rowCode = readInvoiceRowCode(row);
  if (code && rowCode && rowCode === code) return true;

  const rowPhone = readInvoiceRowPhone(row);
  if (phone && rowPhone && rowPhone === phone) return true;
  if (phoneTail && rowPhone.length >= 10 && rowPhone.slice(-10) === phoneTail) return true;

  const rowName = readInvoiceRowName(row);
  if (name.length >= 3 && rowName.includes(name)) return true;

  return false;
}

async function resolveInvoiceSelect(signal?: AbortSignal): Promise<string> {
  for (const selectText of INVOICE_SELECT_OPTIONS) {
    const { error } = await withAbort(
      supabase.from('sales_invoices').select(selectText).limit(1),
      signal
    );
    if (!error) return selectText;
  }
  return INVOICE_SELECT_OPTIONS[INVOICE_SELECT_OPTIONS.length - 1];
}

function buildClausesForStrategy(
  selectText: string,
  strategy: InvoiceMatchStrategy,
  match: ReturnType<typeof resolveMatchParams>
): string | null {
  const { code, phone, phoneTail, customerId, name } = match;
  if (strategy === 'code') {
    return code && columnListHas(selectText, 'customer_code') ? `customer_code.eq.${code}` : null;
  }
  if (strategy === 'phone') {
    const parts: string[] = [];
    if (phone && columnListHas(selectText, 'customer_phone')) parts.push(`customer_phone.eq.${phone}`);
    if (phone && columnListHas(selectText, 'phone')) parts.push(`phone.eq.${phone}`);
    return parts.length ? parts.join(',') : null;
  }
  if (strategy === 'phoneTail') {
    const parts: string[] = [];
    if (phoneTail && columnListHas(selectText, 'customer_phone')) {
      parts.push(`customer_phone.ilike.%${phoneTail}%`);
    }
    if (phoneTail && columnListHas(selectText, 'phone')) parts.push(`phone.ilike.%${phoneTail}%`);
    return parts.length ? parts.join(',') : null;
  }
  if (strategy === 'id') {
    return customerId && isUuidLike(customerId) && columnListHas(selectText, 'customer_id')
      ? `customer_id.eq.${customerId}`
      : null;
  }
  if (strategy === 'name') {
    const parts: string[] = [];
    if (name.length >= 3 && columnListHas(selectText, 'customer_name')) {
      parts.push(`customer_name.ilike.%${name}%`);
    }
    if (name.length >= 3 && columnListHas(selectText, 'name')) parts.push(`name.ilike.%${name}%`);
    return parts.length ? parts.join(',') : null;
  }
  return null;
}

function buildAvailableStrategies(
  selectText: string,
  match: ReturnType<typeof resolveMatchParams>
): Array<{ strategy: InvoiceMatchStrategy; clauses: string }> {
  const strategies: InvoiceMatchStrategy[] = ['code', 'phone', 'phoneTail', 'id', 'name'];
  const queries: Array<{ strategy: InvoiceMatchStrategy; clauses: string }> = [];
  for (const strategy of strategies) {
    const clauses = buildClausesForStrategy(selectText, strategy, match);
    if (clauses) queries.push({ strategy, clauses });
  }
  return queries;
}

async function fallbackScanInvoices(
  selectText: string,
  match: ReturnType<typeof resolveMatchParams>,
  signal?: AbortSignal
): Promise<Row[]> {
  const orderColumn = columnListHas(selectText, 'invoice_date')
    ? 'invoice_date'
    : columnListHas(selectText, 'created_at')
      ? 'created_at'
      : null;
  let query = supabase.from('sales_invoices').select(selectText).limit(FALLBACK_SCAN_LIMIT);
  if (orderColumn) {
    query = query.order(orderColumn, { ascending: false });
  }
  const { data, error } = await withAbort(query, signal);
  if (error) throw error;
  return ((data ?? []) as Row[]).filter((row) => rowMatchesCustomer(row, match));
}

async function fetchCustomerInvoicesMultiMatch(
  params: CustomerFullProfileParams,
  metrics: CustomerMetric | null,
  profile: Row | null,
  errorsBySection: Record<string, string>,
  signal?: AbortSignal
): Promise<InvoiceFetchResult> {
  const match = resolveMatchParams(params, metrics, profile);
  const empty: InvoiceFetchResult = {
    rows: [],
    matchedStrategies: [],
    selectUsed: '',
    successfulStrategies: [],
    failedStrategies: [],
    fallbackScanUsed: false,
  };

  if (!match.code && !match.phone && !match.phoneTail && !match.name && !match.customerId) {
    errorsBySection.salesInvoicesDebug = 'لا توجد بيانات كافية لمطابقة الفواتير';
    return empty;
  }

  let selectUsed = '';
  try {
    selectUsed = await resolveInvoiceSelect(signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorsBySection.salesInvoicesDebug = friendlyError(message);
    selectUsed = INVOICE_SELECT_OPTIONS[INVOICE_SELECT_OPTIONS.length - 1];
  }

  errorsBySection.selectUsed = selectUsed;

  const queries = buildAvailableStrategies(selectUsed, match);
  const matchedStrategies: InvoiceMatchStrategy[] = [];
  const successfulStrategies: InvoiceMatchStrategy[] = [];
  const failedStrategies: InvoiceMatchStrategy[] = [];
  const byKey = new Map<string, Row>();

  await Promise.all(
    queries.map(async ({ strategy, clauses }) => {
      try {
        const { data, error } = await withAbort(
          supabase.from('sales_invoices').select(selectUsed).or(clauses),
          signal
        );
        if (error) throw error;
        const rows = (data ?? []) as Row[];
        successfulStrategies.push(strategy);
        if (rows.length) matchedStrategies.push(strategy);
        for (const row of rows) byKey.set(invoiceRowKey(row), row);
      } catch (error) {
        failedStrategies.push(strategy);
        const message = error instanceof Error ? error.message : String(error);
        errorsBySection[`invoices_${strategy}`] = friendlyError(message);
        if (import.meta.env.DEV) console.warn(`[customerProfileService.invoices_${strategy}]`, error);
      }
    })
  );

  let rows = [...byKey.values()];
  let fallbackScanUsed = false;

  if (!rows.length) {
    try {
      rows = await fallbackScanInvoices(selectUsed, match, signal);
      fallbackScanUsed = rows.length > 0;
      if (fallbackScanUsed) matchedStrategies.push('code');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorsBySection.invoices_fallbackScan = friendlyError(message);
      if (import.meta.env.DEV) console.warn('[customerProfileService.invoices_fallbackScan]', error);
    }
  }

  errorsBySection.successfulStrategies = successfulStrategies.join(',') || 'none';
  errorsBySection.failedStrategies = failedStrategies.join(',') || 'none';
  errorsBySection.fallbackScanUsed = String(fallbackScanUsed);
  errorsBySection.salesInvoicesDebug = [
    `select=${selectUsed.slice(0, 80)}...`,
    `matched=${rows.length}`,
    `strategies=${matchedStrategies.join(',') || 'none'}`,
    `fallback=${fallbackScanUsed}`,
  ].join(' | ');

  return {
    rows,
    matchedStrategies: [...new Set(matchedStrategies)],
    selectUsed,
    successfulStrategies,
    failedStrategies,
    fallbackScanUsed,
  };
}

function readInvoiceAmount(row: Row) {
  return safeNumber(readFirst(row, [...INVOICE_AMOUNT_KEYS], 0));
}

function readInvoiceDate(row: Row) {
  return String(readFirst(row, [...INVOICE_DATE_KEYS], '') || '');
}

function readInvoiceBranch(row: Row) {
  return normalizeBranchName(readFirst(row, [...INVOICE_BRANCH_KEYS], null));
}

function sanitizeIlikeValue(value: string) {
  return value.replace(/[,%.]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[%_]/g, '');
}

function invoiceRowKey(row: Row) {
  const id = String(readFirst(row, ['id'], '') || '').trim();
  if (id) return `id:${id}`;
  return `k:${getInvoiceKey(row)}|${readInvoiceDate(row)}|${readInvoiceAmount(row)}`;
}

function resolveMatchParams(
  params: CustomerFullProfileParams,
  metrics?: CustomerMetric | null,
  profile?: Row | null
) {
  const code = normalizeCustomerCode(
    params.customer_code || metrics?.customer_code || profile?.customer_code
  );
  const phone = normalizePhone(
    params.customer_phone ||
      metrics?.customer_phone ||
      profile?.phone ||
      profile?.whatsapp_phone ||
      profile?.phone_alt
  );
  const customerId = normalizeCustomerKey(
    params.customer_id || metrics?.customer_id || profile?.id
  );
  const name = sanitizeIlikeValue(
    normalizeCustomerKey(params.customer_name || metrics?.customer_name || profile?.name)
  );
  const phoneTail = phone.length >= 10 ? phone.slice(-10) : '';
  return { code, phone, phoneTail, customerId, name };
}


function summarizeMatchedBy(strategies: InvoiceMatchStrategy[]): CustomerProfileMatchBy {
  if (!strategies.length) return 'none';
  if (strategies.length === 1) {
    const only = strategies[0];
    if (only === 'id') return 'mixed';
    return only;
  }
  return 'mixed';
}

function isZeroMetrics(metrics: CustomerMetric | null) {
  if (!metrics) return true;
  return metrics.invoices_count === 0 && metrics.total_spent === 0;
}

function buildMetricsFromInvoices(
  rows: Row[],
  params: CustomerFullProfileParams,
  existing: CustomerMetric | null,
  profile: Row | null
): CustomerMetric {
  let totalSpent = 0;
  let firstPurchase: string | null = null;
  let lastPurchase: string | null = null;
  const months = new Set<string>();
  const branchCounts = new Map<string, number>();
  const branchTotals = new Map<string, number>();
  const datedRows: Array<{ date: string; branch: string | null; amount: number }> = [];

  for (const row of rows) {
    const amount = readInvoiceAmount(row);
    totalSpent += amount;
    const dateStr = readInvoiceDate(row);
    const branch = readInvoiceBranch(row);
    if (dateStr) {
      if (!firstPurchase || dateStr < firstPurchase) firstPurchase = dateStr;
      if (!lastPurchase || dateStr > lastPurchase) lastPurchase = dateStr;
      months.add(dateStr.slice(0, 7));
      datedRows.push({ date: dateStr, branch, amount });
    }
    if (branch) {
      branchCounts.set(branch, (branchCounts.get(branch) || 0) + 1);
      branchTotals.set(branch, (branchTotals.get(branch) || 0) + amount);
    }
  }

  const invoicesCount = rows.length;
  const avgInvoice = invoicesCount ? totalSpent / invoicesCount : 0;
  const activeMonths = months.size;
  const avgMonthly = activeMonths ? totalSpent / activeMonths : 0;

  let topBranch: string | null = null;
  let topCount = 0;
  for (const [branch, count] of branchCounts) {
    if (count > topCount) {
      topCount = count;
      topBranch = branch;
    }
  }

  let highestValueBranch: string | null = null;
  let highestValue = 0;
  for (const [branch, value] of branchTotals) {
    if (value > highestValue) {
      highestValue = value;
      highestValueBranch = branch;
    }
  }

  const lastPurchaseBranch =
    [...datedRows].sort((a, b) => b.date.localeCompare(a.date))[0]?.branch || null;

  const code = normalizeCustomerCode(
    params.customer_code || existing?.customer_code || profile?.customer_code
  );
  const phone = normalizePhone(
    params.customer_phone ||
      existing?.customer_phone ||
      profile?.phone ||
      profile?.whatsapp_phone ||
      profile?.phone_alt
  );
  const customerId = normalizeCustomerKey(
    params.customer_id || existing?.customer_id || profile?.id
  );
  const name = normalizeCustomerKey(
    params.customer_name || existing?.customer_name || profile?.name
  );
  const finalKey = existing?.final_customer_key || null;
  const segment = normalizeCustomerSegment(existing?.segment ?? null, totalSpent, avgMonthly);
  const status =
    invoicesCount <= 0 || !lastPurchase
      ? 'بدون شراء'
      : normalizeCustomerStatus(existing?.customer_status ?? null, lastPurchase, firstPurchase);

  const metric: CustomerMetric = {
    id: String(finalKey || customerId || code || phone || name || 'unknown'),
    final_customer_key: finalKey,
    customer_id: customerId || null,
    customer_code: code || null,
    customer_name: name || null,
    customer_phone: phone || null,
    phone: phone || null,
    name: name || null,
    branch:
      topBranch ||
      existing?.branch ||
      normalizeBranchName(readFirst(profile, ['branch'], null)),
    invoices_count: invoicesCount,
    total_spent: totalSpent,
    total_purchases: totalSpent,
    avg_invoice: avgInvoice,
    first_purchase: firstPurchase,
    last_purchase: lastPurchase,
    active_months: activeMonths,
    avg_monthly: avgMonthly,
    segment,
    type: segment,
    customer_status: status,
    status,
    retention_status: status,
  };

  (metric as CustomerMetric & { branch_highest_value?: string | null; branch_last_purchase?: string | null }).branch_highest_value =
    highestValueBranch;
  (metric as CustomerMetric & { branch_last_purchase?: string | null }).branch_last_purchase =
    lastPurchaseBranch;

  return metric;
}

function resolveFinalMetrics(
  summary: CustomerMetric | null,
  invoiceMetrics: CustomerMetric | null,
  invoiceCount: number
): {
  metrics: CustomerMetric | null;
  metricsFallbackUsed: boolean;
  invoiceSourceUsed: CustomerProfileInvoiceSource;
} {
  if (!invoiceCount || !invoiceMetrics) {
    return {
      metrics: summary,
      metricsFallbackUsed: false,
      invoiceSourceUsed: summary ? 'customer_metrics_summary' : 'sales_invoices',
    };
  }
  if (!summary || isZeroMetrics(summary)) {
    return {
      metrics: invoiceMetrics,
      metricsFallbackUsed: true,
      invoiceSourceUsed: 'sales_invoices',
    };
  }

  const summaryIncomplete =
    summary.invoices_count === 0 ||
    summary.total_spent === 0 ||
    !summary.last_purchase;

  if (summaryIncomplete) {
    const merged: CustomerMetric = {
      ...summary,
      invoices_count: invoiceMetrics.invoices_count,
      total_spent: invoiceMetrics.total_spent,
      total_purchases: invoiceMetrics.total_purchases,
      avg_invoice: invoiceMetrics.avg_invoice,
      first_purchase: summary.first_purchase || invoiceMetrics.first_purchase,
      last_purchase: summary.last_purchase || invoiceMetrics.last_purchase,
      active_months: invoiceMetrics.active_months || summary.active_months,
      avg_monthly: invoiceMetrics.avg_monthly || summary.avg_monthly,
      branch: summary.branch || invoiceMetrics.branch,
      segment: normalizeCustomerSegment(
        summary.segment,
        invoiceMetrics.total_spent,
        invoiceMetrics.avg_monthly || summary.avg_monthly
      ),
      type: normalizeCustomerSegment(
        summary.segment,
        invoiceMetrics.total_spent,
        invoiceMetrics.avg_monthly || summary.avg_monthly
      ),
      customer_status: normalizeCustomerStatus(
        summary.customer_status,
        invoiceMetrics.last_purchase || summary.last_purchase,
        invoiceMetrics.first_purchase || summary.first_purchase
      ),
      status: normalizeCustomerStatus(
        summary.customer_status,
        invoiceMetrics.last_purchase || summary.last_purchase,
        invoiceMetrics.first_purchase || summary.first_purchase
      ),
      retention_status: normalizeCustomerStatus(
        summary.customer_status,
        invoiceMetrics.last_purchase || summary.last_purchase,
        invoiceMetrics.first_purchase || summary.first_purchase
      ),
    };
    merged.type = merged.segment;
    merged.status = merged.customer_status;
    merged.retention_status = merged.customer_status;
    return {
      metrics: merged,
      metricsFallbackUsed: true,
      invoiceSourceUsed: 'mixed',
    };
  }

  if (
    invoiceMetrics.invoices_count > summary.invoices_count ||
    invoiceMetrics.total_spent > summary.total_spent
  ) {
    const merged: CustomerMetric = {
      ...summary,
      invoices_count: Math.max(summary.invoices_count, invoiceMetrics.invoices_count),
      total_spent: Math.max(summary.total_spent, invoiceMetrics.total_spent),
      total_purchases: Math.max(summary.total_purchases, invoiceMetrics.total_purchases),
      avg_invoice:
        Math.max(summary.invoices_count, invoiceMetrics.invoices_count) > 0
          ? Math.max(summary.total_spent, invoiceMetrics.total_spent) /
            Math.max(summary.invoices_count, invoiceMetrics.invoices_count)
          : summary.avg_invoice,
      last_purchase: summary.last_purchase || invoiceMetrics.last_purchase,
      first_purchase: summary.first_purchase || invoiceMetrics.first_purchase,
      active_months: Math.max(summary.active_months, invoiceMetrics.active_months),
      avg_monthly: invoiceMetrics.avg_monthly || summary.avg_monthly,
      branch: summary.branch || invoiceMetrics.branch,
    };
    return {
      metrics: merged,
      metricsFallbackUsed: true,
      invoiceSourceUsed: 'mixed',
    };
  }

  return {
    metrics: summary,
    metricsFallbackUsed: false,
    invoiceSourceUsed: 'customer_metrics_summary',
  };
}

function cacheKey(params: CustomerFullProfileParams) {
  return (
    [
      normalizeCustomerCode(params.customer_code),
      normalizeCustomerKey(params.customer_id),
      normalizeCustomerKey(params.final_customer_key),
      normalizePhone(params.customer_phone),
      normalizeCustomerKey(params.customer_name),
    ]
      .filter(Boolean)
      .join('|') || 'unknown'
  );
}

function withAbort<T>(query: T, signal?: AbortSignal): T {
  const maybe = query as any;
  if (signal && maybe && typeof maybe.abortSignal === 'function') return maybe.abortSignal(signal);
  return query;
}

function metricsOrClauses(params: CustomerFullProfileParams) {
  const { code, phone, phoneTail, customerId, name } = resolveMatchParams(params);
  const finalKey = normalizeCustomerKey(params.final_customer_key);
  return [
    code ? `customer_code.eq.${code}` : '',
    finalKey ? `final_customer_key.eq.${finalKey}` : '',
    customerId && isUuidLike(customerId) ? `customer_id.eq.${customerId}` : '',
    phone ? `customer_phone.eq.${phone}` : '',
    phoneTail ? `customer_phone.ilike.%${phoneTail}%` : '',
    name.length >= 3 ? `customer_name.ilike.%${name}%` : '',
  ]
    .filter(Boolean)
    .join(',');
}

function customerOrClauses(params: CustomerFullProfileParams, metrics?: CustomerMetric | null) {
  const { code, phone, phoneTail, customerId, name } = resolveMatchParams(params, metrics);
  return [
    code ? `customer_code.eq.${code}` : '',
    customerId && isUuidLike(customerId) ? `id.eq.${customerId}` : '',
    phone ? `phone.eq.${phone}` : '',
    phone ? `whatsapp_phone.eq.${phone}` : '',
    phone ? `phone_alt.eq.${phone}` : '',
    phoneTail ? `phone.ilike.%${phoneTail}%` : '',
    name.length >= 3 ? `name.ilike.%${name}%` : '',
  ]
    .filter(Boolean)
    .join(',');
}

function activityOrClauses(
  params: CustomerFullProfileParams,
  metrics?: CustomerMetric | null,
  profile?: Row | null
) {
  const { code, phone, phoneTail, customerId, name } = resolveMatchParams(params, metrics, profile);
  return [
    customerId && isUuidLike(customerId) ? `customer_id.eq.${customerId}` : '',
    code ? `customer_code.eq.${code}` : '',
    phone ? `customer_phone.eq.${phone}` : '',
    phone ? `phone.eq.${phone}` : '',
    phoneTail ? `customer_phone.ilike.%${phoneTail}%` : '',
    phoneTail ? `phone.ilike.%${phoneTail}%` : '',
    name.length >= 3 ? `customer_name.ilike.%${name}%` : '',
  ]
    .filter(Boolean)
    .join(',');
}

function conversationReviewOrClauses(
  params: CustomerFullProfileParams,
  metrics?: CustomerMetric | null,
  profile?: Row | null
) {
  const { code, phone, phoneTail, name } = resolveMatchParams(params, metrics, profile);
  return [
    code ? `customer_code.eq.${code}` : '',
    phone ? `customer_phone.eq.${phone}` : '',
    phoneTail ? `customer_phone.ilike.%${phoneTail}%` : '',
    name.length >= 3 ? `customer_name.ilike.%${name}%` : '',
  ]
    .filter(Boolean)
    .join(',');
}

function normalizeMetric(row: Row | null): CustomerMetric | null {
  if (!row) return null;
  const totalSpent = safeNumber(readFirst(row, ['total_spent'], 0));
  const avgMonthly = safeNumber(readFirst(row, ['avg_monthly'], 0));
  const firstPurchase = readFirst(row, ['first_purchase'], null) as string | null;
  const lastPurchase = readFirst(row, ['last_purchase'], null) as string | null;
  const invoicesCount = safeNumber(readFirst(row, ['invoices_count'], 0));
  const segment = normalizeCustomerSegment(
    readFirst(row, ['segment'], null),
    totalSpent,
    avgMonthly
  );
  const status =
    invoicesCount <= 0 || !lastPurchase
      ? 'بدون شراء'
      : normalizeCustomerStatus(
          readFirst(row, ['customer_status'], null),
          lastPurchase,
          firstPurchase
        );
  const finalKey = readFirst(row, ['final_customer_key'], null) as string | null;
  const customerId = readFirst(row, ['customer_id'], null) as string | null;
  const customerCode = readFirst(row, ['customer_code'], null) as string | null;
  const phone = readFirst(row, ['customer_phone'], null) as string | null;
  const name = readFirst(row, ['customer_name'], null) as string | null;
  return {
    id: String(finalKey || customerId || customerCode || phone || name || 'unknown'),
    final_customer_key: finalKey,
    customer_id: customerId,
    customer_code: customerCode,
    customer_name: name,
    customer_phone: phone,
    phone,
    name,
    branch: normalizeBranchName(readFirst(row, ['branch'], null)),
    invoices_count: invoicesCount,
    total_spent: totalSpent,
    total_purchases: totalSpent,
    avg_invoice: safeNumber(readFirst(row, ['avg_invoice'], 0)),
    first_purchase: firstPurchase,
    last_purchase: lastPurchase,
    active_months: safeNumber(readFirst(row, ['active_months'], 0)),
    avg_monthly: avgMonthly,
    segment,
    type: segment,
    customer_status: status,
    status,
    retention_status: status,
  };
}

function mapInvoice(row: Row): CustomerInvoiceSummary {
  return {
    invoice_number: getInvoiceKey(row) || null,
    invoice_date: readFirst(row, [...INVOICE_DATE_KEYS], null) as string | null,
    amount: readInvoiceAmount(row),
    seller_name: readFirst(row, ['seller_name'], null) as string | null,
    branch: readInvoiceBranch(row),
  };
}

function mapFollowup(row: Row): CustomerFollowupSummary {
  return {
    id: String(readFirst(row, ['id'], crypto.randomUUID())),
    status: readFirst(row, ['followup_status', 'status', 'contact_status'], null) as string | null,
    assigned_to: readFirst(row, ['assigned_to', 'assigned_doctor'], null) as string | null,
    responsible_name: readFirst(row, ['responsible_name'], null) as string | null,
    notes: readFirst(row, ['followup_notes', 'notes'], null) as string | null,
    followup_result: readFirst(row, ['followup_result', 'contact_result'], null) as string | null,
    created_at: readFirst(row, ['created_at'], null) as string | null,
    followup_date: readFirst(row, ['followup_datetime', 'followup_date', 'date'], null) as
      | string
      | null,
    completed_at: readFirst(row, ['completed_at'], null) as string | null,
  };
}

function buildTrend(rows: Row[]): MonthlyPurchaseTrendRow[] {
  const byMonth = new Map<string, { invoicesCount: number; netTotal: number }>();
  for (const row of rows) {
    const month = readInvoiceDate(row).slice(0, 7);
    if (!month) continue;
    const current = byMonth.get(month) || { invoicesCount: 0, netTotal: 0 };
    current.invoicesCount += 1;
    current.netTotal += readInvoiceAmount(row);
    byMonth.set(month, current);
  }
  return [...byMonth.entries()]
    .map(([month, value]) => ({
      month,
      invoicesCount: value.invoicesCount,
      netTotal: value.netTotal,
      avgInvoice: value.invoicesCount ? value.netTotal / value.invoicesCount : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

function buildPurchaseAnalysis(
  rows: MonthlyPurchaseTrendRow[],
  today = new Date()
): PurchaseAnalysis | null {
  const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const previousDate = new Date(today);
  previousDate.setMonth(previousDate.getMonth() - 1);
  const previousKey = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, '0')}`;
  // Build a map for O(1) month lookups
  const byMonth = new Map<string, MonthlyPurchaseTrendRow>();
  for (const r of rows) byMonth.set(r.month, r);
  const current = byMonth.get(currentKey)?.invoicesCount || 0;
  const previous = byMonth.get(previousKey)?.invoicesCount || 0;
  const activeRows = rows.filter((row) => row.invoicesCount > 0);
  const average = activeRows.length
    ? Math.round(activeRows.reduce((sum, row) => sum + row.invoicesCount, 0) / activeRows.length)
    : 0;

  let status = 'طبيعي';
  if (current === 0 && previous >= 2) status = 'توقف عن الشراء';
  else if (previous >= 2 && current * 2 <= previous) status = 'انخفض الشراء';
  else if (current === 0 && previous === 1) status = 'يحتاج متابعة';
  else if (current === 0) status = 'بدون مشتريات هذا الشهر';

  const recommendation =
    status === 'توقف عن الشراء'
      ? 'تابع العميل فورًا لاستعادة الشراء، وراجع آخر صنف أو خدمة كان يطلبها.'
      : status === 'انخفض الشراء'
        ? 'راجع سبب انخفاض الشراء وحدد متابعة قريبة مع عرض مناسب للعميل.'
        : status === 'يحتاج متابعة'
          ? 'اتصل بالعميل لتأكيد احتياجاته وتشجيعه على الشراء القادم.'
          : 'استمر في المتابعة الهادئة مع تسجيل نتيجة واضحة لكل تواصل.';

  return {
    purchaseCountCurrentMonth: current,
    purchaseCountPreviousMonth: previous,
    averageMonthlyPurchaseCount: average,
    purchaseFrequencyStatus: status,
    recommendation,
  };
}

function buildNotes(profile: Row | null): CustomerProfileNotes {
  return {
    customerNotes: readFirst(profile, ['customer_notes'], null) as string | null,
    whatsappNotes: readFirst(profile, ['whatsapp_notes'], null) as string | null,
    serviceNotes: readFirst(profile, ['service_notes'], null) as string | null,
    teamNotes: readFirst(profile, ['team_notes'], null) as string | null,
    handlingNotes: readFirst(profile, ['handling_notes'], null) as string | null,
    notes: readFirst(profile, ['notes'], null) as string | null,
    address: readFirst(profile, ['address'], null) as string | null,
    phoneAlt: readFirst(profile, ['phone_alt'], null) as string | null,
    whatsappPhone: readFirst(profile, ['whatsapp_phone'], null) as string | null,
  };
}

function buildRecommendations(
  metric: CustomerMetric | null,
  profile: Row | null,
  displayPhone: string | null
) {
  const flags = (readFirst(profile, ['customer_flags'], null) || {}) as Record<string, boolean>;
  const items: string[] = [];
  if (!displayPhone) items.push('العميل بدون رقم صحيح، ابدأ باستكمال بيانات التواصل.');
  if (metric?.segment === 'مهم جدًا') items.push('ابدأ برسالة تقدير لأن العميل مهم جدًا.');
  if (metric?.customer_status === 'متوقف') items.push('العميل متوقف، اسأله بلطف عن سبب التوقف.');
  if (metric?.customer_status === 'مهدد بالتوقف')
    items.push('العميل مهدد بالتوقف، حدد متابعة قريبة ولا تتركه يسقط.');
  if (flags.no_delivery) items.push('لا تضف توصيل لهذا العميل.');
  if (flags.no_substitutes) items.push('لا تقترح بدائل إلا بعد موافقة العميل.');
  if (flags.price_sensitive) items.push('وضح السعر والقيمة قبل عرض الاختيارات.');
  if (flags.prefers_call) items.push('يفضل الاتصال بدل واتساب.');
  if (flags.needs_manager || flags.complains_often)
    items.push('راجع آخر شكوى أو ملاحظة قبل التواصل.');
  if (!items.length) items.push('متابعة عادية مع تسجيل نتيجة واضحة وتحديد خطوة قادمة.');
  return items.slice(0, 5);
}

async function safeSection<T>(
  section: string,
  task: () => Promise<T>,
  errorsBySection: Record<string, string>,
  fallback: T
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorsBySection[section] = friendlyError(message);
    if (import.meta.env.DEV) console.warn(`[customerProfileService.${section}]`, error);
    return fallback;
  }
}

export async function getCustomerFullProfile(
  params: CustomerFullProfileParams
): Promise<CustomerFullProfile> {
  if (!isSupabaseConfigured) {
    throw new Error('إعدادات Supabase غير موجودة.');
  }

  const key = cacheKey(params);
  if (!params.forceRefresh && profileCache.has(key)) return profileCache.get(key)!;

  const errorsBySection: Record<string, string> = {};
  const metricsClauses = metricsOrClauses(params);

  const metrics = await safeSection(
    'metrics',
    async () => {
      if (!metricsClauses) return null;
      const query = withAbort(
        supabase
          .from('customer_metrics_summary')
          .select(
            'final_customer_key,customer_id,customer_code,customer_name,customer_phone,branch,invoices_count,total_spent,avg_invoice,first_purchase,last_purchase,active_months,avg_monthly,segment,customer_status'
          )
          .or(metricsClauses)
          .limit(1),
        params.signal
      );
      const { data, error } = await query;
      if (error) throw error;
      return normalizeMetric((data?.[0] ?? null) as Row | null);
    },
    errorsBySection,
    null
  );

  const customerClauses = customerOrClauses(params, metrics);
  const profile = await safeSection(
    'profile',
    async () => {
      if (!customerClauses) return null;
      const query = withAbort(
        supabase
          .from('customers')
          .select(
            'id,customer_code,name,phone,whatsapp_phone,phone_alt,address,notes,customer_notes,whatsapp_notes,service_notes,team_notes,handling_notes,customer_flags,branch'
          )
          .or(customerClauses)
          .limit(1),
        params.signal
      );
      const { data, error } = await query;
      if (error) throw error;
      return (data?.[0] ?? null) as Row | null;
    },
    errorsBySection,
    null
  );

  const displayPhone = getBestCustomerPhone(
    {
      customer_code:
        metrics?.customer_code ||
        params.customer_code ||
        (profile?.customer_code as string | null) ||
        null,
      customer_phone: params.customer_phone || metrics?.customer_phone || null,
      phone: params.customer_phone || null,
    },
    metrics,
    profile
      ? {
          whatsapp_phone: readFirst(profile, ['whatsapp_phone'], null) as string | null,
          phone: readFirst(profile, ['phone'], null) as string | null,
          phone_alt: readFirst(profile, ['phone_alt'], null) as string | null,
          customer_phone: null,
        }
      : null
  );

  const activityClauses = activityOrClauses(params, metrics, profile);
  const reviewClauses = conversationReviewOrClauses(params, metrics, profile);

  const [invoiceMatch, latestFollowups] = await Promise.all([
    fetchCustomerInvoicesMultiMatch(params, metrics, profile, errorsBySection, params.signal),
    safeSection(
      'latestFollowups',
      async () => {
        if (!activityClauses) return [];
        const query = withAbort(
          supabase
            .from('daily_followups')
            .select(
              'id,status,followup_status,assigned_to,assigned_doctor,responsible_name,notes,followup_notes,followup_result,contact_result,created_at,followup_date,followup_datetime,date,completed_at,contact_status'
            )
            .or(activityClauses)
            .order('created_at', { ascending: false })
            .limit(10),
          params.signal
        );
        const { data, error } = await query;
        if (error) throw error;
        return ((data ?? []) as Row[]).map(mapFollowup);
      },
      errorsBySection,
      [] as CustomerFollowupSummary[]
    ),
    safeSection(
      'conversationReviews',
      async () => {
        if (!reviewClauses) return 0;
        const query = withAbort(
          supabase
            .from('conversation_sales_reviews')
            .select('id', { count: 'exact', head: true })
            .or(reviewClauses),
          params.signal
        );
        const { count, error } = await query;
        if (error) throw error;
        return count || 0;
      },
      errorsBySection,
      0
    ),
  ]);

  const invoiceAggRows = invoiceMatch.rows;
  const invoiceMetrics =
    invoiceAggRows.length > 0
      ? buildMetricsFromInvoices(invoiceAggRows, params, metrics, profile)
      : null;
  const { metrics: resolvedMetrics, metricsFallbackUsed, invoiceSourceUsed } = resolveFinalMetrics(
    metrics,
    invoiceMetrics,
    invoiceAggRows.length
  );

  const sortedInvoices = [...invoiceAggRows].sort((a, b) =>
    readInvoiceDate(b).localeCompare(readInvoiceDate(a))
  );
  const latestInvoices = sortedInvoices.slice(0, 20).map(mapInvoice);
  const trendRows = buildTrend(invoiceAggRows);

  const branchExtras = invoiceMetrics as CustomerMetric & {
    branch_highest_value?: string | null;
    branch_last_purchase?: string | null;
  };

  const notes = buildNotes(profile);
  const flags = (readFirst(profile, ['customer_flags'], null) || null) as Record<
    string,
    boolean
  > | null;
  const purchaseAnalysis = buildPurchaseAnalysis(trendRows);
  const result: CustomerFullProfile = {
    profile,
    metrics: resolvedMetrics,
    flags,
    notes,
    latestInvoices,
    latestFollowups,
    monthlyPurchaseTrend: trendRows,
    purchaseAnalysis,
    recommendations: buildRecommendations(resolvedMetrics, profile, displayPhone),
    dataHealth: {
      hasMetrics: Boolean(resolvedMetrics),
      hasCustomerRecord: Boolean(profile),
      hasValidPhone: Boolean(
        displayPhone &&
        isValidEgyptPhone(displayPhone, resolvedMetrics?.customer_code || params.customer_code)
      ),
      isPseudoCustomer: isPseudoCustomer({
        customer_name:
          resolvedMetrics?.customer_name || (profile?.name as string | null) || params.customer_name,
        customer_phone: displayPhone,
        phone: displayPhone,
        customer_id: resolvedMetrics?.customer_id || (profile?.id as string | null),
        customer_code: resolvedMetrics?.customer_code || params.customer_code,
      }),
      invoicesLoaded: invoiceAggRows.length > 0,
      followupsLoaded: !errorsBySection.latestFollowups,
      missingCustomerCode: !normalizeCustomerCode(
        resolvedMetrics?.customer_code || params.customer_code || profile?.customer_code
      ),
      matchedBy: summarizeMatchedBy(invoiceMatch.matchedStrategies),
      invoicesMatchedCount: invoiceAggRows.length,
      invoiceSourceUsed,
      metricsFallbackUsed,
      branchMostFrequent: resolvedMetrics?.branch || null,
      branchHighestValue: branchExtras?.branch_highest_value || null,
      branchLastPurchase: branchExtras?.branch_last_purchase || null,
    },
    errorsBySection,
    displayPhone,
  };

  profileCache.set(key, result);
  return result;
}

export function clearCustomerProfileCache() {
  profileCache.clear();
}
