import { getInvoiceAmount, getInvoiceDate, getInvoiceDoctor, getInvoiceKey } from '@/lib/dawaa2027';
import { getInvoicesForCustomer, type InvoiceLike } from '@/lib/salesInvoiceSource';

type Row = Record<string, unknown>;

export interface CustomerTimelineItem {
  id: string;
  type: 'invoice' | 'followup' | 'request' | 'note' | 'whatsapp';
  title: string;
  date: string | null;
  description: string;
}

export function buildCustomerTimeline(
  customer: Row,
  args: { invoices?: InvoiceLike[]; followups?: Row[]; requests?: Row[]; reviews?: Row[] }
): CustomerTimelineItem[] {
  const invoices = getInvoicesForCustomer(customer, args.invoices || []).map((invoice, index) => ({
    id: `invoice-${String(invoice.id || index)}`,
    type: 'invoice' as const,
    title: `فاتورة ${getInvoiceKey(invoice) || ''}`.trim(),
    date: String(getInvoiceDate(invoice) || '') || null,
    description: `${getInvoiceAmount(invoice).toLocaleString('ar-EG')} ج.م - ${getInvoiceDoctor(invoice) || 'غير محدد'}`,
  }));
  const followups = (args.followups || []).map((row, index) => ({
    id: `followup-${String(row.id || index)}`,
    type: 'followup' as const,
    title: 'متابعة عميل',
    date: String(row.followup_date || row.created_at || '') || null,
    description: String(row.notes || row.followup_result || row.status || ''),
  }));
  const requests = (args.requests || []).map((row, index) => ({
    id: `request-${String(row.id || index)}`,
    type: 'request' as const,
    title: String(row.item_name || 'طلب عميل'),
    date: String(row.created_at || row.requested_at || '') || null,
    description: String(row.current_stage || row.status || ''),
  }));
  return [...invoices, ...followups, ...requests].sort((a, b) =>
    String(b.date || '').localeCompare(String(a.date || ''))
  );
}
