import {
  computeDashboardSalesMetrics,
  normalizeInvoice,
  type InvoiceLike,
} from '@/lib/salesInvoiceSource';

type Row = Record<string, unknown>;

export function getBranchMetrics(
  branch: string,
  args: { invoices: InvoiceLike[]; followups?: Row[]; requests?: Row[]; shortages?: Row[] }
) {
  const invoices = args.invoices.filter((invoice) => normalizeInvoice(invoice).branch === branch);
  const sales = computeDashboardSalesMetrics(invoices);
  return {
    branch,
    ...sales,
    followups: (args.followups || []).filter((row) => row.branch === branch).length,
    requests: (args.requests || []).filter((row) => row.branch === branch).length,
    shortages: (args.shortages || []).filter((row) => row.branch === branch).length,
  };
}
