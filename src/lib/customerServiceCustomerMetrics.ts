/* eslint-disable no-useless-escape */
import { useEffect, useMemo, useState } from 'react';
import {
  getInvoiceAmount,
  getInvoiceBranch,
  getInvoiceDay,
  getInvoiceId,
} from '@/lib/invoices/invoiceCore';
import { readCustomerInvoices } from '@/lib/readModels/customerInvoiceReadModel';

const CACHE_TTL_MS = 60 * 1000;

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
  source: 'customer_invoice_read_model';
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

function normalizeArabicName(value: unknown) {
  return cleanText(value)
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function lastPhoneDigits(value: unknown, count = 10) {
  const digits = cleanText(value).replace(/\D/g, '');
  return digits.length > count ? digits.slice(-count) : digits;
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

function invoiceDate(row: InvoiceLike) {
  return getInvoiceDay(row);
}

function invoiceAmount(row: InvoiceLike) {
  return getInvoiceAmount(row);
}

function invoiceBranch(row: InvoiceLike) {
  return getInvoiceBranch(row) || null;
}

function invoiceIdentity(row: InvoiceLike) {
  return getInvoiceId(row) || `${invoiceDate(row) || 'no-date'}-${invoiceAmount(row)}-${invoiceBranch(row) || ''}`;
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
  for (const row of rows) invoices.set(invoiceIdentity(row), row);

  const uniqueRows = [...invoices.values()];
  const total = uniqueRows.reduce((sum, row) => sum + invoiceAmount(row), 0);
  const datedRows = uniqueRows
    .map((row) => ({ date: invoiceDate(row), amount: invoiceAmount(row), branch: invoiceBranch(row) }))
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

  return {
    total_spent: total,
    invoices_count: invoicesCount,
    last_purchase: lastPurchase,
    first_purchase: dates[0] || null,
    avg_invoice: invoicesCount ? total / invoicesCount : 0,
    avg_monthly: months.size ? total / months.size : 0,
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
    source: 'customer_invoice_read_model',
  };
}

export async function getCustomerServiceLiveMetrics(
  input: CustomerMetricsLookup
): Promise<CustomerServiceLiveMetrics | null> {
  const key = customerMetricsKey(input);
  if (!key) return null;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  try {
    const result = await readCustomerInvoices({
      customerId: input.customer_id,
      customerCode: input.customer_code,
      customerPhone: input.customer_phone,
      customerName: input.customer_name,
    });
    if (!result.rows.length) return null;

    const metrics = summarizeInvoices(result.rows, result.matchedBy);
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
