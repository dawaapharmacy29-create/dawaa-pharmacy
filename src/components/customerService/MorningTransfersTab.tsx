import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCheck, Link2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import { useAuth } from '@/hooks/useAuth';
import {
  TRANSFER_MONEY_TOLERANCE,
  TRANSFER_PROBLEMS,
  loadTransferDay,
  pairPurchases,
  pairSaved,
  pairTransfers,
  problemLabel,
  saveTransferCheck,
  saveTransferSplit,
  transferIssues,
  withTransferCheck,
  type TransferCheck,
  type TransferDay,
  type TransferIssue,
  type TransferPair,
  type TransferPurchase,
  type TransferSale,
} from '@/lib/customerServiceTasks/morning';
import { BranchPicker, ProblemPicker } from './MorningPurchasesTab';
import TransferLinesCompare from './TransferLinesCompare';
import TransferAccuracyReport from './TransferAccuracyReport';
import TransferReturns from './TransferReturns';

// الخطوة التانية: التحويلات اللي دخلت فرعها. التحويل عندنا فاتورة بيع في الفرع اللي بعت (لعميل الفرع ده)
// وفاتورة شراء في الفرع ده من مورد الفرع التاني. الصفحة بتربطهم تلقائي، والبنت تأكد أو تربط بإيدها أو تسجل المشكلة.
// (2026-11-26) بيظهر اللي فيه مشكلة بس: كمية أو كود مختلف أو صنف مش موجود أو فرق فلوس فوق ٥٠ ج. المطابق بيتعتمد
// مرة واحدة، واللي اتراجع بيتشال من القايمة على طول من غير ما الصفحة كلها تتحمل تاني.

const fmtTime = (v: string) =>
  new Date(v.replace(' ', 'T')).toLocaleString('ar-EG', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
const money = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 2 });

const HOW: Record<TransferPair['how'], string> = {
  saved: 'متأكد',
  number: 'بالرقم',
  codes: 'نفس الأصناف',
  value_items: 'نفس القيمة والأصناف',
  split: 'بيع واحد على أكتر من شراء',
  value: 'نفس القيمة',
};

type View = 'review' | 'done' | 'all';
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'review', label: 'المشاكل بس' },
  { key: 'done', label: 'اتراجع' },
  { key: 'all', label: 'الكل' },
];

type Editing =
  | { kind: 'pair'; purchase: TransferPurchase; sale: TransferSale }
  | { kind: 'purchase'; purchase: TransferPurchase }
  | { kind: 'sale'; sale: TransferSale }
  | null;

/** What a form saved, so the page can update itself without reloading. */
export type TransferSaved = {
  purchases: Array<{ store: string; serial: string }>;
  saleInvoice: string | null;
  status: 'ok' | 'problem';
  problems: string[];
  note: string;
};

