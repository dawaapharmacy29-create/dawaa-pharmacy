import { useState } from 'react';
import { setInvoiceExcluded, type ReviewInvoice } from '@/lib/purchaseReview/api';
import { dayLabel, money, shortBranch } from './shared';

// One invoice with its «في المديونية / مستثناة» switch.

export default function InvoiceRow({
  invoice: i,
  showSupplier = false,
  onChanged,
}: {
  invoice: ReviewInvoice;
  showSupplier?: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const excluded = Boolean(i.excluded);

  const toggle = async () => {
    let note: string | null = null;
    if (!excluded) {
      const answer = window.prompt('ليه الفاتورة دي مستثناة؟ (اختياري)', '');
      if (answer === null) return;
      note = answer.trim() || null;
    }
    setBusy(true);
    try {
      await setInvoiceExcluded(i, !excluded, note);
      setError(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر الحفظ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className="dawaa-theme-border flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold"
      style={{
        background: excluded ? 'var(--dawaa-status-warning-bg)' : 'var(--dawaa-theme-surface)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span className="min-w-0 flex-1">
        {dayLabel(i.invoice_at.slice(0, 10))} · {i.store} ({shortBranch(i.branch)}) · مسلسل{' '}
        <span className="font-black">{i.serial}</span>
        {i.supplier_invoice_no ? ` · فاتورة المورد ${i.supplier_invoice_no}` : ''}
        {showSupplier ? <span className="font-black"> · {i.supplier_name}</span> : null}
        {` · ${i.payment === 'cash' ? 'نقدي' : 'آجل'}`}
        {i.entered_by ? <span className="dawaa-caption"> · {i.entered_by}</span> : null}
        {excluded && i.excluded_note ? (
          <span className="dawaa-caption"> · سبب الاستثناء: {i.excluded_note}</span>
        ) : null}
        {error ? <span className="text-[var(--dawaa-status-danger-text)]"> · {error}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className={`tabular-nums ${excluded ? 'line-through' : ''}`}>{money(i.net)}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void toggle()}
          className={`dawaa-badge rounded-md px-2 py-0.5 font-black ${excluded ? 'dawaa-badge--warning' : 'dawaa-badge--neutral'}`}
          title={excluded ? 'رجّعها في المديونية' : 'اطلّعها من المديونية'}
        >
          {excluded ? 'مستثناة · رجّعها' : 'استثنيها'}
        </button>
      </span>
    </li>
  );
}
