import { useEffect, useState } from 'react';
import { GitBranch, PackageCheck, RefreshCcw, Truck, UserRoundCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Row = Record<string, any>;

const stateLabel: Record<string, string> = {
  verified_purchase: 'شراء مؤكد',
  service_failure_needs_recovery: 'تعثر خدمة يحتاج استرجاع',
  continuity_review_needed: 'يحتاج مراجعة استمرارية الحالة',
  delay_acknowledged_by_customer: 'العميل وافق على التأخير — التنفيذ غير محسوم',
  promise_pending_verification: 'وعد تشغيلي يحتاج تحقق',
  request_open: 'طلب مفتوح',
  context_only: 'سياق فقط',
};

export default function WhatsAppOrderLifecycleV19({ sourceId }: { sourceId: string | null }) {
  const [row, setRow] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!sourceId) { setRow(null); return; }
      setLoading(true); setError(null);
      const { data, error: qError } = await supabase
        .from('whatsapp_order_lifecycle_v19')
        .select('*')
        .contains('source_ids', [sourceId])
        .maybeSingle();
      if (cancelled) return;
      if (qError) { setError(qError.message); setRow(null); }
      else setRow(data || null);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [sourceId]);

  if (!sourceId) return null;
  if (loading) return <section className="dawaa-card dawaa-card--soft p-4 text-sm text-slate-400">جاري تجميع دورة تنفيذ الطلب...</section>;
  if (error) return <section className="dawaa-card dawaa-card--soft p-4 text-xs text-rose-200">تعذر تحميل دورة الطلب: {error}</section>;
  if (!row || Number(row.request_signals || 0) === 0) return null;

  return (
    <section className="dawaa-card dawaa-card--soft p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-white"><GitBranch size={17}/>دورة تنفيذ الطلب والـHandoff V19</div>
          <div className="mt-1 text-xs text-slate-400">تجمع كل الجلسات المرتبطة بنفس قصة العميل بدل تقييم كل موظف بمعزل عن مسار التنفيذ.</div>
        </div>
        <div className={`rounded-xl border px-3 py-2 text-xs font-black ${row.lifecycle_state === 'verified_purchase' ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200' : row.human_responsibility_review_required ? 'border-amber-400/25 bg-amber-500/10 text-amber-200' : 'border-slate-700 bg-slate-950/30 text-slate-200'}`}>
          {stateLabel[row.lifecycle_state] || row.lifecycle_state}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <K icon={PackageCheck} label="طلبات مكتشفة" value={row.request_signals || 0} />
        <K icon={RefreshCcw} label="وعود تشغيلية" value={row.promises_made || 0} />
        <K icon={Truck} label="إشعارات تأخير" value={row.delay_notices || 0} />
        <K icon={UserRoundCheck} label="وافق على الانتظار" value={row.customer_delay_acceptances || 0} />
        <K icon={GitBranch} label="Handoffs" value={row.staff_handoffs || 0} />
        <K icon={Truck} label="Delivery blockers" value={row.delivery_blockers || 0} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4 text-xs">
        <Mini label="إشارات تعثر وعد" value={row.promise_breach_signals || 0} warn={Number(row.promise_breach_signals || 0) > 0} />
        <Mini label="محاولات استرجاع" value={row.recovery_offers || 0} />
        <Mini label="انقطاع استمرارية" value={row.continuity_break_signals || 0} warn={Number(row.continuity_break_signals || 0) > 0} />
        <Mini label="شراء مؤكد" value={row.verified_sales || 0} />
      </div>

      <div className="mt-3 rounded-xl border border-violet-400/15 bg-violet-500/5 p-3 text-xs leading-6 text-violet-100">
        <b>الإجراء التالي:</b> {row.next_operational_action}
      </div>
      {row.human_responsibility_review_required ? <div className="mt-2 text-[10px] leading-5 text-amber-200">تحديد مسؤولية التأخير أو فشل التنفيذ يحتاج مراجعة بشرية لمسار الطلب والدليفري. وجود تعثر لا يعني تلقائيًا أن الدكتور هو المسؤول.</div> : null}
    </section>
  );
}

function K({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-2.5"><div className="flex items-center gap-1.5 text-[10px] text-slate-500"><Icon size={12}/>{label}</div><div className="mt-1 font-black text-white">{value}</div></div>;
}
function Mini({ label, value, warn = false }: { label: string; value: any; warn?: boolean }) {
  return <div className={`rounded-xl border p-2.5 ${warn ? 'border-amber-400/20 bg-amber-500/5' : 'border-slate-800 bg-slate-950/20'}`}><div className="text-[10px] text-slate-500">{label}</div><div className={warn ? 'mt-1 font-black text-amber-200' : 'mt-1 font-black text-slate-100'}>{value}</div></div>;
}
