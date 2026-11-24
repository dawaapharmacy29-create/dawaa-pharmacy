import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Pencil, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import {
  PURCHASE_PROBLEMS,
  loadPurchaseDay,
  problemLabel,
  savePurchaseCheck,
  type PurchaseDay,
  type PurchaseFix,
  type PurchaseInvoice,
  type PurchaseProblem,
} from '@/lib/customerServiceTasks/morning';

// الخطوة الأولى في الصبح: كل فاتورة مشتريات دخلت فرعها من ٩ الصبح امبارح لـ ٩ الصبح النهارده (التحويلات في تبويبها).
// اعتماد، أو تعديل (المورد/المسلسل/رقم فاتورة المورد/المخزن/الإجمالي)، أو «فيها مشكلة». الخصم مش هنا: ده للمدير العام.

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

type Mode = { serial: string; store: string; kind: 'fix' | 'problem' } | null;

export default function MorningPurchasesTab({
  onProgress,
}: {
  onProgress?: (done: number, total: number) => void;
}) {
  const [branch, setBranch] = useState<string | null>(null);
  const [day, setDay] = useState<PurchaseDay | null>(null);
  const [error, setError] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setDay(await loadPurchaseDay(branch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [branch]);
  useEffect(() => {
    void load();
  }, [load]);

  const done = (day?.invoices ?? []).filter((i) => i.check).length;
  const total = day?.invoices.length ?? 0;
  useEffect(() => {
    if (day) onProgress?.(done, total);
  }, [day, done, total, onProgress]);

  const stores = useMemo(
    () => [
      ...new Set(
        (day?.invoices ?? []).map((i) => i.store).concat((day?.uploads ?? []).map((u) => u.store))
      ),
    ],
    [day]
  );
  const shown = (day?.invoices ?? []).filter(
    (i) => !onlyOpen || !i.check || (mode && mode.serial === i.serial && mode.store === i.store)
  );

  async function approve(i: PurchaseInvoice) {
    setBusy(`${i.store}|${i.serial}`);
    try {
      await savePurchaseCheck({
        store: i.store,
        serial: i.serial,
        status: 'ok',
        problems: [],
        fix: {},
        note: '',
      });
      await load();
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
  if (!day)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin" />
      </div>
    );

  const problems = day.invoices.filter((i) => i.check && i.check.status !== 'ok').length;
  const sum = day.invoices.reduce((s, i) => s + i.net, 0);

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle
          title="١) فواتير مشتريات امبارح"
          subtitle={`من ${fmtTime(day.from)} لـ ${fmtTime(day.to)} · كل فاتورة: اعتماد أو تعديل أو فيها مشكلة`}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BranchPicker branch={day.branch} canPick={day.can_pick} onChange={setBranch} />
          <button
            className="btn-secondary inline-flex items-center gap-1"
            onClick={() => void load()}
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
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniBox label="الفواتير" value={String(total)} tone="blue" />
          <MiniBox
            label="اتراجعت"
            value={`${done} / ${total}`}
            tone={done === total && total ? 'green' : 'cyan'}
          />
          <MiniBox
            label="اتعدلت أو فيها مشكلة"
            value={String(problems)}
            tone={problems ? 'amber' : 'cyan'}
          />
          <MiniBox label="الإجمالي" value={`${money(sum)} ج`} tone="cyan" />
        </div>
        <p className="mt-2 text-xs opacity-70">
          آخر رفع لملفات المشتريات:{' '}
          {day.uploads.length
            ? day.uploads.map((u) => `${u.store} ${fmtTime(u.uploaded_at)}`).join(' · ')
            : 'مفيش ملفات اترفعت للفرع ده'}
          . لو الملف لسه مترفعش النهارده، الفواتير بعد آخر رفع مش هتظهر.
        </p>
      </Panel>

      <Panel>
        {shown.length === 0 ? (
          <EmptyState
            label={total ? 'كل الفواتير اتراجعت 👌' : 'مفيش فواتير مشتريات في الفترة دي'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right opacity-70">
                  <th className="p-2">الوقت</th>
                  <th className="p-2">المخزن · المسلسل</th>
                  <th className="p-2">المورد</th>
                  <th className="p-2">رقم فاتورة المورد</th>
                  <th className="p-2">أصناف</th>
                  <th className="p-2">القيمة</th>
                  <th className="p-2">سجّلها</th>
                  <th className="p-2">الحالة</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => {
                  const key = `${i.store}|${i.serial}`;
                  const open = mode && mode.serial === i.serial && mode.store === i.store;
                  return (
                    <InvoiceRows
                      key={key}
                      invoice={i}
                      open={open ? mode!.kind : null}
                      busy={busy === key}
                      stores={stores}
                      suppliers={day.suppliers}
                      onApprove={() => void approve(i)}
                      onOpen={(kind) => setMode({ serial: i.serial, store: i.store, kind })}
                      onClose={() => setMode(null)}
                      onSaved={async () => {
                        setMode(null);
                        await load();
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

function InvoiceRows({
  invoice: i,
  open,
  busy,
  stores,
  suppliers,
  onApprove,
  onOpen,
  onClose,
  onSaved,
}: {
  invoice: PurchaseInvoice;
  open: 'fix' | 'problem' | null;
  busy: boolean;
  stores: string[];
  suppliers: Array<{ code: string; name: string }>;
  onApprove: () => void;
  onOpen: (kind: 'fix' | 'problem') => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const fix = i.check?.fix ?? {};
  return (
    <>
      <tr className="border-t border-[var(--dawaa-theme-border)] align-top">
        <td className="p-2 whitespace-nowrap text-xs">{fmtTime(i.invoice_at)}</td>
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
          {statusBadge(i.check?.status)}
          {i.check?.problems?.length ? (
            <span className="block text-xs opacity-70">
              {i.check.problems.map(problemLabel).join('، ')}
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
          </div>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={9} className="bg-[var(--dawaa-theme-soft)] p-3">
            <CheckForm
              invoice={i}
              kind={open}
              stores={stores}
              suppliers={suppliers}
              onClose={onClose}
              onSaved={onSaved}
            />
          </td>
        </tr>
      ) : null}
    </>
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
