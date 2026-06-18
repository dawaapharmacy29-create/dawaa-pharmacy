import { computeDashboardSalesMetrics, type InvoiceLike } from '@/lib/salesInvoiceSource';

type Row = Record<string, unknown>;

function open(row: Row) {
  const status = String(row.status || row.current_stage || '').toLowerCase();
  return !['done', 'completed', 'closed', 'delivered', 'cancelled', 'تم', 'مكتمل', 'ملغي'].some(
    (x) => status.includes(x)
  );
}

export function getDashboardMetrics(args: {
  invoices: InvoiceLike[];
  customers?: Row[];
  followups?: Row[];
  customerRequests?: Row[];
  transactions?: Row[];
}) {
  const sales = computeDashboardSalesMetrics(args.invoices);
  return {
    ...sales,
    customersCount: args.customers?.length || 0,
    openFollowups: (args.followups || []).filter(open).length,
    openCustomerRequests: (args.customerRequests || []).filter(open).length,
    rewards: (args.transactions || []).filter(
      (row) =>
        String(row.type || '')
          .toLowerCase()
          .includes('reward') || String(row.type || '').includes('مكاف')
    ).length,
    penalties: (args.transactions || []).filter(
      (row) =>
        String(row.type || '')
          .toLowerCase()
          .includes('penalty') || String(row.type || '').includes('خصم')
    ).length,
  };
}
