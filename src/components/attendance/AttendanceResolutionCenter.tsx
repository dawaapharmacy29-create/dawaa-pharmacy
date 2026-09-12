import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, Scale, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  approveAttendanceResolution,
  listAttendanceImpactLedger,
  listAttendanceResolutionQueue,
  materializeAttendanceRange,
  type AttendanceImpactRow,
  type AttendanceResolutionRow,
} from '@/lib/attendance/attendanceResolutionService';

function cairoDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function fmt(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' });
}

function statusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    on_time: 'ملتزم',
    on_time_with_permission: 'ملتزم + إذن',
    late: 'تأخير',
    very_late: 'تأخير شديد',
    approved_time_off: 'إجازة/غياب معتمد',
    off_day: 'إجازة أسبوعية',
    absence_review: 'غياب يحتاج مراجعة',
    missing_checkin: 'بصمة دخول ناقصة',
    missing_checkout: 'بصمة خروج ناقصة',
    early_leave_review: 'خروج مبكر يحتاج مراجعة',
    worked_on_off: 'عمل في يوم إجازة',
    time_off_with_events: 'بصمة أثناء إجازة',
    time_off_conflict: 'تعارض أذونات/إجازات',
    schedule_conflict: 'تعارض جدول',
    shift_swap_requires_schedule: 'تبديل شيفت غير مثبت بالجدول',
    no_schedule: 'لا يوجد جدول معتمد',
    invalid_schedule_time: 'وقت الجدول غير صالح',
    needs_event_review: 'بصمة تحتاج مراجعة',
    sync_pending_verification: 'انتظار اكتمال المزامنة',
    shift_in_progress: 'الشيفت لسه شغال',
    invalid_duration: 'مدة عمل غير منطقية',
  };
  return labels[status || ''] || status || 'غير محدد';
}

function stateClass(row: AttendanceResolutionRow) {
  if (row.status === 'approved' && ['on_time', 'on_time_with_permission', 'off_day', 'approved_time_off'].includes(row.resolution_status || '')) {
    return 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]';
  }
  if (row.status === 'pending_review') {
    return 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]';
  }
  return 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]';
}

