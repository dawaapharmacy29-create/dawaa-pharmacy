import type { DashboardSalesTruth } from '@/lib/dashboard/dashboardTruthService';

/**
 * Legacy dashboard session snapshots are intentionally retired.
 *
 * The executive dashboard now gets its sales truth from dashboardTruthService,
 * which owns the bounded/server-side data path and its own request caching.
 * The old page-level sessionStorage snapshot became unsafe after that migration:
 * the page could write a stale React closure after fresh data had already been
 * rendered, while the corresponding read result was no longer applied by the
 * page. Keeping those writes only created stale-data debt and storage churn.
 *
 * These compatibility functions remain so older imports do not need a risky
 * large-file rewrite. They deliberately do not hydrate or persist dashboard
 * state anymore. clearDashboardCache still removes historical snapshots left
 * by older deployments.
 */
export function saveDashboardCache(
  _state: unknown,
  _branch: string,
  _dateRange: { start: string; end: string },
  _userRole?: string
): void {
  // No-op by design. dashboardTruthService is the canonical cache/data owner.
}

export function loadDashboardCache(
  _branch: string,
  _dateRange: { start: string; end: string },
  _userRole?: string
): null {
  return null;
}

export function clearDashboardCache(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('dawaa_dashboard_cache_')) sessionStorage.removeItem(key);
    }
  } catch (error) {
    console.debug('[Dashboard Cache] Failed to clear legacy cache:', error);
  }
}

export function getDashboardCacheTimestamp(): Date | null {
  return null;
}

export function ensureValidDashboardData(data: Partial<DashboardSalesTruth>): DashboardSalesTruth {
  return {
    sourceRows: data.sourceRows || [],
    cycleRows: data.cycleRows || [],
    summary: {
      invoices_count: data.summary?.invoices_count ?? 0,
      sales_total: data.summary?.sales_total ?? 0,
      avg_invoice: data.summary?.avg_invoice ?? 0,
      linked_invoices: data.summary?.linked_invoices ?? 0,
      unregistered_customer_invoices: data.summary?.unregistered_customer_invoices ?? 0,
      linked_sales: data.summary?.linked_sales ?? 0,
      unregistered_customer_sales: data.summary?.unregistered_customer_sales ?? 0,
      customer_link_rate_percent: data.summary?.customer_link_rate_percent ?? 0,
      linked_customers: data.summary?.linked_customers ?? 0,
    },
    dailySales: data.dailySales || [],
    monthlySales: data.monthlySales || [],
    branchDistribution: data.branchDistribution || [],
    doctorSales: data.doctorSales || [],
    recentInvoices: data.recentInvoices || [],
    reconciliation: {
      source: data.reconciliation?.source ?? 'sales_invoices_live',
      dashboardTotal: data.reconciliation?.dashboardTotal ?? 0,
      sqlEquivalentTotal: data.reconciliation?.sqlEquivalentTotal ?? 0,
      difference: data.reconciliation?.difference ?? 0,
      invoicesCount: data.reconciliation?.invoicesCount ?? 0,
      rowsRead: data.reconciliation?.rowsRead ?? 0,
      selectedStartDate:
        data.reconciliation?.selectedStartDate ?? new Date().toISOString().slice(0, 10),
      selectedEndDate:
        data.reconciliation?.selectedEndDate ?? new Date().toISOString().slice(0, 10),
      branchesIncluded: data.reconciliation?.branchesIncluded || [],
      firstInvoiceDate: data.reconciliation?.firstInvoiceDate || null,
      lastInvoiceDate: data.reconciliation?.lastInvoiceDate || null,
      missingBranchCount: data.reconciliation?.missingBranchCount ?? 0,
      missingDoctorCount: data.reconciliation?.missingDoctorCount ?? 0,
      missingInvoiceKeyCount: data.reconciliation?.missingInvoiceKeyCount ?? 0,
      missingCustomerCodeCount: data.reconciliation?.missingCustomerCodeCount ?? 0,
    },
  };
}

export function hasSalesData(summary: { sales_total?: number | null }): boolean {
  return (summary?.sales_total ?? 0) > 0;
}

export function hasInvoiceData(summary: { invoices_count?: number | null }): boolean {
  return (summary?.invoices_count ?? 0) > 0;
}

export function shouldShowEmptyState(
  summary: { sales_total?: number; invoices_count?: number },
  isLoading: boolean
): boolean {
  if (isLoading) return false;
  return !hasSalesData(summary) && !hasInvoiceData(summary);
}

export function buildSalesMap(rows: Array<{ branch?: string; sales_total?: number }>) {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const branch = String(row.branch || 'غير محدد').trim();
    map.set(branch, (map.get(branch) || 0) + (Number(row.sales_total) || 0));
  });
  return map;
}

export function buildInvoiceCountMap(rows: Array<{ branch?: string; invoices_count?: number }>) {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const branch = String(row.branch || 'غير محدد').trim();
    map.set(branch, (map.get(branch) || 0) + (Number(row.invoices_count) || 0));
  });
  return map;
}

export function sanitizeDashboardNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function safeAverage(total: number, count: number): number {
  if (count <= 0) return 0;
  const avg = total / count;
  return Number.isFinite(avg) ? avg : 0;
}

export function safePercentage(value: number, total: number): number {
  if (total <= 0) return 0;
  const pct = (value / total) * 100;
  return Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
}
