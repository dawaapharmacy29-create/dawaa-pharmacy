import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/hooks/useAuth';
import { X, Calendar, TrendingUp, Clock3, Download, AlertCircle, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { buildEmployeeAttendanceProfilePdf } from '@/lib/attendance/employeeProfilePdf';
import { toast } from 'sonner';
import { formatEmployeeProfileClock as formatTime } from '@/lib/attendance/profileTime';

// Lazy import avoids circular eager initialization: the inbox also opens staff profiles.
const AttendanceResolutionCenter = lazy(() => import('@/components/attendance/AttendanceResolutionCenter'));
const REVIEW_ROLES = new Set(['admin', 'general_manager', 'executive_manager', 'branches_manager', 'branch_manager', 'shift_supervisor_morning', 'shift_supervisor_evening']);

type Profile = {
  staff: { id: string; name: string; role: string | null; branch: string | null; active: boolean };
  weekly_schedule: { day_name: string; shift_date: string | null; is_off: boolean; shift_start: string | null; shift_end: string | null }[];
  rates: {
    evaluated_days: number; on_time_days: number; late_days: number; very_late_days: number;
    early_leave_days: number; permission_days: number; absence_days: number; pending_review_days: number;
    late_rate_pct: number; permission_rate_pct: number;
  };
  recent_days: {
    attendance_date: string; status: string; resolution_status: string; first_in: string | null;
    last_out: string | null; late_minutes: number; early_leave_minutes: number; payroll_eligible_hours: number | null;
  }[];
  processed_evidence: {
    source: 'staff_attendance_logs';
    from: string; to: string;
    total_punches: number; accepted_punches: number; accepted_days: number;
    summary_covered_days: number; missing_summary_days: number; coverage_complete: boolean;
    complete_pair_days: number; manual_review_punches: number; rejected_punches: number;
    recent_days: {
      shift_date: string; accepted_punches: number; review_punches: number; rejected_punches: number;
      first_in: string | null; last_out: string | null; punch_branches: string[];
      has_summary: boolean; summary_status: string | null;
    }[];
  };
};

const STATUS_LABEL: Record<string, string> = {
  on_time: 'في الموعد', late: 'متأخر', very_late: 'متأخر جدًا', absence_review: 'غياب',
  missing_checkin: 'دخول ناقص', missing_checkout: 'خروج ناقص', off_day: 'إجازة', worked_on_off: 'حضور في إجازة',
  approved_time_off: 'إذن معتمد', early_leave_review: 'خروج مبكر', shift_in_progress: 'جارٍ الآن', no_schedule: 'بدون جدول',
};

export default function EmployeeProfileDrawer({ staffId, onClose }: { staffId: string; onClose: () => void }) {
  const { user } = useAuth();
  const canReviewAttendance = REVIEW_ROLES.has(user?.role || '');
  const [showReviews, setShowReviews] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { data, error: rpcError } = await supabase.rpc('attendance_employee_profile_evidence_v1', { p_staff_id: staffId, p_days: 30 });
        if (rpcError) throw rpcError;
        if (!cancelled) setProfile(data as Profile);
      } catch (e) {
        if (!cancelled) { setProfile(null); setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات الموظف'); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [staffId, reloadVersion]);

  // The global Header has z-[220] and h-14. The drawer lives in document.body,
  // outside page stacking contexts, and starts below the visible app header.
  useEffect(() => {
    const savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = savedOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  const evidence = profile?.processed_evidence;
  const coverageIncomplete = Boolean(evidence && !evidence.coverage_complete);
  const currentCairoDay = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long', timeZone: 'Africa/Cairo',
  });

  function openCurrentCycleReview() {
    // Reuse the existing guarded decision workflow without losing this employee.
    setShowReviews(true);
  }

  async function handleExport() {
    if (!profile) return;
    setExporting(true);
    try {
      const { pdf, fileName } = await buildEmployeeAttendanceProfilePdf({
        staffName: profile.staff.name,
        role: profile.staff.role,
        branch: profile.staff.branch,
        weeklySchedule: profile.weekly_schedule,
        rates: profile.rates,
        recentDays: profile.recent_days,
        processedEvidence: profile.processed_evidence,
      });
      pdf.save(fileName);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إنشاء ملف PDF');
    } finally {
      setExporting(false);
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="ملف حضور الموظف"
      className="fixed inset-x-0 bottom-0 top-14 z-[240] flex items-center justify-center bg-black/60 px-2 py-3 backdrop-blur-[2px] sm:px-5 sm:py-5"
      onClick={onClose} dir="rtl">
      <aside className="flex max-h-full w-full min-w-0 max-w-[1060px] flex-col overflow-hidden rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <header className="z-10 flex shrink-0 items-start justify-between gap-3 border-b border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-black leading-snug text-[var(--dawaa-theme-heading)] sm:text-xl">{loading ? 'جارٍ التحميل...' : profile?.staff.name || 'ملف حضور الموظف'}</h2>
          {profile && !loading && <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
            <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5">{profile.staff.role || 'الوظيفة غير محددة'}</span>
            <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5">{profile.staff.branch || 'الفرع غير محدد'}</span>
            <span className="rounded-full border px-2 py-0.5 border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-heading)]">{coverageIncomplete ? 'تغطية جزئية' : 'تغطية مكتملة'}</span>
            {!profile.staff.active && <span className="rounded-full border border-[var(--dawaa-status-danger-border)] px-2 py-0.5 text-[var(--dawaa-status-danger-text)]">غير نشط</span>}
          </div>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {showReviews && <button type="button" onClick={() => setShowReviews(false)} className="btn-secondary px-3 py-2 text-xs">العودة للملف</button>}
            {profile && !loading && !showReviews && <button onClick={() => void handleExport()} disabled={exporting} className="btn-secondary px-3 py-2 text-xs" aria-label="تصدير ملف الحضور PDF"><Download size={14} className={exporting ? 'animate-pulse' : ''} /> {exporting ? 'جارٍ التصدير...' : 'PDF'}</button>}
            <button type="button" onClick={onClose} aria-label="إغلاق ملف الموظف" className="rounded-xl border border-[var(--dawaa-theme-border)] p-2 text-[var(--dawaa-theme-heading)] hover:bg-[var(--dawaa-theme-surface-2)]"><X size={18} /></button>
          </div>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 sm:py-5">
        {error && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</div>}
        {loading && <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--dawaa-theme-surface-2)]" />)}</div>}

        {profile && !loading && (showReviews ? (
          <Suspense fallback={<p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">جارٍ تجهيز مراجعات الموظف...</p>}>
            <AttendanceResolutionCenter key={staffId} defaultBranch="الكل" initialTriage="all"
              initialStaffId={staffId} initialCurrentCycle embedded
              onDecisionSaved={() => setReloadVersion((v) => v + 1)} />
          </Suspense>
        ) : <div className="space-y-5">)}
          {!profile.processed_evidence.coverage_complete && profile.processed_evidence.accepted_punches > 0 && (
            <section role="status" className="rounded-2xl border border-[var(--dawaa-status-warning-border)] p-3 sm:p-4">
              <div className="flex items-center gap-2 text-sm font-black text-[var(--dawaa-theme-heading)]">
                <AlertCircle size={16} className="shrink-0 text-[var(--dawaa-status-warning-text)]" />
                ملخص الحضور غير مكتمل
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-2.5">
                  <div className="text-lg font-black text-[var(--dawaa-theme-heading)]">{profile.processed_evidence.accepted_punches.toLocaleString('ar-EG')}</div>
                  <div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">بصمة مقبولة خلال {profile.processed_evidence.accepted_days} يوم</div>
                </div>
                <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-2.5">
                  <div className="text-lg font-black text-[var(--dawaa-theme-heading)]">{profile.processed_evidence.missing_summary_days.toLocaleString('ar-EG')}</div>
                  <div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">أيام بصمات بلا ملخص حضور</div>
                </div>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-[var(--dawaa-theme-muted)]">
                {profile.rates.evaluated_days > 0 ? 'التقييم يغطي جزءًا من الفترة فقط؛ النسب ليست نهائية.' : 'لا يوجد ملخص حضور لهذه الفترة؛ النسب غير متاحة.'}
                {' '}البصمات للمتابعة فقط وليست اعتمادًا لساعات أو خصومات أو مرتبات.
              </p>
            </section>
          )}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-black text-[var(--dawaa-theme-heading)]"><TrendingUp size={16} /> معدلات الحضور</h3>
              <span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">آخر 30 يوم · من ملخص الحضور</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <RateBox label="تأخير" value={profile.processed_evidence.coverage_complete ? `${profile.rates.late_rate_pct}%` : '—'} sub={profile.processed_evidence.coverage_complete ? `${profile.rates.late_days + profile.rates.very_late_days} يوم` : 'تغطية الحضور غير مكتملة'} />
              <RateBox label="إذن/إجازة" value={profile.processed_evidence.coverage_complete ? `${profile.rates.permission_rate_pct}%` : '—'} sub={profile.processed_evidence.coverage_complete ? `${profile.rates.permission_days} يوم` : 'تغطية الحضور غير مكتملة'} />
              {canReviewAttendance ? (
                <button type="button" onClick={openCurrentCycleReview}
                  aria-label={`فتح مراجعات الموظف ${profile.staff.name} في الدورة الحالية داخل النافذة`}
                  className="block min-w-0 cursor-pointer rounded-xl text-right focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dawaa-theme-accent)]">
                  <RateBox label="مراجعات الدورة" value="عرض" sub="المراجعات والقرارات داخل الملف" />
                </button>
              ) : (
                <RateBox label="مراجعة معلقة" value={profile.rates.evaluated_days > 0 ? String(profile.rates.pending_review_days) : '—'} sub={profile.rates.evaluated_days > 0 ? 'من أيام الملخص فقط' : 'لا يوجد ملخص حضور'} />
              )}
            </div>
          </section>

          <section aria-label="الشيفت الأسبوعي" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-black text-[var(--dawaa-theme-heading)]"><Calendar size={16} /> الشيفت الأسبوعي</h3>
              <span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">المواعيد المسجلة · الاستثناءات موضحة</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {profile.weekly_schedule.filter((shift) => shift.day_name).map((shift, i) => {
                const today = !shift.shift_date && shift.day_name.trim() === currentCairoDay;
                return <div key={`${shift.day_name}-${shift.shift_date || i}`} className={cn(
                    'min-w-0 rounded-xl border px-2.5 py-2.5',
                    today ? 'border-[var(--dawaa-theme-accent)] bg-[var(--dawaa-theme-surface-2)]' : 'border-[var(--dawaa-theme-border)]',
                    shift.is_off && 'bg-[var(--dawaa-theme-surface-2)]'
                  )}>
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs font-black text-[var(--dawaa-theme-heading)]">
                    <span>{shift.day_name}</span>
                    {today && <span className="text-[10px] text-[var(--dawaa-theme-muted)]">اليوم</span>}
                  </div>
                  <div className="mt-1.5 text-[11px] font-bold leading-relaxed text-[var(--dawaa-theme-heading)]">
                    {shift.is_off ? 'إجازة' : `من ${formatTime(shift.shift_start)} إلى ${formatTime(shift.shift_end)}`}
                  </div>
                  {shift.shift_date && <div className="mt-1 text-[10px] text-[var(--dawaa-status-info-text)]">استثناء {shift.shift_date}</div>}
                </div>;
              })}
              {!profile.weekly_schedule.some((shift) => shift.day_name) &&
                <div className="col-span-full rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">لا يوجد جدول شيفت مسجل.</div>}
            </div>
          </section>

          <section aria-label="آخر أيام الحضور" className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-black text-[var(--dawaa-theme-heading)]"><Clock3 size={16} /> آخر أيام الحضور</h3>
              <span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الأوقات والساعات المسجلة في ملخص الحضور</span>
            </div>
            <div className="space-y-2">
              {profile.recent_days.slice(0,15).map((day) => {
                const needsReview = day.status === 'pending_review' ||
                  ['absence_review', 'missing_checkin', 'missing_checkout', 'early_leave_review'].includes(day.resolution_status);
                const late = ['late', 'very_late'].includes(day.resolution_status);
                return <div key={day.attendance_date} className="rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-[var(--dawaa-theme-heading)]">{day.attendance_date}</span>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black',
                      needsReview || late ? 'border-[var(--dawaa-status-warning-border)] text-[var(--dawaa-status-warning-text)]' :
                      'border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-heading)]'
                    )}>
                      {day.status === 'pending_review' ? 'تحتاج مراجعة' : STATUS_LABEL[day.resolution_status] || day.resolution_status || 'غير محدد'}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <div className="text-[10px] text-[var(--dawaa-theme-muted)]">الدخول ← الخروج</div>
                      <div className="mt-0.5 font-bold text-[var(--dawaa-theme-heading)]">{formatTime(day.first_in)} ← {formatTime(day.last_out)}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] text-[var(--dawaa-theme-muted)]">ساعات المرتب المحفوظة</div>
                      <div className="mt-0.5 font-black text-[var(--dawaa-theme-heading)]">
                        {day.payroll_eligible_hours != null ? `${day.payroll_eligible_hours} س` : 'غير معتمدة'}
                      </div>
                    </div>
                  </div>
                </div>;
              })}
              {!profile.recent_days.length && <div className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs font-bold leading-relaxed text-[var(--dawaa-theme-muted)]">
                لا يوجد ملخص حضور لهذه الفترة. راجع دليل البصمات أدناه؛ غياب الملخص لا يعني عدم الحضور.
              </div>}
            </div>
          </section>
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-black text-[var(--dawaa-theme-heading)]"><ShieldCheck size={16} /> دليل البصمات</h3>
              <span className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">سجل مستقل · غير معتمد ماليًا</span>
            </div>
            <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">
              <span>{profile.processed_evidence.accepted_punches} بصمة مقبولة</span>
              <span>{profile.processed_evidence.accepted_days} يوم</span>
              <span>{profile.processed_evidence.complete_pair_days} دخول وخروج</span>
              <span>{profile.processed_evidence.summary_covered_days} بملخص</span>
              <span>{profile.processed_evidence.missing_summary_days} بدون ملخص</span>
              {profile.processed_evidence.manual_review_punches > 0 && <span>{profile.processed_evidence.manual_review_punches} تحت المراجعة</span>}
            </div>
            <div className="space-y-2">
              {profile.processed_evidence.recent_days.map((d) => (
                <div key={d.shift_date} className="rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-2.5 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-[var(--dawaa-theme-heading)]">{d.shift_date}</span>
                    <span className="font-bold text-[var(--dawaa-theme-muted)]">{d.accepted_punches} مقبولة</span>
                  </div>
                  <div className="mt-1.5 font-bold text-[var(--dawaa-theme-heading)]">{formatTime(d.first_in)} ← {formatTime(d.last_out)}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-[var(--dawaa-theme-muted)]">
                    {d.punch_branches.join('، ') || 'فرع الجهاز غير محدد'}
                    {!d.has_summary && d.accepted_punches > 0 ? ' · بلا ملخص حضور لهذا اليوم' : ''}
                    {d.review_punches > 0 ? ` · ${d.review_punches} تحتاج مراجعة` : ''}
                    {d.accepted_punches > 0 && (!d.first_in || !d.last_out) ? ' · البصمات لا تكوّن زوج دخول/خروج كاملًا' : ''}
                  </div>
                </div>
              ))}
              {!profile.processed_evidence.recent_days.length && <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد بصمات مُعالجة في الفترة المحددة.</p>}
            </div>
          </section>
        </div>)}
        </div>
      </aside>
    </div>,
    document.body
  );
}

function RateBox({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="min-w-0 rounded-xl border border-[var(--dawaa-theme-border)] p-2.5 text-center">
    <div className="text-lg font-black text-[var(--dawaa-theme-heading)]">{value}</div>
    <div className="mt-0.5 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div>
    <div className="mt-0.5 text-[10px] leading-snug text-[var(--dawaa-theme-muted)]">{sub}</div>
  </div>;
}
