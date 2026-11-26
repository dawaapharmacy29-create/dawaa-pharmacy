import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  CheckCheck,
  ListTree,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState, Panel } from '@/components/dashboard/DashboardPrimitives';
import {
  PURCHASE_PROBLEMS,
  bulkApprovePurchases,
  matchesPurchase,
  savePurchaseMarks,
  searchPurchases,
  type PaperSerial,
  loadPurchaseDay,
  problemLabel,
  savePurchaseCheck,
  type PurchaseCheck,
  type PurchaseDay,
  type PurchaseFix,
  type PurchaseInvoice,
  type PurchaseProblem,
} from '@/lib/customerServiceTasks/morning';
import InvoiceLinesTable from '@/components/purchase-review/InvoiceLinesTable';
import { useAuth } from '@/hooks/useAuth';

// الخطوة الأولى في الصبح: كل فاتورة مشتريات دخلت فرعها من ٩ الصبح امبارح لـ ٩ الصبح النهارده (التحويلات في تبويبها).
// المسلسل على الورق (الدكتور كتبه بإيده ولا لأ)، وبعدين اعتماد، أو تعديل (المورد/المسلسل/رقم فاتورة المورد/المخزن/الإجمالي)، أو «فيها مشكلة». الخصم مش هنا: ده للمدير العام.

const fmtTime = (v: string) =>
  new Date(v.replace(' ', 'T')).toLocaleString('ar-EG', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
const money = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 2 });

export function BranchPicker({
  branch,
  canPick,
  onChange,
}: {
  branch: string;
  canPick: boolean;
  onChange: (b: string) => void;
}) {
  if (!canPick)
    return (
      <span className="rounded-full bg-[var(--dawaa-theme-soft)] px-3 py-1 text-xs font-black">
        {branch}
      </span>
    );
  return (
    <select
      className="input-field w-auto"
      value={branch}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="فرع شكري">فرع شكري</option>
      <option value="فرع الشامي">فرع الشامي</option>
    </select>
  );
}

export function statusBadge(status: string | undefined) {
  if (status === 'ok')
    return (
      <span className="text-xs font-black text-[var(--dawaa-status-success-text)]">اتعتمدت</span>
    );
  if (status === 'fixed')
    return <span className="text-xs font-black text-[var(--dawaa-status-info-text)]">اتعدلت</span>;
  if (status === 'problem')
    return (
      <span className="text-xs font-black text-[var(--dawaa-status-danger-text)]">فيها مشكلة</span>
    );
  return <span className="text-xs opacity-60">لسه</span>;
}

export function ProblemPicker<K extends string>({
  options,
  value,
  onChange,
}: {
  options: Record<K, string>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(options) as K[]).map((k) => {
        const on = value.includes(k);
        return (
          <button
            key={k}
            type="button"
            className={on ? 'btn-primary !px-2 !py-1 text-xs' : 'btn-secondary !px-2 !py-1 text-xs'}
            onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
          >
            {options[k]}
          </button>
        );
      })}
    </div>
  );
}

type Mode = { serial: string; store: string; kind: 'fix' | 'problem' | 'returns' } | null;

const keyOf = (i: { store: string; serial: string }) => `${i.store}|${i.serial}`;

/** What a form or button changed on one invoice; the row updates in place instead of reloading the page. */
export type InvoicePatch = Partial<
  Pick<PurchaseInvoice, 'check' | 'paper_serial' | 'returns_note'>
>;

type StatusFilter = 'open' | 'issues' | 'ok' | 'all';
const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'open', label: 'لسه' },
  { key: 'issues', label: 'اتعدلت أو فيها مشكلة' },
  { key: 'ok', label: 'اتعتمدت' },
  { key: 'all', label: 'الكل' },
];
const needsWork = (i: PurchaseInvoice) => !i.check || i.paper_serial == null;
const matchesStatus = (i: PurchaseInvoice, f: StatusFilter) =>
  f === 'all' ||
  (f === 'open' && needsWork(i)) ||
  (f === 'issues' && !!i.check && i.check.status !== 'ok') ||
  (f === 'ok' && i.check?.status === 'ok');

