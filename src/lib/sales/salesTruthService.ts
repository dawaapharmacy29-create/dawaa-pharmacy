import { supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { clearInvoiceCache } from '@/lib/invoiceCache';
import {
  dashboardInvoiceAmount,
  type DashboardInvoiceRow,
} from '@/lib/dashboard/dashboardTruthService';
import { fetchSalesInvoicesPagedSafe } from '@/lib/salesInvoiceQueries';

export type BranchTruthStats = {
  branch: string;
  sales_total: number;
  invoices_count: number;
  avg_invoice: number;
  linked_customers: number;
  daily_avg: number;
  link_rate: number;
  best_day: string | null;
  best_day_sales: number;
};

export type SalesTruthLoadResult<T> = {
  rows: T[];
  source: 'rpc' | 'client_fallback';
  rowsRead: number;
  warnings: string[];
};

function numberValue(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw || null;
}

function day(row: DashboardInvoiceRow) {
  return String(row.invoice_date || '').slice(0, 10);
}

function invoiceKey(row: DashboardInvoiceRow) {
  return String(row.invoice_no ?? row.invoice_number ?? row.id ?? '').trim();
}

function customerKey(row: DashboardInvoiceRow) {
  return String(row.customer_code ?? row.customer_name ?? '').trim();
}

function buildBranchStatsFallback(rows: DashboardInvoiceRow[]): BranchTruthStats[] {
  const branches = new Map<
    string,
    { total: number; keys: Set<string>; customers: Set<string>; days: Map<string, number> }
  >();

  for (const row of rows) {
    const branch = normalizeBranchName(row.branch || '') || 'غير محدد';
    const current = branches.get(branch) || {
      total: 0,
      keys: new Set<string>(),
      customers: new Set<string>(),
      days: new Map<string, number>(),
    };
    const amount = dashboardInvoiceAmount(row);
    const k = invoiceKey(row);
    const c = customerKey(row);
    const d = day(row);
    current.total += amount;
    if (k) current.keys.add(k);
    if (c) current.customers.add(c);
    if (d) current.days.set(d, (current.days.get(d) || 0) + amount);
    branches.set(branch, current);
  }

  const grand = [...branches.values()].reduce((sum, row) => sum + row.total, 0) || 1;
  return [...branches.entries()]
    .map(([branch, row]) => {
      const dayRows = [...row.days.entries()].sort((a, b) => b[1] - a[1]);
      const invoiceCount = row.keys.size;
      return {
        branch,
        sales_total: row.total,
        invoices_count: invoiceCount,
        avg_invoice: invoiceCount ? row.total / invoiceCount : 0,
        linked_customers: row.customers.size,
        daily_avg: row.days.size ? row.total / row.days.size : row.total,
        link_rate: (row.total / grand) * 100,
        best_day: dayRows[0]?.[0] || null,
        best_day_sales: dayRows[0]?.[1] || 0,
      } satisfies BranchTruthStats;
    })
    .sort((a, b) => b.sales_total - a.sales_total);
}

function mapRpcBranchRow(row: Record<string, unknown>): BranchTruthStats {
  return {
    branch: text(row.branch) || 'غير محدد',
    sales_total: numberValue(row.sales_total),
    invoices_count: numberValue(row.invoices_count),
    avg_invoice: numberValue(row.avg_invoice),
    linked_customers: numberValue(row.linked_customers),
    daily_avg: numberValue(row.daily_avg),
    link_rate: numberValue(row.link_rate),
    best_day: text(row.best_day),
    best_day_sales: numberValue(row.best_day_sales),
  };
}

async function tryBranchRpc(
  startDate: string,
  endDate: string
): Promise<BranchTruthStats[] | null> {
  try {
    const { data, error } = await supabase.rpc('get_branch_comparison_v2', {
      p_start_date: startDate,
      p_end_date: endDate,
    });
    if (error) return null;
    return ((data || []) as Record<string, unknown>[])
      .map(mapRpcBranchRow)
      .sort((a, b) => b.sales_total - a.sales_total);
  } catch {
    return null;
  }
}

export async function getBranchComparisonTruth(options: {
  startDate: string;
  endDate: string;
  forceRefresh?: boolean;
}): Promise<SalesTruthLoadResult<BranchTruthStats>> {
  const warnings: string[] = [];

  if (!options.forceRefresh) {
    const rpcRows = await tryBranchRpc(options.startDate, options.endDate);
    if (rpcRows && rpcRows.length) {
      return { rows: rpcRows, source: 'rpc', rowsRead: rpcRows.length, warnings };
    }
    warnings.push(
      'لم يتم العثور على RPC get_branch_comparison_v2 أو لم يرجع بيانات؛ تم استخدام fallback من الفواتير.'
    );
  }

  if (options.forceRefresh) clearInvoiceCache();
  const errors: string[] = [];
  const invoiceRows = (await fetchSalesInvoicesPagedSafe({
    startDate: options.startDate,
    endDate: options.endDate,
    branch: 'كل الفروع',
    errors,
    noCache: options.forceRefresh,
    pageSize: 1000,
    maxPages: 80,
  })) as DashboardInvoiceRow[];

  warnings.push(...errors);
  return {
    rows: buildBranchStatsFallback(invoiceRows),
    source: 'client_fallback',
    rowsRead: invoiceRows.length,
    warnings,
  };
}
