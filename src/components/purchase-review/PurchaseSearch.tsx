import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import { searchReviewInvoices, type ReviewInvoice } from '@/lib/purchaseReview/api';
import InvoiceRow from './InvoiceRow';

// The invoices matching the suppliers tab's search: our serial, the supplier's invoice number, or the
// supplier's name or code; each one can be taken out of the debt right there.

export default function PurchaseSearch({
  query,
  onChanged,
}: {
  query: string;
  onChanged: () => Promise<void>;
}) {
  const [invoices, setInvoices] = useState<ReviewInvoice[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) {
      setInvoices(null);
      return;
    }
    let live = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchReviewInvoices(q)
        .then((rows) => live && (setInvoices(rows), setError(null)))
        .catch((err) => live && setError(err instanceof Error ? err.message : 'تعذّر البحث'))
        .finally(() => live && setSearching(false));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  if (q.length < 2) return null;

  const reload = async () => {
    await onChanged();
    setInvoices(await searchReviewInvoices(q).catch(() => invoices));
  };

  return (
    <Panel className="p-4">
      <p className="dawaa-caption mb-2 flex items-center gap-1 text-xs font-black">
        الفواتير{' '}
        {invoices ? `(${invoices.length >= 150 ? 'أول ١٥٠، دقّق البحث' : invoices.length})` : ''}
        {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      </p>
      {error ? (
        <p className="text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}
      {invoices && !invoices.length && !searching ? (
        <p className="dawaa-caption text-xs font-bold">مفيش فواتير بالبحث ده</p>
      ) : null}
      <ul className="max-h-96 space-y-1 overflow-y-auto">
        {(invoices ?? []).map((i) => (
          <InvoiceRow key={`${i.store}-${i.serial}`} invoice={i} showSupplier onChanged={reload} />
        ))}
      </ul>
    </Panel>
  );
}
