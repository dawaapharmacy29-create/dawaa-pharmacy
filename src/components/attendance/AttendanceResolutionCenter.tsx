import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import {
  approveAttendanceResolution,
  listAttendanceExceptionInbox,
  materializeAttendanceRange,
  type AttendanceExceptionLane,
  type AttendanceExceptionRow,
} from '@/lib/attendance/attendanceResolutionService';
import EmployeeProfileDrawer from '@/components/attendance/EmployeeProfileDrawer';
import AttendanceCorrectionReviewPanel from '@/components/attendance/AttendanceCorrectionReviewPanel';

function cairoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function fmt(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-EG', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function laneMeta(lane: AttendanceExceptionLane) {
  if (lane === 'system') {
    return {
      label: 'مشكلة نظام',
      className: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]',
      description: 'لا تُنسب للموظف ولا تعتمد كغياب أو خصم قبل إصلاح السبب النظامي.',
    };
  }
  return {
    label: 'يحتاج قرار مدير',
    className: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]',
    description: 'حالة تحتاج قرارًا بشريًا موثقًا بعد مراجعة الدليل.',
  };
}

const REVIEW_REASONS: Record<string, string[]> = {
  absence: ['إجازة معتمدة بعد مراجعة الطلب', 'مأمورية أو عمل خارج الفرع مثبت', 'غياب مؤكد بعد مراجعة المدير'],
  missing_punch: ['نسيان بصمة الدخول بعد التحقق', 'نسيان بصمة الخروج بعد التحقق', 'عطل جهاز البصمة مثبت', 'تم التحقق من سجل الفرع والمدير'],
  schedule: ['جدول العمل مختلف عن المسجل', 'تغيير وردية بموافقة المدير', 'عمل بفرع آخر مثبت'],
};
const COMMON_REASONS = ['تم التحقق من مدير الفرع', 'تعديل وردية معتمد', 'عمل بفرع آخر مثبت', 'عطل جهاز البصمة مثبت', 'إجازة معتمدة', 'بصمة مكررة أو خاطئة'];

