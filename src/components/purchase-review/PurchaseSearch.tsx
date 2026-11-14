import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  saveSupplierTerms,
  searchReviewInvoices,
  type ReviewInvoice,
} from '@/lib/purchaseReview/api';
import {
  normalizeName,
  type SupplierBalance,
  type SupplierTerms,
} from '@/lib/purchaseReview/ledger';
import InvoiceRow from './InvoiceRow';
import { money, shortBranch } from './shared';

// Search by invoice number (our serial or the supplier's) or by supplier, and decide right there whether an
// invoice or a whole supplier counts in the debt or is an exception.

export default function PurchaseSearch({
  suppliers,
  balances,
  onChanged,
}: {
  suppliers: SupplierTerms[];
  balances: SupplierBalance[];
  onChanged: () => Promise<void>;
}) {
  const [query, setQuery] = useState('');
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

  const matchedSuppliers = useMemo(() => {
    if (q.length < 2) return [];
    const key = normalizeName(q, false);
    return suppliers
      .filter((s) => s.code === q || normalizeName(s.name, false).includes(key))
      .slice(0, 8);
  }, [q, suppliers]);

  const reload = async () => {
    await onChanged();
    if (q.length >= 2) setInvoices(await searchReviewInvoices(q).catch(() => invoices));
  };

  return (
    <Panel className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <Search className="h-5 w-5 text-[var(--dawaa-status-info-text)]" />
        <h2 className="dawaa-title text-lg">دوّر على فاتورة أو مورد</h2>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="رقم الفاتورة (المسلسل أو رقم فاتورة المورد) أو اسم المورد أو كوده"
        className="dawaa-theme-surface dawaa-theme-border w-full rounded-xl border px-3 py-2 text-sm font-bold"
      />
      {error ? (
        <p className="mt-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}

      {matchedSuppliers.length ? (
        <div className="mt-3 space-y-1.5">
          <p className="dawaa-caption text-[11px] font-black">الموردين</p>
          {matchedSuppliers.map((s) => (
            <SupplierRow
              key={s.code}
              supplier={s}
              balances={balances.filter((b) => b.code === s.code)}
              onChanged={reload}
            />
          ))}
        </div>
      ) : null}

      {q.length >= 2 ? (
        <div className="mt-3">
          <p className="dawaa-caption mb-1 flex items-center gap-1 text-[11px] font-black">
            الفواتير {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {invoices && invoices.length >= 150 ? ' (أول ١٥٠ بس، دقّق البحث)' : ''}
          </p>
          {invoices && !invoices.length && !searching ? (
            <p className="dawaa-caption text-xs font-bold">مفيش فواتير بالبحث ده</p>
          ) : null}
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {(invoices ?? []).map((i) => (
              <InvoiceRow
                key={`${i.store}-${i.serial}`}
                invoice={i}
                showSupplier
                onChanged={reload}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function SupplierRow({
  supplier,
  balances,
  onChanged,
}: {
  supplier: SupplierTerms;
  balances: SupplierBalance[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (
      !window.confirm(
        supplier.excluded
          ? `يرجع ${supplier.name} في المديونية والمشتريات؟`
          : `${supplier.name} يبقى مستثنى؟ فواتيره كلها هتطلع من المديونية والمشتريات.`
      )
    )
      return;
    setBusy(true);
    try {
      await saveSupplierTerms({
        code: supplier.code,
        month_start_day: supplier.month_start_day,
        pay_after_days: supplier.pay_after_days,
        excluded: !supplier.excluded,
        note: supplier.note,
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="dawaa-theme-border flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-bold"
      style={{ background: 'var(--dawaa-theme-surface)' }}
    >
      <span>
        <span className="font-black">{supplier.name}</span>{' '}
        <span className="dawaa-caption">كود {supplier.code}</span>
        {balances.map((b) => (
          <span key={b.branch} className="dawaa-caption">
            {' '}
            · {shortBranch(b.branch)}:{' '}
            {b.balance < -0.5 ? `لينا ${money(-b.balance)}` : `علينا ${money(b.balance)}`}
          </span>
        ))}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className={`dawaa-badge rounded-lg px-2.5 py-1 font-black ${supplier.excluded ? 'dawaa-badge--warning' : 'dawaa-badge--success'}`}
      >
        {busy ? '…' : supplier.excluded ? 'مستثنى · رجّعه' : 'داخل المديونية · استثنيه'}
      </button>
    </div>
  );
}
