import { normalizeBranchName } from '@/lib/branch';
import { supabase } from '@/lib/supabase';

export type DashboardInvoiceHealthRead = {
  invoicesWithoutCustomerCode: number | null;
  invoicesWithoutCustomerPhone: number | null;
  invoicesWithoutSellerName: number | null;
  invoicesWithoutBranch: number | null;
  lastInvoiceDate: string | null;
  latestImportBatch: string | null;
  error: string | null;
};

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

export async function readDashboardInvoiceHealth(args: {
  startDate: string;
  endDate: string;
  branch?: string | null;
}): Promise<DashboardInvoiceHealthRead> {
  const rawBranch = String(args.branch || '').trim();
  const branch = !rawBranch || rawBranch === 'all' || rawBranch === 'الكل' || rawBranch === 'كل الفروع'
    ? null
    : normalizeBranchName(rawBranch);

  try {
    const { data, error } = await supabase.rpc('get_dashboard_invoice_health_v1', {
      p_start: args.startDate,
      p_end: args.endDate,
      p_branch: branch,
    });
    if (error) throw error;
    const row = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    return {
      invoicesWithoutCustomerCode: numberOrNull(row.invoicesWithoutCustomerCode),
      invoicesWithoutCustomerPhone: numberOrNull(row.invoicesWithoutCustomerPhone),
      invoicesWithoutSellerName: numberOrNull(row.invoicesWithoutSellerName),
      invoicesWithoutBranch: numberOrNull(row.invoicesWithoutBranch),
      lastInvoiceDate: row.lastInvoiceDate ? String(row.lastInvoiceDate) : null,
      latestImportBatch: row.latestImportBatch ? String(row.latestImportBatch) : null,
      error: null,
    };
  } catch (error) {
    return {
      invoicesWithoutCustomerCode: null,
      invoicesWithoutCustomerPhone: null,
      invoicesWithoutSellerName: null,
      invoicesWithoutBranch: null,
      lastInvoiceDate: null,
      latestImportBatch: null,
      error: error instanceof Error ? error.message : 'غير متاح حاليًا',
    };
  }
}
