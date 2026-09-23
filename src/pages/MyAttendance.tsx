import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  getStaffAttendanceDetail,
  RESOLUTION_STATUS_LABELS,
  resolutionStatusTone,
  type AttendanceDayRow,
  type StaffAttendanceDetail,
} from '@/lib/attendance/attendanceBreakdownService';
import { getAnnualLeaveBalanceV1, getPermissionPolicyStatusV2, type AnnualLeaveBalanceV1, type PermissionPolicyStatusV2 } from '@/lib/timeOffService';
import { cairoToday, computeRange, formatClock, type PeriodMode, rangeLabel, shiftAnchor, toneClasses } from '@/lib/attendance/period';
import { supabase } from '@/lib/supabase';
import AttendanceCorrectionRequestPanel from '@/components/attendance/AttendanceCorrectionRequestPanel';
import { listMyPaidStatements } from '@/lib/payroll/paidStatementService';
import { buildPaidStatementPdf } from '@/lib/payroll/paidStatementPdf';

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3">
      <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{label}</p>
      <p className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{sub}</p>}
    </div>
  );
}

export default function MyAttendance() {
  const [staffId, setStaffId] = useState<string | null>(null);
  const [resolvingIdentity, setResolvingIdentity] = useState(true);
  const [mode, setMode] = useState<PeriodMode>('month');
  const [anchor, setAnchor] = useState(cairoToday());
  const [detail, setDetail] = useState<StaffAttendanceDetail | null>(null);
  const [leaveBalance, setLeaveBalance] = useState<AnnualLeaveBalanceV1 | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionPolicyStatusV2 | null>(null);
  const [workforceSnapshot, setWorkforceSnapshot] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(false);
  const [paidStatements,setPaidStatements] = useState<{month_cycle:string;cycle_start:string;cycle_end:string;net_salary:number}[]>([]);
  const [statementError,setStatementError] = useState('');
  const [exportingMonth,setExportingMonth] = useState('');

  useEffect(()=>{if(!staffId)return;let active=true;listMyPaidStatements().then(rows=>{if(active){setPaidStatements(rows);setStatementError('')}}).catch(error=>{if(active)setStatementError(error instanceof Error?error.message:'تعذر تحميل كشوف الرواتب')});return()=>{active=false}},[staffId]);

  async function exportStatement(monthCycle:string){if(!staffId)return;setExportingMonth(monthCycle);try{const {pdf,fileName}=await buildPaidStatementPdf(staffId,monthCycle);pdf.save(fileName)}catch(error){toast.error(error instanceof Error?error.message:'تعذر تنزيل كشف الراتب')}finally{setExportingMonth('')}}

  const { start, end } = computeRange(mode, anchor);

  useEffect(() => {
    supabase.rpc('dawaa_current_actor_staff_id_v1').then(({ data, error }) => {
      if (!error && data) setStaffId(data as string);
      setResolvingIdentity(false);
    });
  }, []);

  const loadWorkforceSnapshot = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_workforce_snapshot_v1', { p_date: cairoToday() });
    if (error) throw error;
    return (data || null) as Record<string, any> | null;
  }, []);

  const load = useCallback(async () => {
    if (!staffId) return;
    setLoading(true);
    try {
      const [d, leave, permission, snapshot] = await Promise.all([
        getStaffAttendanceDetail(staffId, start, end),
        getAnnualLeaveBalanceV1(staffId, Number(end.slice(0, 4))).catch(() => null),
        getPermissionPolicyStatusV2(staffId, start, end).catch(() => null),
        loadWorkforceSnapshot().catch(() => null),
      ]);
      setDetail(d);
      setLeaveBalance(leave);
      setPermissionStatus(permission);
      setWorkforceSnapshot(snapshot);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل بيانات الحضور');
    } finally {
      setLoading(false);
    }
  }, [staffId, start, end, loadWorkforceSnapshot]);

  useEffect(() => { void load(); }, [load]);

  const summary = detail?.summary;

  if (resolvingIdentity) {
    return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-[var(--dawaa-theme-muted)]" /></div>;
  }
  if (!staffId) {
    return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-6 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">حسابك غير مربوط بملف موظف، تواصل مع الإدارة.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-3" dir="rtl">
      <div>
        <div className="text-xs font-black text-[var(--dawaa-theme-primary-strong)]">Employee Self-Service</div>
        <h1 className="text-xl font-black text-[var(--dawaa-theme-heading)]">حضوري وجدولي</h1>
        <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">شيفتك، حضورك، الإجازات وطلبات التصحيح في مكان واحد.</p>
      </div>

      <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4">
        <h2 className="font-black">كشوف رواتبي المدفوعة</h2>
        <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">يظهر كشف PDF بعد تسجيل الدفع ووجود نسخة اعتماد مالية كاملة. بصمات كل يوم معروضة أسفل الصفحة.</p>
        {statementError&&<p role="alert" className="mt-2 text-sm text-[var(--dawaa-status-danger-text)]">{statementError}</p>}
        {!statementError&&paidStatements.length===0&&<p className="mt-2 text-sm">لا توجد كشوف مدفوعة متاحة حتى الآن.</p>}
        {paidStatements.map(row=><div key={row.month_cycle} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-sm"><span>دورة {row.cycle_start} إلى {row.cycle_end} · الصافي {Number(row.net_salary).toLocaleString('ar-EG')} ج</span><button className="btn-secondary" disabled={!!exportingMonth} onClick={()=>void exportStatement(row.month_cycle)}>{exportingMonth===row.month_cycle?'جارٍ إعداد PDF':'تنزيل PDF'}</button></div>)}
      </section>

      {workforceSnapshot?.linked && (
        <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="شيفت اليوم"
            value={workforceSnapshot.today_schedule ? `${String(workforceSnapshot.today_schedule.shift_start || '—').slice(0,5)} → ${String(workforceSnapshot.today_schedule.shift_end || '—').slice(0,5)}` : 'غير مجدول'}
            sub={workforceSnapshot.today_schedule?.source_kind === 'date_override' ? 'تعديل مؤقت بتاريخ محدد' : workforceSnapshot.today_schedule ? 'الجدول الحالي' : 'راجع الإدارة إذا كان متوقعًا عملك اليوم'}
          />
          <StatCard
            label="الشيفت القادم"
            value={workforceSnapshot.next_schedule ? `${String(workforceSnapshot.next_schedule.shift_start || '—').slice(0,5)} → ${String(workforceSnapshot.next_schedule.shift_end || '—').slice(0,5)}` : 'غير متاح'}
            sub={workforceSnapshot.next_schedule?.day_name ? String(workforceSnapshot.next_schedule.day_name) : undefined}
          />
          <StatCard label="تصحيحات معلقة" value={String(workforceSnapshot.pending_corrections || 0)} />
          <StatCard label="طلبات معلقة" value={String((workforceSnapshot.pending_time_off || 0) + (workforceSnapshot.pending_overtime || 0))} sub={`إجازات ${workforceSnapshot.pending_time_off || 0} · OT ${workforceSnapshot.pending_overtime || 0}`} />
        </section>
      )}

      <div className="flex flex-col gap-2.5 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-xl border border-[var(--dawaa-theme-border)] p-1">
          {(['day', 'week', 'month'] as PeriodMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 text-xs font-black ${mode === m ? 'bg-[var(--dawaa-theme-accent)] text-white' : 'text-[var(--dawaa-theme-muted)]'}`}>
              {m === 'day' ? 'يومي' : m === 'week' ? 'أسبوعي' : 'الدورة الشهرية (26 → 25)'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))} className="btn-secondary !px-2"><ChevronRight size={16} /></button>
          <span className="flex items-center gap-1.5 rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-1.5 text-sm font-black text-[var(--dawaa-theme-heading)]">
            <CalendarDays size={14} /> {rangeLabel(mode, start, end)}
          </span>
          <button onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))} className="btn-secondary !px-2"><ChevronLeft size={16} /></button>
          <button onClick={() => void load()} className="btn-secondary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {loading && <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-6"><Loader2 className="mx-auto animate-spin text-[var(--dawaa-theme-muted)]" /></div>}

      {!loading && summary && (
        <>
          {summary.resolution_drift_days > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-2 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                يوجد {summary.resolution_drift_days} يوم قديم تغيّر تفسيره بعد تحديث الجداول
                {summary.financial_drift_days > 0 ? `، منهم ${summary.financial_drift_days} يوم يحتاج مراجعة الإدارة قبل الاعتماد المالي.` : '، بدون فرق ساعات مالي حاليًا.'}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="أيام حضور فعلية" value={String(summary.actual_worked_days)} sub={`من ${summary.scheduled_workdays} يوم مطلوب حتى اليوم`} />
            <StatCard label="أيام التأخير المعتمدة" value={String(summary.late_days)} sub={`${summary.total_late_minutes} دقيقة فعلية`} />
            <StatCard label="أيام معلّقة" value={String(summary.pending_review_days)} sub={`غياب ${summary.absence_review_days} · بصمة ناقصة ${summary.missing_punch_days}`} />
            <StatCard label="ساعات فعلية معتمدة" value={summary.total_worked_hours.toFixed(1)} />
            <StatCard label="أوفر تايم معتمد" value={summary.total_overtime_hours_approved.toFixed(1)} />
            <StatCard label="إجازات معتمدة" value={String(summary.approved_leave_days)} />
          </div>

          <div className="rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-2 text-xs font-bold text-[var(--dawaa-status-info-text)]">
            أي خصم مالي أو جزاء لا يُحسب من شاشة الحضور؛ الحساب النهائي من محرك المرتبات بعد اعتماد الأيام المعلّقة.
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard
              label="رصيد الإجازة السنوية"
              value={leaveBalance?.configured ? String(leaveBalance.balance ?? 0) : 'غير مفعّلة'}
              sub={leaveBalance?.configured ? `مستخدم ${leaveBalance.used} · محجوز ${leaveBalance.reserved}` : undefined}
            />
            <StatCard
              label="الأذونات هذه الفترة"
              value={permissionStatus ? `${permissionStatus.approved_permissions}/${permissionStatus.allowance}` : '—'}
              sub={permissionStatus ? `متبقٍ ${permissionStatus.remaining}` : undefined}
            />
          </div>

          {permissionStatus?.requires_manager_review && (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-2 text-xs font-black text-[var(--dawaa-status-danger-text)]">
              <AlertTriangle size={14} /> تجاوزت حد الأذونات المسموح به هذه الفترة
            </div>
          )}

          <AttendanceCorrectionRequestPanel defaultDate={end} />

          <div className="overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--dawaa-theme-border)] text-right text-xs font-black text-[var(--dawaa-theme-muted)]">
                  <th className="p-3">التاريخ</th>
                  <th className="p-3">اليوم</th>
                  <th className="p-3">الحالة</th>
                  <th className="p-3">الاعتماد</th>
                  <th className="p-3">حضور</th>
                  <th className="p-3">انصراف</th>
                  <th className="p-3">تأخير</th>
                </tr>
              </thead>
              <tbody>
                {detail!.days.map((d: AttendanceDayRow) => (
                  <tr key={d.attendance_date} className="border-b border-[var(--dawaa-theme-border)] last:border-0">
                    <td className="p-3 font-bold text-[var(--dawaa-theme-heading)]">{d.attendance_date}</td>
                    <td className="p-3 text-[var(--dawaa-theme-muted)]">{d.day_name}</td>
                    <td className="p-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${toneClasses(resolutionStatusTone(d.resolution_status))}`}>
                        {RESOLUTION_STATUS_LABELS[d.resolution_status] || d.resolution_status}
                      </span>
                    </td>
                    <td className="p-3">
                      {d.approval_state === 'approved'
                        ? <span className="rounded-full border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-2 py-0.5 text-[10px] font-black text-[var(--dawaa-status-success-text)]">معتمد</span>
                        : d.approval_state === 'pending_review'
                          ? <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-0.5 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">معلّق</span>
                          : <span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">غير مكوّن</span>}
                    </td>
                    <td className="p-3">{formatClock(d.first_in)}</td>
                    <td className="p-3">{formatClock(d.last_out)}</td>
                    <td className="p-3">{Number(d.late_minutes) > 0 ? `${d.late_minutes} د` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
