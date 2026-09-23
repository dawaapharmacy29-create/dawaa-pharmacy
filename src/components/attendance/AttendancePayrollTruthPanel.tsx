import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ClipboardCheck,
  RefreshCw,
  ShieldCheck,
  Timer,
  Umbrella,
  Users2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { reopenAttendanceResolution } from '@/lib/attendance/attendanceResolutionService';
import {
  getAttendanceTruthCycleV2,
  type AttendanceTruthCycleV2,
} from '@/lib/hr/attendanceTruthService';

type DriftRow = {
  staff_id: string;
  staff_name: string;
  branch: string | null;
  attendance_date: string;
  stored_status: string;
  rebuilt_status: string;
  stored_hours: number;
  rebuilt_hours: number;
  drift_reason: string;
};

function cairoToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function cycleBounds(today = cairoToday()) {
  const [y, m, d] = today.split('-').map(Number);
  if (d >= 26) {
    const next = new Date(Date.UTC(y, m, 25));
    return { start: `${y}-${String(m).padStart(2, '0')}-26`, end: next.toISOString().slice(0, 10) };
  }
  const prev = new Date(Date.UTC(y, m - 2, 26));
  return { start: prev.toISOString().slice(0, 10), end: `${y}-${String(m).padStart(2, '0')}-25` };
}

function n(value: unknown) {
  const x = Number(value || 0);
  return Number.isFinite(x) ? x : 0;
}

