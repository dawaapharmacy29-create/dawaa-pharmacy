/* eslint-disable no-useless-escape */
import { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  getInvoiceAmount,
  getInvoiceBranch,
  getInvoiceDay,
  getInvoiceId,
} from '@/lib/invoices/invoiceCore';

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_INVOICES_PER_CUSTOMER = 700;

export type CustomerServiceLiveMetrics = {
  total_spent: number;
  invoices_count: number;
  last_purchase: string | null;
  first_purchase: string | null;
  avg_invoice: number;
  avg_monthly: number;
  current_month_count: number;
  current_month_spent: number;
  previous_month_count: number;
  previous_month_spent: number;
  average_monthly_purchase_count: number;
  branch: string | null;
  branch_most_frequent: string | null;
  branch_highest_value: string | null;
  branch_last_purchase: string | null;
  segment: string | null;
  customer_status: string | null;
  matched_by: string | null;
  invoices_matched_count: number;
  source: 'sales_invoices' | 'fallback';
};

type CacheEntry = { at: number; data: CustomerServiceLiveMetrics };

const cache = new Map<string, CacheEntry>();

export type CustomerMetricsLookup = {
  customer_id?: string | number | null;
  customer_code?: string | number | null;
  customer_phone?: string | number | null;
  customer_name?: string | null;
  branch?: string | null;
};

type InvoiceLike = Record<string, unknown>;

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

function digitsOnly(value: unknown) {
  return cleanText(value).replace(/\D/g, '');
}

function normalizeArabicName(value: unknown) {
  return cleanText(value)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function lastPhoneDigits(value: unknown, count = 10) {
  const digits = digitsOnly(value);
  return digits.length > count ? digits.slice(-count) : digits;
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanText(value));
}

export function customerMetricsKey(input: CustomerMetricsLookup) {
  return [
    cleanText(input.customer_code),
    lastPhoneDigits(input.customer_phone),
    cleanText(input.customer_id),
    normalizeArabicName(input.customer_name),
  ]
    .filter(Boolean)
    .join('|');
}

function monthStart(offset = 0) {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth() + offset, 1).toISOString().slice(0, 10);
}

function monthEnd(offset = 0) {
  const date = new Date();
  return new Date(date.getFullYear(), date.getMonth() + offset + 1, 0).toISOString().slice(0, 10);
}

function valueOf(row: InvoiceLike, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && cleanText(value) !== '') return value;
  }
  return null;
}

function invoiceDate(row: InvoiceLike) {
  return getInvoiceDay(row);
}