export default function MorningTransfersTab() {
  const { user } = useAuth();
  const [branch, setBranch] = useState<string | null>(null);
  const [day, setDay] = useState<TransferDay | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<View>('review');
  const [showReport, setShowReport] = useState(false);
  const [showReturns, setShowReturns] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      setDay(await loadTransferDay(branch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [branch]);
  useEffect(() => {
    void load();
  }, [load]);

  const me = user?.name || user?.username || 'أنا';
  const patch = useCallback(
    (s: TransferSaved) => {
      const check: TransferCheck = {
        status: s.status,
        problems: s.problems,
        note: s.note || null,
        by: me,
        at: new Date().toISOString(),
      };
      setDay((d) =>
        d ? withTransferCheck(d, { purchases: s.purchases, saleInvoice: s.saleInvoice }, check) : d
      );
    },
    [me]
  );

  const pairing = useMemo(() => (day ? pairTransfers(day.purchases, day.sales) : null), [day]);
  const rows = useMemo(
    () =>
      (pairing?.pairs ?? []).map((p) => ({ p, issues: transferIssues(p), saved: pairSaved(p) })),
    [pairing]
  );

  async function confirmPair(p: TransferPair) {
    if (p.rest.length)
      await saveTransferSplit({ purchases: pairPurchases(p), saleInvoice: p.sale.invoice });
    else
      await saveTransferCheck({
        purchaseStore: p.purchase.store,
        purchaseSerial: p.purchase.serial,
        saleInvoice: p.sale.invoice,
        status: 'ok',
        problems: [],
        note: '',
        branch: day!.branch,
      });
    patch({
      purchases: pairPurchases(p),
      saleInvoice: p.sale.invoice,
      status: 'ok',
      problems: [],
      note: '',
    });
  }

  async function confirm(p: TransferPair) {
    setBusy(p.purchase.serial);
    try {
      await confirmPair(p);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  async function confirmClean(list: TransferPair[]) {
    setBusy('bulk');
    let ok = 0;
    try {
      for (let i = 0; i < list.length; i += 4) {
        const part = list.slice(i, i + 4);
        const res = await Promise.allSettled(part.map((p) => confirmPair(p)));
        ok += res.filter((r) => r.status === 'fulfilled').length;
      }
      if (ok === list.length) toast.success(`اتعتمد ${ok} تحويل مطابق`);
      else toast.warning(`اتعتمد ${ok} من ${list.length}، جرّبي الباقي تاني`);
    } finally {
      setBusy('');
    }
  }

  if (error)
    return (
      <Panel>
        <EmptyState label={error} />
        <button className="btn-secondary mt-2" onClick={() => void load()}>
          إعادة المحاولة
        </button>
      </Panel>
    );
  if (!day || !pairing)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin" />
      </div>
    );

  const clean = rows.filter((r) => !r.saved && !r.issues.length);
  const needPairs = rows.filter((r) => !r.saved && r.issues.length);
  const donePairs = rows.filter((r) => r.saved);
  const openPurchases = pairing.purchasesOnly.filter((p) => !p.check);
  const openSales = pairing.salesOnly.filter((s) => !s.check);
  const need = needPairs.length + openPurchases.length + openSales.length;
  const doneCount =
    donePairs.length +
    (pairing.purchasesOnly.length - openPurchases.length) +
    (pairing.salesOnly.length - openSales.length);

  const shownPairs = view === 'review' ? needPairs : view === 'done' ? donePairs : rows;
  const shownPurchases =
    view === 'review'
      ? openPurchases
      : view === 'done'
        ? pairing.purchasesOnly.filter((p) => p.check)
        : pairing.purchasesOnly;
  const shownSales =
    view === 'review'
      ? openSales
      : view === 'done'
        ? pairing.salesOnly.filter((s) => s.check)
        : pairing.salesOnly;

  const supplierName = day.branch === 'فرع شكري' ? 'دواء الشامي' : 'دواء ابو العزم';
  const customerName = day.branch === 'فرع شكري' ? 'فرع ابو العزم (170)' : 'دواء الشامي (10)';

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle
          title="٢) التحويلات اللي دخلت الفرع"
          subtitle={`شراء ${day.branch} من «${supplierName}» قصاد بيع ${day.sale_branch} للعميل «${customerName}»`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BranchPicker branch={day.branch} canPick={day.can_pick} onChange={setBranch} />
          <button
            className="btn-secondary inline-flex items-center gap-1"
            onClick={() => void load()}
          >
            <RefreshCw size={16} /> تحديث
          </button>
          <div className="mr-auto inline-flex rounded-xl border border-[var(--dawaa-theme-border)] p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                type="button"
                className={`rounded-lg px-3 py-1 text-xs font-black ${
                  view === v.key
                    ? 'bg-[var(--dawaa-theme-primary,#0f766e)] text-white'
                    : 'opacity-70'
                }`}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniBox label="محتاج مراجعة" value={String(need)} tone={need ? 'amber' : 'green'} />
          <MiniBox label="مطابق تلقائي" value={String(clean.length)} tone="blue" />
          <MiniBox label="اتراجع" value={String(doneCount)} tone="green" />
          <MiniBox
            label="من غير ربط"
            value={String(pairing.purchasesOnly.length + pairing.salesOnly.length)}
            tone={pairing.purchasesOnly.length + pairing.salesOnly.length ? 'amber' : 'cyan'}
          />
        </div>
        {clean.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--dawaa-theme-soft)] p-2 text-sm">
            <span className="font-bold">
              {clean.length} تحويل مطابق: نفس الأصناف والكميات والفرق أقل من{' '}
              {TRANSFER_MONEY_TOLERANCE} ج.
            </span>
            <button
              className="btn-primary !px-3 !py-1 mr-auto inline-flex items-center gap-1"
              disabled={busy === 'bulk'}
              onClick={() => void confirmClean(clean.map((r) => r.p))}
            >
              {busy === 'bulk' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <CheckCheck size={14} />
              )}{' '}
              اعتمدي المطابق كله
            </button>
          </div>
        ) : null}
        {day.purchases.length > 0 && day.sales.length === 0 ? (
          <p className="mt-2 text-sm font-black text-[var(--dawaa-status-danger-text)]">
            مفيش ولا فاتورة بيع من {day.sale_branch} لسه. غالباً فواتير البيع لسه مترفعتش (بتترفع
            حوالي الضهر)، فاستني الرفع قبل ما تسجلي «مش متسجلة بيع».
          </p>
        ) : null}
      </Panel>

      {editing ? (
        <Panel>
          <TransferForm
            editing={editing}
            branch={day.branch}
            salesOnly={pairing.salesOnly}
            onClose={() => setEditing(null)}
            onSaved={(s) => {
              setEditing(null);
              patch(s);
              // الربط بإيدها بيغيّر الربط التلقائي: نحدّث في الخلفية من غير ما الصفحة تقف.
              void load();
            }}
          />
        </Panel>
      ) : null}

      {view === 'review' && need === 0 ? (
        <Panel>
          <EmptyState
            label={
              clean.length
                ? 'مفيش مشاكل. اعتمدي المطابق من فوق وخلصتي 👌'
                : 'مفيش حاجة محتاجة مراجعة 👌'
            }
          />
        </Panel>
      ) : null}

      {shownPairs.length ? (
        <Panel>
          <SectionTitle
            title={view === 'done' ? 'اتراجعت' : view === 'review' ? 'فيها اختلاف' : 'مربوطين'}
            subtitle="الكمية والكود والصنف الناقص الأول. فرق الفلوس بيظهر بس لو أكتر من ٥٠ ج"
          />
          <div className="mt-2 space-y-2">
            {shownPairs.map(({ p, issues, saved }) => (
              <PairCard
                key={p.purchase.serial}
                p={p}
                issues={issues}
                saved={saved}
                busy={busy === p.purchase.serial}
                onConfirm={() => void confirm(p)}
                onProblem={() => setEditing({ kind: 'pair', purchase: p.purchase, sale: p.sale })}
                onUnlink={() => setEditing({ kind: 'purchase', purchase: p.purchase })}
              />
            ))}
          </div>
        </Panel>
      ) : null}

      {shownPurchases.length ? (
        <Panel>
          <SectionTitle
            title={`شراء في ${day.branch} ملهوش بيع`}
            subtitle="اربطيه برقم فاتورة البيع، أو سجّلي إنه مش متسجل بيع"
          />
          <div className="mt-2 space-y-2">
            {shownPurchases.map((p) => (
              <div
                key={p.serial}
                className="rounded-2xl border-r-4 border border-[var(--dawaa-theme-border)] border-r-[var(--dawaa-status-warning-text,#b45309)] p-3"
              >
                <PurchaseCard p={p} />
                {p.lines.length ? <ItemList items={p.lines} /> : null}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {p.check ? (
                    <span className="font-black text-[var(--dawaa-status-danger-text)]">
                      {p.check.problems.map(problemLabel).join('، ')} · {p.check.by}
                    </span>
                  ) : null}
                  <button
                    className="btn-secondary !px-2 !py-1 mr-auto inline-flex items-center gap-1"
                    onClick={() => setEditing({ kind: 'purchase', purchase: p })}
                  >
                    <Link2 size={14} /> اربط أو سجّل المشكلة
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {shownSales.length ? (
        <Panel>
          <SectionTitle
            title={`بيع في ${day.sale_branch} ملهوش شراء عندنا`}
            subtitle="لو الصنف وصل ومتسجلش شراء، سجّلي المشكلة"
          />
          <div className="mt-2 space-y-2">
            {shownSales.map((s) => (
              <div
                key={s.invoice}
                className="rounded-2xl border-r-4 border border-[var(--dawaa-theme-border)] border-r-[var(--dawaa-status-warning-text,#b45309)] p-3"
              >
                <SaleCard s={s} />
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {s.check ? (
                    <span
                      className={
                        s.check.status === 'ok'
                          ? 'font-black'
                          : 'font-black text-[var(--dawaa-status-danger-text)]'
                      }
                    >
                      {s.check.purchase_serial
                        ? `مربوطة بمسلسل ${s.check.purchase_serial}`
                        : s.check.problems.map(problemLabel).join('، ')}{' '}
                      · {s.check.by}
                    </span>
                  ) : null}
                  {!s.check?.purchase_serial ? (
                    <button
                      className="btn-secondary !px-2 !py-1 mr-auto inline-flex items-center gap-1"
                      onClick={() => setEditing({ kind: 'sale', sale: s })}
                    >
                      <TriangleAlert size={14} /> سجّل المشكلة
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {showReturns ? (
        <TransferReturns branch={day?.branch ?? branch} />
      ) : (
        <button className="btn-secondary w-full" onClick={() => setShowReturns(true)}>
          مرتجعات التحويلات
        </button>
      )}

      {showReport ? (
        <TransferAccuracyReport />
      ) : (
        <button className="btn-secondary w-full" onClick={() => setShowReport(true)}>
          تقرير دقة التحويلات (فترة)
        </button>
      )}
    </div>
  );
}

const ISSUE_TONE: Record<TransferIssue['kind'], string> = {
  qty: 'bg-[var(--dawaa-status-danger-bg,#fee2e2)] text-[var(--dawaa-status-danger-text)]',
  missing: 'bg-[var(--dawaa-status-danger-bg,#fee2e2)] text-[var(--dawaa-status-danger-text)]',
  code: 'bg-[var(--dawaa-status-warning-bg,#fef3c7)] text-[var(--dawaa-status-warning-text,#b45309)]',
  count:
    'bg-[var(--dawaa-status-warning-bg,#fef3c7)] text-[var(--dawaa-status-warning-text,#b45309)]',
  money:
    'bg-[var(--dawaa-status-warning-bg,#fef3c7)] text-[var(--dawaa-status-warning-text,#b45309)]',
};

function PairCard({
  p,
  issues,
  saved,
  busy,
  onConfirm,
  onProblem,
  onUnlink,
}: {
  p: TransferPair;
  issues: TransferIssue[];
  saved: boolean;
  busy: boolean;
  onConfirm: () => void;
  onProblem: () => void;
  onUnlink: () => void;
}) {
  const all = pairPurchases(p);
  const edge = saved
    ? p.purchase.check?.status === 'ok'
      ? 'border-r-[var(--dawaa-status-success-text)]'
      : 'border-r-[var(--dawaa-status-danger-text)]'
    : issues.length
      ? 'border-r-[var(--dawaa-status-danger-text)]'
      : 'border-r-[var(--dawaa-status-success-text)]';
  return (
    <div className={`rounded-2xl border border-r-4 border-[var(--dawaa-theme-border)] p-3 ${edge}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {issues.map((x) => (
          <span
            key={x.kind}
            className={`rounded-full px-2 py-0.5 font-black ${ISSUE_TONE[x.kind]}`}
          >
            {x.label}
          </span>
        ))}
        {!issues.length ? (
          <span className="rounded-full bg-[var(--dawaa-theme-soft)] px-2 py-0.5 font-black text-[var(--dawaa-status-success-text)]">
            مطابق
          </span>
        ) : null}
        <span className="rounded-full bg-[var(--dawaa-theme-soft)] px-2 py-0.5 font-bold opacity-70">
          اتربط {HOW[p.how]}
        </span>
        {saved ? (
          <span
            className={
              p.purchase.check!.status === 'ok'
                ? 'font-black text-[var(--dawaa-status-success-text)]'
                : 'font-black text-[var(--dawaa-status-danger-text)]'
            }
          >
            {p.purchase.check!.status === 'ok'
              ? 'اتأكد'
              : `مشكلة: ${p.purchase.check!.problems.map(problemLabel).join('، ')}`}{' '}
            · {p.purchase.check!.by}
          </span>
        ) : null}
      </div>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          {all.map((x) => (
            <PurchaseCard key={x.serial} p={x} />
          ))}
          {p.rest.length ? (
            <div className="text-xs font-black">
              مجموع الشراء {money(all.reduce((t, x) => t + x.net, 0))} ج على {all.length} فواتير
            </div>
          ) : null}
        </div>
        <SaleCard s={p.sale} compact={all.every((x) => x.lines.length > 0)} />
      </div>
      <TransferLinesCompare purchases={all} sale={p.sale} onlyIssues={issues.length > 0} />
      <div className="mt-2 flex flex-wrap justify-end gap-1 text-xs">
        <button
          className="btn-primary !px-3 !py-1 inline-flex items-center gap-1"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} مطابق
        </button>
        <button
          className="btn-secondary !px-2 !py-1 inline-flex items-center gap-1"
          onClick={onProblem}
        >
          <TriangleAlert size={14} /> مشكلة
        </button>
        <button
          className="btn-secondary !px-2 !py-1 inline-flex items-center gap-1"
          onClick={onUnlink}
        >
          <Link2 size={14} /> مش دي
        </button>
      </div>
    </div>
  );
}

function PurchaseCard({ p }: { p: TransferPurchase }) {
  return (
    <div className="text-sm">
      <div className="text-xs font-bold opacity-70">شراء · {p.store}</div>
      <div className="font-black">
        مسلسل {p.serial} · {money(p.net)} ج · {p.items} صنف
      </div>
      <div className="text-xs opacity-70">
        {fmtTime(p.invoice_at)} · سجّلها {p.entered_by ?? '—'}
        {p.supplier_invoice_no ? ` · رقم المورد ${p.supplier_invoice_no}` : ''}
      </div>
    </div>
  );
}

function ItemList({ items }: { items: Array<{ code: string; name: string; qty: number }> }) {
  return (
    <ul className="mt-1 list-disc pr-5 text-xs" dir="auto">
      {items.slice(0, 8).map((it, n) => (
        <li key={n}>
          <span className="font-mono opacity-60">{it.code}</span> {it.name} × {it.qty}
        </li>
      ))}
      {items.length > 8 ? <li>و{items.length - 8} صنف كمان</li> : null}
    </ul>
  );
}

function SaleCard({ s, compact }: { s: TransferSale; compact?: boolean }) {
  return (
    <div className="text-sm">
      <div className="text-xs font-bold opacity-70">بيع · فاتورة {s.invoice}</div>
      <div className="font-black">
        {money(s.net)} ج · {s.lines} صنف
      </div>
      <div className="text-xs opacity-70">
        {fmtTime(s.at)} · {s.seller ?? '—'}
      </div>
      {s.items.length && !compact ? <ItemList items={s.items} /> : null}
    </div>
  );
}

function TransferForm({
  editing,
  branch,
  salesOnly,
  onClose,
  onSaved,
}: {
  editing: NonNullable<Editing>;
  branch: string;
  salesOnly: TransferSale[];
  onClose: () => void;
  onSaved: (saved: TransferSaved) => void;
}) {
  const purchase = editing.kind === 'sale' ? null : editing.purchase;
  const initialSale =
    editing.kind === 'pair'
      ? editing.sale.invoice
      : editing.kind === 'sale'
        ? editing.sale.invoice
        : '';
  const [sale, setSale] = useState(initialSale);
  const [problems, setProblems] = useState<string[]>(
    editing.kind === 'sale' ? ['no_purchase'] : editing.kind === 'purchase' ? [] : []
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const linking = editing.kind === 'purchase';

  async function save(status: 'ok' | 'problem') {
    if (status === 'problem' && problems.length === 0) {
      toast.error('اختاري نوع المشكلة');
      return;
    }
    setSaving(true);
    try {
      const saleInvoice = editing.kind === 'sale' ? editing.sale.invoice : sale.trim() || null;
      const saved = {
        status,
        problems: status === 'ok' ? [] : problems,
        note,
      };
      await saveTransferCheck({
        purchaseStore: purchase?.store ?? null,
        purchaseSerial: purchase?.serial ?? null,
        saleInvoice,
        ...saved,
        branch,
      });
      toast.success('اتحفظ');
      onSaved({
        ...saved,
        purchases: purchase ? [{ store: purchase.store, serial: purchase.serial }] : [],
        saleInvoice,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <SectionTitle
        title={
          editing.kind === 'sale'
            ? `فاتورة بيع ${editing.sale.invoice} ملهاش شراء`
            : linking
              ? `ربط مسلسل ${purchase!.serial} بفاتورة البيع`
              : `مشكلة في تحويل مسلسل ${purchase!.serial}`
        }
      />
      {editing.kind !== 'sale' ? (
        <label className="block text-xs font-bold">
          رقم فاتورة البيع في الفرع التاني (سيبيه فاضي لو مفيش بيع خالص)
          <input
            className="input-field mt-1"
            value={sale}
            onChange={(e) => setSale(e.target.value)}
            list="cs-transfer-open-sales"
          />
          <datalist id="cs-transfer-open-sales">
            {salesOnly.map((s) => (
              <option key={s.invoice} value={s.invoice}>
                {money(s.net)} ج · {s.lines} صنف
              </option>
            ))}
          </datalist>
        </label>
      ) : null}
      <div>
        <span className="text-xs font-bold">المشكلة</span>
        <div className="mt-1">
          <ProblemPicker options={TRANSFER_PROBLEMS} value={problems} onChange={setProblems} />
        </div>
      </div>
      <label className="block text-xs font-bold">
        ملاحظة (اختياري)
        <input
          className="input-field mt-1"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="مثلاً: صنف كذا اتباع ٣ واتشرى ٢"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {linking ? (
          <button
            className="btn-primary inline-flex items-center gap-1"
            disabled={saving || !sale.trim()}
            onClick={() => void save('ok')}
          >
            <Check size={16} /> اربط ومطابق
          </button>
        ) : null}
        <button
          className={
            linking
              ? 'btn-secondary inline-flex items-center gap-1'
              : 'btn-primary inline-flex items-center gap-1'
          }
          disabled={saving}
          onClick={() => void save('problem')}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <TriangleAlert size={16} />}{' '}
          سجّل المشكلة
        </button>
        <button className="btn-secondary" disabled={saving} onClick={onClose}>
          إلغاء
        </button>
      </div>
    </div>
  );
}