export default function AttendanceResolutionCenter({
  defaultBranch = 'الكل',
  initialDate = null,
  initialTriage = 'manager',
}: {
  defaultBranch?: string;
  initialDate?: string | null;
  initialTriage?: 'all' | 'manager' | 'system';
}) {
  const [start, setStart] = useState(() => initialDate || cairoDate(-7));
  const [end, setEnd] = useState(() => initialDate || cairoDate());
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [lane, setLane] = useState<'all' | AttendanceExceptionLane>(initialTriage);
  const [rows, setRows] = useState<AttendanceExceptionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [selected, setSelected] = useState<AttendanceExceptionRow | null>(null);
  const [profileStaffId, setProfileStaffId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('');
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    setLane(initialTriage);
    if (!initialDate) return;
    setStart(initialDate);
    setEnd(initialDate);
  }, [initialDate, initialTriage]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const queue = await listAttendanceExceptionInbox({
        start,
        end,
        branch,
        lane,
        limit: 500,
      });
      setRows(queue);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل صندوق مراجعة الحضور');
    } finally {
      setLoading(false);
    }
  }, [branch, end, lane, start]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    total: rows.length,
    manager: rows.filter((row) => row.queue_lane === 'manager').length,
    system: rows.filter((row) => row.queue_lane === 'system').length,
    missingPunch: rows.filter((row) => row.issue_group === 'missing_punch').length,
    absence: rows.filter((row) => row.issue_group === 'absence').length,
  }), [rows]);

  async function runMaterialization() {
    setMaterializing(true);
    try {
      const result = await materializeAttendanceRange({ start, end, branch });
      toast.success(`تم تحديث حقيقة الحضور: ${Number(result.approved || 0)} يوم معتمد تلقائيًا، ${Number(result.pending_review || 0)} يحتاج مراجعة.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحديث حقيقة الحضور');
    } finally {
      setMaterializing(false);
    }
  }

  async function approveSelected() {
    if (!selected) return;
    if (selected.queue_lane !== 'manager') {
      toast.warning('هذه مشكلة نظام وليست قرار موظف. أصلح السبب النظامي أولًا.');
      return;
    }
    const decisionNote = [reason, note.trim()].filter(Boolean).join(' — ');
    if (!decisionNote) {
      toast.warning('اختر سبب القرار أو اكتبه حتى يظل الاعتماد قابلًا للمراجعة.');
      return;
    }
    const parsedHours = hours.trim() === '' ? null : Number(hours);
    if (parsedHours != null && (!Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > 18)) {
      toast.error('ساعات الاستحقاق يجب أن تكون بين 0 و18 ساعة.');
      return;
    }

    setApproving(true);
    try {
      await approveAttendanceResolution({
        staffId: selected.staff_id,
        date: selected.attendance_date,
        payrollEligibleHours: parsedHours,
        note: decisionNote,
      });
      toast.success('تم اعتماد قرار الحضور وحفظ السبب في سجل المراجعة.');
      setSelected(null);
      setNote('');
      setReason('');
      setHours('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر اعتماد قرار الحضور');
    } finally {
      setApproving(false);
    }
  }

  const currentLaneMeta = lane === 'system' ? laneMeta('system') : laneMeta('manager');

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="flex-1">
            <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Exception Inbox V2</div>
            <h2 className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">صندوق مراجعة الحضور</h2>
            <p className="mt-1 text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
              الموظف السليم لا يظهر هنا. نفصل قرار المدير عن مشكلة النظام، ومشكلة النظام لا تتحول تلقائيًا إلى مخالفة أو خصم.
            </p>
          </div>

          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
            من
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-dark mt-1 block" />
          </label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
            إلى
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-dark mt-1 block" />
          </label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
            المسار
            <select value={lane} onChange={(e) => setLane(e.target.value as 'all' | AttendanceExceptionLane)} className="input-dark mt-1 block">
              <option value="manager">يحتاج قرار مدير</option>
              <option value="system">مشكلة نظام</option>
              <option value="all">الكل</option>
            </select>
          </label>
          <button onClick={() => void load()} className="btn-secondary">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث
          </button>
          <button onClick={() => void runMaterialization()} disabled={materializing} className="btn-primary">
            <ShieldCheck size={16} className={materializing ? 'animate-pulse' : ''} /> تحديث حقيقة الحضور
          </button>
        </div>

        <input value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark mt-3 max-w-xs" placeholder="الفرع أو الكل" />

        <div className={`mt-3 rounded-xl border p-3 text-xs font-bold ${lane === 'all' ? 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]' : currentLaneMeta.className}`}>
          {lane === 'all'
            ? 'تعرض هذه النظرة قرارات المدير ومشاكل النظام معًا. استخدم المسارات المنفصلة للعمل اليومي.'
            : currentLaneMeta.description}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="إجمالي الاستثناءات" value={totals.total} icon={Clock3} />
        <Metric label="تحتاج قرار مدير" value={totals.manager} icon={AlertTriangle} tone="warn" />
        <Metric label="مشاكل نظام" value={totals.system} icon={Wrench} tone="info" />
        <Metric label="بصمات ناقصة" value={totals.missingPunch} icon={Clock3} />
        <Metric label="غياب محتمل" value={totals.absence} icon={AlertTriangle} tone="warn" />
      </section>

      <AttendanceCorrectionReviewPanel branch={branch} />

      <section className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
        <table className="min-w-[1050px] w-full text-sm">
          <thead className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
            <tr>
              <th className="p-3 text-right">الموظف</th>
              <th className="p-3 text-right">اليوم</th>
              <th className="p-3 text-right">نوع الحالة</th>
              <th className="p-3 text-right">المسار</th>
              <th className="p-3 text-right">الدليل</th>
              <th className="p-3 text-right">دخول / خروج</th>
              <th className="p-3 text-right">ساعات مرشحة</th>
              <th className="p-3 text-right">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const meta = laneMeta(row.queue_lane);
              return (
                <tr key={row.id} className="border-b border-[var(--dawaa-theme-border)]/60 last:border-0">
                  <td className="p-3">
                    <button onClick={() => setProfileStaffId(row.staff_id)} className="text-right font-black text-[var(--dawaa-theme-heading)] hover:underline hover:text-[var(--dawaa-theme-primary-strong)]">
                      {row.staff_name}
                    </button>
                    <div className="text-xs text-[var(--dawaa-theme-muted)]">{row.branch || '-'}</div>
                  </td>
                  <td className="p-3 font-bold">{row.attendance_date}</td>
                  <td className="p-3">
                    <div className="font-black text-[var(--dawaa-theme-heading)]">{row.issue_label}</div>
                    <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.issue_group}</div>
                  </td>
                  <td className="p-3">
                    <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-black ${meta.className}`}>{meta.label}</span>
                    {row.queue_lane === 'system' && <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-status-info-text)]">لا إجراء على الموظف</div>}
                  </td>
                  <td className="p-3">
                    <div className="font-black">{row.raw_events.toLocaleString('ar-EG')} بصمة خام</div>
                    <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الدليل محفوظ ولا يتم تعديله</div>
                  </td>
                  <td className="p-3 text-xs">
                    <div>{fmt(row.first_in)}</div>
                    <div>{fmt(row.last_out)}</div>
                  </td>
                  <td className="p-3 font-black">{row.candidate_hours == null ? '-' : row.candidate_hours.toFixed(2)}</td>
                  <td className="p-3">
                    {row.queue_lane === 'manager'
                      ? <button onClick={() => { setSelected(row); setHours(row.candidate_hours == null ? '' : String(row.candidate_hours)); setNote(''); setReason(''); }} className="btn-secondary text-xs">اتخاذ قرار</button>
                      : <span className="rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-2 py-1 text-[11px] font-black text-[var(--dawaa-status-info-text)]">إصلاح نظامي</span>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && !loading && (
              <tr>
                <td colSpan={8} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">
                  لا توجد حالات في هذا المسار خلال الفترة المحددة.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-2xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-4 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        الخصومات والجزاءات لم تعد جزءًا من صندوق مراجعة الحضور. الحضور يثبت الحقيقة التشغيلية فقط؛ الأثر المالي يمر من الرواتب/الجزاءات بعد الاعتماد.
      </section>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-2xl">
            <h3 className="text-lg font-black text-[var(--dawaa-theme-heading)]">قرار حضور — {selected.staff_name}</h3>
            <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">
              {selected.issue_label} · {selected.attendance_date}
            </p>
            <div className="mt-3 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
              هذا اعتماد لحقيقة الحضور، وليس قرار خصم أو جزاء مالي.
            </div>
            <label className="mt-4 block text-xs font-black text-[var(--dawaa-theme-muted)]">
              ساعات الاستحقاق للمرتب
              <input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min="0" max="18" step="0.01" className="input-dark mt-1 w-full" />
            </label>
            <label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">
              سبب شائع (اختياري)
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="input-dark mt-1 w-full">
                <option value="">اختر سببًا أو اكتب سببًا آخر</option>
                {[...new Set([...(REVIEW_REASONS[selected.issue_group] || []), ...COMMON_REASONS])].map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">
              تفاصيل أو سبب آخر (اختياري مع اختيار سبب)
              <textarea value={note} onChange={(e) => setNote(e.target.value)} className="input-dark mt-1 min-h-24 w-full" placeholder="اكتب تفاصيل التحقق أو سببًا غير موجود في القائمة..." />
            </label>
            <p className="mt-2 text-xs text-[var(--dawaa-theme-muted)]">اختر السبب بعد التحقق من الدليل؛ الساعات تُراجع منفصلة ولا تُحدد تلقائيًا من السبب.</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => void approveSelected()} disabled={approving} className="btn-primary flex-1">اعتماد موثق</button>
              <button onClick={() => { setSelected(null); setNote(''); setReason(''); setHours(''); }} className="btn-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}

      {profileStaffId && <EmployeeProfileDrawer staffId={profileStaffId} onClose={() => setProfileStaffId(null)} />}
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  icon: typeof Clock3;
  tone?: 'neutral' | 'warn' | 'info';
}) {
  const cls = tone === 'warn'
    ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]'
    : tone === 'info'
      ? 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)]'
      : 'border-[var(--dawaa-theme-border)] dawaa-surface';

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${cls}`}>
      <div className="flex items-center gap-2 text-[var(--dawaa-theme-muted)]"><Icon size={17} /><span className="text-xs font-black">{label}</span></div>
      <div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}