function parseMoney(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = cleanText(value)
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[^0-9.\-]/g, '');
  const amount = Number(normalized || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function invoiceAmount(row: InvoiceLike) {
  return getInvoiceAmount(row);
}

function invoiceBranch(row: InvoiceLike) {
  return getInvoiceBranch(row) || null;
}

function invoiceIdentity(row: InvoiceLike) {
  return (
    getInvoiceId(row) ||
    `${invoiceDate(row) || 'no-date'}-${invoiceAmount(row)}-${invoiceBranch(row) || ''}`
  );
}

function segmentFrom(total: number, invoicesCount: number, lastPurchase: string | null) {
  const daysSinceLast = lastPurchase
    ? Math.floor((Date.now() - new Date(lastPurchase).getTime()) / 86_400_000)
    : Number.POSITIVE_INFINITY;
  if (total >= 8000 || invoicesCount >= 12) return 'VIP';
  if (total >= 4000 || invoicesCount >= 6) return 'Loyal';
  if (daysSinceLast > 90) return 'At Risk';
  return 'Occasional';
}

function statusFrom(lastPurchase: string | null) {
  if (!lastPurchase) return 'لا يوجد شراء';
  const days = Math.floor((Date.now() - new Date(lastPurchase).getTime()) / 86_400_000);
  if (days <= 45) return 'نشط';
  if (days <= 90) return 'يحتاج متابعة';
  return 'متوقف';
}

function summarizeInvoices(rows: InvoiceLike[], matchedBy: string | null): CustomerServiceLiveMetrics {
  const invoices = new Map<string, InvoiceLike>();
  for (const row of rows) {
    invoices.set(invoiceIdentity(row), row);
  }

  const uniqueRows = [...invoices.values()];
  const totals = uniqueRows.map(invoiceAmount).filter(Number.isFinite);
  const total = totals.reduce((sum, value) => sum + value, 0);
  const datedRows = uniqueRows
    .map((row) => ({ row, date: invoiceDate(row), amount: invoiceAmount(row), branch: invoiceBranch(row) }))
    .filter((item) => Boolean(item.date))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const dates = datedRows.map((item) => item.date as string);
  const months = new Set(dates.map((date) => date.slice(0, 7)));
  const currentStart = monthStart(0);
  const currentEnd = monthEnd(0);
  const previousStart = monthStart(-1);
  const previousEnd = monthEnd(-1);

  const currentMonthRows = datedRows.filter((item) => item.date! >= currentStart && item.date! <= currentEnd);
  const previousMonthRows = datedRows.filter((item) => item.date! >= previousStart && item.date! <= previousEnd);

  const branchCounts = new Map<string, number>();
  const branchTotals = new Map<string, number>();
  for (const item of datedRows) {
    if (!item.branch) continue;
    branchCounts.set(item.branch, (branchCounts.get(item.branch) || 0) + 1);
    branchTotals.set(item.branch, (branchTotals.get(item.branch) || 0) + item.amount);
  }

  const branchMostFrequent = [...branchCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const branchHighestValue = [...branchTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const lastPurchaseRow = datedRows.at(-1);
  const lastPurchase = dates.at(-1) || null;
  const invoicesCount = uniqueRows.length;
  const avgInvoice = invoicesCount ? total / invoicesCount : 0;
  const avgMonthly = months.size ? total / months.size : 0;

  return {
    total_spent: total,
    invoices_count: invoicesCount,
    last_purchase: lastPurchase,
    first_purchase: dates[0] || null,
    avg_invoice: avgInvoice,
    avg_monthly: avgMonthly,
    current_month_count: currentMonthRows.length,
    current_month_spent: currentMonthRows.reduce((sum, item) => sum + item.amount, 0),
    previous_month_count: previousMonthRows.length,
    previous_month_spent: previousMonthRows.reduce((sum, item) => sum + item.amount, 0),
    average_monthly_purchase_count: months.size ? invoicesCount / months.size : currentMonthRows.length,
    branch: lastPurchaseRow?.branch || branchMostFrequent || null,
    branch_most_frequent: branchMostFrequent,
    branch_highest_value: branchHighestValue,
    branch_last_purchase: lastPurchaseRow?.branch || null,
    segment: segmentFrom(total, invoicesCount, lastPurchase),
    customer_status: statusFrom(lastPurchase),
    matched_by: matchedBy,
    invoices_matched_count: invoicesCount,
    source: 'sales_invoices',
  };
}

async function querySalesInvoices(column: string, operator: 'eq' | 'ilike', value: string) {
  if (!isSupabaseConfigured || !value) return { rows: [] as InvoiceLike[], error: null as unknown };

  let query = supabase.from('sales_invoices').select('*').limit(MAX_INVOICES_PER_CUSTOMER);
  query = operator === 'eq' ? query.eq(column, value) : query.ilike(column, value);
  const { data, error } = await query;
  if (error) return { rows: [] as InvoiceLike[], error };
  return { rows: (data || []) as InvoiceLike[], error: null };
}

async function fetchByStrategies(input: CustomerMetricsLookup) {
  const code = cleanText(input.customer_code);
  const phone = cleanText(input.customer_phone);
  const phoneTail = lastPhoneDigits(phone);
  const customerId = cleanText(input.customer_id);
  const name = cleanText(input.customer_name);
  const normalizedName = normalizeArabicName(name);
  const allRows: InvoiceLike[] = [];
  const matched: string[] = [];

  const strategies: Array<{ label: string; columns: string[]; op: 'eq' | 'ilike'; value: string }> = [];

  if (code) {
    strategies.push({ label: 'code', columns: ['customer_code', 'client_code', 'code'], op: 'eq', value: code });
  }
  if (customerId && isUuid(customerId)) {
    strategies.push({ label: 'customer_id', columns: ['customer_id', 'client_id'], op: 'eq', value: customerId });
  }
  if (phone) {
    strategies.push({
      label: 'phone',
      columns: ['customer_phone', 'phone', 'mobile', 'client_phone', 'whatsapp_phone'],
      op: 'eq',
      value: phone,
    });
  }
  if (phoneTail.length >= 8) {
    strategies.push({
      label: 'phoneTail',
      columns: ['customer_phone', 'phone', 'mobile', 'client_phone', 'whatsapp_phone'],
      op: 'ilike',
      value: `%${phoneTail}`,
    });
  }
  if (name && normalizedName.length >= 3) {
    strategies.push({
      label: 'name',
      columns: ['customer_name', 'name', 'client_name'],
      op: 'ilike',
      value: `%${name}%`,
    });
  }

  for (const strategy of strategies) {
    for (const column of strategy.columns) {
      const { rows } = await querySalesInvoices(column, strategy.op, strategy.value);
      if (!rows.length) continue;

      let filteredRows = rows;
      if (strategy.label === 'name' && phoneTail.length >= 8) {
        const phoneColumns = ['customer_phone', 'phone', 'mobile', 'client_phone', 'whatsapp_phone'];
        const phoneFiltered = rows.filter((row) =>
          phoneColumns.some((columnName) => lastPhoneDigits(row[columnName]).endsWith(phoneTail))
        );
        if (phoneFiltered.length) filteredRows = phoneFiltered;
      }

      allRows.push(...filteredRows);
      matched.push(`${strategy.label}:${column}`);
      if (strategy.label === 'code' || strategy.label === 'phone' || strategy.label === 'phoneTail') {
        break;
      }
    }
    if (allRows.length && ['code', 'phone', 'phoneTail', 'customer_id'].some((key) => matched.some((m) => m.startsWith(key)))) {
      // Stop after a strong match to avoid pulling unrelated name matches.
      break;
    }
  }

  return { rows: allRows, matchedBy: matched.join(',') || null };
}

export async function getCustomerServiceLiveMetrics(
  input: CustomerMetricsLookup
): Promise<CustomerServiceLiveMetrics | null> {
  const key = customerMetricsKey(input);
  if (!key) return null;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  try {
    const { rows, matchedBy } = await fetchByStrategies(input);
    if (!rows.length) return null;

    const metrics = summarizeInvoices(rows, matchedBy);
    cache.set(key, { at: Date.now(), data: metrics });
    return metrics;
  } catch (error) {
    if (import.meta.env.DEV) console.warn('[customerServiceCustomerMetrics] failed', error);
    return null;
  }
}

export async function batchEnrichCustomerServiceMetrics(
  items: CustomerMetricsLookup[]
): Promise<Map<string, CustomerServiceLiveMetrics>> {
  const result = new Map<string, CustomerServiceLiveMetrics>();
  const unique = new Map<string, CustomerMetricsLookup>();

  for (const item of items) {
    const key = customerMetricsKey(item);
    if (!key || unique.has(key)) continue;
    unique.set(key, item);
  }

  const entries = [...unique.entries()];
  const concurrency = 5;
  for (let index = 0; index < entries.length; index += concurrency) {
    const chunk = entries.slice(index, index + concurrency);
    await Promise.all(
      chunk.map(async ([key, item]) => {
        const metrics = await getCustomerServiceLiveMetrics(item);
        if (metrics) result.set(key, metrics);
      })
    );
  }

  return result;
}

export function clearCustomerServiceMetricsCache() {
  cache.clear();
}

export function useCustomerServiceMetricsEnrichment(items: CustomerMetricsLookup[]) {
  const [metricsByKey, setMetricsByKey] = useState<Map<string, CustomerServiceLiveMetrics>>(new Map());
  const [refreshVersion, setRefreshVersion] = useState(0);
  const serialized = useMemo(() => JSON.stringify(items), [items]);

  useEffect(() => {
    const refresh = () => {
      clearCustomerServiceMetricsCache();
      setRefreshVersion((value) => value + 1);
    };

    window.addEventListener('dawaa:data-refresh', refresh);
    window.addEventListener('dataChanged', refresh);
    return () => {
      window.removeEventListener('dawaa:data-refresh', refresh);
      window.removeEventListener('dataChanged', refresh);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void batchEnrichCustomerServiceMetrics(items).then((map) => {
      if (active) setMetricsByKey(map);
    });
    return () => {
      active = false;
    };
  }, [serialized, refreshVersion]);

  return metricsByKey;
}