export default function AttendanceResolutionCenter({ defaultBranch = 'الكل' }: { defaultBranch?: string }) {
  const [start, setStart] = useState(cairoDate(-7));
  const [end, setEnd] = useState(cairoDate());
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [status, setStatus] = useState<string>('');
  const [rows, setRows] = useState<AttendanceResolutionRow[]>([]);
  const [impacts, setImpacts] = useState<AttendanceImpactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [selected, setSelected] = useState<AttendanceResolutionRow | null>(null);
  const [note, setNote] = useState('');
  const [hours, setHours] = useState('');
  const [approving, setApproving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [queue, ledger] = await Promise.all([
        listAttendanceResolutionQueue({ start, end, branch, status: status || null, limit: 500 }),
        listAttendanceImpactLedger({ start, end, limit: 500 }),
      ]);
      setRows(queue);
      setImpacts(ledger);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل تسويات الحضور');
    } finally {
      setLoading(false);
    }
  }, [branch, end, start, status]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => ({
    total: rows.length,
    approved: rows.filter((row) => row.status === 'approved').length,
    review: rows.filter((row) => row.status === 'pending_review').length,
    system: rows.filter((row) => row.resolution_origin === 'system').length,
    manager: rows.filter((row) => row.resolution_origin === 'manager').length,
  }), [rows]);

  async function runMaterialization() {
    setMaterializing(true);
    try {
      const result = await materializeAttendanceRange({ start, end, branch });
      toast.success(`تمت التسوية: ${Number(result.approved || 0)} معتمد تلقائيًا، ${Number(result.pending_review || 0)} للمراجعة.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تشغيل التسوية');
    } finally {
      setMaterializing(false);
    }
  }

  async function approveSelected() {
    if (!selected) return;
    if (!note.trim()) {
      toast.warning('اكتب سبب الاعتماد أو التعديل حتى يظل القرار قابلًا للمراجعة.');
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
        note: note.trim(),
      });
      toast.success('تم اعتماد التسوية مع حفظ السبب وسجل المراجعة.');
      setSelected(null); setNote(''); setHours('');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر اعتماد التسوية');
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">التسوية اليومية والالتزام</h2>
            <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">البصمة دليل فقط. القرار هنا يجمع الجدول + المزامنة + الإذن/الإجازة + السياسة قبل أي أثر على الحافز أو المرتب.</p>
          </div>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">من<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-dark mt-1 block" /></label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">إلى<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-dark mt-1 block" /></label>
          <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">الحالة<select value={status} onChange={(e) => setStatus(e.target.value)} className="input-dark mt-1 block"><option value="">الكل</option><option value="pending_review">تحتاج مراجعة</option><option value="approved">معتمدة</option></select></label>
          <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button>
          <button onClick={() => void runMaterialization()} disabled={materializing} className="btn-primary"><ShieldCheck size={16} className={materializing ? 'animate-pulse' : ''} /> تشغيل التسوية</button>
        </div>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark mt-3 max-w-xs" placeholder="الفرع أو الكل" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="إجمالي الأيام" value={totals.total} icon={Clock3} />
        <Metric label="معتمدة" value={totals.approved} icon={CheckCircle2} />
        <Metric label="تحتاج مراجعة" value={totals.review} icon={AlertTriangle} />
        <Metric label="اعتماد تلقائي" value={totals.system} icon={ShieldCheck} />
        <Metric label="اعتماد إداري" value={totals.manager} icon={Scale} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]"><tr><th className="p-3 text-right">الموظف</th><th className="p-3 text-right">اليوم</th><th className="p-3 text-right">القرار</th><th className="p-3 text-right">دخول / خروج</th><th className="p-3 text-right">تأخير</th><th className="p-3 text-right">ساعات مرشحة</th><th className="p-3 text-right">المصدر</th><th className="p-3 text-right">إجراء</th></tr></thead>
          <tbody>
            {rows.map((row) => {
              const snapshot = row.resolution_snapshot || {};
              const staffName = String(snapshot.staff_name || row.staff_id);
              return <tr key={row.id} className="border-b border-[var(--dawaa-theme-border)]/60 last:border-0">
                <td className="p-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{staffName}</div><div className="text-xs text-[var(--dawaa-theme-muted)]">{row.branch || '-'}</div></td>
                <td className="p-3 font-bold">{row.attendance_date}</td>
                <td className="p-3"><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-black ${stateClass(row)}`}>{statusLabel(row.resolution_status)}</span></td>
                <td className="p-3 text-xs"><div>{fmt(row.first_in)}</div><div>{fmt(row.last_out)}</div></td>
                <td className="p-3 font-black">{Number(row.late_minutes || 0)} د</td>
                <td className="p-3 font-black">{Number(row.candidate_hours || 0).toFixed(2)}</td>
                <td className="p-3 text-xs">{row.resolution_origin === 'system' ? 'النظام' : row.resolution_origin === 'manager' ? 'إدارة' : 'مراجعة'}</td>
                <td className="p-3">{row.status === 'pending_review' ? <button onClick={() => { setSelected(row); setHours(row.candidate_hours == null ? '' : String(row.candidate_hours)); setNote(''); }} className="btn-secondary text-xs">مراجعة</button> : <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">معتمد</span>}</td>
              </tr>;
            })}
            {!rows.length && !loading && <tr><td colSpan={8} className="p-8 text-center font-bold text-[var(--dawaa-theme-muted)]">لا توجد تسويات مادية في الفترة الحالية. الحالات غير المكتملة بسبب المزامنة لا تتحول إلى خصم أو غياب نهائي.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <h3 className="font-black text-[var(--dawaa-theme-heading)]">سجل أثر الالتزام</h3>
        <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">تصنيف قابل للتتبع فقط؛ القيم المالية والنقاط تظل صفرًا حتى يمر الحدث بسياسة الحوافز/الرواتب المعتمدة.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{impacts.slice(0, 18).map((impact) => <div key={impact.id} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{statusLabel(String(impact.event_type).replace('attendance_', ''))}</div><div className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">{impact.attendance_date} · سياسة {impact.policy_version || 'غير محددة'}</div></div>)}</div>
      </div>

      {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-lg rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-2xl"><h3 className="text-lg font-black text-[var(--dawaa-theme-heading)]">مراجعة تسوية {selected.attendance_date}</h3><p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">{statusLabel(selected.resolution_status)} — لا يتم الاعتماد بدون سبب محفوظ في الـAudit.</p><label className="mt-4 block text-xs font-black text-[var(--dawaa-theme-muted)]">ساعات الاستحقاق للراتب<input value={hours} onChange={(e) => setHours(e.target.value)} type="number" min="0" max="18" step="0.01" className="input-dark mt-1 w-full" /></label><label className="mt-3 block text-xs font-black text-[var(--dawaa-theme-muted)]">سبب القرار<textarea value={note} onChange={(e) => setNote(e.target.value)} className="input-dark mt-1 min-h-24 w-full" placeholder="مثال: تم التحقق من مدير الفرع ومن سجل البصمة..." /></label><div className="mt-4 flex gap-2"><button onClick={() => void approveSelected()} disabled={approving} className="btn-primary flex-1">اعتماد موثق</button><button onClick={() => { setSelected(null); setNote(''); setHours(''); }} className="btn-secondary">إلغاء</button></div></div></div>}
    </div>
  );
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Clock3 }) {
  return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm"><div className="flex items-center gap-2 text-[var(--dawaa-theme-muted)]"><Icon size={17} /><span className="text-xs font-black">{label}</span></div><div className="mt-2 text-2xl font-black text-[var(--dawaa-theme-heading)]">{value}</div></div>;
}
