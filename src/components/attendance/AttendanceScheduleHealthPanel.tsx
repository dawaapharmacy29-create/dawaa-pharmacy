import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarRange, CheckCircle2, Clock3, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type Row = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  weekly_rows: number;
  off_days: number;
  distinct_work_times: number;
  missing_time_rows: number;
  date_overrides: number;
  has_custom_pattern: boolean;
  health_status: string;
};

function statusLabel(status: string) {
  if (status === 'ok') return 'جدول ثابت وسليم';
  if (status === 'custom_schedule') return 'مواعيد مختلفة/استثناءات محفوظة';
  if (status === 'missing_weekly_days') return 'أيام أسبوعية ناقصة';
  if (status === 'duplicate_weekly_rows') return 'صفوف أسبوعية مكررة';
  if (status === 'missing_shift_time') return 'وقت شيفت ناقص';
  return status;
}

export default function AttendanceScheduleHealthPanel({
  defaultBranch,
}: {
  defaultBranch: string;
}) {
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultBranch) setBranch(defaultBranch);
  }, [defaultBranch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('attendance_schedule_health_v1', {
        p_branch: branch === 'الكل' ? null : branch,
      });
      if (rpcError) throw rpcError;
      setRows((data || []) as Row[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل سلامة الجداول');
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    total: rows.length,
    custom: rows.filter((r) => r.health_status === 'custom_schedule').length,
    issues: rows.filter((r) => !['ok', 'custom_schedule'].includes(r.health_status)).length,
  }), [rows]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">سلامة جداول الموظفين</h2>
            <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
              يراجع الجداول الأسبوعية والاستثناءات المؤرخة. اختلاف المواعيد بين الأيام حالة صحيحة وليست خطأ طالما الجدول كامل.
            </p>
          </div>
          <div className="flex gap-2">
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark">
              <option>الكل</option><option>فرع الشامي</option><option>فرع شكري</option>
            </select>
            <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> تحديث</button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="موظفين مراجعِين" value={totals.total} icon={CalendarRange} />
        <Metric label="جداول بمواعيد مختلفة" value={totals.custom} icon={Clock3} tone="info" />
        <Metric label="مشاكل تحتاج إصلاح" value={totals.issues} icon={AlertTriangle} tone={totals.issues ? 'danger' : 'success'} />
      </div>

      {error && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-sm font-bold text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}

      <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
        <table className="min-w-[900px] w-full text-sm">
          <thead className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="p-3 text-right">الموظف</th>
              <th className="p-3 text-right">الفرع</th>
              <th className="p-3 text-right">أيام الجدول</th>
              <th className="p-3 text-right">أيام الراحة</th>
              <th className="p-3 text-right">أنماط المواعيد</th>
              <th className="p-3 text-right">استثناءات بتاريخ</th>
              <th className="p-3 text-right">أوقات ناقصة</th>
              <th className="p-3 text-right">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const issue = !['ok','custom_schedule'].includes(row.health_status);
              return <tr key={row.staff_id} className="border-b border-[var(--dawaa-theme-divider)] last:border-0">
                <td className="p-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}</div><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.role || '-'}</div></td>
                <td className="p-3">{row.branch || '-'}</td>
                <td className="p-3 font-black">{row.weekly_rows}</td>
                <td className="p-3">{row.off_days}</td>
                <td className="p-3 font-black">{row.distinct_work_times}</td>
                <td className="p-3">{row.date_overrides}</td>
                <td className="p-3">{row.missing_time_rows}</td>
                <td className="p-3">
                  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-black',
                    issue
                      ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]'
                      : row.health_status === 'custom_schedule'
                      ? 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]'
                      : 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]'
                  )}>
                    {issue ? <AlertTriangle size={13}/> : <CheckCircle2 size={13}/>}
                    {statusLabel(row.health_status)}
                  </span>
                </td>
              </tr>;
            })}
            {!loading && !rows.length && <tr><td colSpan={8} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد بيانات جداول في النطاق الحالي.</td></tr>}
            {loading && <tr><td colSpan={8} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">جارٍ فحص الجداول...</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone = 'default' }: { label: string; value: number; icon: typeof Clock3; tone?: 'default'|'info'|'success'|'danger' }) {
  const cls = tone === 'danger'
    ? 'text-[var(--dawaa-status-danger-text)]'
    : tone === 'success'
    ? 'text-[var(--dawaa-status-success-text)]'
    : tone === 'info'
    ? 'text-[var(--dawaa-status-info-text)]'
    : 'text-[var(--dawaa-theme-heading)]';
  return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><Icon size={16}/>{label}</div><div className={cn('mt-2 text-2xl font-black',cls)}>{value}</div></div>;
}
