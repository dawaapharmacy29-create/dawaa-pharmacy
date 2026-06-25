import { useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

const CACHE_TTL_MS = 5 * 60 * 1000;

export type CustomerServiceLiveMetrics = {
  total_spent: number;
  invoices_count: number;
  last_purchase: string | null;
  first_purchase: string | null;
  avg_invoice: number;
  avg_monthly: number;
  current_month_count: number;
  average_monthly_purchase_count: number;
  branch: string | null;
  segment: string | null;
  customer_status: string | null;
  source: 'sales_invoices' | 'fallback';
};

type CacheEntry = { at: number; data: CustomerServiceLiveMetrics };

const cache = new Map<string, CacheEntry>();

export type CustomerMetricsLookup = {
  customer_id?: string | null;
  customer_code?: string | null;
  customer_phone?: string | null;
  customer_name?: string | null;
  branch?: string | null;
};

export function customerMetricsKey(input: CustomerMetricsLookup) {
  return [
    String(input.customer_code || '').trim(),
    String(input.customer_phone || '').trim(),
    String(input.customer_id || '').trim(),
    String(input.customer_name || '').trim(),
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

function summarizeInvoices(
  rows: Array<{
    invoice_date?: string | null;
    net_total?: number | null;
    total?: number | null;
    branch?: string | null;
  }>
) {
  const totals = rows.map((row) => Number(row.net_total ?? row.total ?? 0)).filter(Number.isFinite);
  const total = totals.reduce((sum, value) => sum + value, 0);
  const dates = rows
    .map((row) => String(row.invoice_date || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  const months = new Set(dates.map((date) => date.slice(0, 7)));
  const currentStart = monthStart(0);
  const currentEnd = monthEnd(0);
  const currentMonthCount = rows.filter((row) => {
    const date = String(row.invoice_date || '').slice(0, 10);
    return date >= currentStart && date <= currentEnd;
  }).length;

  const branchCounts = new Map<string, number>();
  for (const row of rows) {
    const branch = String(row.branch || '').trim();
    if (!branch) continue;
    branchCounts.set(branch, (branchCounts.get(branch) || 0) + 1);
  }
  const branch = [...branchCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    total_spent: total,
    invoices_count: rows.length,
    last_purchase: dates.at(-1) || null,
    first_purchase: dates[0] || null,
    avg_invoice: rows.length ? total / rows.length : 0,
    avg_monthly: months.size ? total / months.size : 0,
    current_month_count: currentMonthCount,
    average_monthly_purchase_count: months.size ? rows.length / months.size : currentMonthCount,
    branch,
  };
}

async function fetchInvoicesForCustomer(input: CustomerMetricsLookup) {
  if (!isSupabaseConfigured) return [];

  const select = 'invoice_date,net_total,total,branch,customer_code,customer_phone,customer_name,customer_id';
  const clauses: string[] = [];
  if (input.customer_code) clauses.push(`customer_code.eq.${input.customer_code}`);
  if (input.customer_phone) clauses.push(`customer_phone.eq.${input.customer_phone}`);
  if (input.customer_id) clauses.push(`customer_id.eq.${input.customer_id}`);
  if (input.customer_name) clauses.push(`customer_name.eq.${input.customer_name}`);
  if (!clauses.length) return [];

  const { data, error } = await supabase
    .from('sales_invoices')
    .select(select)
    .or(clauses.join(','))
    .order('invoice_date', { ascending: false })
    .limit(500);

  if (error) {
    if (import.meta.env.DEV) console.warn('[customerServiceCustomerMetrics] invoice query failed', error.message);
    return [];
  }
  return (data || []) as Array<{
    invoice_date?: string | null;
    net_total?: number | null;
    total?: number | null;
    branch?: string | null;
  }>;
}

export async function getCustomerServiceLiveMetrics(
  input: CustomerMetricsLookup
): Promise<CustomerServiceLiveMetrics | null> {
  const key = customerMetricsKey(input);
  if (!key) return null;

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  try {
    const invoices = await fetchInvoicesForCustomer(input);
    if (!invoices.length) return null;

    const summary = summarizeInvoices(invoices);
    const metrics: CustomerServiceLiveMetrics = {
      ...summary,
      segment: null,
      customer_status: null,
      source: 'sales_invoices',
    };
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

  await Promise.all(
    [...unique.entries()].map(async ([key, item]) => {
      const metrics = await getCustomerServiceLiveMetrics(item);
      if (metrics) result.set(key, metrics);
    })
  );

  return result;
}

export function useCustomerServiceMetricsEnrichment(items: CustomerMetricsLookup[]) {
  const [metricsByKey, setMetricsByKey] = useState<Map<string, CustomerServiceLiveMetrics>>(new Map());
  const serialized = JSON.stringify(items);

  useEffect(() => {
    let active = true;
    void batchEnrichCustomerServiceMetrics(items).then((map) => {
      if (active) setMetricsByKey(map);
    });
    return () => {
      active = false;
    };
  }, [serialized]);

  return metricsByKey;
}
