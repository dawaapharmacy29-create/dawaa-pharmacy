import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { listProtectedWhatsAppChanges, type ProtectedWhatsAppChangeRow } from '@/lib/salesIntelligence/operations/whatsappDeletionService';

const STATUS: Record<ProtectedWhatsAppChangeRow['status'], string> = {
  pending_confirmation: 'بانتظار التأكيد الإضافي',
  approved_pending_reconciliation: 'معتمد — ينتظر التسوية',
  cancelled: 'ملغي',
  applied: 'منفذ بعد التسوية',
};

const OPERATION: Record<ProtectedWhatsAppChangeRow['operation'], string> = {
  delete_case: 'حذف حالة',
  delete_conversation: 'حذف محادثة كاملة',
  edit_case: 'تعديل حالة',
  edit_conversation: 'تعديل محادثة',
};

export function WhatsAppProtectedChangesPanel() {
  const [rows, setRows] = useState<ProtectedWhatsAppChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try { setRows(await listProtectedWhatsAppChanges(supabase)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'تعذر تحميل طلبات التصحيح.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  return (
    <section className="dawaa-card space-y-4" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-black text-lg"><ShieldCheck size={19} /> طلبات تصحيح المدير العام</h2>
          <p className="dawaa-muted mt-1 text-sm">الموافقة الإضافية لا تنفذ الحذف أو التعديل المالي. لا بد من تسوية الأثر واعتماد تنفيذها أولًا.</p>
        </div>
        <button type="button" className="dawaa-button dawaa-button--secondary" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} /> تحديث
        </button>
      </div>
      {error && <div className="dawaa-alert dawaa-alert--danger">{error}</div>}
      {loading && <div className="dawaa-muted text-sm">جارٍ تحميل السجل...</div>}
      {!loading && !error && rows.length === 0 && <div className="dawaa-muted text-sm">لا توجد طلبات تصحيح معتمدة أو معلقة حتى الآن.</div>}
      <div className="grid gap-3">
        {rows.map((row) => (
          <article key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-black">{OPERATION[row.operation]} — {row.customerName || 'محادثة'} {row.customerCode ? `(${row.customerCode})` : ''}</div>
              <div className="flex items-center gap-1 font-bold">
                {row.status === 'approved_pending_reconciliation' ? <AlertCircle size={16} /> : row.status === 'applied' ? <CheckCircle2 size={16} /> : <Clock3 size={16} />}
                {STATUS[row.status]}
              </div>
            </div>
            <p className="mt-2 leading-6">{row.reason}</p>
            <div className="dawaa-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span>الحالات: {row.caseCount}</span>
              <span>موانع الحماية: {row.blockerCount}</span>
              <span>الطلب: {row.requestedBy || 'غير معروف'}</span>
              <span>التأكيد: {row.confirmedBy || 'لم يُؤكد بعد'}</span>
              <span>تاريخ الطلب: {row.requestedAt ? new Date(row.requestedAt).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }) : '—'}</span>
            </div>
            {row.status === 'approved_pending_reconciliation' && (
              <div className="dawaa-alert dawaa-alert--warning mt-3 text-xs">مُعتمد إداريًا فقط؛ لا يوجد خصم أو استرجاع أو حذف منفّذ على البيانات الأصلية.</div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
