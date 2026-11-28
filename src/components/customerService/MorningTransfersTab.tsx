import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Link2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
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
  saveTransferMultiSale,
  pairSales,
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
// تسجيل المشكلة يبقيها في قائمة المراجعة. التأكيد المحفوظ ينقل التحويل للمعتمدة.

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
  multi_sale: 'شراء واحد على أكتر من بيع',
  value: 'نفس القيمة',
};

type View = 'review' | 'done' | 'all';
const VIEWS: Array<{ key: View; label: string }> = [
  { key: 'review', label: 'محتاج مراجعة' },
  { key: 'done', label: 'المعتمدة' },
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
  /** The other sales of a purchase saved against several sales. */
  extraSales?: string[];
};

export default function MorningTransfersTab({ initialBranch = null, initialDay = '' }: {
  initialBranch?: string | null;
  initialDay?: string;
} = {}) {
  const { user } = useAuth();
  const [branch, setBranch] = useState<string | null>(initialBranch);
  const [pickedDay, setPickedDay] = useState(initialDay);
  const [day, setDay] = useState<TransferDay | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<View>('review');
  const [search, setSearch] = useState('');
  const formRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  useEffect(() => {
    if (editing) formRef.current?.focus();
  }, [editing]);
  const [showReport, setShowReport] = useState(false);
  const [showReturns, setShowReturns] = useState(false);

  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      setError('');
      const result = await loadTransferDay(branch, pickedDay || null);
      if (id === request.current) setDay(result);
    } catch (e) {
      if (id === request.current) setError(e instanceof Error ? e.message : String(e));
    }
  }, [branch, pickedDay]);
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
        extra_sales: s.extraSales ?? [],
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
      (pairing?.pairs ?? []).map((p) => ({ p, issues: transferIssues(p), saved: pairSaved(p),
        hasDetails: pairPurchases(p).every((purchase) => purchase.lines.length > 0) && p.sale.items.length > 0,
      })),
    [pairing]
  );

  async function confirmPair(p: TransferPair) {
    if (p.sale.parts) {
      const sales = pairSales(p.sale).map((s) => s.invoice);
      await saveTransferMultiSale({ purchase: p.purchase, sales });
      patch({
        purchases: pairPurchases(p),
        saleInvoice: sales[0],
        extraSales: sales.slice(1),
        status: 'ok',
        problems: [],
        note: '',
      });
      return;
    }
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
        day: day!.day,
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
      toast.success('التحويل اتعمد واتنقل لتبويب المعتمدة');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
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

  const donePairs = rows.filter(({ p, saved }) =>
    saved && pairPurchases(p).every((purchase) => purchase.check?.status === 'ok')
  );
  const approvedPairs = new Set(donePairs);
  const needPairs = rows.filter((row) => !approvedPairs.has(row));
  const clean = needPairs.filter(({ p, hasDetails, issues }) =>
    hasDetails && !issues.length && pairPurchases(p).every((purchase) => !purchase.check)
  );
  const openPurchases = pairing.purchasesOnly.filter((p) => p.check?.status !== 'ok');
  const openSales = pairing.salesOnly.filter((s) => s.check?.status !== 'ok');
  const need = needPairs.length + openPurchases.length + openSales.length;
  const doneCount =
    donePairs.length +
    (pairing.purchasesOnly.length - openPurchases.length) +
    (pairing.salesOnly.length - openSales.length);

  const invoiceQuery = search.trim().replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) & 15));
  const matches = (...values: Array<string | null | undefined>) =>
    !invoiceQuery || values.some((value) => value?.includes(invoiceQuery));
  const reviewPairs = [...needPairs].sort((a, b) =>
    Number(clean.includes(a)) - Number(clean.includes(b))
  );
  const shownPairs = (view === 'review' ? reviewPairs : view === 'done' ? donePairs : rows).filter(
    ({ p }) => matches(...pairPurchases(p).flatMap((item) => [item.serial, item.supplier_invoice_no]),
      ...pairSales(p.sale).map((sale) => sale.invoice))
  );
  const shownPurchases =
    (view === 'review'
      ? openPurchases
      : view === 'done'
        ? pairing.purchasesOnly.filter((p) => p.check?.status === 'ok')
        : pairing.purchasesOnly).filter((p) => matches(p.serial, p.supplier_invoice_no));
  const shownSales =
    (view === 'review'
      ? openSales
      : view === 'done'
        ? pairing.salesOnly.filter((s) => s.check?.status === 'ok')
        : pairing.salesOnly).filter((s) => matches(s.invoice));

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
          <BranchPicker branch={day.branch} canPick={day.can_pick} onChange={(next) => {
            if (next === day.branch) return;
            setEditing(null);
            setDay(null);
            setBranch(next);
          }} />
          <label className="text-xs font-bold">
            الفترة تنتهي الساعة ٩ صباحًا يوم
            <input type="date" className="input-field mt-1 !w-auto" value={pickedDay || day.day}
              onChange={(event) => {
                if (!event.target.value || event.target.value === (pickedDay || day.day)) return;
                setEditing(null);
                setDay(null);
                setPickedDay(event.target.value);
              }} />
          </label>
          {pickedDay ? <button type="button" className="btn-secondary" onClick={() => {
            setEditing(null);
            setDay(null);
            setPickedDay('');
          }}>الفترة الحالية</button> : null}
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
        <p className="mt-2 text-xs opacity-75">
          من {day.from.slice(0, 10)} الساعة ٩ ص لحد {day.to.slice(0, 10)} الساعة ٩ ص.
          مشتريات الموردين الخارجيين تظهر في مراجعة المشتريات.
        </p>
        <label className="mt-3 block text-xs font-bold">
          ابحث برقم فاتورة البيع أو مسلسل الشراء
          <input className="input-field mt-1" inputMode="numeric" value={search}
            onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniBox label="محتاج مراجعة" value={String(need)} tone={need ? 'amber' : 'green'} />
          <MiniBox label="مقترح للاعتماد" value={String(clean.length)} tone="blue" />
          <MiniBox label="معتمدة" value={String(doneCount)} tone="green" />
          <MiniBox
            label="من غير ربط"
            value={String(openPurchases.length + openSales.length)}
            tone={openPurchases.length + openSales.length ? 'amber' : 'cyan'}
          />
        </div>
        {clean.length ? (
          <p className="mt-2 text-xs font-bold opacity-70">
            {clean.length} تحويل مطابق (نفس الأصناف والكميات والفرق أقل من{' '}
            {TRANSFER_MONEY_TOLERANCE} ج) جاهزين للتأكيد بعد مراجعة الربط.
          </p>
        ) : null}
        {day.purchases.length > 0 && day.sales.length === 0 ? (
          <p className="mt-2 text-sm font-black text-[var(--dawaa-status-danger-text)]">
            مفيش ولا فاتورة بيع من {day.sale_branch} لسه. غالباً فواتير البيع لسه مترفعتش (بتترفع
            حوالي الضهر)، فاستني الرفع قبل ما تسجلي «مش متسجلة بيع».
          </p>
        ) : null}
      </Panel>

      {editing ? (
        <div ref={formRef} tabIndex={-1}>
        <Panel>
          <TransferForm
            key={editing.kind === 'sale' ? `sale:${editing.sale.invoice}` : `${editing.kind}:${editing.purchase.store}:${editing.purchase.serial}`}
            editing={editing}
            branch={day.branch}
            day={day.day}
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
        </div>
      ) : null}

      {invoiceQuery && !shownPairs.length && !shownPurchases.length && !shownSales.length ? (
        <Panel><EmptyState label="رقم الفاتورة مش موجود في العرض الحالي" /></Panel>
      ) : null}

      {!invoiceQuery && view === 'review' && need === 0 ? (
        <Panel>
          <EmptyState
            label="مفيش تحويلات مفتوحة للمراجعة"
          />
        </Panel>
      ) : null}

      {shownPairs.length ? (
        <Panel>
          <SectionTitle
            title={view === 'done' ? 'تحويلات معتمدة' : 'تحويلات مربوطة'}
            subtitle="الكمية والكود والصنف الناقص الأول. فرق الفلوس بيظهر بس لو أكتر من ٥٠ ج"
          />
          <div className="mt-2 space-y-2">
            {shownPairs.map(({ p, issues, saved, hasDetails }) => (
              <PairCard
                key={`${p.purchase.store}:${p.purchase.serial}`}
                p={p}
                issues={issues}
                saved={saved}
                hasDetails={hasDetails}
                busy={busy === p.purchase.serial}
                onConfirm={() => void confirm(p)}
                onProblem={p.rest.length ? undefined : () => setEditing({ kind: 'pair', purchase: p.purchase, sale: p.sale })}
                onUnlink={p.rest.length || p.sale.parts ? undefined : () => setEditing({ kind: 'purchase', purchase: p.purchase })}
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
                key={`${p.store}:${p.serial}`}
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
                    <Link2 size={14} /> {p.check ? 'عدّل المراجعة أو الربط' : 'اربط أو سجّل المشكلة'}
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
                      <TriangleAlert size={14} /> {s.check ? 'عدّل المراجعة' : 'سجّل المشكلة'}
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
  hasDetails,
  busy,
  onConfirm,
  onProblem,
  onUnlink,
}: {
  p: TransferPair;
  issues: TransferIssue[];
  saved: boolean;
  hasDetails: boolean;
  busy: boolean;
  onConfirm: () => void;
  onProblem?: () => void;
  onUnlink?: () => void;
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
        {!issues.length && hasDetails ? (
          <span className="rounded-full bg-[var(--dawaa-theme-soft)] px-2 py-0.5 font-black text-[var(--dawaa-status-success-text)]">
            مطابق
          </span>
        ) : null}
        <span className="rounded-full bg-[var(--dawaa-theme-soft)] px-2 py-0.5 font-bold opacity-70">
          اتربط {HOW[p.how]}
        </span>
        {!hasDetails ? <span className="font-bold">تفاصيل الأصناف ناقصة</span> : null}
        {saved ? (
          <span
            className={
              p.purchase.check!.status === 'ok'
                ? 'font-black text-[var(--dawaa-status-success-text)]'
                : 'font-black text-[var(--dawaa-status-danger-text)]'
            }
          >
            {p.purchase.check!.status === 'ok'
              ? 'معتمد'
              : `مشكلة مفتوحة: ${p.purchase.check!.problems.map(problemLabel).join('، ')}`}{' '}
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
      {!hasDetails || issues.length ? (
        <p className="mt-2 text-xs opacity-75">الاعتماد متاح بعد اكتمال تفاصيل الفاتورتين وتصحيح الاختلاف.</p>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-end gap-1 text-xs">
        <button
          className="btn-primary !px-3 !py-1 inline-flex items-center gap-1"
          disabled={busy || !hasDetails || issues.length > 0 || (saved && all.every((purchase) => purchase.check?.status === 'ok'))}
          onClick={onConfirm}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {saved && p.purchase.check?.status === 'problem' ? 'اتصلحت واعتمد' : 'اعتمد التحويل'}
        </button>
        {onProblem ? <button
          className="btn-secondary !px-2 !py-1 inline-flex items-center gap-1"
          onClick={onProblem}
        >
          <TriangleAlert size={14} /> {saved ? 'عدّل القرار' : 'مشكلة'}
        </button> : null}
        {onUnlink ? <button
          className="btn-secondary !px-2 !py-1 inline-flex items-center gap-1"
          onClick={onUnlink}
        >
          <Link2 size={14} /> تصحيح الربط
        </button> : null}
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
    <ul className="mt-1.5 space-y-1 text-xs">
      {items.slice(0, 8).map((it, n) => (
        <li
          key={n}
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-[var(--dawaa-theme-soft)] px-2 py-1"
        >
          <span className="min-w-0 flex-1 text-sm font-black break-words" dir="auto">
            {it.name}
          </span>
          <span className="rounded-md bg-[var(--dawaa-theme-surface)] px-1.5 text-sm font-black">
            × {it.qty.toLocaleString('ar-EG', { maximumFractionDigits: 2 })}
          </span>
          <span className="font-mono text-[11px] opacity-70">كود {it.code}</span>
        </li>
      ))}
      {items.length > 8 ? <li className="opacity-70">و{items.length - 8} صنف كمان</li> : null}
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
  day,
  salesOnly,
  onClose,
  onSaved,
}: {
  editing: NonNullable<Editing>;
  branch: string;
  day: string;
  salesOnly: TransferSale[];
  onClose: () => void;
  onSaved: (saved: TransferSaved) => void;
}) {
  const purchase = editing.kind === 'sale' ? null : editing.purchase;
  // شراء على كذا فاتورة بيع: المشكلة بتتسجل على الفواتير كلها، والخانة فيها أولهم.
  const parts = editing.kind === 'pair' && editing.sale.parts ? pairSales(editing.sale) : null;
  const initialSale =
    editing.kind === 'pair'
      ? (parts?.[0].invoice ?? editing.sale.invoice)
      : editing.kind === 'sale'
        ? editing.sale.invoice
        : '';
  const existing = purchase?.check ?? (editing.kind === 'sale' ? editing.sale.check : null);
  const [sale, setSale] = useState(initialSale);
  const [problems, setProblems] = useState<string[]>(
    existing?.problems ?? (editing.kind === 'sale' ? ['no_purchase'] : [])
  );
  const [note, setNote] = useState(existing?.note ?? '');
  const [saving, setSaving] = useState(false);
  const linking = editing.kind === 'purchase';
  const candidate = linking ? salesOnly.find((item) => item.invoice === sale.trim()) : undefined;
  const canCompare = Boolean(purchase?.lines.length && candidate?.items.length);
  const differences = purchase && candidate && canCompare
    ? transferIssues({ purchase, sale: candidate, rest: [], how: 'number' })
    : [];
  const canApproveLink = canCompare && differences.length === 0;

  async function save(status: 'ok' | 'problem') {
    if (status === 'problem' && problems.length === 0) {
      toast.error('اختاري نوع المشكلة');
      return;
    }
    if (status === 'ok' && !canApproveLink) return;
    setSaving(true);
    try {
      const saleInvoice = editing.kind === 'sale' ? editing.sale.invoice : sale.trim() || null;
      const saved = {
        status,
        problems: status === 'ok' ? [] : problems,
        note,
      };
      const extraSales =
        purchase && parts && saleInvoice === parts[0].invoice
          ? parts.slice(1).map((x) => x.invoice)
          : [];
      if (purchase && extraSales.length)
        await saveTransferMultiSale({
          purchase,
          sales: [saleInvoice!, ...extraSales],
          ...saved,
        });
      else
        await saveTransferCheck({
          purchaseStore: purchase?.store ?? null,
          purchaseSerial: purchase?.serial ?? null,
          saleInvoice,
          ...saved,
          branch,
          day,
        });
      toast.success('اتحفظ');
      onSaved({
        ...saved,
        purchases: purchase ? [{ store: purchase.store, serial: purchase.serial }] : [],
        saleInvoice,
        extraSales,
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
      {editing.kind !== 'sale' && !parts ? (
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
      {linking && sale.trim() ? (
        <p className="text-xs font-bold" role="status">
          {!candidate ? 'فاتورة البيع مش ظاهرة ضمن الفواتير المتاحة للربط.'
            : !canCompare ? 'تفاصيل الأصناف ناقصة، والمطابقة لسه محتاجة مراجعة.'
            : differences.length ? differences.map((issue) => issue.label).join('، ')
            : 'الأصناف والكميات متطابقة، والفرق في القيمة داخل الحد المسموح.'}
        </p>
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
            disabled={saving || !canApproveLink}
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
          {existing ? 'احفظ المشكلة مفتوحة' : 'سجّل المشكلة'}
        </button>
        <button className="btn-secondary" disabled={saving} onClick={onClose}>
          إلغاء
        </button>
      </div>
    </div>
  );
}
