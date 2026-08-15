import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Database, Link2Off, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  getCustomerRequestSourceAudit,
  type CustomerRequestSourceAudit,
} from '@/lib/api/customerRequestSourceAudit';

function fmt(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export default function CustomerRequestSourceAuditPanel({ branch }: { branch: string }) {
  const [audit, setAudit] = useState<CustomerRequestSourceAudit | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setAudit(await getCustomerRequestSourceAudit(branch));
    } catch (error) {
      toast.error(`تعذر فحص دقة Base44: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);

  const exactMismatch = useMemo(() => {
    const s = audit?.summary;
    if (!s) return 0;
    return s.branch_mismatch + s.request_time_mismatch + s.quantity_mismatch + s.channel_mismatch + s.recorded_by_mismatch + s.request_type_mismatch + s.priority_mismatch + s.source_status_ahead;
  }, [audit]);

  if (loading && !audit) {
    return <div className="rounded-2xl border border-cyan-400/15 bg-cyan-500/[0.04] p-4 text-sm font-bold text-cyan-100">جاري فحص بيانات Base44 مقابل الإدارة...</div>;
  }
  if (!audit) return null;
  const s = audit.summary;
  const exact = exactMismatch === 0;

  return (
    <section className={`rounded-3xl border p-4 ${exact ? 'border-emerald-400/20 bg-emerald-500/[0.045]' : 'border-amber-400/25 bg-amber-500/[0.05]'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-white">
            {exact ? <ShieldCheck size={20} className="text-emerald-300" /> : <AlertTriangle size={20} className="text-amber-300" />}
            تدقيق Base44 ↔ تطبيق الإدارة
          </div>
          <p className="mt-1 text-xs leading-6 text-slate-400">
            مقارنة مباشرة بين البيانات الخام المحفوظة من CustomerOrder والحقول التشغيلية بعد التطبيع، بدون تغيير حالة الطلب أو الرجوع بمراحله للخلف.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="h-9 rounded-xl border border-slate-700 px-3 text-xs font-black text-slate-300 hover:bg-slate-900">
          <span className="inline-flex items-center gap-2"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> إعادة الفحص</span>
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <Metric icon={<Database size={15} />} label="طلبات المصدر" value={s.total} tone="cyan" />
        <Metric icon={<CheckCircle2 size={15} />} label="اختلافات المصدر" value={exactMismatch} tone={exact ? 'green' : 'amber'} />
        <Metric icon={<AlertTriangle size={15} />} label="بدون فرع" value={s.no_branch} tone={s.no_branch ? 'amber' : 'green'} />
        <Metric icon={<Link2Off size={15} />} label="عميل غير مربوط" value={s.unlinked_customer} tone={s.unlinked_customer ? 'amber' : 'green'} />
        <Metric icon={<AlertTriangle size={15} />} label="تعارض مزامنة" value={s.sync_conflicts} tone={s.sync_conflicts ? 'red' : 'green'} />
        <Metric icon={<Clock3 size={15} />} label="آخر وصول" valueText={fmt(s.last_seen)} tone="slate" />
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Detail label="وقت الطلب" value={s.request_time_mismatch} />
        <Detail label="نوع الطلب" value={s.request_type_mismatch} />
        <Detail label="الأولوية" value={s.priority_mismatch} />
        <Detail label="الكمية" value={s.quantity_mismatch} />
        <Detail label="قناة الطلب" value={s.channel_mismatch} />
        <Detail label="الفرع مقابل المصدر" value={s.branch_mismatch} />
        <Detail label="مسجل الطلب" value={s.recorded_by_mismatch} />
        <Detail label="المصدر متقدم عن الإدارة" value={s.source_status_ahead} />
      </div>

      {s.local_workflow_ahead > 0 && (
        <div className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-500/[0.05] px-3 py-2 text-xs font-bold text-cyan-100">
          {s.local_workflow_ahead.toLocaleString('ar-EG')} طلب حالته داخل الإدارة متقدمة عن الحالة القديمة القادمة من Base44؛ تم الاحتفاظ بالحالة الأحدث عمدًا لحماية سير العمل.
        </div>
      )}

      {!!audit.unresolved.length && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <div className="mb-2 text-xs font-black text-slate-300">أحدث سجلات تحتاج مراجعة بيانات</div>
          <div className="grid gap-2 lg:grid-cols-2">
            {audit.unresolved.slice(0, 10).map((row) => (
              <div key={row.id} className="rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-black text-white">{row.medicine_name || 'صنف غير محدد'}</div>
                  <div className="text-[10px] font-black text-cyan-200">{row.order_number || 'بدون رقم طلب'}</div>
                </div>
                <div className="mt-1 text-xs text-slate-400">{row.customer_name || 'عميل غير محدد'} · {row.customer_code || 'بدون كود'} · {row.branch || 'بدون فرع'}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(row.issues || []).map((issue) => <span key={issue} className="rounded-lg border border-amber-400/15 bg-amber-500/10 px-2 py-1 text-[10px] font-black text-amber-100">{issue}</span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Metric({ icon, label, value, valueText, tone }: { icon: React.ReactNode; label: string; value?: number; valueText?: string; tone: 'cyan' | 'green' | 'amber' | 'red' | 'slate' }) {
  const tones = {
    cyan: 'border-cyan-400/15 bg-cyan-500/[0.05] text-cyan-100',
    green: 'border-emerald-400/15 bg-emerald-500/[0.05] text-emerald-100',
    amber: 'border-amber-400/15 bg-amber-500/[0.05] text-amber-100',
    red: 'border-red-400/15 bg-red-500/[0.05] text-red-100',
    slate: 'border-slate-700 bg-slate-950/35 text-slate-200',
  };
  return <div className={`rounded-xl border p-3 ${tones[tone]}`}><div className="flex items-center gap-1.5 text-[10px] font-black opacity-80">{icon}{label}</div><div className="mt-1 text-lg font-black">{valueText ?? (value || 0).toLocaleString('ar-EG')}</div></div>;
}

function Detail({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-xs"><span className="font-bold text-slate-400">{label}</span><strong className={value ? 'text-amber-200' : 'text-emerald-300'}>{value.toLocaleString('ar-EG')}</strong></div>;
}
