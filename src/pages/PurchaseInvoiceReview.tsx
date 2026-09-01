import { useCallback, useEffect, useState } from 'react';
import { Check, Clock, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { Panel, SectionTitle, EmptyState } from '@/components/dashboard/DashboardPrimitives';

type InvoiceRow = {
  id: string;
  system_invoice_number: string;
  supplier_invoice_number: string | null;
  supplier_name: string | null;
  branch: string;
  entered_by_name: string | null;
  invoice_date: string;
  total_value: number;
  paid_value: number;
  status: string;
  transaction_type: 'external_purchase' | 'internal_transfer';
  source_branch: string | null;
  destination_branch: string | null;
  purchase_category: string;
  notes: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  medicines: 'أدوية',
  supplies_accessories: 'مستلزمات وإكسسوار',
  unclassified: 'غير مصنّف',
};

export default function PurchaseInvoiceReview() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const { data, error } = await supabase.rpc('list_purchase_invoices_v1', { p_status: 'بانتظار المراجعة', p_limit: 100 });
    if (error) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setInvoices((data || []) as InvoiceRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReview = useCallback(async (id: string, status: 'معتمدة' | 'معلقة' | 'مرفوضة', reviewNote?: string) => {
    setActingId(id);
    try {
      const { error } = await supabase.rpc('review_purchase_invoice_v1', {
        p_invoice_id: id,
        p_status: status,
        p_note: reviewNote || null,
      });
      if (error) throw error;
      toast.success(status === 'معتمدة' ? 'تم الاعتماد' : status === 'معلقة' ? 'اتحطت معلقة' : 'اترفضت');
      setRejectingId(null);
      setNote('');
      setInvoices((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حصل خطأ');
    } finally {
      setActingId(null);
    }
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>مراجعة فواتير المشتريات</h1>
        <p className="mt-1 text-sm font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
          الاعتماد بيدّي فريق دواء نقطة إدخال صحيح أوتوماتيك.
        </p>
      </div>

      <Panel className="p-4">
        <SectionTitle title="بانتظار المراجعة" icon={<Clock size={18} />} />
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="animate-spin" style={{ color: 'var(--dawaa-theme-muted)' }} /></div>
        ) : loadError ? (
          <EmptyState label="تعذّر التحميل" error onRetry={() => void load()} />
        ) : invoices.length === 0 ? (
          <EmptyState label="مفيش فواتير بانتظار المراجعة" />
        ) : (
          <div className="space-y-3">
            {invoices.map((inv) => (
              <div key={inv.id} className="rounded-xl border p-3" style={{ borderColor: 'var(--dawaa-theme-border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>فاتورة {inv.system_invoice_number}</p>
                  <span className="text-xs font-black" style={{ color: 'var(--dawaa-status-success-text)' }}>{inv.total_value} جنيه</span>
                </div>
                <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
                  {inv.branch} — دخلها: {inv.entered_by_name} — {inv.invoice_date}
                </p>
                {inv.transaction_type === 'internal_transfer' ? (
                  <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>تحويل: {inv.source_branch} ← {inv.destination_branch}</p>
                ) : (
                  <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{inv.supplier_name || 'بدون مورد'} — {CATEGORY_LABEL[inv.purchase_category]}</p>
                )}
                {inv.notes ? <p className="mt-1 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>{inv.notes}</p> : null}

                {rejectingId === inv.id ? (
                  <div className="mt-3 space-y-2">
                    <input
                      type="text"
                      className="input-dark w-full text-sm"
                      placeholder="السبب (اختياري)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={actingId === inv.id}
                        onClick={() => void handleReview(inv.id, 'مرفوضة', note)}
                        className="flex-1 rounded-lg py-2 text-sm font-black text-white"
                        style={{ background: 'var(--dawaa-status-danger-text)' }}
                      >
                        تأكيد الرفض
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRejectingId(null); setNote(''); }}
                        className="flex-1 rounded-lg border py-2 text-sm font-black"
                        style={{ borderColor: 'var(--dawaa-theme-border)', color: 'var(--dawaa-theme-text)' }}
                      >
                        إلغاء
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={actingId === inv.id}
                      onClick={() => void handleReview(inv.id, 'معتمدة')}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-black text-white"
                      style={{ background: 'var(--dawaa-status-success-text)' }}
                    >
                      {actingId === inv.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                      اعتماد
                    </button>
                    <button
                      type="button"
                      disabled={actingId === inv.id}
                      onClick={() => void handleReview(inv.id, 'معلقة')}
                      className="flex-1 rounded-lg border py-2 text-sm font-black"
                      style={{ borderColor: 'var(--dawaa-status-warning-border)', color: 'var(--dawaa-status-warning-text)' }}
                    >
                      تعليق
                    </button>
                    <button
                      type="button"
                      disabled={actingId === inv.id}
                      onClick={() => setRejectingId(inv.id)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg border py-2 text-sm font-black"
                      style={{ borderColor: 'var(--dawaa-status-danger-border)', color: 'var(--dawaa-status-danger-text)' }}
                    >
                      <X size={14} /> رفض
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
