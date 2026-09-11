import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Plus, RotateCcw, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';
import { Panel, SectionTitle, EmptyState, MiniBox } from '@/components/dashboard/DashboardPrimitives';

type ReturnStatus = 'pending' | 'under_review' | 'approved' | 'returned' | 'rejected';

const STATUS_LABEL: Record<ReturnStatus, string> = {
  pending: 'معلق',
  under_review: 'تحت المراجعة',
  approved: 'معتمد',
  returned: 'اترجع للمورد',
  rejected: 'مرفوض',
};

const STATUS_STYLE: Record<ReturnStatus, { color: string; bg: string; borderColor: string }> = {
  pending: { color: 'var(--dawaa-status-warning-text)', bg: 'var(--dawaa-status-warning-bg)', borderColor: 'var(--dawaa-status-warning-border)' },
  under_review: { color: 'var(--dawaa-status-info-text)', bg: 'var(--dawaa-status-info-bg)', borderColor: 'var(--dawaa-status-info-border)' },
  approved: { color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)' },
  returned: { color: 'var(--dawaa-status-success-text)', bg: 'var(--dawaa-status-success-bg)', borderColor: 'var(--dawaa-status-success-border)' },
  rejected: { color: 'var(--dawaa-status-danger-text)', bg: 'var(--dawaa-status-danger-bg)', borderColor: 'var(--dawaa-status-danger-border)' },
};

