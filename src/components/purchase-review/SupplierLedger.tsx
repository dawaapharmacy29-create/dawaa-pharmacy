import { useState } from 'react';
import { ChevronDown, Loader2, Trash2 } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  normalizeName,
  supplierRows,
  type BillState,
  type SupplierRow,
  type SupplierBalance,
  type SupplierPayment,
} from '@/lib/purchaseReview/ledger';
import {
  addSupplierPayment,
  deleteSupplierPayment,
  listReviewInvoices,
  saveSupplierTerms,
  type ReviewInvoice,
} from '@/lib/purchaseReview/api';
import InvoiceRow from './InvoiceRow';
import { billingLabel, count, dayLabel, money, shortBranch } from './shared';

// «الموردين»: one row per supplier (both branches together) with one status; a row opens each branch's
// bills, payments and the supplier's payment terms.

const STATE: Record<BillState, { label: string; tone: string }> = {
  open: { label: 'شغّال', tone: 'info' },
  waiting: { label: 'مستني ميعاده', tone: 'neutral' },
  due_soon: { label: 'مستحق قريب', tone: 'warning' },
  overdue: { label: 'متأخر', tone: 'danger' },
  paid: { label: 'اتدفع', tone: 'success' },
};

type Filter = 'owed' | 'overdue' | 'credit' | 'all';
const FILTERS: [Filter, string][] = [
  ['owed', 'عليه فلوس'],
  ['overdue', 'متأخر'],
  ['credit', 'لينا عنده'],
  ['all', 'الكل'],
];

function status(r: SupplierRow) {
  if (r.balance < -0.5) return { tone: 'success', text: `لينا ${money(-r.balance)}` };
  if (r.overdue > 0.5) return { tone: 'danger', text: `متأخر ${money(r.overdue)}` };
  if (r.dueSoon > 0.5 && r.nextDue)
    return { tone: 'warning', text: `يستحق ${dayLabel(r.nextDue)}` };
  if (r.running > 0.5) return { tone: 'info', text: 'فواتير الشهر بتتجمع' };
  if (r.balance > 0.5 && r.nextDue)
    return { tone: 'neutral', text: `ميعاده ${dayLabel(r.nextDue)}` };
  return { tone: 'neutral', text: 'خالص' };
}

