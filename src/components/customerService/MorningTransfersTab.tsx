import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Link2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  EmptyState,
  MiniBox,
  Panel,
  SectionTitle,
} from '@/components/dashboard/DashboardPrimitives';
import {
  TRANSFER_PROBLEMS,
  loadTransferDay,
  pairTransfers,
  problemLabel,
  saveTransferCheck,
  transferProgress,
  type TransferDay,
  type TransferPair,
  type TransferPurchase,
  type TransferSale,
} from '@/lib/customerServiceTasks/morning';
import { BranchPicker, ProblemPicker } from './MorningPurchasesTab';

// الخطوة التانية: التحويلات اللي دخلت فرعها. التحويل عندنا فاتورة بيع في الفرع اللي بعت (لعميل الفرع ده)
// وفاتورة شراء في الفرع ده من مورد الفرع التاني. الصفحة بتربطهم تلقائي، والبنت تأكد أو تربط بإيدها أو تسجل المشكلة.

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
  value_items: 'نفس القيمة والأصناف',
  value: 'نفس القيمة',
};

type Editing =
  | { kind: 'pair'; purchase: TransferPurchase; sale: TransferSale }
  | { kind: 'purchase'; purchase: TransferPurchase }
  | { kind: 'sale'; sale: TransferSale }
  | null;