export default function AttendancePayrollTruthPanel({
  branches,
  defaultBranch,
  onOpenResolutions,
}: {
  branches: string[];
  defaultBranch: string;
  onOpenResolutions?: (date: string) => void;
}) {
  const bounds = useMemo(() => cycleBounds(), []);
  const [start, setStart] = useState(bounds.start);
  const [end, setEnd] = useState(bounds.end);
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [truth, setTruth] = useState<AttendanceTruthCycleV2 | null>(null);
  const [driftRows, setDriftRows] = useState<DriftRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopenTarget, setReopenTarget] = useState<DriftRow | null>(null);
  const [reopenNote, setReopenNote] = useState('');
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    if (defaultBranch) setBranch(defaultBranch);
  }, [defaultBranch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const branchArg = branch === 'الكل' ? null : branch;
      const [truthResult, driftResult] = await Promise.all([
        getAttendanceTruthCycleV2({ start, end, branch: branchArg }),
        supabase.rpc('attendance_resolution_drift_v1', {
          p_start: start,
          p_end: end,
          p_branch: branchArg,
        }),
      ]);
      if (driftResult.error) throw driftResult.error;
      setTruth(truthResult);
      setDriftRows((driftResult.data || []).map((row: any) => ({
        ...row,
        stored_hours: n(row.stored_hours),
        rebuilt_hours: n(row.rebuilt_hours),
      })) as DriftRow[]);
    } catch (e) {
      setTruth(null);
      setError(e instanceof Error ? e.message : 'تعذر تحميل Attendance Truth V2');
    } finally {
      setLoading(false);
    }
  }, [branch, end, start]);

  useEffect(() => { void load(); }, [load]);

  const reopenFinancialDrift = useCallback(async () => {
    if (!reopenTarget) return;
    if (!reopenNote.trim()) {
      toast.warning('اكتب سبب إعادة فتح اليوم حتى يظل القرار موثقًا.');
      return;
    }
    setReopening(true);
    try {
      await reopenAttendanceResolution({
        staffId: reopenTarget.staff_id,
        date: reopenTarget.attendance_date,
        note: reopenNote.trim(),
      });
      const reopenedDate = reopenTarget.attendance_date;
      toast.success('تمت إعادة فتح اليوم. خرج من الحقيقة المالية لحين اعتماده من جديد.');
      setReopenTarget(null);
      setReopenNote('');
      await load();
      onOpenResolutions?.(reopenedDate);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إعادة فتح اليوم للمراجعة');
    } finally {
      setReopening(false);
    }
  }, [load, onOpenResolutions, reopenNote, reopenTarget]);

  const financialDriftRows = useMemo(
    () => driftRows.filter((row) => Math.abs(row.stored_hours - row.rebuilt_hours) > 0.1),
    [driftRows]
  );
  const classificationDriftRows = useMemo(
    () => driftRows.filter((row) => Math.abs(row.stored_hours - row.rebuilt_hours) <= 0.1),
    [driftRows]
  );

  const summary = truth?.summary;
  const rows = truth?.rows || [];
  const blockers =
    (summary?.pending_attendance_days || 0)
    + (summary?.stale_approved_overtime || 0)
    + financialDriftRows.length;
  const pendingWorkflow =
    (summary?.pending_overtime_hours || 0)
    + (summary?.pending_corrections || 0)
    + (summary?.pending_timeoff || 0);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-3xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Attendance Truth V2</div>
            <h2 className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">حقيقة الحضور للدورة</h2>
            <p className="mt-1 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
              مصدر موحد للحضور المعتمد والمعلق والإجازات والأوفر تايم وطلبات التصحيح. لا يتم احتساب أثر مالي من البصمة الخام مباشرة.
            </p>
          </div>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">من<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-dark mt-1 block" /></label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">إلى<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-dark mt-1 block" /></label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">الفرع<select value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark mt-1 block">
            {['الكل', ...branches.filter((b) => b !== 'الكل')].map((b) => <option key={b}>{b}</option>)}
          </select></label>
          <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
        </div>
      </div>

      {truth && (
        <div className={`rounded-2xl border p-4 ${
          summary?.ready_for_payroll_truth && blockers === 0
            ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]'
            : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'
        }`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
                {summary?.ready_for_payroll_truth && blockers === 0 ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} />}
                بوابة Attendance Truth
              </div>
              <div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">
                {summary?.ready_for_payroll_truth && blockers === 0
                  ? 'لا توجد موانع Truth حالية. الإقفال المالي يظل خاضعًا لباقي Payroll Contract.'
                  : 'يوجد عمل يحتاج إغلاقًا قبل اعتبار حقيقة الحضور مستقرة للدورة.'}
              </div>
            </div>
            <div className="rounded-full border border-current/10 bg-[var(--dawaa-theme-surface)] px-4 py-2 text-xs font-black">
              {blockers === 0 ? 'Truth مستقرة' : `${blockers.toLocaleString('ar-EG')} مانع مباشر`}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <Metric label="أيام عمل فعلية" value={summary?.worked_days ?? '—'} icon={CalendarDays} />
        <Metric label="ساعات عمل فعلية" value={summary ? Number(summary.worked_hours).toFixed(2) : '—'} icon={Clock3} />
        <Metric label="أيام حضور معلقة" value={summary?.pending_attendance_days ?? '—'} icon={AlertTriangle} warn={!!summary?.pending_attendance_days} />
        <Metric label="OT معتمد" value={summary ? Number(summary.approved_overtime_hours).toFixed(2) : '—'} icon={Timer} />
        <Metric label="OT معتمد أصبح Stale" value={summary?.stale_approved_overtime ?? '—'} icon={AlertTriangle} warn={!!summary?.stale_approved_overtime} />
        <Metric label="طلبات تصحيح معلقة" value={summary?.pending_corrections ?? '—'} icon={ClipboardCheck} warn={!!summary?.pending_corrections} />
        <Metric label="طلبات إجازة معلقة" value={summary?.pending_timeoff ?? '—'} icon={Umbrella} warn={!!summary?.pending_timeoff} />
        <Metric label="OT معلق" value={summary ? Number(summary.pending_overtime_hours).toFixed(2) : '—'} icon={Timer} warn={!!summary?.pending_overtime_hours} />
        <Metric label="فروق ساعات مالية" value={financialDriftRows.length} icon={AlertTriangle} warn={financialDriftRows.length > 0} />
        <Metric label="فروق تصنيف فقط" value={classificationDriftRows.length} icon={AlertTriangle} />
      </div>

      {error && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-sm font-bold text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}

      {!!pendingWorkflow && (
        <div className="rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
          توجد إجراءات Workflow معلقة: تصحيحات أو إجازات أو أوفر تايم. بعضها لا يغيّر الحقيقة تلقائيًا، لكنه يجب أن يُحسم قبل إغلاق الدورة إداريًا.
        </div>
      )}

      {financialDriftRows.length > 0 && (
        <div className="rounded-2xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-[var(--dawaa-status-danger-text)]" />
            <div>
              <div className="font-black text-[var(--dawaa-status-danger-text)]">يوجد {financialDriftRows.length} يوم تغيّرت ساعاته بعد الاعتماد</div>
              <div className="mt-1 text-xs font-bold text-[var(--dawaa-status-danger-text)]">
                لا يتم تعديل اليوم المعتمد تلقائيًا. يلزم إعادة فتحه ثم اعتماده من جديد، وبعدها يعاد تقييم الأوفر تايم المرتبط به.
              </div>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-theme-surface)]">
            <table className="min-w-[760px] w-full text-xs">
              <thead><tr className="border-b border-[var(--dawaa-theme-border)]">
                <th className="p-2 text-right">الموظف</th><th className="p-2 text-right">التاريخ</th>
                <th className="p-2 text-right">المحفوظ</th><th className="p-2 text-right">إعادة البناء</th>
                <th className="p-2 text-right">الساعات</th><th className="p-2 text-right">سبب الفرق</th><th className="p-2 text-right">الإجراء</th>
              </tr></thead>
              <tbody>
                {financialDriftRows.slice(0, 25).map((row) => <tr key={`${row.staff_id}-${row.attendance_date}`} className="border-b border-[var(--dawaa-theme-divider)] last:border-0">
                  <td className="p-2 font-black">{row.staff_name}<div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.branch || '-'}</div></td>
                  <td className="p-2">{row.attendance_date}</td>
                  <td className="p-2">{statusLabel(row.stored_status)}</td>
                  <td className="p-2 font-black text-[var(--dawaa-status-danger-text)]">{statusLabel(row.rebuilt_status)}</td>
                  <td className="p-2">{row.stored_hours.toFixed(2)} ← {row.rebuilt_hours.toFixed(2)}</td>
                  <td className="p-2">{driftReasonLabel(row.drift_reason)}</td>
                  <td className="p-2">
                    <button onClick={() => { setReopenTarget(row); setReopenNote(''); }} className="btn-secondary whitespace-nowrap px-2 py-1 text-[11px]">
                      إعادة فتح للمراجعة
                    </button>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
        <table className="min-w-[1250px] w-full text-sm">
          <thead className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="p-3 text-right">الموظف</th>
              <th className="p-3 text-right">الفرع</th>
              <th className="p-3 text-right">Truth</th>
              <th className="p-3 text-right">أيام عمل</th>
              <th className="p-3 text-right">ساعات فعلية</th>
              <th className="p-3 text-right">أيام معلقة</th>
              <th className="p-3 text-right">إجازة أسبوعية</th>
              <th className="p-3 text-right">إجازة معتمدة</th>
              <th className="p-3 text-right">غياب</th>
              <th className="p-3 text-right">عمل يوم إجازة</th>
              <th className="p-3 text-right">OT معتمد</th>
              <th className="p-3 text-right">OT معلق</th>
              <th className="p-3 text-right">طلبات معلقة</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.staff_id} className="border-b border-[var(--dawaa-theme-divider)] last:border-0">
                <td className="p-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}</div><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.role || '-'}</div></td>
                <td className="p-3">{row.branch || '-'}</td>
                <td className="p-3">
                  <span className={row.truth_ready
                    ? 'font-black text-[var(--dawaa-status-success-text)]'
                    : 'font-black text-[var(--dawaa-status-warning-text)]'}>
                    {row.truth_ready ? 'مستقرة' : 'تحتاج إغلاق'}
                  </span>
                  {!!row.stale_approved_overtime && <div className="mt-1 text-[10px] font-black text-[var(--dawaa-status-danger-text)]">OT stale: {row.stale_approved_overtime}</div>}
                </td>
                <td className="p-3 font-black text-[var(--dawaa-status-success-text)]">{row.worked_days}</td>
                <td className="p-3 font-black">{Number(row.worked_hours).toFixed(2)}</td>
                <td className="p-3 font-black text-[var(--dawaa-status-warning-text)]">{row.pending_attendance_days}</td>
                <td className="p-3">{row.off_days}</td>
                <td className="p-3">{row.approved_leave_days}</td>
                <td className="p-3">{row.absence_days}</td>
                <td className="p-3">{row.worked_on_off_days}</td>
                <td className="p-3 font-black text-[var(--dawaa-status-success-text)]">{Number(row.approved_overtime_hours).toFixed(2)}</td>
                <td className="p-3 font-black text-[var(--dawaa-status-warning-text)]">{Number(row.pending_overtime_hours).toFixed(2)}</td>
                <td className="p-3">{row.pending_corrections + row.pending_timeoff}</td>
              </tr>
            ))}
            {!loading && !rows.length && <tr><td colSpan={13} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد بيانات في الفترة الحالية.</td></tr>}
            {loading && <tr><td colSpan={13} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">جارٍ تحميل Attendance Truth...</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        الفصل المعماري: Attendance Truth تثبت ما حدث فعليًا. Payroll Contract هو وحده الذي يحوّل الحقيقة المعتمدة إلى مدخل مالي ثابت.
      </div>

      {reopenTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-2xl">
            <h3 className="text-lg font-black text-[var(--dawaa-theme-heading)]">إعادة فتح يوم مالي للمراجعة</h3>
            <p className="mt-2 text-sm font-bold text-[var(--dawaa-theme-muted)]">
              {reopenTarget.staff_name} — {reopenTarget.attendance_date}
            </p>
            <div className="mt-3 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-danger-text)]">
              الساعات المعتمدة: {reopenTarget.stored_hours.toFixed(2)} — إعادة البناء: {reopenTarget.rebuilt_hours.toFixed(2)}.
              بعد إعادة الفتح لا يدخل اليوم في Payroll Truth حتى يتم اعتماده مرة أخرى.
            </div>
            <label className="mt-4 block text-xs font-black text-[var(--dawaa-theme-muted)]">
              سبب إعادة الفتح
              <textarea value={reopenNote} onChange={(e) => setReopenNote(e.target.value)} className="input-dark mt-1 min-h-24 w-full" />
            </label>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void reopenFinancialDrift()} disabled={reopening} className="btn-primary flex-1">
                {reopening ? 'جارٍ إعادة الفتح...' : 'تأكيد وإرسال للتسويات'}
              </button>
              <button onClick={() => { setReopenTarget(null); setReopenNote(''); }} disabled={reopening} className="btn-secondary">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  warn = false,
}: {
  label: string;
  value: number | string;
  icon: typeof Clock3;
  warn?: boolean;
}) {
  return <div className={`rounded-2xl border p-4 shadow-sm ${
    warn
      ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'
      : 'border-[var(--dawaa-theme-border)] dawaa-surface'
  }`}>
    <div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><Icon size={16}/>{label}</div>
    <div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value}</div>
  </div>;
}

function statusLabel(value: string) {
  const labels: Record<string, string> = {
    on_time: 'في الموعد',
    on_time_with_permission: 'في الموعد بإذن',
    late: 'متأخر',
    very_late: 'متأخر جدًا',
    off_day: 'إجازة أسبوعية',
    approved_time_off: 'إجازة معتمدة',
    time_off_with_events: 'إجازة وبها بصمات',
    absence_review: 'غياب',
    worked_on_off: 'عمل في يوم إجازة',
    missing_checkin: 'دخول ناقص',
    missing_checkout: 'خروج ناقص',
    early_leave_review: 'خروج مبكر',
    needs_event_review: 'بصمات تحتاج مراجعة',
  };
  return labels[value] || value || '-';
}

function driftReasonLabel(value: string) {
  return String(value || '')
    .replace('status_changed', 'الحالة تغيرت')
    .replace('schedule_changed', 'الجدول تغير')
    .replace('hours_changed', 'الساعات تغيرت')
    .replaceAll(',', ' + ');
}
