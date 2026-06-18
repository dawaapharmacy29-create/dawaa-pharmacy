import { computeStaffSalesMetrics, type InvoiceLike } from '@/lib/salesInvoiceSource';
import { pointRecordDelta, type PointLedgerRecord } from '@/lib/pointsLedger';

type Row = Record<string, unknown>;

function text(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

export function getStaffMetrics(args: {
  staff: Row;
  invoices: InvoiceLike[];
  followups?: Row[];
  customerRequests?: Row[];
  transactions?: PointLedgerRecord[];
  conversationReviews?: Row[];
  tasks?: Row[];
}) {
  const name = text(args.staff, ['name', 'employee_name', 'staff_name']);
  const sales = computeStaffSalesMetrics(name, args.invoices);
  const transactions = args.transactions || [];
  const pointsDelta = transactions.reduce((sum, row) => sum + pointRecordDelta(row), 0);
  return {
    ...sales,
    followupsCompleted: (args.followups || []).filter(
      (row) =>
        String(text(row, ['status'])).includes('تم') ||
        String(text(row, ['status'])).includes('completed')
    ).length,
    customerRequestsRegistered: (args.customerRequests || []).length,
    pointsDelta,
    reviewsCount: (args.conversationReviews || []).length,
    pendingTasks: (args.tasks || []).filter(
      (row) => !['done', 'completed', 'closed'].includes(text(row, ['status']).toLowerCase())
    ).length,
  };
}
