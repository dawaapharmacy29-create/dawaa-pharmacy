import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertOctagon, Clock3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type LostOpportunityRow = {
  session_id: string; customer_name: string; staff_name: string | null; branch: string | null;
  conversation_started_at: string; suggested_followup_reason: string | null; days_since: number;
};

export default function WhatsAppLostOpportunities() {
  const [rows, setRows] = useState<LostOpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('whatsapp_lost_opportunities_v1', { p_days_window: 7 });
    if (error) toast.error(error.message);
    else setRows((data || []) as LostOpportunityRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="dawaa-text space-y-4 p-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4 shadow-sm">
        <h1 className="flex items-center gap-2 text-xl font-black text-[var(--dawaa-status-danger-text)]"><AlertOctagon size={20} /> فرص بيع ضائعة</h1>
        <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">محادثات فيها نية شراء واضحة من العميل، لكن مفيش فاتورة بيع فعلية اتسجلت له خلال 7 أيام بعدها — كل حالة هنا فرصة حقيقية تستاهل متابعة الآن.</p>
        <div className="mt-2 text-2xl font-black text-[var(--dawaa-status-danger-text)]">{rows.length} فرصة ضائعة</div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--dawaa-theme-surface-2)]">
            <tr>{['العميل', 'الدكتور', 'الفرع', 'تاريخ المحادثة', 'منذ كم يوم', 'سبب المتابعة المقترح'].map((h) => (
              <th key={h} className="whitespace-nowrap p-2.5 text-right font-black text-[var(--dawaa-theme-heading)]">{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="p-6 text-center font-bold text-[var(--dawaa-theme-muted)]">جارٍ التحميل...</td></tr>}
            {!loading && !rows.length && <tr><td colSpan={6} className="p-6 text-center font-bold text-[var(--dawaa-theme-muted)]">مفيش فرص ضائعة حاليًا 🎉</td></tr>}
            {rows.map((r) => (
              <tr key={r.session_id} className="border-t border-[var(--dawaa-theme-border)]">
                <td className="p-2.5 font-black text-[var(--dawaa-theme-heading)]">{r.customer_name}</td>
                <td className="p-2.5">{r.staff_name || '-'}</td>
                <td className="p-2.5">{r.branch || '-'}</td>
                <td className="whitespace-nowrap p-2.5 font-bold text-[var(--dawaa-theme-muted)]">{new Date(r.conversation_started_at).toLocaleDateString('ar-EG')}</td>
                <td className="p-2.5"><span className="flex items-center gap-1 font-black text-amber-400"><Clock3 size={12} /> {r.days_since} يوم</span></td>
                <td className="max-w-[280px] p-2.5 text-[var(--dawaa-theme-muted)]">{r.suggested_followup_reason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
