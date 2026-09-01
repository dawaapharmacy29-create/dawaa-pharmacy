import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, FileText, Loader2, Repeat } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Panel, SectionTitle, EmptyState, MiniBox } from '@/components/dashboard/DashboardPrimitives';

const BRANCHES = ['فرع شكري', 'فرع الشامي'] as const;
type Branch = (typeof BRANCHES)[number];

type Supplier = {
  id: string;
  name: string;
  payment_type: string | null;
  supplier_type: string;
  linked_branch: string | null;
  default_purchase_category: string;
  default_payment_method: string;
};

type InvoiceRow = {
  id: string;
  system_invoice_number: string;
  supplier_invoice_number: string | null;
  supplier_name: string | null;
  branch: string;
  invoice_date: string;
  total_value: number;
  status: 'بانتظار المراجعة' | 'معتمدة' | 'معلقة' | 'مرفوضة';
  transaction_type: 'external_purchase' | 'internal_transfer';
  purchase_category: string;
  notes: string | null;
};

const STATUS_STYLE: Record<InvoiceRow['status'], { color: string; bg: string; borderColor: string }> = {
  'بانتظار المراجعة': { color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' },
  'معتمدة': { color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)' },
  'معلقة': { color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' },
  'مرفوضة': { color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)' },
};

const PAYMENT_TYPES = ['كاش', 'آجل', 'انستا', 'فودافون', 'مختلط'];

export default function PurchaseInvoiceEntry() {
  const { user } = useAuth();
  const staffId = user?.staffId || user?.id || '';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [transactionType, setTransactionType] = useState<'external_purchase' | 'internal_transfer'>('external_purchase');
  const [branch, setBranch] = useState<Branch>('فرع شكري');
  const [sourceBranch, setSourceBranch] = useState<Branch>('فرع شكري');
  const [destinationBranch, setDestinationBranch] = useState<Branch>('فرع الشامي');
  const [supplierId, setSupplierId] = useState<string>('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [transferAuthNumber, setTransferAuthNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [totalValue, setTotalValue] = useState('');
  const [paidValue, setPaidValue] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [paymentType, setPaymentType] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [supplierRes, invoiceRes] = await Promise.all([
      supabase.rpc('list_purchase_suppliers_v1'),
      supabase.rpc('list_purchase_invoices_v1', { p_limit: 30 }),
    ]);
    if (supplierRes.error || invoiceRes.error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setSuppliers((supplierRes.data || []) as Supplier[]);
    setInvoices((invoiceRes.data || []) as InvoiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const externalSuppliers = useMemo(() => suppliers.filter((s) => s.supplier_type === 'external_supplier'), [suppliers]);

  const resetForm = () => {
    setSupplierId('');
    setSupplierInvoiceNumber('');
    setTransferAuthNumber('');
    setTotalValue('');
    setPaidValue('');
    setCashAmount('');
    setPaymentType('');
    setNotes('');
    setInvoiceDate(new Date().toISOString().slice(0, 10));
  };

  const handleSubmit = useCallback(async () => {
    const total = Number(totalValue);
    if (!total || total <= 0) {
      toast.error('اكتب قيمة الفاتورة');
      return;
    }
    if (transactionType === 'internal_transfer' && sourceBranch === destinationBranch) {
      toast.error('فرع المصدر والفرع المستلم لازم يكونوا مختلفين');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('create_purchase_invoice_v1', {
        p_supplier_id: supplierId || null,
        p_branch: transactionType === 'internal_transfer' ? destinationBranch : branch,
        p_transaction_type: transactionType,
        p_total_value: total,
        p_invoice_date: invoiceDate,
        p_supplier_invoice_number: supplierInvoiceNumber.trim() || null,
        p_transfer_authorization_number: transferAuthNumber.trim() || null,
        p_payment_type: paymentType || null,
        p_paid_value: Number(paidValue) || 0,
        p_cash_amount: Number(cashAmount) || 0,
        p_source_branch: transactionType === 'internal_transfer' ? sourceBranch : null,
        p_destination_branch: transactionType === 'internal_transfer' ? destinationBranch : null,
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      toast.success('اتسجلت الفاتورة، هتتراجع من مدير الفرع');
      resetForm();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حصل خطأ في الحفظ');
    } finally {
      setSubmitting(false);
    }
  }, [transactionType, branch, sourceBranch, destinationBranch, supplierId, totalValue, invoiceDate, supplierInvoiceNumber, transferAuthNumber, paymentType, paidValue, cashAmount, notes, load]);

  if (!staffId) return null;

  const pendingCount = invoices.filter((i) => i.status === 'بانتظار المراجعة').length;
  const approvedCount = invoices.filter((i) => i.status === 'معتمدة').length;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>تسجيل فاتورة مشتريات</h1>
        <p className="mt-1 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          كل الفواتير من دلوقتي تتسجل هنا مباشرة بدل Base44.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MiniBox label="بانتظار المراجعة" value={String(pendingCount)} tone="amber" />
        <MiniBox label="معتمدة (آخر 30)" value={String(approvedCount)} tone="green" />
      </div>

      <Panel className="p-4 space-y-4">
        <SectionTitle title="فاتورة جديدة" icon={<FileText size={18} />} />

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>نوع العملية</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTransactionType('external_purchase')}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border py-2 text-sm font-black"
              style={{
                borderColor: transactionType === 'external_purchase' ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
                background: transactionType === 'external_purchase' ? 'var(--dawaa-theme-soft)' : 'transparent',
              }}
            >
              <FileText size={14} /> شراء خارجي
            </button>
            <button
              type="button"
              onClick={() => setTransactionType('internal_transfer')}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border py-2 text-sm font-black"
              style={{
                borderColor: transactionType === 'internal_transfer' ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
                background: transactionType === 'internal_transfer' ? 'var(--dawaa-theme-soft)' : 'transparent',
              }}
            >
              <Repeat size={14} /> تحويل بين فرعين
            </button>
          </div>
        </div>

        {transactionType === 'external_purchase' ? (
          <>
            <div>
              <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>الفرع</p>
              <div className="flex gap-2">
                {BRANCHES.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBranch(b)}
                    className="flex-1 rounded-xl border py-2 text-sm font-black"
                    style={{
                      borderColor: branch === b ? 'var(--dawaa-theme-primary)' : 'var(--dawaa-theme-border)',
                      background: branch === b ? 'var(--dawaa-theme-soft)' : 'transparent',
                      color: 'var(--dawaa-theme-heading)',
                    }}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>المورد</p>
              <select
                className="input-dark w-full text-sm"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">بدون مورد محدد</option>
                {externalSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>رقم فاتورة المورد (اختياري)</p>
              <input type="text" className="input-dark w-full text-sm" value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} />
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>من فرع</p>
                <select className="input-dark w-full text-sm" value={sourceBranch} onChange={(e) => setSourceBranch(e.target.value as Branch)}>
                  {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>لفرع</p>
                <select className="input-dark w-full text-sm" value={destinationBranch} onChange={(e) => setDestinationBranch(e.target.value as Branch)}>
                  {BRANCHES.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>رقم إذن التحويل (اختياري)</p>
              <input type="text" className="input-dark w-full text-sm" value={transferAuthNumber} onChange={(e) => setTransferAuthNumber(e.target.value)} />
            </div>
          </>
        )}

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>تاريخ الفاتورة</p>
          <input type="date" className="input-dark w-full text-sm" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>القيمة الإجمالية</p>
          <input type="number" className="input-dark w-full text-sm" value={totalValue} onChange={(e) => setTotalValue(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>المدفوع</p>
            <input type="number" className="input-dark w-full text-sm" value={paidValue} onChange={(e) => setPaidValue(e.target.value)} />
          </div>
          <div>
            <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>كاش</p>
            <input type="number" className="input-dark w-full text-sm" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} />
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>طريقة الدفع</p>
          <select className="input-dark w-full text-sm" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
            <option value="">غير محدد</option>
            {PAYMENT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div>
          <p className="mb-2 text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>ملاحظات</p>
          <input type="text" className="input-dark w-full text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={submitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white"
          style={{ background: 'var(--dawaa-theme-primary)' }}
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          تسجيل الفاتورة
        </button>
      </Panel>

      <Panel className="p-4">
        <SectionTitle title="آخر الفواتير" icon={<ClipboardList size={18} />} />
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : loadError ? (
          <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
        ) : invoices.length === 0 ? (
          <EmptyState label="لسه مفيش فواتير مسجّلة" />
        ) : (
          <div className="space-y-2">
            {invoices.map((inv) => {
              const style = STATUS_STYLE[inv.status];
              return (
                <div key={inv.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                      فاتورة {inv.system_invoice_number} {inv.supplier_name ? `— ${inv.supplier_name}` : ''}
                    </p>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black" style={{ borderColor: style.borderColor, background: style.bg, color: style.color }}>
                      {inv.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                    {inv.branch} — {inv.invoice_date} — {inv.total_value} جنيه
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