const NEXT_STATUS: Record<ReturnStatus, ReturnStatus[]> = {
  pending: ['under_review', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['returned', 'rejected'],
  returned: [],
  rejected: [],
};

type ReturnRow = {
  id: string;
  return_number: string | null;
  purchase_invoice_id: string | null;
  invoice_number: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  branch: string;
  reported_by_name: string | null;
  return_reason: string | null;
  notes: string | null;
  items: { name?: string; quantity?: number; unit_price?: number }[];
  total_returned_value: number;
  status: ReturnStatus;
  created_at: string;
};

type InvoiceOption = {
  id: string;
  system_invoice_number: string;
  supplier_id: string | null;
  supplier_name: string | null;
  branch: string;
  total_value: number;
};

type ItemDraft = { name: string; quantity: string; unit_price: string };

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function PurchaseReturns() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ReturnStatus | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [returnsRes, invoicesRes] = await Promise.all([
      supabase.from('purchase_returns').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.rpc('list_purchase_invoices_v1', { p_limit: 200 }),
    ]);
    if (returnsRes.error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setRows((returnsRes.data || []) as ReturnRow[]);
    if (!invoicesRes.error) {
      setInvoices(
        ((invoicesRes.data || []) as any[]).map((inv) => ({
          id: inv.id,
          system_invoice_number: inv.system_invoice_number,
          supplier_id: inv.supplier_id,
          supplier_name: inv.supplier_name,
          branch: inv.branch,
          total_value: n(inv.total_value),
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(
    () => (statusFilter === 'all' ? rows : rows.filter((r) => r.status === statusFilter)),
    [rows, statusFilter]
  );

  const totals = useMemo(
    () => ({
      count: rows.length,
      approvedValue: rows.filter((r) => r.status === 'approved' || r.status === 'returned').reduce((a, r) => a + n(r.total_returned_value), 0),
      pendingCount: rows.filter((r) => r.status === 'pending' || r.status === 'under_review').length,
    }),
    [rows]
  );

  const handleStatusChange = useCallback(
    async (id: string, newStatus: ReturnStatus) => {
      setActingId(id);
      try {
        const { error } = await supabase.rpc('update_purchase_return_status_v1', {
          p_return_id: id,
          p_new_status: newStatus,
          p_note: null,
        });
        if (error) throw error;
        toast.success('تم تحديث حالة المرتجع');
        void load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'تعذر تحديث الحالة');
      } finally {
        setActingId(null);
      }
    },
    [load]
  );

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="dawaa-title text-2xl">مرتجعات المشتريات</h1>
            <p className="dawaa-caption mt-1 font-bold">تسجيل ومتابعة مرتجعات فواتير المشتريات للموردين.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="dawaa-button dawaa-button--primary"
          >
            <Plus size={17} /> تسجيل مرتجع جديد
          </button>
        </div>
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <MiniBox label="إجمالي المرتجعات" value={totals.count.toLocaleString('ar-EG')} />
        <MiniBox label="قيمة المعتمد/المرتجع فعليًا" value={formatCurrency(totals.approvedValue)} />
        <MiniBox label="بانتظار المراجعة" value={totals.pendingCount.toLocaleString('ar-EG')} />
      </div>

      {showForm ? (
        <NewReturnForm
          invoices={invoices}
          staffId={user?.staffId || user?.id || ''}
          staffName={user?.name || ''}
          onCreated={() => {
            setShowForm(false);
            void load();
          }}
          onCancel={() => setShowForm(false)}
        />
      ) : null}

      <Panel className="p-4">
        <SectionTitle title="سجل المرتجعات" icon={<RotateCcw size={18} />} />
        <div className="mb-3 flex flex-wrap gap-2">
          {(['all', 'pending', 'under_review', 'approved', 'returned', 'rejected'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`dawaa-tab ${statusFilter === s ? 'is-active' : ''}`}
            >
              {s === 'all' ? 'الكل' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : loadError ? (
          <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
        ) : filteredRows.length === 0 ? (
          <EmptyState label="لا توجد مرتجعات" />
        ) : (
          <div className="space-y-3">
            {filteredRows.map((row) => {
              const style = STATUS_STYLE[row.status];
              const nextOptions = NEXT_STATUS[row.status] || [];
              return (
                <div key={row.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
                        {row.supplier_name || 'مورد غير محدد'} — فاتورة {row.invoice_number || '-'}
                      </p>
                      <p className="dawaa-caption mt-0.5 text-xs font-bold">
                        {row.branch} · بواسطة {row.reported_by_name || '-'} · {new Date(row.created_at).toLocaleDateString('ar-EG')}
                      </p>
                    </div>
                    <span
                      className="rounded-full border px-3 py-1 text-xs font-black"
                      style={{ color: style.color, background: style.bg, borderColor: style.borderColor }}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                  </div>

                  {row.items?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {row.items.map((it, idx) => (
                        <span key={idx} className="dawaa-badge dawaa-badge--info text-xs font-bold">
                          {it.name || '-'} × {it.quantity || 0}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {row.return_reason ? (
                    <p className="dawaa-body mt-2 text-sm font-bold">السبب: {row.return_reason}</p>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>
                      {formatCurrency(n(row.total_returned_value))}
                    </span>
                    {nextOptions.length ? (
                      <div className="flex gap-2">
                        {nextOptions.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            disabled={actingId === row.id}
                            onClick={() => void handleStatusChange(row.id, opt)}
                            className="dawaa-button dawaa-button--secondary text-xs"
                            style={opt === 'rejected' ? { color: 'var(--dawaa-status-danger-text)' } : undefined}
                          >
                            {opt === 'rejected' ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                            {STATUS_LABEL[opt]}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function NewReturnForm({
  invoices,
  staffId,
  staffName,
  onCreated,
  onCancel,
}: {
  invoices: InvoiceOption[];
  staffId: string;
  staffName: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [invoiceId, setInvoiceId] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([{ name: '', quantity: '1', unit_price: '0' }]);
  const [submitting, setSubmitting] = useState(false);

  const selectedInvoice = invoices.find((i) => i.id === invoiceId);

  const totalValue = items.reduce((acc, it) => acc + n(it.quantity) * n(it.unit_price), 0);

  const updateItem = (idx: number, patch: Partial<ItemDraft>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleSubmit = async () => {
    if (!invoiceId) {
      toast.error('اختار الفاتورة أولًا');
      return;
    }
    const cleanItems = items.filter((it) => it.name.trim());
    if (!cleanItems.length) {
      toast.error('أضف صنف واحد على الأقل');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('submit_purchase_return_v1', {
        p_purchase_invoice_id: invoiceId,
        p_return_reason: reason || null,
        p_items: cleanItems.map((it) => ({
          name: it.name,
          quantity: n(it.quantity),
          unit_price: n(it.unit_price),
        })),
        p_notes: notes || null,
        p_invoice_images: null,
      });
      if (error) throw error;
      toast.success('تم تسجيل المرتجع');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'تعذر تسجيل المرتجع');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel className="p-4">
      <SectionTitle title="تسجيل مرتجع جديد" />
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="dawaa-caption mb-1 block text-xs font-bold">الفاتورة</label>
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className="dawaa-input py-2.5 text-sm font-bold">
            <option value="">اختر الفاتورة</option>
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.system_invoice_number} — {inv.supplier_name || '-'} ({inv.branch})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="dawaa-caption mb-1 block text-xs font-bold">سبب المرتجع</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="dawaa-input py-2.5 text-sm font-bold" placeholder="مثال: صنف تالف / خطأ في الكمية" />
        </div>
      </div>

      {selectedInvoice ? (
        <p className="dawaa-caption mt-2 text-xs font-bold">قيمة الفاتورة الأصلية: {formatCurrency(selectedInvoice.total_value)}</p>
      ) : null}

      <div className="mt-4">
        <label className="dawaa-caption mb-2 block text-xs font-bold">الأصناف المرتجعة</label>
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_1fr]">
              <input
                value={it.name}
                onChange={(e) => updateItem(idx, { name: e.target.value })}
                placeholder="اسم الصنف"
                className="dawaa-input py-2 text-sm font-bold"
              />
              <input
                type="number"
                value={it.quantity}
                onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                placeholder="الكمية"
                className="dawaa-input py-2 text-sm font-bold"
              />
              <input
                type="number"
                value={it.unit_price}
                onChange={(e) => updateItem(idx, { unit_price: e.target.value })}
                placeholder="سعر الوحدة"
                className="dawaa-input py-2 text-sm font-bold"
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, { name: '', quantity: '1', unit_price: '0' }])}
          className="dawaa-button dawaa-button--secondary mt-2 text-xs"
        >
          <Plus size={14} /> إضافة صنف
        </button>
      </div>

      <div className="mt-3">
        <label className="dawaa-caption mb-1 block text-xs font-bold">ملاحظات</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="dawaa-input py-2 text-sm font-bold" rows={2} />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>
          إجمالي المرتجع: {formatCurrency(totalValue)}
        </span>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="dawaa-button dawaa-button--secondary text-sm">إلغاء</button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            className="dawaa-button dawaa-button--primary text-sm disabled:opacity-50"
          >
            {submitting ? 'جاري الحفظ...' : 'حفظ المرتجع'}
          </button>
        </div>
      </div>
      {staffId && staffName ? null : null}
    </Panel>
  );
}
