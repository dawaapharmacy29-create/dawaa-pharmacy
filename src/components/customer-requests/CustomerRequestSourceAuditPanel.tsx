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
    return <div className="rounded-2xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-primary)]/[0.04] p-4 text-sm font-bold text-[var(--dawaa-theme-primary)]">جاري فحص بيانات Base44 مقابل الإدارة...</div>;
  }
  if (!audit) return null;
  const s = audit.summary;
  const sourceContractGaps =
    s.source_missing_customer_code +
    s.source_missing_product_code +
    s.source_missing_recorded_staff_id;
  const exact = exactMismatch === 0;
  const healthy = exact && sourceContractGaps === 0;

  return (
    <section className={`rounded-3xl border p-4 ${healthy ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]/[0.045]' : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]/[0.05]'}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            {healthy ? <ShieldCheck size={20} className="text-[var(--dawaa-status-success-text)]" /> : <AlertTriangle size={20} className="text-[var(--dawaa-status-warning-text)]" />}
            تدقيق Base44 ↔ تطبيق الإدارة
          </div>
          <p className="mt-1 text-xs leading-6 text-[var(--dawaa-theme-muted)]">
            مقارنة مباشرة بين البيانات الخام المحفوظة من CustomerOrder والحقول التشغيلية بعد التطبيع، بدون تغيير حالة الطلب أو الرجوع بمراحله للخلف.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="h-9 rounded-xl border border-[var(--dawaa-theme-border)] px-3 text-xs font-black text-[var(--dawaa-theme-text)] hover:bg-[var(--dawaa-theme-surface)]">
          <span className="inline-flex items-center gap-2"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> إعادة الفحص</span>
        </button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <Metric icon={<Database size={15} />} label="طلبات المصدر" value={s.total} tone="cyan" />
        <Metric icon={<CheckCircle2 size={15} />} label="اختلافات المصدر" value={exactMismatch} tone={exact ? 'green' : 'amber'} />
        <Metric icon={<Link2Off size={15} />} label="عميل غير مربوط" value={s.unlinked_customer} tone={s.unlinked_customer ? 'amber' : 'green'} />
        <Metric icon={<Link2Off size={15} />} label="صنف غير مربوط" value={s.unlinked_product} tone={s.unlinked_product ? 'amber' : 'green'} />
        <Metric icon={<AlertTriangle size={15} />} label="مسجل غير مربوط" value={s.unlinked_registrar} tone={s.unlinked_registrar ? 'amber' : 'green'} />
        <Metric icon={<Clock3 size={15} />} label="آخر وصول" valueText={fmt(s.last_seen)} tone="slate" />
      </div>

      <div className="mt-3 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-black text-[var(--dawaa-theme-heading)]">عقد الهوية القادم من Base44</div>
          <span className={`rounded-lg px-2 py-1 text-[10px] font-black ${sourceContractGaps ? 'bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' : 'bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'}`}>
            {sourceContractGaps ? `${sourceContractGaps.toLocaleString('ar-EG')} فجوة هوية` : 'العقد مكتمل'}
          </span>
        </div>
        <p className="mt-1 text-[10px] font-bold leading-5 text-[var(--dawaa-theme-muted)]">الأفضل أن يصل كل طلب بـ customer_code + product_code + recorded_staff_id. الاسم وحده لا يمنح نقاطًا ولا يربط صنفًا تلقائيًا.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Detail label="بدون customer_code ثابت بالمصدر" value={s.source_missing_customer_code} />
          <Detail label="بدون product_code ثابت بالمصدر" value={s.source_missing_product_code} />
          <Detail label="بدون recorded_staff_id ثابت بالمصدر" value={s.source_missing_recorded_staff_id} />
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Detail label="وقت الطلب" value={s.request_time_mismatch} />
        <Detail label="نوع الطلب" value={s.request_type_mismatch} />
        <Detail label="الأولوية" value={s.priority_mismatch} />
        <Detail label="الكمية" value={s.quantity_mismatch} />
        <Detail label="قناة الطلب" value={s.channel_mismatch} />
        <Detail label="الفرع مقابل المصدر" value={s.branch_mismatch} />
        <Detail label="مسجل الطلب" value={s.recorded_by_mismatch} />
        <Detail label="تعارض مزامنة" value={s.sync_conflicts} />
        <Detail label="بدون فرع" value={s.no_branch} />
        <Detail label="المصدر متقدم عن الإدارة" value={s.source_status_ahead} />
      </div>

      {s.local_workflow_ahead > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-primary)]/[0.05] px-3 py-2 text-xs font-bold text-[var(--dawaa-theme-primary)]">
          {s.local_workflow_ahead.toLocaleString('ar-EG')} طلب حالته داخل الإدارة متقدمة عن الحالة القديمة القادمة من Base44؛ تم الاحتفاظ بالحالة الأحدث عمدًا لحماية سير العمل.
        </div>
      )}

      {!!audit.unresolved.length && (
        <div className="mt-4 border-t border-[var(--dawaa-theme-border)] pt-3">
          <div className="mb-2 text-xs font-black text-[var(--dawaa-theme-text)]">أحدث سجلات تحتاج مراجعة بيانات</div>
          <div className="grid gap-2 lg:grid-cols-2">
            {audit.unresolved.slice(0, 10).map((row) => (
              <div key={row.id} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-black text-[var(--dawaa-theme-heading)]">{row.medicine_name || 'صنف غير محدد'}</div>
                  <div className="text-[10px] font-black text-[var(--dawaa-theme-primary)]">{row.order_number || 'بدون رقم طلب'}</div>
                </div>
                <div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{row.customer_name || 'عميل غير محدد'} · {row.customer_code || 'بدون كود'} · {row.branch || 'بدون فرع'}</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(row.issues || []).map((issue) => <span key={issue} className="rounded-lg border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-1 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">{issue}</span>)}
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
    cyan: 'border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-primary)]/[0.05] text-[var(--dawaa-theme-primary)]',
    green: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]/[0.05] text-[var(--dawaa-status-success-text)]',
    amber: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]/[0.05] text-[var(--dawaa-status-warning-text)]',
    red: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]/[0.05] text-[var(--dawaa-status-danger-text)]',
    slate: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] text-[var(--dawaa-theme-heading)]',
  };
  return <div className={`rounded-xl border p-3 ${tones[tone]}`}><div className="flex items-center gap-1.5 text-[10px] font-black opacity-80">{icon}{label}</div><div className="mt-1 text-lg font-black">{valueText ?? (value || 0).toLocaleString('ar-EG')}</div></div>;
}

function Detail({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-xs"><span className="font-bold text-[var(--dawaa-theme-muted)]">{label}</span><strong className={value ? 'text-[var(--dawaa-status-warning-text)]' : 'text-[var(--dawaa-status-success-text)]'}>{value.toLocaleString('ar-EG')}</strong></div>;
}
