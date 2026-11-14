import { Fragment, useState } from 'react';
import { ChevronDown, Loader2, Trash2 } from 'lucide-react';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import type { PurchaseBranch } from '@/lib/purchaseReview/ePlusReport';
import {
  PURCHASE_BRANCHES,
  type BillState,
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
import { billingLabel, count, dayLabel, money, shortBranch } from './shared';

// «علينا ولينا»: every supplier per branch with what is overdue, due this week, still running, and its
// bills; a row opens the bills, the payments and the supplier's payment terms.

const STATE: Record<BillState, { label: string; tone: string }> = {
  open: { label: 'شغّال', tone: 'info' },
  waiting: { label: 'مستني ميعاده', tone: 'neutral' },
  due_soon: { label: 'مستحق قريب', tone: 'warning' },
  overdue: { label: 'متأخر', tone: 'danger' },
  paid: { label: 'اتدفع', tone: 'success' },
};

type Filter = 'all' | PurchaseBranch;

export default function SupplierLedger({
  balances,
  payments,
  today,
  onChanged,
}: {
  balances: SupplierBalance[];
  payments: SupplierPayment[];
  today: string;
  onChanged: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [onlyOwed, setOnlyOwed] = useState(true);
  const shown = balances.filter(
    (b) => (filter === 'all' || b.branch === filter) && (!onlyOwed || Math.abs(b.balance) > 0.5)
  );
  const total = shown.reduce((s, b) => s + Math.max(0, b.balance), 0);
  const overdue = balances.filter((b) => b.overdue > 0.5);
  const overdueTotal = overdue.reduce((s, b) => s + b.overdue, 0);
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);

  // First use: the files start mid-way, and what was paid before is not in the system yet.
  const settleOverdue = async () => {
    if (
      !window.confirm(
        `هيتسجل إن كل الشهور اللي ميعادها فات اتدفعت (${count(overdue.length)} مورد بـ ${money(overdueTotal)}). تكمّل؟`
      )
    )
      return;
    setSettling(true);
    try {
      for (const b of overdue)
        await addSupplierPayment({
          supplier_code: b.code,
          branch: b.branch,
          amount: Math.round(b.overdue * 100) / 100,
          paid_on: today,
          note: 'تسوية: اللي ميعاده فات اتدفع',
        });
      setSettleError(null);
    } catch (err) {
      setSettleError(err instanceof Error ? err.message : 'تعذّر التسجيل');
    } finally {
      setSettling(false);
      await onChanged();
    }
  };

  return (
    <Panel className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="dawaa-title text-lg">علينا ولينا لكل مورد</h2>
          <p className="dawaa-caption text-xs font-bold">
            علينا {money(total)} · الآجل بيتقفل على شهر كل مورد، والدفعات بتقفل أقدم فاتورة الأول
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['all', ...PURCHASE_BRANCHES] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`dawaa-tab text-xs ${filter === f ? 'is-active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'الفرعين' : shortBranch(f)}
            </button>
          ))}
          <label className="inline-flex items-center gap-1 text-xs font-black">
            <input
              type="checkbox"
              checked={onlyOwed}
              onChange={(e) => setOnlyOwed(e.target.checked)}
            />
            اللي ليه رصيد بس
          </label>
          {overdue.length ? (
            <button
              type="button"
              disabled={settling}
              onClick={() => void settleOverdue()}
              className="dawaa-badge dawaa-badge--warning rounded-lg px-2.5 py-1 text-xs font-black"
            >
              {settling ? 'بيتسجل…' : 'تسوية البداية: كل المتأخر اتدفع'}
            </button>
          ) : null}
        </div>
      </div>
      {settleError ? (
        <p className="mb-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">
          {settleError}
        </p>
      ) : null}

      <div className="hidden overflow-x-auto md:block">
        <table className="dawaa-table w-full min-w-[760px] text-right text-sm">
          <thead>
            <tr>
              <th>المورد</th>
              <th>الفرع</th>
              <th>شهره</th>
              <th>متأخر</th>
              <th>مستحق قريب</th>
              <th>شغّال</th>
              <th>الرصيد</th>
              <th>الدفعة الجاية</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((b) => {
              const key = `${b.code}|${b.branch}`;
              const isOpen = open === key;
              return (
                <Fragment key={key}>
                  <tr
                    className="cursor-pointer"
                    onClick={() => setOpen(isOpen ? null : key)}
                    style={
                      b.overdue > 0.5 ? { background: 'var(--dawaa-status-danger-bg)' } : undefined
                    }
                  >
                    <td className="font-black">{b.name}</td>
                    <td>{shortBranch(b.branch)}</td>
                    <td className="dawaa-caption text-xs font-bold">
                      {billingLabel(b.terms?.month_start_day ?? 1)}
                      {b.terms?.pay_after_days ? ` + ${count(b.terms.pay_after_days)} يوم` : ''}
                    </td>
                    <td className="font-black text-[var(--dawaa-status-danger-text)]">
                      {b.overdue > 0.5 ? money(b.overdue) : '—'}
                    </td>
                    <td className="font-black text-[var(--dawaa-status-warning-text)]">
                      {b.dueSoon > 0.5 ? money(b.dueSoon) : '—'}
                    </td>
                    <td>{b.running > 0.5 ? money(b.running) : '—'}</td>
                    <td
                      className="font-black"
                      style={{
                        color:
                          b.balance < -0.5
                            ? 'var(--dawaa-status-success-text)'
                            : 'var(--dawaa-theme-heading)',
                      }}
                    >
                      {b.balance < -0.5 ? `لينا ${money(-b.balance)}` : money(b.balance)}
                    </td>
                    <td className="text-xs font-bold">{b.nextDue ? dayLabel(b.nextDue) : '—'}</td>
                    <td>
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={9} style={{ background: 'var(--dawaa-theme-surface-raised)' }}>
                        <SupplierDetails
                          balance={b}
                          payments={payments.filter(
                            (p) => p.supplier_code === b.code && p.branch === b.branch
                          )}
                          today={today}
                          onChanged={onChanged}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phones: one card per supplier, its details open under it. */}
      <div className="space-y-2 md:hidden">
        {shown.map((b) => {
          const key = `${b.code}|${b.branch}`;
          const isOpen = open === key;
          return (
            <div key={key}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : key)}
                className="dawaa-theme-border w-full rounded-xl border p-2.5 text-start text-xs font-bold"
                style={{
                  background:
                    b.overdue > 0.5
                      ? 'var(--dawaa-status-danger-bg)'
                      : 'var(--dawaa-theme-surface)',
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-black">
                    {b.name} <span className="dawaa-caption">· {shortBranch(b.branch)}</span>
                  </span>
                  <span
                    className="shrink-0 text-sm font-black tabular-nums"
                    style={{
                      color:
                        b.balance < -0.5
                          ? 'var(--dawaa-status-success-text)'
                          : 'var(--dawaa-theme-heading)',
                    }}
                  >
                    {b.balance < -0.5 ? `لينا ${money(-b.balance)}` : money(b.balance)}
                  </span>
                </div>
                <p className="dawaa-caption mt-1">
                  {b.overdue > 0.5 ? (
                    <span className="text-[var(--dawaa-status-danger-text)]">
                      متأخر {money(b.overdue)} ·{' '}
                    </span>
                  ) : null}
                  {b.dueSoon > 0.5 ? `قريب ${money(b.dueSoon)} · ` : ''}
                  {b.running > 0.5 ? `شغّال ${money(b.running)} · ` : ''}
                  {billingLabel(b.terms?.month_start_day ?? 1)}
                </p>
              </button>
              {isOpen ? (
                <div
                  className="mt-1 rounded-xl"
                  style={{ background: 'var(--dawaa-theme-surface-raised)' }}
                >
                  <SupplierDetails
                    balance={b}
                    payments={payments.filter(
                      (p) => p.supplier_code === b.code && p.branch === b.branch
                    )}
                    today={today}
                    onChanged={onChanged}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {!shown.length ? (
        <p className="dawaa-caption p-3 text-xs font-bold">مفيش موردين عليهم رصيد</p>
      ) : null}
    </Panel>
  );
}

function SupplierDetails({
  balance,
  payments,
  today,
  onChanged,
}: {
  balance: SupplierBalance;
  payments: SupplierPayment[];
  today: string;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر التحميل');
    }
  };

  const [paying, setPaying] = useState<string | null>(null);
  const markPaid = async (b: SupplierBalance['bills'][number]) => {
    setPaying(b.from);
    try {
      await addSupplierPayment({
        supplier_code: balance.code,
        branch: balance.branch,
        amount: Math.round(b.remaining * 100) / 100,
        paid_on: b.due < today ? b.due : today,
        note: `شهر ${dayLabel(b.from)} ← ${dayLabel(b.to)}`,
      });
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذّر التسجيل');
    } finally {
      setPaying(null);
    }
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
                {b.remaining > 0.5 && b.to < today ? (
                  <button
                    type="button"
                    disabled={paying !== null}
                    onClick={() => void markPaid(b)}
                    className="dawaa-badge dawaa-badge--success shrink-0 rounded-xl px-2.5 text-xs font-black"
                  >
                    {paying === b.from ? '…' : 'اتدفعت'}
                  </button>
                ) : null}
              </div>
              {bill === b.from ? (
                <div className="px-2 py-1.5 text-[11px] font-bold">
                  {error ? (
                    <p className="text-[var(--dawaa-status-danger-text)]">{error}</p>
                  ) : !invoices ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ul className="max-h-60 space-y-1 overflow-y-auto">
                      {invoices.map((i) => (
                        <li key={`${i.store}-${i.serial}`} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate">
                            {dayLabel(i.invoice_at.slice(0, 10))} · {i.store} · مسلسل {i.serial}
                            {i.supplier_invoice_no ? ` · فاتورة ${i.supplier_invoice_no}` : ''}
                            {i.entered_by ? ` · ${i.entered_by}` : ''}
                          </span>
                          <span className="shrink-0 tabular-nums">{money(i.net)}</span>
                        </li>
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
        <Payments balance={balance} payments={payments} today={today} onChanged={onChanged} />
        <TermsForm balance={balance} onChanged={onChanged} />
      </div>
    </div>
  );
}

function Payments({
  balance,
  payments,
  today,
  onChanged,
}: {
  balance: SupplierBalance;
  payments: SupplierPayment[];
  today: string;
  onChanged: () => Promise<void>;
}) {
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
        note: note.trim() || (oldDebt ? 'رصيد قديم' : null),
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
      <p className="mb-2 text-xs font-black">
        المدفوع {money(balance.paid)} من {money(balance.credit)}
      </p>
      {payments.length ? (
        <ul className="mb-2 space-y-1 text-[11px] font-bold">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {dayLabel(p.paid_on)} · {p.amount < 0 ? 'رصيد قديم' : 'دفعة'}
                {p.note ? ` · ${p.note}` : ''}
                {p.by ? ` · ${p.by}` : ''}
              </span>
              <span className="flex shrink-0 items-center gap-1 tabular-nums">
                {money(Math.abs(p.amount))}
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
          ده رصيد قديم علينا من قبل أول ملف (مش دفعة)
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="dawaa-badge dawaa-badge--success col-span-2 justify-center rounded-lg py-1.5 font-black"
        >
          {busy ? 'بيتسجل…' : oldDebt ? 'سجّل الرصيد القديم' : 'سجّل الدفعة'}
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