export default function MorningPurchasesTab({
  onProgress,
}: {
  onProgress?: (done: number, total: number) => void;
}) {
  const { user } = useAuth();
  const me = user?.name || user?.username || 'أنا';
  const [branch, setBranch] = useState<string | null>(null);
  // اليوم اللي الفترة بتخلص فيه (٩ الصبح). فاضي = النهارده، يعني فواتير امبارح.
  const [pickedDay, setPickedDay] = useState<string>('');
  const [day, setDay] = useState<PurchaseDay | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<StatusFilter>('open');
  const [store, setStore] = useState('');
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [who, setWho] = useState('');
  const [found, setFound] = useState<PurchaseInvoice[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkPaper, setBulkPaper] = useState<'' | PaperSerial>('');

  const load = useCallback(async () => {
    try {
      setError('');
      setDay(await loadPurchaseDay(branch, pickedDay || null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [branch, pickedDay]);
  useEffect(() => {
    void load();
  }, [load]);

  const reloadAll = useCallback(async () => {
    await load();
    if (found && query.trim()) {
      try {
        setFound(await searchPurchases(query, day?.branch ?? branch));
      } catch {
        /* القايمة الأساسية اتحدثت؛ البحث يتعاد بإيدها */
      }
    }
  }, [load, found, query, day, branch]);

  /** Updates the given invoices in the loaded day and in the search results, without asking the server again. */
  const patch = useCallback((keys: string[], change: (i: PurchaseInvoice) => InvoicePatch) => {
    const set = new Set(keys);
    const apply = (list: PurchaseInvoice[]) =>
      list.map((i) => (set.has(keyOf(i)) ? { ...i, ...change(i) } : i));
    setDay((d) => (d ? { ...d, invoices: apply(d.invoices) } : d));
    setFound((f) => (f ? apply(f) : f));
  }, []);
  const checkOf = (
    s: PurchaseCheck['status'],
    extra: Partial<PurchaseCheck> = {}
  ): PurchaseCheck => ({
    status: s,
    problems: [],
    fix: {},
    note: null,
    by: me,
    at: new Date().toISOString(),
    ...extra,
  });

  const done = (day?.invoices ?? []).filter((i) => i.check).length;
  const total = day?.invoices.length ?? 0;
  useEffect(() => {
    // الشيك ليست بتعد فواتير امبارح بس، مش يوم تاني اتفتح من التاريخ.
    if (day && !pickedDay) onProgress?.(done, total);
  }, [day, done, total, onProgress, pickedDay]);

  const stores = useMemo(
    () => [
      ...new Set(
        (day?.invoices ?? []).map((i) => i.store).concat((day?.uploads ?? []).map((u) => u.store))
      ),
    ],
    [day]
  );
  const base = useMemo(() => found ?? day?.invoices ?? [], [found, day]);
  const people = useMemo(
    () => [...new Set(base.map((i) => i.entered_by ?? '').filter(Boolean))].sort(),
    [base]
  );
  const isOpen = (i: PurchaseInvoice) => mode && mode.serial === i.serial && mode.store === i.store;
  const counts = useMemo(() => {
    const out: Record<StatusFilter, number> = { open: 0, issues: 0, ok: 0, all: 0 };
    for (const i of day?.invoices ?? [])
      for (const f of STATUS_FILTERS) if (matchesStatus(i, f.key)) out[f.key] += 1;
    return out;
  }, [day]);
  const shown = base.filter(
    (i) =>
      (found || matchesStatus(i, status) || isOpen(i)) &&
      (!who || i.entered_by === who) &&
      (!store || i.store === store) &&
      (found || matchesPurchase(i, query))
  );
  const pickedRows = shown.filter((i) => picked.has(keyOf(i)));
  const allPicked = shown.length > 0 && pickedRows.length === shown.length;

  function togglePick(i: PurchaseInvoice) {
    setPicked((prev) => {
      const next = new Set(prev);
      const k = keyOf(i);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    try {
      await work();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  const approve = (i: PurchaseInvoice) =>
    run(keyOf(i), async () => {
      await savePurchaseCheck({
        store: i.store,
        serial: i.serial,
        status: 'ok',
        problems: [],
        fix: {},
        note: '',
      });
      patch([keyOf(i)], () => ({ check: checkOf('ok') }));
    });

  const markPaper = (i: PurchaseInvoice, v: PaperSerial) =>
    run(`${keyOf(i)}|paper`, async () => {
      const next = i.paper_serial === v ? null : v;
      await savePurchaseMarks([{ store: i.store, serial: i.serial, paper_serial: next }]);
      patch([keyOf(i)], () => ({ paper_serial: next }));
    });

  const bulkApprove = () =>
    run('bulk', async () => {
      const rows = pickedRows;
      const r = await bulkApprovePurchases(rows, bulkPaper || null);
      const parts = [`اتعتمد ${r.approved}`];
      if (r.kept) parts.push(`${r.kept} متعدلة أو فيها مشكلة فضلت زي ما هي`);
      if (r.skipped.length) parts.push(`${r.skipped.length} ماتعتمدتش`);
      (r.skipped.length ? toast.warning : toast.success)(parts.join(' · '));
      const skipped = new Set(r.skipped.map((s) => s.serial));
      patch(rows.filter((i) => !skipped.has(i.serial)).map(keyOf), (i) => ({
        // المتعدلة أو اللي فيها مشكلة بتفضل زي ما هي؛ الباقي اتعتمد.
        check: i.check && i.check.status !== 'ok' ? i.check : (i.check ?? checkOf('ok')),
        paper_serial: bulkPaper || i.paper_serial,
      }));
      setPicked(new Set());
    });

  const bulkPaperOnly = (v: PaperSerial) =>
    run('bulk', async () => {
      const rows = pickedRows;
      const n = await savePurchaseMarks(
        rows.map((i) => ({ store: i.store, serial: i.serial, paper_serial: v }))
      );
      toast.success(`اتسجل لـ ${n} فاتورة: المسلسل ${v === 'yes' ? 'مكتوب' : 'مش مكتوب'}`);
      patch(rows.map(keyOf), () => ({ paper_serial: v }));
      setPicked(new Set());
    });

  async function searchAll() {
    if (query.trim().length < 2) {
      toast.error('اكتبي رقم أو اسم الأول');
      return;
    }
    setSearching(true);
    try {
      setFound(await searchPurchases(query, day?.branch ?? branch));
      setPicked(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
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
  if (!day)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin" />
      </div>
    );

  const sum = day.invoices.reduce((s, i) => s + i.net, 0);
  const paperAnswered = day.invoices.filter((i) => i.paper_serial).length;
  const paperForgot = day.invoices.filter((i) => i.paper_serial === 'no').length;
  const stats: Array<{ label: string; value: string; tone?: 'good' | 'warn' }> = [
    { label: 'الفواتير', value: `${total} · ${money(sum)} ج` },
    {
      label: 'اتراجعت',
      value: `${done} / ${total}`,
      tone: done === total && total ? 'good' : undefined,
    },
    {
      label: 'المسلسل على الورق اتحدد',
      value: `${paperAnswered} / ${total}`,
      tone: paperAnswered === total && total ? 'good' : undefined,
    },
    {
      label: 'المسلسل مش مكتوب',
      value: String(paperForgot),
      tone: paperForgot ? 'warn' : undefined,
    },
    {
      label: 'اتعدلت أو فيها مشكلة',
      value: String(counts.issues),
      tone: counts.issues ? 'warn' : undefined,
    },
  ];

  return (
    <div className="space-y-3">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-black">
              {pickedDay ? 'فواتير مشتريات' : '١) فواتير مشتريات امبارح'}
            </h2>
            <p className="text-xs opacity-70">
              من {fmtTime(day.from)} لـ {fmtTime(day.to)} · المسلسل على الورق، وبعدين اعتماد أو
              تعديل أو مشكلة
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BranchPicker branch={day.branch} canPick={day.can_pick} onChange={setBranch} />
            <input
              type="date"
              className="input-field !w-auto !py-1 text-sm"
              aria-label="لحد يوم"
              value={pickedDay || day.day}
              onChange={(e) => setPickedDay(e.target.value)}
            />
            {pickedDay ? (
              <button
                className="btn-secondary !px-2 !py-1 text-xs"
                onClick={() => setPickedDay('')}
              >
                رجوع لامبارح
              </button>
            ) : null}
            <button
              className="btn-secondary !px-2 !py-1 inline-flex items-center gap-1 text-sm"
              onClick={() => void reloadAll()}
              title="تحديث"
            >
              <RefreshCw size={15} />
            </button>
            <Link
              to="/purchase-invoice-entry"
              className="btn-secondary !px-2 !py-1 inline-flex items-center gap-1 text-sm"
            >
              <Plus size={15} /> فاتورة مش موجودة؟
            </Link>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className={`rounded-xl border px-3 py-1.5 ${
                s.tone === 'good'
                  ? 'border-[var(--dawaa-status-success-text)] text-[var(--dawaa-status-success-text)]'
                  : s.tone === 'warn'
                    ? 'border-[var(--dawaa-status-warning-text,#b45309)] text-[var(--dawaa-status-warning-text,#b45309)]'
                    : 'border-[var(--dawaa-theme-border)]'
              }`}
            >
              <span className="text-[11px] font-bold opacity-80">{s.label}</span>
              <span className="mr-2 text-sm font-black">{s.value}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] opacity-60">
          آخر رفع لملفات المشتريات:{' '}
          {day.uploads.length
            ? day.uploads.map((u) => `${u.store} ${fmtTime(u.uploaded_at)}`).join(' · ')
            : 'مفيش ملفات اترفعت للفرع ده'}
          . الفواتير بعد آخر رفع مش هتظهر.
        </p>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[15rem] flex-1">
            <Search size={16} className="absolute top-1/2 right-3 -translate-y-1/2 opacity-50" />
            <input
              className="input-field !pr-9"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (found) setFound(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void searchAll();
              }}
              placeholder="مسلسل، رقم فاتورة المورد، القيمة، اسم الدكتور أو المورد"
            />
          </div>
          <button
            className="btn-secondary inline-flex items-center gap-1"
            disabled={searching}
            onClick={() => void searchAll()}
            title="يدوّر في فواتير فرعك في آخر ٩٠ يوم (أو دوسي Enter)"
          >
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} آخر
            ٩٠ يوم
          </button>
          <select
            className="input-field !w-auto"
            value={store}
            onChange={(e) => setStore(e.target.value)}
          >
            <option value="">كل المخازن</option>
            {stores.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="input-field !w-auto"
            value={who}
            onChange={(e) => setWho(e.target.value)}
          >
            <option value="">كل اللي سجّلوا</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        {!found ? (
          <div className="mt-2 inline-flex flex-wrap rounded-xl border border-[var(--dawaa-theme-border)] p-0.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`rounded-lg px-3 py-1 text-xs font-black ${
                  status === f.key
                    ? 'bg-[var(--dawaa-theme-primary,#0f766e)] text-white'
                    : 'opacity-70'
                }`}
                onClick={() => setStatus(f.key)}
              >
                {f.label} ({counts[f.key]})
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-black">
              نتايج البحث في آخر ٩٠ يوم: {found.length}
              {found.length === 100 ? ' (أحدث ١٠٠ بس)' : ''}
            </span>
            <button
              className="btn-secondary !px-2 !py-1 text-xs"
              onClick={() => {
                setFound(null);
                setQuery('');
              }}
            >
              رجوع للقايمة
            </button>
          </div>
        )}

        {pickedRows.length ? (
          <div className="sticky top-0 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface,#fff)] p-2 text-sm shadow-sm">
            <span className="font-black">اخترتي {pickedRows.length}</span>
            <select
              className="input-field !w-auto !py-1"
              value={bulkPaper}
              onChange={(e) => setBulkPaper(e.target.value as '' | PaperSerial)}
            >
              <option value="">المسلسل على الورق: من غير ما أحدد</option>
              <option value="yes">والمسلسل مكتوب على الورق</option>
              <option value="no">والمسلسل مش مكتوب على الورق</option>
            </select>
            <button
              className="btn-primary !py-1 inline-flex items-center gap-1"
              disabled={busy === 'bulk'}
              onClick={() => void bulkApprove()}
            >
              {busy === 'bulk' ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <CheckCheck size={16} />
              )}{' '}
              اعتماد المختار
            </button>
            <button
              className="btn-secondary !px-2 !py-1 text-xs"
              disabled={busy === 'bulk'}
              onClick={() => void bulkPaperOnly('yes')}
            >
              المسلسل مكتوب للكل
            </button>
            <button
              className="btn-secondary !px-2 !py-1 text-xs"
              disabled={busy === 'bulk'}
              onClick={() => void bulkPaperOnly('no')}
            >
              مش مكتوب للكل
            </button>
            <button
              className="btn-secondary !px-2 !py-1 text-xs"
              onClick={() => setPicked(new Set())}
            >
              إلغاء
            </button>
          </div>
        ) : null}

        {shown.length === 0 ? (
          <EmptyState
            label={
              found
                ? 'مفيش فواتير بالبحث ده'
                : query || who || store
                  ? 'مفيش فواتير بالبحث ده هنا، جرّبي «آخر ٩٠ يوم»'
                  : status === 'open' && total
                    ? 'كل الفواتير اتراجعت 👌'
                    : 'مفيش فواتير هنا'
            }
          />
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--dawaa-theme-soft)]">
                <tr className="text-right text-xs">
                  <th className="p-2">
                    <input
                      type="checkbox"
                      aria-label="اختاري الكل"
                      checked={allPicked}
                      onChange={() =>
                        setPicked(allPicked ? new Set() : new Set(shown.map((i) => keyOf(i))))
                      }
                    />
                  </th>
                  <th className="p-2">الفاتورة</th>
                  <th className="p-2">المورد</th>
                  <th className="p-2">القيمة</th>
                  <th className="p-2">سجّلها</th>
                  <th className="p-2">المسلسل على الورق؟</th>
                  <th className="p-2">الحالة</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => {
                  const key = keyOf(i);
                  const open = isOpen(i);
                  return (
                    <InvoiceRows
                      key={key}
                      invoice={i}
                      showDay={!!found}
                      picked={picked.has(key)}
                      onPick={() => togglePick(i)}
                      open={open ? mode!.kind : null}
                      busy={busy === key}
                      paperBusy={busy === `${key}|paper`}
                      stores={stores}
                      suppliers={day.suppliers}
                      onApprove={() => void approve(i)}
                      onPaper={(v) => void markPaper(i, v)}
                      onOpen={(kind) => setMode({ serial: i.serial, store: i.store, kind })}
                      onClose={() => setMode(null)}
                      onSaved={(change) => {
                        setMode(null);
                        patch([key], () => change);
                      }}
                      me={me}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function PaperButtons({
  value,
  busy,
  onPick,
}: {
  value: PaperSerial | null | undefined;
  busy: boolean;
  onPick: (v: PaperSerial) => void;
}) {
  if (busy) return <Loader2 size={14} className="animate-spin" />;
  return (
    <div className="flex gap-1">
      <button
        type="button"
        className={
          value === 'yes'
            ? 'btn-primary !px-2 !py-1 text-xs'
            : 'btn-secondary !px-2 !py-1 text-xs opacity-80'
        }
        onClick={() => onPick('yes')}
        title="الدكتور كتب المسلسل بإيده على الفاتورة الورق"
      >
        ✓ مكتوب
      </button>
      <button
        type="button"
        className={
          value === 'no'
            ? '!px-2 !py-1 text-xs rounded-lg font-black bg-[var(--dawaa-status-danger-bg,#fee2e2)] text-[var(--dawaa-status-danger-text)]'
            : 'btn-secondary !px-2 !py-1 text-xs opacity-80'
        }
        onClick={() => onPick('no')}
        title="الدكتور نسي يكتب المسلسل على الفاتورة الورق"
      >
        ✗ مش مكتوب
      </button>
    </div>
  );
}

const ROW_EDGE: Record<string, string> = {
  ok: 'border-r-[var(--dawaa-status-success-text)]',
  fixed: 'border-r-[var(--dawaa-status-info-text,#2563eb)]',
  problem: 'border-r-[var(--dawaa-status-danger-text)]',
  none: 'border-r-transparent',
};

function InvoiceRows({
  invoice: i,
  showDay,
  picked,
  onPick,
  open,
  busy,
  paperBusy,
  stores,
  suppliers,
  onApprove,
  onPaper,
  onOpen,
  onClose,
  onSaved,
  me,
}: {
  invoice: PurchaseInvoice;
  showDay: boolean;
  picked: boolean;
  onPick: () => void;
  open: 'fix' | 'problem' | 'returns' | null;
  busy: boolean;
  paperBusy: boolean;
  stores: string[];
  suppliers: Array<{ code: string; name: string }>;
  onApprove: () => void;
  onPaper: (v: PaperSerial) => void;
  onOpen: (kind: 'fix' | 'problem' | 'returns') => void;
  onClose: () => void;
  onSaved: (change: InvoicePatch) => void;
  me: string;
}) {
  const fix = i.check?.fix ?? {};
  const [details, setDetails] = useState(false);
  return (
    <>
      <tr
        className={`border-t border-r-4 border-[var(--dawaa-theme-border)] align-top ${
          ROW_EDGE[i.check?.status ?? 'none']
        } ${picked ? 'bg-[var(--dawaa-theme-soft)]' : ''}`}
      >
        <td className="p-2">
          <input type="checkbox" checked={picked} onChange={onPick} aria-label="اختيار" />
        </td>
        <td className="p-2 whitespace-nowrap">
          <button
            type="button"
            className="text-right"
            onClick={() => setDetails(!details)}
            title="تفاصيل الفاتورة صنف صنف"
          >
            <span className="block text-base font-black leading-tight">
              {i.serial}
              <ListTree size={13} className="mr-1 inline opacity-60" />
            </span>
            <span className="block text-[11px] opacity-70">
              {i.store} ·{' '}
              {showDay && i.invoice_day
                ? `${i.invoice_day.split('-').reverse().slice(0, 2).join('/')} `
                : ''}
              {fmtTime(i.invoice_at)}
            </span>
          </button>
          {fix.serial ? (
            <span className="block text-xs text-[var(--dawaa-status-info-text)]">
              ← {fix.serial}
            </span>
          ) : null}
        </td>
        <td className="p-2">
          <span className="font-bold">{i.supplier_name}</span>
          {fix.supplier_name ? (
            <span className="block text-xs text-[var(--dawaa-status-info-text)]">
              ← {fix.supplier_name}
            </span>
          ) : null}
          <span className="block text-[11px]">
            {i.supplier_invoice_no ? (
              <span className="opacity-70">فاتورة المورد {i.supplier_invoice_no}</span>
            ) : (
              <span className="font-bold text-[var(--dawaa-status-danger-text)]">
                رقم فاتورة المورد مش مكتوب
              </span>
            )}
            {fix.supplier_invoice_no ? (
              <span className="text-[var(--dawaa-status-info-text)]">
                {' '}
                ← {fix.supplier_invoice_no}
              </span>
            ) : null}
          </span>
          {i.payment || i.note ? (
            <span className="block text-[11px] opacity-70">
              {[i.payment, i.note].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </td>
        <td className="p-2 whitespace-nowrap">
          <span className="font-black">{money(i.net)}</span>
          <span className="block text-[11px] opacity-70">{i.items} صنف</span>
          {fix.net != null ? (
            <span className="block text-xs text-[var(--dawaa-status-info-text)]">
              ← {money(fix.net)}
            </span>
          ) : null}
        </td>
        <td className="p-2 whitespace-nowrap text-xs">{i.entered_by ?? '—'}</td>
        <td className="p-2">
          <PaperButtons value={i.paper_serial} busy={paperBusy} onPick={onPaper} />
        </td>
        <td className="p-2 text-xs">
          {statusBadge(i.check?.status)}
          {i.check?.problems?.length ? (
            <span className="block opacity-70">
              {i.check.problems.map(problemLabel).join('، ')}
            </span>
          ) : null}
          {i.check?.by ? <span className="block opacity-50">{i.check.by}</span> : null}
          {i.returns_note ? (
            <span className="block font-bold text-[var(--dawaa-status-warning-text,#b45309)]">
              مرتجعات: {i.returns_note}
            </span>
          ) : null}
        </td>
        <td className="p-2 whitespace-nowrap">
          <div className="flex items-center gap-1">
            <button
              className="btn-primary !px-2.5 !py-1 text-xs inline-flex items-center gap-1"
              disabled={busy}
              onClick={onApprove}
              title="الفاتورة مظبوطة"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} اعتماد
            </button>
            <button
              className="btn-secondary !p-1.5"
              onClick={() => onOpen('fix')}
              title="تعديل"
              aria-label="تعديل"
            >
              <Pencil size={14} />
            </button>
            <button
              className="btn-secondary !p-1.5"
              onClick={() => onOpen('problem')}
              title="فيها مشكلة"
              aria-label="فيها مشكلة"
            >
              <TriangleAlert size={14} />
            </button>
            <button
              className="btn-secondary !p-1.5"
              onClick={() => onOpen('returns')}
              title="ملحوظة مرتجعات على الفاتورة"
              aria-label="مرتجعات"
            >
              <Undo2 size={14} />
            </button>
          </div>
        </td>
      </tr>
      {details ? (
        <tr>
          <td colSpan={8} className="bg-[var(--dawaa-theme-soft)] p-2">
            <InvoiceLinesTable store={i.store} serial={i.serial} />
          </td>
        </tr>
      ) : null}
      {open ? (
        <tr>
          <td colSpan={8} className="bg-[var(--dawaa-theme-soft)] p-3">
            {open === 'returns' ? (
              <ReturnsForm invoice={i} onClose={onClose} onSaved={onSaved} />
            ) : (
              <CheckForm
                invoice={i}
                kind={open}
                stores={stores}
                suppliers={suppliers}
                onClose={onClose}
                onSaved={onSaved}
                me={me}
              />
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ReturnsForm({
  invoice: i,
  onClose,
  onSaved,
}: {
  invoice: PurchaseInvoice;
  onClose: () => void;
  onSaved: (change: InvoicePatch) => void;
}) {
  const [note, setNote] = useState(i.returns_note ?? '');
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await savePurchaseMarks([
        { store: i.store, serial: i.serial, returns_note: note.trim() || null },
      ]);
      toast.success(note.trim() ? 'ملحوظة المرتجعات اتحفظت' : 'ملحوظة المرتجعات اتشالت');
      onSaved({ returns_note: note.trim() || null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-2">
      <label className="block text-xs font-bold">
        ملحوظة المرتجعات على الفاتورة دي
        <textarea
          className="input-field mt-1"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="مثلاً: مرتجع علبتين كونكور ٥ للمورد، لسه ماتعملش إشعار"
        />
      </label>
      <div className="flex gap-2">
        <button
          className="btn-primary inline-flex items-center gap-1"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} حفظ
        </button>
        <button className="btn-secondary" disabled={saving} onClick={onClose}>
          إلغاء
        </button>
      </div>
      <p className="text-xs opacity-70">
        الملحوظة بتتسجل باسمك، وبتظهر للمدير العام في تقرير المسلسل والمرتجعات. لو فاضية بتتشال.
      </p>
    </div>
  );
}

function CheckForm({
  invoice: i,
  kind,
  stores,
  suppliers,
  onClose,
  onSaved,
  me,
}: {
  invoice: PurchaseInvoice;
  kind: 'fix' | 'problem';
  stores: string[];
  suppliers: Array<{ code: string; name: string }>;
  onClose: () => void;
  onSaved: (change: InvoicePatch) => void;
  me: string;
}) {
  const prev = i.check?.fix ?? {};
  const [supplier, setSupplier] = useState(prev.supplier_code ?? i.supplier_code);
  const [serial, setSerial] = useState(prev.serial ?? i.serial);
  const [supInv, setSupInv] = useState(prev.supplier_invoice_no ?? i.supplier_invoice_no ?? '');
  const [store, setStore] = useState(prev.store ?? i.store);
  const [net, setNet] = useState(String(prev.net ?? i.net));
  const [problems, setProblems] = useState<string[]>(i.check?.problems ?? []);
  const [note, setNote] = useState(i.check?.note ?? '');
  const [saving, setSaving] = useState(false);

  const fix: PurchaseFix = {};
  if (supplier !== i.supplier_code) {
    fix.supplier_code = supplier;
    fix.supplier_name = suppliers.find((s) => s.code === supplier)?.name ?? supplier;
  }
  if (serial.trim() && serial.trim() !== i.serial) fix.serial = serial.trim();
  if (supInv.trim() !== (i.supplier_invoice_no ?? '')) fix.supplier_invoice_no = supInv.trim();
  if (store !== i.store) fix.store = store;
  if (Number(net) !== i.net && Number.isFinite(Number(net))) fix.net = Number(net);

  // المشكلة بتتحدد تلقائي من اللي اتعدل، وتقدر تزود عليها.
  const auto: PurchaseProblem[] = [];
  if (fix.supplier_code) auto.push('wrong_supplier');
  if (fix.serial || fix.supplier_invoice_no !== undefined) auto.push('serial');
  if (fix.store) auto.push('wrong_store');
  if (fix.net != null) auto.push('value');
  const allProblems = [...new Set([...auto, ...problems])];

  async function save() {
    if (kind === 'fix' && Object.keys(fix).length === 0) {
      toast.error('مفيش حاجة اتغيرت');
      return;
    }
    if (kind === 'problem' && allProblems.length === 0) {
      toast.error('اختاري نوع المشكلة');
      return;
    }
    setSaving(true);
    try {
      const saved = {
        status: (kind === 'fix' ? 'fixed' : 'problem') as PurchaseCheck['status'],
        problems: allProblems,
        fix: kind === 'fix' ? fix : {},
        note,
      };
      await savePurchaseCheck({ store: i.store, serial: i.serial, ...saved });
      toast.success('اتحفظ');
      onSaved({
        check: { ...saved, note: note || null, by: me, at: new Date().toISOString() },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {kind === 'fix' ? (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <label className="text-xs font-bold">
            المورد
            <select
              className="input-field mt-1"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
            >
              {!suppliers.some((s) => s.code === i.supplier_code) ? (
                <option value={i.supplier_code}>{i.supplier_name}</option>
              ) : null}
              {suppliers.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            المسلسل على بي كونكت
            <input
              className="input-field mt-1"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
            />
          </label>
          <label className="text-xs font-bold">
            رقم فاتورة المورد (اللي على الورقة)
            <input
              className="input-field mt-1"
              value={supInv}
              onChange={(e) => setSupInv(e.target.value)}
            />
          </label>
          <label className="text-xs font-bold">
            المخزن
            <select
              className="input-field mt-1"
              value={store}
              onChange={(e) => setStore(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            الإجمالي الصح
            <input
              className="input-field mt-1"
              inputMode="decimal"
              value={net}
              onChange={(e) => setNet(e.target.value)}
            />
          </label>
        </div>
      ) : null}
      <div>
        <span className="text-xs font-bold">نوع المشكلة</span>
        <div className="mt-1">
          <ProblemPicker options={PURCHASE_PROBLEMS} value={allProblems} onChange={setProblems} />
        </div>
      </div>
      <label className="block text-xs font-bold">
        ملاحظة (اختياري)
        <input
          className="input-field mt-1"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="مثلاً: الرصيد ناقص علبتين من صنف كذا"
        />
      </label>
      <div className="flex gap-2">
        <button
          className="btn-primary inline-flex items-center gap-1"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} حفظ
        </button>
        <button className="btn-secondary" disabled={saving} onClick={onClose}>
          إلغاء
        </button>
      </div>
      {kind === 'fix' ? (
        <p className="text-xs opacity-70">
          التعديل بيتسجل هنا باسمك ووقته، والقديم محفوظ. لو الغلط في بي كونكت نفسه بلّغي الدكتور
          يصلّحه هناك كمان.
        </p>
      ) : null}
    </div>
  );
}
