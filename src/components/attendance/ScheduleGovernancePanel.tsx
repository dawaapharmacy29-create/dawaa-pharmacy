import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarCheck2, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { getScheduleGovernance, type ScheduleGovernance } from '@/lib/hr/workforceService';
import { cairoToday, startOfMonth } from '@/lib/attendance/period';

function Metric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'ok' | 'warn' | 'info' }) {
  const cls = tone === 'ok'
    ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]'
    : tone === 'warn'
      ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'
      : tone === 'info'
        ? 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)]'
        : 'border-[var(--dawaa-theme-border)] dawaa-surface';

  return (
    <div className={`rounded-xl border p-3 ${cls}`}>
      <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}

export default function ScheduleGovernancePanel({ branch }: { branch?: string | null }) {
  const today = cairoToday();
  const [start, setStart] = useState(startOfMonth(today));
  const [end, setEnd] = useState(today);
  const [data, setData] = useState<ScheduleGovernance | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getScheduleGovernance(start, end, branch && branch !== 'الكل' ? branch : null));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل حوكمة الجداول');
    } finally {
      setLoading(false);
    }
  }, [branch, end, start]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]"><CalendarCheck2 size={18} /> حوكمة الجداول والمناوبات</div>
          <p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
            قراءة Effective-dated للجداول الحالية قبل أي Publish workflow جديد. لا نحسب غيابًا من يوم جدول مفقود أو متعارض.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">من<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-dark mt-1 block" /></label>
          <label className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">إلى<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-dark mt-1 block" /></label>
          <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> تحديث</button>
        </div>
      </div>

      {data && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <Metric label="موظفون نشطون" value={data.staff_count} />
            <Metric label="أيام موظفين" value={data.staff_days} />
            <Metric label="جدول واضح" value={data.healthy_schedule_days} tone="ok" />
            <Metric label="بدون جدول" value={data.missing_schedule_days} tone={data.missing_schedule_days ? 'warn' : 'ok'} />
            <Metric label="تعارضات" value={data.conflicting_schedule_days} tone={data.conflicting_schedule_days ? 'warn' : 'ok'} />
            <Metric label="سجلات تشغيل" value={data.published_like_rows} tone="info" />
            <Metric label="مسودات" value={data.draft_rows} tone="info" />
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
              <div className="flex items-center gap-2"><ShieldCheck size={15} /> الوضع الحالي</div>
              <div className="mt-1">الجداول الحالية تعتبر تشغيلية كما هي؛ لم نغيّر طريقة الحضور الحالية أو نفعّل Draft/Publish إجباريًا بعد.</div>
            </div>
            <div className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
              <div className="flex items-center gap-2"><AlertTriangle size={15} /> الخطوة المستهدفة</div>
              <div className="mt-1">سنحوّل تعديل الجدول لاحقًا إلى Draft → Validate → Publish مع حفظ النسخة السابقة وعدم إعادة كتابة التاريخ.</div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
