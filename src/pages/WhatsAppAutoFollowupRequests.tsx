import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

type FollowupRow = {
  id: string;
  created_at: string;
  branch: string | null;
  doctor_name: string | null;
  customer_name: string;
  customer_phone: string | null;
  signal_type: string;
  signal_type_label: string;
  evidence_quote: string;
  requested_product_name: string | null;
  alternative_offered: boolean | null;
  alternative_product_name: string | null;
  assigned_team: string;
  assigned_to: string | null;
  status: string;
  followup_notes: string | null;
  ai_confidence: number | null;
};

const SIGNAL_COLORS: Record<string, string> = {
  complaint: 'bg-red-950 text-red-300 border-red-800',
  sick_person: 'bg-amber-950 text-amber-300 border-amber-800',
  doctor_recommendation: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  missing_product: 'bg-sky-950 text-sky-300 border-sky-800',
  other_opportunity: 'bg-slate-800 text-slate-300 border-slate-700',
};

const STATUS_OPTIONS = ['جديد', 'قيد المتابعة', 'تم التواصل', 'تم البيع', 'لم يتم الرد', 'ملغى'];

export default function WhatsAppAutoFollowupRequests() {
  const [rows, setRows] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [signalFilter, setSignalFilter] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('whatsapp_auto_followup_list_v1', {
      p_status: statusFilter || null,
      p_signal_type: signalFilter || null,
    });
    if (error) toast.error(error.message);
    else setRows((data || []) as FollowupRow[]);
    setLoading(false);
  }, [statusFilter, signalFilter]);

  useEffect(() => { void load(); }, [load]);

  async function updateStatus(id: string, status: string) {
    setBusyId(id);
    try {
      const { error } = await supabase.rpc('whatsapp_auto_followup_update_status_v1', { p_id: id, p_status: status });
      if (error) throw error;
      toast.success('تم تحديث الحالة');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر التحديث');
    } finally {
      setBusyId(null);
    }
  }

  function exportCsv() {
    const headers = ['التاريخ', 'الفرع', 'الدكتور', 'العميل', 'الهاتف', 'نوع الإشارة', 'الدليل', 'الصنف المطلوب', 'اتعرض بديل؟', 'الحالة', 'ملاحظات'];
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        new Date(r.created_at).toLocaleDateString('ar-EG'), r.branch || '', r.doctor_name || '', r.customer_name, r.customer_phone || '',
        r.signal_type_label, `"${(r.evidence_quote || '').replace(/"/g, '""')}"`, r.requested_product_name || '',
        r.alternative_offered ? 'نعم' : 'لا', r.status, `"${(r.followup_notes || '').replace(/"/g, '""')}"`,
      ].join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `طلبات-متابعة-الواتساب-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="dawaa-text space-y-4 p-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">طلبات المتابعة الآلية من محادثات الواتساب</h1>
        <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">اكتشاف تلقائي بالذكاء الاصطناعي: شكوى، حالة مريض بالمنزل، ترشيح دكتور، أو صنف مطلوب غير متوفر — مخصصة لفريق دواء ألفا للمتابعة.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={signalFilter} onChange={(e) => setSignalFilter(e.target.value)} className="input-dark text-xs">
            <option value="">كل الأنواع</option>
            <option value="complaint">شكوى عميل</option>
            <option value="sick_person">حالة مريض بالمنزل</option>
            <option value="doctor_recommendation">ترشيح دكتور</option>
            <option value="missing_product">صنف غير متوفر</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="input-dark text-xs">
            <option value="">كل الحالات</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={exportCsv} className="btn-secondary text-xs">تصدير Excel (CSV)</button>
          <span className="mr-auto text-xs font-bold text-[var(--dawaa-theme-muted)]">{rows.length.toLocaleString('ar-EG')} صف</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--dawaa-theme-surface-2)]">
            <tr>
              {['التاريخ', 'الفرع', 'العميل / الهاتف', 'النوع', 'الدليل من المحادثة', 'الصنف / البديل', 'الحالة', 'إجراء'].map((h) => (
                <th key={h} className="whitespace-nowrap p-2.5 text-right font-black text-[var(--dawaa-theme-heading)]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-6 text-center font-bold text-[var(--dawaa-theme-muted)]">جارٍ التحميل...</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={8} className="p-6 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد طلبات متابعة حاليًا.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[var(--dawaa-theme-border)] align-top">
                <td className="whitespace-nowrap p-2.5 font-bold text-[var(--dawaa-theme-muted)]">{new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
                <td className="whitespace-nowrap p-2.5">{r.branch || '-'}</td>
                <td className="whitespace-nowrap p-2.5 font-black text-[var(--dawaa-theme-heading)]">{r.customer_name}<div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{r.customer_phone || '-'}</div></td>
                <td className="whitespace-nowrap p-2.5"><span className={`rounded-full border px-2 py-1 text-[10px] font-black ${SIGNAL_COLORS[r.signal_type] || ''}`}>{r.signal_type_label}</span></td>
                <td className="max-w-[280px] p-2.5 text-[var(--dawaa-theme-muted)]">{r.evidence_quote}</td>
                <td className="max-w-[220px] p-2.5 text-[var(--dawaa-theme-muted)]">
                  {r.requested_product_name && <div>مطلوب: {r.requested_product_name}</div>}
                  {r.alternative_offered != null && <div className={r.alternative_offered ? 'text-emerald-400' : 'text-red-400'}>{r.alternative_offered ? '✓ اتعرض بديل' : '✗ مفيش بديل اتعرض'}</div>}
                </td>
                <td className="whitespace-nowrap p-2.5">
                  <select value={r.status} disabled={busyId === r.id} onChange={(e) => void updateStatus(r.id, e.target.value)} className="input-dark text-[10px]">
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="whitespace-nowrap p-2.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{r.assigned_team}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
