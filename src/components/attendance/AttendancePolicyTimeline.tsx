import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { resolveEffectiveAttendancePolicy, type ShiftException, type TimeOffRequest } from '@/lib/attendance/effectiveAttendancePolicy';

type DailyRow = {
  staff_id: string;
  staff_name: string;
  branch: string | null;
  work_date: string;
  shift_start: string | null;
  shift_end: string | null;
  first_check_in: string | null;
  last_check_out: string | null;
};

type Props = {
  rows: DailyRow[];
  date: string;
  branch: string;
};

type PolicyRow = DailyRow & {
  timeOff: TimeOffRequest[];
  exceptions: ShiftException[];
};

function fmt(value?: string | null) {
  if (!value) return '-';
  return value.slice(0, 5);
}

export default function AttendancePolicyTimeline({ rows, date, branch }: Props) {
  const [timeOff, setTimeOff] = useState<any[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const staffIds = rows.map((r) => r.staff_id).filter(Boolean);
      if (!staffIds.length) {
        setTimeOff([]);
        setExceptions([]);
        return;
      }

      const [timeOffResult, exceptionResult] = await Promise.all([
        supabase
          .from('staff_time_off_requests')
          .select('id,staff_id,request_kind,request_label,status,start_date,end_date,start_time,end_time,duration_minutes,reason,decided_by_name')
          .in('staff_id', staffIds)
          .lte('start_date', date)
          .gte('end_date', date),
        supabase
          .from('shift_exceptions')
          .select('id,staff_name,employee_name,type,status,date,start_time,end_time,reason,branch')
          .eq('date', date),
      ]);

      if (timeOffResult.error) throw timeOffResult.error;
      if (exceptionResult.error) throw exceptionResult.error;
      setTimeOff(timeOffResult.data || []);
      setExceptions((exceptionResult.data || []).filter((x: any) => branch === 'الكل' || !x.branch || x.branch === branch));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل الأذونات وتعديلات الشيفت');
    } finally {
      setLoading(false);
    }
  }, [branch, date, rows]);

  useEffect(() => { void load(); }, [load]);

  const policyRows = useMemo<PolicyRow[]>(() => rows.map((row) => ({
    ...row,
    timeOff: timeOff.filter((x: any) => x.staff_id === row.staff_id) as TimeOffRequest[],
    exceptions: exceptions.filter((x: any) => [x.staff_name, x.employee_name].filter(Boolean).includes(row.staff_name)) as ShiftException[],
  })), [rows, timeOff, exceptions]);

  const changed = useMemo(() => policyRows.map((row) => {
    const result = resolveEffectiveAttendancePolicy({ date, baseStart: row.shift_start, baseEnd: row.shift_end, timeOff: row.timeOff, exceptions: row.exceptions });
    const changedWindow = result.base.start !== result.effective.start || result.base.end !== result.effective.end || result.effective.source !== 'base_schedule';
    return { row, result, changedWindow };
  }).filter((x) => x.changedWindow || x.result.pendingReview), [policyRows, date]);

  return <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-2"><CalendarClock size={18} className="text-[var(--dawaa-theme-primary-strong)]"/><h3 className="font-black text-[var(--dawaa-theme-heading)]">خط زمني للجدول والأذونات</h3></div>
        <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">القرار يبدأ بالجدول الأصلي ثم الاستثناءات والأذونات المعتمدة. الطلب قيد المراجعة يوقف الجزاء النهائي لحين الحسم.</p>
      </div>
      <div className="text-xs font-black text-[var(--dawaa-theme-muted)]">{loading ? 'جارٍ التحميل...' : `${changed.length} حالة تغيّر التوقع الفعلي`}</div>
    </div>

    {error && <div className="mt-3 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-black text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}

    {!loading && !changed.length && !error && <div className="mt-3 rounded-xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-3 text-xs font-black text-[var(--dawaa-status-success-text)]">لا توجد أذونات أو تعديلات تغيّر التوقع الفعلي لهذا اليوم.</div>}

    {!!changed.length && <div className="mt-3 grid gap-3 xl:grid-cols-2">
      {changed.map(({ row, result }) => {
        const pending = result.pendingReview;
        return <div key={row.staff_id} className={cn('rounded-xl border p-3', pending ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]' : 'border-[var(--dawaa-theme-border)] dawaa-surface-soft')}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}</div><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{row.branch || '-'}</div></div>
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black', pending ? 'border-[var(--dawaa-status-warning-border)] text-[var(--dawaa-status-warning-text)]' : 'border-[var(--dawaa-status-success-border)] text-[var(--dawaa-status-success-text)]')}>{pending ? <AlertTriangle size={12}/> : <ShieldCheck size={12}/>} {pending ? 'جزاء معلّق' : 'توقع معدل ومعتمد'}</span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2"><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الجدول الأصلي</div><div className="font-black">{fmt(result.base.start)} ← {fmt(result.base.end)}</div></div>
            <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2"><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">التوقع الفعلي</div><div className="font-black">{fmt(result.effective.start)} ← {fmt(result.effective.end)}</div></div>
          </div>

          <div className="mt-2 space-y-1.5">{result.rules.map((rule, index) => <div key={index} className="flex items-start gap-1.5 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{index === result.rules.length - 1 ? <CheckCircle2 size={13} className="mt-0.5 shrink-0"/> : <Clock3 size={13} className="mt-0.5 shrink-0"/>}<span>{rule}</span></div>)}</div>
        </div>;
      })}
    </div>}
  </section>;
}
