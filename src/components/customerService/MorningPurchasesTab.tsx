import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  CheckCheck,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
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
  type PurchaseDay,
  type PurchaseFix,
  type PurchaseInvoice,
  type PurchaseProblem,
} from '@/lib/customerServiceTasks/morning';

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

export default function MorningPurchasesTab({
  onProgress,
}: {
  onProgress?: (done: number, total: number) => void;
}) {
  const [branch, setBranch] = useState<string | null>(null);
  // اليوم اللي الفترة بتخلص فيه (٩ الصبح). فاضي = النهارده، يعني فواتير امبارح.
  const [pickedDay, setPickedDay] = useState<string>('');
  const [day, setDay] = useState<PurchaseDay | null>(null);
  const [error, setError] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
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
  const base = found ?? day?.invoices ?? [];
  const people = useMemo(
    () => [...new Set(base.map((i) => i.entered_by ?? '').filter(Boolean))].sort(),
    [base]
  );
  const isOpen = (i: PurchaseInvoice) => mode && mode.serial === i.serial && mode.store === i.store;
  const shown = base.filter(
    (i) =>
      (found || !onlyOpen || !i.check || i.paper_serial == null || isOpen(i)) &&
      (!who || i.entered_by === who) &&
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
      await reloadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  }

  const approve = (i: PurchaseInvoice) =>
    run(keyOf(i), () =>
      savePurchaseCheck({
        store: i.store,
        serial: i.serial,
        status: 'ok',
        problems: [],
        fix: {},
        note: '',
      })
    );

  const markPaper = (i: PurchaseInvoice, v: PaperSerial) =>
    run(`${keyOf(i)}|paper`, async () => {
      await savePurchaseMarks([
        { store: i.store, serial: i.serial, paper_serial: i.paper_serial === v ? null : v },
      ]);
    });

  const bulkApprove = () =>
    run('bulk', async () => {
      const r = await bulkApprovePurchases(pickedRows, bulkPaper || null);
      const parts = [`اتعتمد ${r.approved}`];
      if (r.kept) parts.push(`${r.kept} متعدلة أو فيها مشكلة فضلت زي ما هي`);
      if (r.skipped.length) parts.push(`${r.skipped.length} ماتعتمدتش`);
      (r.skipped.length ? toast.warning : toast.success)(parts.join(' · '));
      setPicked(new Set());
    });

  const bulkPaperOnly = (v: PaperSerial) =>
    run('bulk', async () => {
      const n = await savePurchaseMarks(
        pickedRows.map((i) => ({ store: i.store, serial: i.serial, paper_serial: v }))
      );
      toast.success(`اتسجل لـ ${n} فاتورة: المسلسل ${v === 'yes' ? 'مكتوب' : 'مش مكتوب'}`);
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

  const problems = day.invoices.filter((i) => i.check && i.check.status !== 'ok').length;
  const sum = day.invoices.reduce((s, i) => s + i.net, 0);
  const paperAnswered = day.invoices.filter((i) => i.paper_serial).length;
  const paperForgot = day.invoices.filter((i) => i.paper_serial === 'no').length;

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle
          title={pickedDay ? 'فواتير مشتريات' : '١) فواتير مشتريات امبارح'}
          subtitle={`من ${fmtTime(day.from)} لـ ${fmtTime(day.to)} · كل فاتورة: المسلسل على الورق، وبعدين اعتماد أو تعديل أو فيها مشكلة`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BranchPicker branch={day.branch} canPick={day.can_pick} onChange={setBranch} />
          <label className="inline-flex items-center gap-1 text-xs font-bold">
            لحد يوم
            <input
              type="date"
              className="input-field w-auto"
              value={pickedDay || day.day}
              onChange={(e) => setPickedDay(e.target.value)}
            />
          </label>
          {pickedDay ? (
            <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setPickedDay('')}>
              رجوع لامبارح
            </button>
          ) : null}
          <button
            className="btn-secondary inline-flex items-center gap-1"
            onClick={() => void reloadAll()}
          >
            <RefreshCw size={16} /> تحديث
          </button>
          <label className="inline-flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(e) => setOnlyOpen(e.target.checked)}
            />{' '}
            اللي لسه بس
          </label>
          <Link
            to="/purchase-invoice-entry"
            className="btn-secondary mr-auto inline-flex items-center gap-1"
          >
            <Plus size={16} /> فاتورة مش موجودة؟ سجّليها
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <MiniBox label="الفواتير" value={String(total)} tone="blue" />
          <MiniBox
            label="اتراجعت"
            value={`${done} / ${total}`}
            tone={done === total && total ? 'green' : 'cyan'}
          />
          <MiniBox
            label="المسلسل على الورق اتحدد"
            value={`${paperAnswered} / ${total}`}
            tone={paperAnswered === total && total ? 'green' : 'cyan'}
          />
          <MiniBox
            label="المسلسل مش مكتوب"
            value={String(paperForgot)}
            tone={paperForgot ? 'amber' : 'cyan'}
          />
          <MiniBox
            label="اتعدلت أو فيها مشكلة"
            value={String(problems)}
            tone={problems ? 'amber' : 'cyan'}
          />
        </div>
        <p className="mt-2 text-xs opacity-70">
          الإجمالي {money(sum)} ج · آخر رفع لملفات المشتريات:{' '}
          {day.uploads.length
            ? day.uploads.map((u) => `${u.store} ${fmtTime(u.uploaded_at)}`).join(' · ')
            : 'مفيش ملفات اترفعت للفرع ده'}
          . لو الملف لسه مترفعش النهارده، الفواتير بعد آخر رفع مش هتظهر.
        </p>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[16rem] flex-1">
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
              placeholder="دوّري برقم المسلسل أو رقم فاتورة المورد أو اسم الدكتور أو المورد"
            />
          </div>
          <button
            className="btn-secondary inline-flex items-center gap-1"
            disabled={searching}
            onClick={() => void searchAll()}
            title="يدوّر في فواتير فرعك في آخر ٩٠ يوم"
          >
            {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />} في
            آخر ٩٠ يوم
          </button>
          <select
            className="input-field w-auto"
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
        {found ? (
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
        ) : null}

        {pickedRows.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--dawaa-theme-soft)] p-2 text-sm">
            <span className="font-black">اخترتي {pickedRows.length}</span>
            <select
              className="input-field w-auto"
              value={bulkPaper}
              onChange={(e) => setBulkPaper(e.target.value as '' | PaperSerial)}
            >
              <option value="">المسلسل على الورق: من غير ما أحدد</option>
              <option value="yes">والمسلسل مكتوب على الورق</option>
              <option value="no">والمسلسل مش مكتوب على الورق</option>
            </select>
            <button
              className="btn-primary inline-flex items-center gap-1"
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
              إلغاء الاختيار
            </button>
            <span className="text-xs opacity-70">
              الاعتماد الجماعي مابيلمسش الفواتير اللي اتعدلت أو اتقال فيها مشكلة.
            </span>
          </div>
        ) : null}

        {shown.length === 0 ? (
          <EmptyState
            label={
              found
                ? 'مفيش فواتير بالبحث ده'
                : query || who
                  ? 'مفيش فواتير بالبحث ده هنا، جرّبي «في آخر ٩٠ يوم»'
                  : total
                    ? 'كل الفواتير اتراجعت 👌'
                    : 'مفيش فواتير مشتريات في الفترة دي'
            }
          />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right opacity-70">
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
                  <th className="p-2">الوقت</th>
                  <th className="p-2">المخزن · المسلسل</th>
                  <th className="p-2">المورد</th>
                  <th className="p-2">رقم فاتورة المورد</th>
                  <th className="p-2">أصناف</th>
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
                      onSaved={async () => {
                        setMode(null);
                        await reloadAll();
                      }}
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
  onSaved: () => Promise<void>;
}) {
  const fix = i.check?.fix ?? {};
  return (
    <>
      <tr
        className={`border-t border-[var(--dawaa-theme-border)] align-top ${picked ? 'bg-[var(--dawaa-theme-soft)]' : ''}`}
      >
        <td className="p-2">
          <input type="checkbox" checked={picked} onChange={onPick} aria-label="اختيار" />
        </td>
        <td className="p-2 whitespace-nowrap text-xs">
          {showDay && i.invoice_day ? (
            <span className="block font-bold">
              {i.invoice_day.split('-').reverse().slice(0, 2).join('/')}
            </span>
          ) : null}
          {fmtTime(i.invoice_at)}
        </td>
        <td className="p-2 whitespace-nowrap">
          <span className="text-xs opacity-70">{i.store}</span>
          <span className="block font-black">{i.serial}</span>
        </td>
        <td className="p-2">
          {i.supplier_name}
          {fix.supplier_name ? (
            <span className="block text-xs text-[var(--dawaa-status-info-text)]">
              ← {fix.supplier_name}
            </span>
          ) : null}
        </td>
        <td className="p-2 whitespace-nowrap">
          {i.supplier_invoice_no || (
            <span className="text-xs text-[var(--dawaa-status-danger-text)]">مش مكتوب</span>
          )}
          {fix.supplier_invoice_no ? (
            <span className="block text-xs text-[var(--dawaa-status-info-text)]">
              ← {fix.supplier_invoice_no}
            </span>
          ) : null}
        </td>
        <td className="p-2">{i.items}</td>
        <td className="p-2 whitespace-nowrap">
          {money(i.net)}
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
        <td className="p-2">
          {statusBadge(i.check?.status)}
          {i.check?.problems?.length ? (
            <span className="block text-xs opacity-70">
              {i.check.problems.map(problemLabel).join('، ')}
            </span>
          ) : null}
          {i.returns_note ? (
            <span className="block text-xs font-bold text-[var(--dawaa-status-warning-text,#b45309)]">
              مرتجعات: {i.returns_note}
            </span>
          ) : null}
        </td>
        <td className="p-2 whitespace-nowrap">
          <div className="flex gap-1">
            <button
              className="btn-primary !px-2 !py-1 text-xs inline-flex items-center gap-1"
              disabled={busy}
              onClick={onApprove}
              title="الفاتورة مظبوطة"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} اعتماد
            </button>
            <button
              className="btn-secondary !px-2 !py-1 text-xs inline-flex items-center gap-1"
              onClick={() => onOpen('fix')}
            >
              <Pencil size={14} /> تعديل
            </button>
            <button
              className="btn-secondary !px-2 !py-1 text-xs inline-flex items-center gap-1"
              onClick={() => onOpen('problem')}
            >
              <TriangleAlert size={14} /> مشكلة
            </button>
            <button
              className="btn-secondary !px-2 !py-1 text-xs inline-flex items-center gap-1"
              onClick={() => onOpen('returns')}
              title="ملحوظة مرتجعات على الفاتورة"
            >
              <Undo2 size={14} /> مرتجعات
            </button>
          </div>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={11} className="bg-[var(--dawaa-theme-soft)] p-3">
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
  onSaved: () => Promise<void>;
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
      await onSaved();
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
}: {
  invoice: PurchaseInvoice;
  kind: 'fix' | 'problem';
  stores: string[];
  suppliers: Array<{ code: string; name: string }>;
  onClose: () => void;
  onSaved: () => Promise<void>;
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
      await savePurchaseCheck({
        store: i.store,
        serial: i.serial,
        status: kind === 'fix' ? 'fixed' : 'problem',
        problems: allProblems,
        fix: kind === 'fix' ? fix : {},
        note,
      });
      toast.success('اتحفظ');
      await onSaved();
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