export default function MorningTransfersTab() {
  const [branch, setBranch] = useState<string | null>(null);
  const [day, setDay] = useState<TransferDay | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState('');

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

  const pairing = useMemo(() => (day ? pairTransfers(day.purchases, day.sales) : null), [day]);
  const progress = pairing ? transferProgress(pairing) : { done: 0, total: 0 };

  async function confirm(p: TransferPair) {
    setBusy(p.purchase.serial);
    try {
      await saveTransferCheck({
        purchaseStore: p.purchase.store,
        purchaseSerial: p.purchase.serial,
        saleInvoice: p.sale.invoice,
        status: 'ok',
        problems: [],
        note: '',
        branch: day!.branch,
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
  if (!day || !pairing)
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="animate-spin" />
      </div>
    );

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
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <MiniBox
            label="اتراجع"
            value={`${progress.done} / ${progress.total}`}
            tone={progress.done === progress.total && progress.total ? 'green' : 'cyan'}
          />
          <MiniBox label="مربوطين" value={String(pairing.pairs.length)} tone="blue" />
          <MiniBox
            label="شراء من غير بيع"
            value={String(pairing.purchasesOnly.length)}
            tone={pairing.purchasesOnly.length ? 'amber' : 'cyan'}
          />
          <MiniBox
            label="بيع من غير شراء"
            value={String(pairing.salesOnly.length)}
            tone={pairing.salesOnly.length ? 'amber' : 'cyan'}
          />
        </div>
        <p className="mt-2 text-xs opacity-70">
          الربط التلقائي بالرقم الأول (لو رقم فاتورة البيع مكتوب كرقم فاتورة المورد)، وبعدين بنفس
          القيمة وعدد الأصناف. قارني أصناف البيع اللي ظاهرة بفاتورة الشراء على بي كونكت قبل ما
          تأكدي. أصناف فاتورة الشراء نفسها مش في ملف المشتريات.
        </p>
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
            onSaved={async () => {
              setEditing(null);
              await load();
            }}
          />
        </Panel>
      ) : null}

      <Panel>
        <SectionTitle
          title="مربوطين"
          subtitle="أكدي «مطابق» لو الأصناف والكميات زي بعض، أو سجّلي المشكلة"
        />
        {pairing.pairs.length === 0 ? (
          <EmptyState label="مفيش تحويلات اتربطت" />
        ) : (
          <div className="mt-2 space-y-2">
            {pairing.pairs.map((p) => {
              const saved = p.purchase.check && p.purchase.check.sale_invoice === p.sale.invoice;
              const diff = p.purchase.net - p.sale.net;
              return (
                <div
                  key={p.purchase.serial}
                  className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3"
                >
                  <div className="grid gap-3 md:grid-cols-2">
                    <PurchaseCard p={p.purchase} />
                    <SaleCard s={p.sale} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-[var(--dawaa-theme-soft)] px-2 py-0.5 font-bold">
                      {HOW[p.how]}
                    </span>
                    {Math.abs(diff) > 0.5 ? (
                      <span className="font-black text-[var(--dawaa-status-danger-text)]">
                        فرق {money(diff)} ج
                      </span>
                    ) : null}
                    {p.purchase.items && p.sale.lines && p.purchase.items !== p.sale.lines ? (
                      <span className="font-black text-[var(--dawaa-status-danger-text)]">
                        أصناف الشراء {p.purchase.items} والبيع {p.sale.lines}
                      </span>
                    ) : null}
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
                    <div className="mr-auto flex gap-1">
                      <button
                        className="btn-primary !px-2 !py-1 inline-flex items-center gap-1"
                        disabled={busy === p.purchase.serial}
                        onClick={() => void confirm(p)}
                      >
                        {busy === p.purchase.serial ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Check size={14} />
                        )}{' '}
                        مطابق
                      </button>
                      <button
                        className="btn-secondary !px-2 !py-1 inline-flex items-center gap-1"
                        onClick={() =>
                          setEditing({ kind: 'pair', purchase: p.purchase, sale: p.sale })
                        }
                      >
                        <TriangleAlert size={14} /> مشكلة
                      </button>
                      <button
                        className="btn-secondary !px-2 !py-1 inline-flex items-center gap-1"
                        onClick={() => setEditing({ kind: 'purchase', purchase: p.purchase })}
                      >
                        <Link2 size={14} /> مش دي
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel>
        <SectionTitle
          title={`شراء في ${day.branch} ملهوش بيع`}
          subtitle="اربطيه برقم فاتورة البيع، أو سجّلي إنه مش متسجل بيع"
        />
        {pairing.purchasesOnly.length === 0 ? (
          <EmptyState label="مفيش" />
        ) : (
          <div className="mt-2 space-y-2">
            {pairing.purchasesOnly.map((p) => (
              <div
                key={p.serial}
                className="rounded-2xl border border-[var(--dawaa-status-warning-border,var(--dawaa-theme-border))] p-3"
              >
                <PurchaseCard p={p} />
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
        )}
      </Panel>

      <Panel>
        <SectionTitle
          title={`بيع في ${day.sale_branch} ملهوش شراء عندنا`}
          subtitle="لو الصنف وصل ومتسجلش شراء، سجّلي المشكلة"
        />
        {pairing.salesOnly.length === 0 ? (
          <EmptyState label="مفيش" />
        ) : (
          <div className="mt-2 space-y-2">
            {pairing.salesOnly.map((s) => (
              <div
                key={s.invoice}
                className="rounded-2xl border border-[var(--dawaa-theme-border)] p-3"
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
        )}
      </Panel>
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

function SaleCard({ s }: { s: TransferSale }) {
  return (
    <div className="text-sm">
      <div className="text-xs font-bold opacity-70">بيع · فاتورة {s.invoice}</div>
      <div className="font-black">
        {money(s.net)} ج · {s.lines} صنف
      </div>
      <div className="text-xs opacity-70">
        {fmtTime(s.at)} · {s.seller ?? '—'}
      </div>
      {s.items.length ? (
        <ul className="mt-1 list-disc pr-5 text-xs">
          {s.items.slice(0, 8).map((it, n) => (
            <li key={n}>
              {it.name} × {it.qty}
            </li>
          ))}
          {s.items.length > 8 ? <li>و{s.items.length - 8} صنف كمان</li> : null}
        </ul>
      ) : null}
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
  onSaved: () => Promise<void>;
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
      await saveTransferCheck({
        purchaseStore: purchase?.store ?? null,
        purchaseSerial: purchase?.serial ?? null,
        saleInvoice: editing.kind === 'sale' ? editing.sale.invoice : sale.trim() || null,
        status,
        problems: status === 'ok' ? [] : problems,
        note,
        branch,
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
