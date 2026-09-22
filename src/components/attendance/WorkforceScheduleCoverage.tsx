import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, Moon, RefreshCw, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type CoveragePayload = {
  date?: string;
  totals?: {
    staff?: number;
    scheduled_working?: number;
    no_schedule?: number;
    off_staff?: number;
    date_overrides?: number;
    overnight_shifts?: number;
  };
  branches?: Array<{
    branch: string;
    total_staff: number;
    scheduled_working: number;
    no_schedule: number;
    off_staff: number;
    date_overrides: number;
    overnight_shifts: number;
  }>;
  roles?: Array<{
    branch: string;
    role: string;
    total_staff: number;
    scheduled_working: number;
    no_schedule: number;
  }>;
};

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function Metric({ label, value, icon: Icon, warn = false }: { label: string; value: number; icon: typeof Users; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${warn ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]' : 'border-[var(--dawaa-theme-border)] dawaa-surface'}`}>
      <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><Icon size={15} /> {label}</div>
      <div className="mt-1 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}

export default function WorkforceScheduleCoverage({ branch }: { branch: string }) {
  const [date, setDate] = useState(cairoToday());
  const [data, setData] = useState<CoveragePayload | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload, error } = await supabase.rpc('workforce_schedule_coverage_v1', {
        p_date: date,
        p_branch: branch === 'الكل' ? null : branch,
      });
      if (error) throw error;
      setData((payload || {}) as CoveragePayload);
    } catch (error) {
      console.warn('[schedule] coverage unavailable', error);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [branch, date]);

  useEffect(() => { void load(); }, [load]);

  const totals = data?.totals || {};
  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm" dir="rtl">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Workforce Scheduling V2</div>
          <h2 className="mt-1 text-lg font-black text-[var(--dawaa-theme-heading)]">تغطية الجداول والمناوبات</h2>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">قراءة تشغيلية لعدد الموظفين المجدولين، الإجازات، الجداول الناقصة والشيفتات الليلية في التاريخ المحدد.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-dark mt-1 block" /></label>
          <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث</button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="إجمالي الفريق" value={Number(totals.staff || 0)} icon={Users} />
        <Metric label="مجدولون للعمل" value={Number(totals.scheduled_working || 0)} icon={CalendarDays} />
        <Metric label="إجازة/راحة" value={Number(totals.off_staff || 0)} icon={CalendarDays} />
        <Metric label="بدون جدول" value={Number(totals.no_schedule || 0)} icon={AlertTriangle} warn={Number(totals.no_schedule || 0) > 0} />
        <Metric label="تعديلات بتاريخ محدد" value={Number(totals.date_overrides || 0)} icon={CalendarDays} />
        <Metric label="شيفتات ليلية" value={Number(totals.overnight_shifts || 0)} icon={Moon} />
      </div>

      {!!data?.branches?.length && (
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {data.branches.map((row) => (
            <div key={row.branch} className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3">
              <div className="font-black text-[var(--dawaa-theme-heading)]">{row.branch}</div>
              <div className="mt-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                {row.scheduled_working.toLocaleString('ar-EG')} مجدول · {row.off_staff.toLocaleString('ar-EG')} راحة · {row.no_schedule.toLocaleString('ar-EG')} بدون جدول
              </div>
              <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.overnight_shifts.toLocaleString('ar-EG')} شيفت ليلي · {row.date_overrides.toLocaleString('ar-EG')} تعديل مؤقت</div>
            </div>
          ))}
        </div>
      )}

      {Number(totals.no_schedule || 0) > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
          يوجد موظفون بدون جدول في هذا اليوم. هذه مشكلة بيانات/تخطيط ولا تُحسب غيابًا على الموظف تلقائيًا.
        </div>
      )}
    </section>
  );
}