export default function SupplierLedger({
  balances,
  payments,
  today,
  trackFrom,
  query,
  openCode,
  onOpen,
  onChanged,
}: {
  balances: SupplierBalance[];
  payments: SupplierPayment[];
  today: string;
  trackFrom: string | null;
  query: string;
  openCode: string | null;
  onOpen: (code: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>('owed');
  const rows = supplierRows(balances);
  const q = query.trim();
  const key = q.length >= 2 ? normalizeName(q, false) : '';
  const shown = rows.filter((r) =>
    key
      ? r.code === q || normalizeName(r.name, false).includes(key)
      : r.code === openCode ||
        (filter === 'all'
          ? true
          : filter === 'owed'
            ? r.balance > 0.5
            : filter === 'overdue'
              ? r.overdue > 0.5
              : r.balance < -0.5)
  );
  // Same total as «المطلوب دفعه»: each branch on its own, a credit in one does not cut the other.
  const owed = balances.reduce((s, b) => s + Math.max(0, b.balance), 0);

  return (
    <Panel className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-black">
          علينا للموردين {money(owed)}{' '}
          <span className="dawaa-caption text-xs">· {count(shown.length)} مورد</span>
        </p>
        {!key ? (
          <div className="flex flex-wrap gap-1">
            {FILTERS.map(([f, label]) => (
              <button
                key={f}
                type="button"
                className={`dawaa-tab text-xs ${filter === f ? 'is-active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ul className="space-y-1.5">
        {shown.map((r) => {
          const isOpen = openCode === r.code;
          const st = status(r);
          return (
            <li key={r.code}>
              <button
                type="button"
                onClick={() => onOpen(isOpen ? null : r.code)}
                className="dawaa-theme-border flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start"
                style={{
                  background: isOpen
                    ? 'var(--dawaa-theme-surface-raised)'
                    : 'var(--dawaa-theme-surface)',
                }}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-black">{r.name}</span>
                  <span className="dawaa-caption block text-[11px] font-bold">
                    {r.branches
                      .map(
                        (b) =>
                          `${shortBranch(b.branch)} ${b.balance < -0.5 ? `لينا ${money(-b.balance)}` : money(b.balance)}`
                      )
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`dawaa-badge dawaa-badge--${st.tone} text-[11px]`}>
                    {st.text}
                  </span>
                  <span className="w-24 text-end text-base font-black tabular-nums">
                    {r.balance < -0.5 ? '—' : money(r.balance)}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                  />
                </span>
              </button>
              {isOpen ? (
                <div className="mt-1 space-y-2">
                  {r.branches.map((b) => (
                    <div
                      key={b.branch}
                      className="rounded-xl p-2"
                      style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                    >
                      <p className="px-2 pt-1 text-xs font-black">
                        {b.branch}:{' '}
                        {b.balance < -0.5
                          ? `لينا ${money(-b.balance)}`
                          : `علينا ${money(b.balance)}`}
                        <span className="dawaa-caption">
                          {' '}
                          · شهره {billingLabel(b.terms?.month_start_day ?? 1)}
                          {b.terms?.pay_after_days ? ` + ${count(b.terms.pay_after_days)} يوم` : ''}
                        </span>
                      </p>
                      <SupplierDetails
                        balance={b}
                        payments={payments.filter(
                          (p) => p.supplier_code === b.code && p.branch === b.branch
                        )}
                        today={today}
                        trackFrom={trackFrom}
                        onChanged={onChanged}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {!shown.length ? (
        <p className="dawaa-caption p-3 text-xs font-bold">
          {key ? 'مفيش مورد بالاسم ده' : 'مفيش موردين هنا'}
        </p>
      ) : null}
    </Panel>
  );
}

function SupplierDetails({
  balance,
  payments,
  today,
  trackFrom,
  onChanged,
}: {
  balance: SupplierBalance;
  payments: SupplierPayment[];
  today: string;
  trackFrom: string | null;
  onChanged: () => Promise<void>;
}) {
  const [bill, setBill] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<ReviewInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openBill = async (from: string, to: string) => {
    if (bill === from) {
      setBill(null);
      return;
    }
    setBill(from);
    setInvoices(null);
    await loadBill(from, to);
  };
  const loadBill = async (from: string, to: string) => {
    try {
      setInvoices(
        (
          await listReviewInvoices({
            from,
            to,
            supplier_code: balance.code,
            branch: balance.branch,
          })
        ).filter((i) => i.payment === 'credit')
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر التحميل');
    }
  };
  const afterInvoiceChange = async () => {
    await onChanged();
    const b = balance.bills.find((x) => x.from === bill);
    if (b) await loadBill(b.from, b.to);
  };

  return (
    <div className="grid gap-3 p-2 lg:grid-cols-[1.4fr_1fr]">
      <div>
        <p className="mb-2 text-xs font-black">فواتير الشهر عند المورد</p>
        <div className="space-y-1.5">
          {[...balance.bills].reverse().map((b) => (
            <div key={b.from}>
              <div className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  onClick={() => void openBill(b.from, b.to)}
                  className="dawaa-theme-border flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-bold"
                  style={{ background: 'var(--dawaa-theme-surface)' }}
                >
                  <span>
                    {dayLabel(b.from)} ← {dayLabel(b.to)} · {count(b.invoices)} فاتورة
                    {b.partial ? (
                      <span className="dawaa-caption"> · أول الشهر قبل أول ملف اترفع</span>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums">{money(b.amount)}</span>
                    {b.paid > 0.5 && b.remaining > 0.5 ? (
                      <span className="dawaa-caption">فاضل {money(b.remaining)}</span>
                    ) : null}
                    <span className={`dawaa-badge dawaa-badge--${STATE[b.state].tone}`}>
                      {STATE[b.state].label}
                      {b.state !== 'paid' && b.state !== 'open' ? ` ${dayLabel(b.due)}` : ''}
                    </span>
                  </span>
                </button>
              </div>
              {bill === b.from ? (
                <div className="px-2 py-1.5 text-[11px] font-bold">
                  {error ? (
                    <p className="text-[var(--dawaa-status-danger-text)]">{error}</p>
                  ) : !invoices ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ul className="max-h-72 space-y-1 overflow-y-auto">
                      {invoices.map((i) => (
                        <InvoiceRow
                          key={`${i.store}-${i.serial}`}
                          invoice={i}
                          onChanged={afterInvoiceChange}
                        />
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <Payments
          balance={balance}
          payments={payments}
          today={today}
          trackFrom={trackFrom}
          onChanged={onChanged}
        />
        <TermsForm balance={balance} onChanged={onChanged} />
      </div>
    </div>
  );
}

function Payments({
  balance,
  payments,
  today,
  trackFrom,
  onChanged,
}: {
  balance: SupplierBalance;
  payments: SupplierPayment[];
  today: string;
  trackFrom: string | null;
  onChanged: () => Promise<void>;
}) {
  const shownPayments = payments
    .filter((p) => p.amount < 0 || !trackFrom || p.paid_on >= trackFrom)
    .slice()
    .reverse();
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState(today);
  const [note, setNote] = useState('');
  const [oldDebt, setOldDebt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setError(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حصل خطأ');
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const value = Number(amount.replace(/[,٬\s]/g, ''));
    if (!Number.isFinite(value) || value <= 0) {
      setError('اكتب المبلغ');
      return;
    }
    void run(async () => {
      await addSupplierPayment({
        supplier_code: balance.code,
        branch: balance.branch,
        amount: oldDebt ? -value : value,
        paid_on: day,
        note: note.trim() || (oldDebt ? 'رصيد أول المدة' : null),
      });
      setAmount('');
      setNote('');
    });
  };

  return (
    <div
      className="dawaa-theme-border rounded-xl border p-3"
      style={{ background: 'var(--dawaa-theme-surface)' }}
    >
      <p className="mb-1 text-xs font-black">
        فواتير آجل {money(balance.credit)} · اتدفع {money(balance.paid)}
        {balance.fromTreasury > 0.5 ? ` (منه ${money(balance.fromTreasury)} من الخزنة)` : ''}
      </p>
      <p className="dawaa-caption mb-2 text-[11px] font-bold">
        من {trackFrom ? dayLabel(trackFrom) : 'أول الملفات'} · الدفعات من الخزنة بتيجي لوحدها من
        التقارير المجمعة
      </p>
      {shownPayments.length ? (
        <ul className="mb-2 max-h-48 space-y-1 overflow-y-auto text-[11px] font-bold">
          {shownPayments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {dayLabel(p.paid_on)} ·{' '}
                {p.amount < 0
                  ? 'رصيد أول المدة'
                  : p.source === 'treasury'
                    ? 'من الخزنة'
                    : 'دفعة برة الخزنة'}
                {p.note ? ` · ${p.note}` : ''}
                {p.by ? ` · ${p.by}` : ''}
              </span>
              <span className="flex shrink-0 items-center gap-1 tabular-nums">
                {money(Math.abs(p.amount))}
                {p.source !== 'treasury' ? (
                  <button
                    type="button"
                    aria-label="مسح الدفعة"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('تمسح الدفعة دي؟'))
                        void run(() => deleteSupplierPayment(p.id));
                    }}
                    className="text-[var(--dawaa-status-danger-text)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <input
          inputMode="decimal"
          placeholder="المبلغ"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="dawaa-theme-surface dawaa-theme-border rounded-lg border px-2 py-1.5 font-bold"
        />
        <input
          type="date"
          value={day}
          max={today}
          onChange={(e) => setDay(e.target.value)}
          className="dawaa-theme-surface dawaa-theme-border rounded-lg border px-2 py-1.5 font-bold"
        />
        <input
          placeholder="ملاحظة (اختياري)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="dawaa-theme-surface dawaa-theme-border col-span-2 rounded-lg border px-2 py-1.5 font-bold"
        />
        <label className="col-span-2 inline-flex items-center gap-1 font-black">
          <input type="checkbox" checked={oldDebt} onChange={(e) => setOldDebt(e.target.checked)} />
          ده رصيد أول المدة علينا (فلوس قديمة قبل تاريخ المتابعة، مش دفعة)
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="dawaa-badge dawaa-badge--success col-span-2 justify-center rounded-lg py-1.5 font-black"
        >
          {busy
            ? 'بيتسجل…'
            : oldDebt
              ? 'سجّل رصيد أول المدة'
              : 'سجّل دفعة برة الخزنة (تحويل بنكي مثلاً)'}
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</p>
      ) : null}
    </div>
  );
}

function TermsForm({
  balance,
  onChanged,
}: {
  balance: SupplierBalance;
  onChanged: () => Promise<void>;
}) {
  const t = balance.terms;
  const [start, setStart] = useState(String(t?.month_start_day ?? 1));
  const [after, setAfter] = useState(String(t?.pay_after_days ?? 0));
  const [note, setNote] = useState(t?.note ?? '');
  const [excluded, setExcluded] = useState(Boolean(t?.excluded));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    const s = Number(start);
    const a = Number(after);
    if (!Number.isInteger(s) || s < 1 || s > 28 || !Number.isInteger(a) || a < 0 || a > 120) {
      setMsg('يوم البداية من ١ لـ ٢٨، والمهلة من ٠ لـ ١٢٠ يوم');
      return;
    }
    setBusy(true);
    try {
      await saveSupplierTerms({
        code: balance.code,
        month_start_day: s,
        pay_after_days: a,
        excluded,
        note: note || null,
      });
      setMsg('اتحفظ');
      await onChanged();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'تعذّر الحفظ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="dawaa-theme-border rounded-xl border p-3 text-xs"
      style={{ background: 'var(--dawaa-theme-surface)' }}
    >
      <p className="mb-2 font-black">طريقة الدفع مع {balance.name}</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="font-bold">
          شهره بيبدأ يوم
          <input
            type="number"
            min={1}
            max={28}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="dawaa-theme-surface dawaa-theme-border mt-1 w-full rounded-lg border px-2 py-1.5 font-bold"
          />
        </label>
        <label className="font-bold">
          بيتدفع بعد قفل الشهر بـ (يوم)
          <input
            type="number"
            min={0}
            max={120}
            value={after}
            onChange={(e) => setAfter(e.target.value)}
            className="dawaa-theme-surface dawaa-theme-border mt-1 w-full rounded-lg border px-2 py-1.5 font-bold"
          />
        </label>
        <input
          placeholder="تفاصيل الدفع (مثلاً: نص أول الشهر ونص يوم ١٥)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="dawaa-theme-surface dawaa-theme-border col-span-2 rounded-lg border px-2 py-1.5 font-bold"
        />
        <label className="col-span-2 inline-flex items-center gap-1 font-black">
          <input
            type="checkbox"
            checked={excluded}
            onChange={(e) => setExcluded(e.target.checked)}
          />
          مستثنى (تحويل بين مخازننا أو جرد، مش مشتريات)
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="dawaa-badge dawaa-badge--info col-span-2 justify-center rounded-lg py-1.5 font-black"
        >
          {busy ? 'بيتحفظ…' : 'احفظ'}
        </button>
      </div>
      {msg ? <p className="mt-1 font-bold">{msg}</p> : null}
    </div>
  );
}
