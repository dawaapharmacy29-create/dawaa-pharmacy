import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Loader2, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatTenure,
  getAttendanceBranches,
  getBranchAttendanceRoster,
  getStaffAttendanceDetail,
  RESOLUTION_STATUS_LABELS,
  resolutionStatusTone,
  type AttendanceDayRow,
  type BranchRosterRow,
  type StaffAttendanceDetail,
} from '@/lib/attendance/attendanceBreakdownService';
import { getAnnualLeaveBalanceV1, getPermissionPolicyStatusV2, type AnnualLeaveBalanceV1, type PermissionPolicyStatusV2 } from '@/lib/timeOffService';
import { cairoToday, computeRange, formatClock, type PeriodMode, rangeLabel, shiftAnchor, toneClasses } from '@/lib/attendance/period';
import { Skeleton } from '@/components/ui/skeleton';

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3">
      <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{label}</p>
      <p className={`mt-1 text-xl font-black ${tone || 'text-[var(--dawaa-theme-heading)]'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{sub}</p>}
    </div>
  );
}

interface Props {
  branches: string[];
  defaultBranch: string;
  canAllBranches: boolean;
}

export default function EmployeeAttendanceBreakdown({ branches, defaultBranch, canAllBranches }: Props) {
  const [branchList, setBranchList] = useState<string[]>(branches);
  const [branch, setBranch] = useState(defaultBranch);
  const [mode, setMode] = useState<PeriodMode>('month');
  const [anchor, setAnchor] = useState(cairoToday());
  const [roster, setRoster] = useState<BranchRosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StaffAttendanceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [leaveBalance, setLeaveBalance] = useState<AnnualLeaveBalanceV1 | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<PermissionPolicyStatusV2 | null>(null);

  useEffect(() => { setBranch(defaultBranch); }, [defaultBranch]);

  useEffect(() => {
    getAttendanceBranches()
      .then((fresh) => {
        if (fresh.length) {
          setBranchList(fresh);
          setBranch((current) => (fresh.includes(current) ? current : fresh[0]));
        }
      })
      .catch(() => { /* keep the prop-provided list if the canonical lookup fails */ });
  }, []);

  const { start, end } = useMemo(() => computeRange(mode, anchor), [mode, anchor]);

  const loadRoster = useCallback(async () => {
    setLoadingRoster(true);
    try {
      const data = await getBranchAttendanceRoster(branch, start, end);
      setRoster(data);
      setSelectedStaffId((current) => {
        if (current && data.some((r) => r.staff_id === current)) return current;
        return data[0]?.staff_id ?? null;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل قائمة الموظفين');
    } finally {
      setLoadingRoster(false);
    }
  }, [branch, start, end]);

  useEffect(() => { void loadRoster(); }, [loadRoster]);

  const loadDetail = useCallback(async () => {
    if (!selectedStaffId) { setDetail(null); return; }
    setLoadingDetail(true);
    try {
      const data = await getStaffAttendanceDetail(selectedStaffId, start, end);
      setDetail(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر تحميل تفاصيل الموظف');
    } finally {
      setLoadingDetail(false);
    }
  }, [selectedStaffId, start, end]);

  useEffect(() => { void loadDetail(); }, [loadDetail]);

  useEffect(() => {
    if (!selectedStaffId) { setLeaveBalance(null); setPermissionStatus(null); return; }
    let cancelled = false;
    const year = Number(end.slice(0, 4));
    Promise.all([
      getAnnualLeaveBalanceV1(selectedStaffId, year).catch(() => null),
      getPermissionPolicyStatusV2(selectedStaffId, start, end).catch(() => null),
    ]).then(([leave, permission]) => {
      if (cancelled) return;
      setLeaveBalance(leave);
      setPermissionStatus(permission);
    });
    return () => { cancelled = true; };
  }, [selectedStaffId, start, end]);

  const summary = detail?.summary;

  return (
    <div className="grid gap-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {canAllBranches && branchList.map((b) => (
            <button key={b} onClick={() => setBranch(b)} className={branch === b ? 'btn-primary' : 'btn-secondary'}>{b}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-[var(--dawaa-theme-border)] p-1">
            {(['day', 'week', 'month'] as PeriodMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 text-xs font-black ${mode === m ? 'bg-[var(--dawaa-theme-accent)] text-white' : 'text-[var(--dawaa-theme-muted)]'}`}>
                {m === 'day' ? 'يومي' : m === 'week' ? 'أسبوعي' : 'الدورة الشهرية (26 → 25)'}
              </button>
            ))}
          </div>
          <button onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))} className="btn-secondary !px-2"><ChevronRight size={16} /></button>
          <span className="flex items-center gap-1.5 rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-1.5 text-sm font-black text-[var(--dawaa-theme-heading)]">
            <CalendarDays size={14} /> {rangeLabel(mode, start, end)}
          </span>
          <button onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))} className="btn-secondary !px-2"><ChevronLeft size={16} /></button>
          <button onClick={() => { void loadRoster(); void loadDetail(); }} className="btn-secondary"><RefreshCw size={16} className={loadingRoster || loadingDetail ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        {/* Employee roster */}
        <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-2 shadow-sm">
          <div className="flex items-center gap-2 px-2 py-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><Users size={14} /> الموظفون ({roster.length})</div>
          {loadingRoster && <div className="space-y-2 p-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>}
          {!loadingRoster && (
            <div className="max-h-[560px] space-y-1 overflow-y-auto p-1">
              {roster.map((r) => (
                <button
                  key={r.staff_id}
                  onClick={() => setSelectedStaffId(r.staff_id)}
                  className={`w-full rounded-xl border p-2 text-right transition ${selectedStaffId === r.staff_id ? 'border-[var(--dawaa-theme-accent)] bg-[var(--dawaa-theme-accent)]/10' : 'border-transparent hover:border-[var(--dawaa-theme-border)]'}`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <p className="truncate text-sm font-black text-[var(--dawaa-theme-heading)]">{r.staff_name}</p>
                  </div>
                  <p className="truncate text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{r.role || '—'}{formatTenure(r.tenure_days) ? ` · ${formatTenure(r.tenure_days)}` : ''}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.total_late_minutes > 0 && <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">إجمالي تأخير {r.total_late_minutes} د{r.late_days > 0 ? ` (${r.late_days} يوم، بمعدل ${Math.round(r.total_late_minutes / r.late_days)} د/يوم)` : ''}</span>}
                    {r.actual_worked_days > 0 && <span className="rounded-full border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-success-text)]">حضور فعلي {r.actual_worked_days}</span>}
                    {r.absence_review_days > 0 && <span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-danger-text)]">غياب للمراجعة {r.absence_review_days}</span>}
                    {r.needs_review_days > 0 && <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">قرار مدير {r.needs_review_days}</span>}
                    {r.system_review_days > 0 && <span className="rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-info-text)]">مشكلة نظام {r.system_review_days}</span>}
                  </div>
                </button>
              ))}
              {!roster.length && <p className="p-4 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">لا يوجد موظفون نشطون في هذا الفرع</p>}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="grid gap-4">
          {loadingDetail && <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-6"><Loader2 className="mx-auto animate-spin text-[var(--dawaa-theme-muted)]" /></div>}

          {!loadingDetail && detail && (
            <>
              <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-black text-[var(--dawaa-theme-heading)]">{detail.staff.name}</p>
                    <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">
                      {detail.staff.role} · {detail.staff.branch}
                      {(() => { const t = formatTenure(roster.find((r) => r.staff_id === selectedStaffId)?.tenure_days ?? null); return t ? ` · بالشركة منذ ${t}` : ''; })()}
                    </p>
                  </div>
                </div>

                {summary && (
                  <>
                    {summary.resolution_drift_days > 0 && (
                      <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-2 text-xs font-bold text-[var(--dawaa-status-warning-text)]">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>
                          يوجد {summary.resolution_drift_days} يوم معتمد قديم تغيّر تفسيره بعد تصحيح الجداول
                          {summary.financial_drift_days > 0 ? `، منهم ${summary.financial_drift_days} يوم فيه فرق ساعات مالي ويحتاج إعادة اعتماد.` : '، بدون فرق ساعات مالي حاليًا.'}
                        </span>
                      </div>
                    )}
                    {summary.cycle_open && (
                      <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-2 text-xs font-black text-[var(--dawaa-status-info-text)]">
                        <CalendarDays size={14} />
                        الدورة مفتوحة — الحساب حتى {summary.effective_end || 'اليوم'} فقط، وتم استبعاد {summary.future_days_excluded} أيام مستقبلية.
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                      <StatCard label="أيام حضور فعلية" value={String(summary.actual_worked_days)} sub={`من ${summary.scheduled_workdays} يوم مطلوب حتى اليوم`} />
                      <StatCard label="أيام التأخير المعتمدة" value={String(summary.late_days)} sub={`${summary.total_late_minutes} دقيقة فعلية — بدون حساب جزاء هنا`} />
                      <StatCard label="أيام معلّقة للمراجعة" value={String(summary.pending_review_days)} sub={`غياب ${summary.absence_review_days} · بصمة ناقصة ${summary.missing_punch_days}`} />
                      <StatCard label="ساعات فعلية معتمدة" value={summary.total_worked_hours.toFixed(1)} sub="هي فقط التي تدخل حقيقة الحضور" />
                      <StatCard label="أوفر تايم معتمد" value={summary.total_overtime_hours_approved.toFixed(1)} />
                      <StatCard label="أوفر تايم بانتظار الموافقة" value={summary.total_overtime_hours_pending.toFixed(1)} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <StatCard label="إجازات أسبوعية" value={String(summary.off_days)} />
                      <StatCard label="إجازات معتمدة" value={String(summary.approved_leave_days)} />
                      <StatCard label="ساعات معلقة" value={summary.pending_worked_hours.toFixed(1)} sub="لا تدخل المرتب قبل الحسم" />
                      <StatCard label="الفترة المحسوبة" value={String(summary.period_days)} sub={summary.effective_end ? `حتى ${summary.effective_end}` : undefined} />
                    </div>
                    <div className="mt-2 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-2 text-xs font-bold text-[var(--dawaa-status-info-text)]">
                      هذا تقرير حقيقة الحضور فقط. أي خصم مالي أو جزاء يُحسب ويُعتمد من محرك المرتبات، وليس من هذه الشاشة.
                    </div>
                  </>
                )}

                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatCard
                    label="رصيد الإجازة السنوية"
                    value={leaveBalance?.configured ? String(leaveBalance.balance ?? 0) : 'غير مفعّلة'}
                    sub={leaveBalance?.configured ? `مستخدم ${leaveBalance.used} · محجوز ${leaveBalance.reserved}` : undefined}
                  />
                  <StatCard
                    label="الأذونات هذه الفترة"
                    value={permissionStatus ? `${permissionStatus.approved_permissions}/${permissionStatus.allowance}` : '—'}
                    sub={permissionStatus ? `متبقٍ ${permissionStatus.remaining}` : undefined}
                    tone={permissionStatus?.requires_manager_review ? 'text-[var(--dawaa-status-danger-text)]' : undefined}
                  />
                  <StatCard label="مرات تجاوز مدة الإذن" value={permissionStatus ? String(permissionStatus.over_duration_count) : '—'} />
                  <StatCard label="إجازات معتمدة هذه الفترة" value={String(summary?.approved_leave_days ?? 0)} />
                </div>

                {permissionStatus?.requires_manager_review && (
                  <div className="mt-2 flex items-center gap-2 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-2 text-xs font-black text-[var(--dawaa-status-danger-text)]">
                    <AlertTriangle size={14} /> هذا الموظف تجاوز حد الأذونات المسموح به هذه الفترة — يحتاج مراجعة مديره
                  </div>
                )}
              </div>

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
                      <th className="p-3">مغادرة مبكرة</th>
                      <th className="p-3">ساعات العمل</th>
                      <th className="p-3">أوفر تايم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.days.map((d: AttendanceDayRow) => (
                      <tr key={d.attendance_date} className="border-b border-[var(--dawaa-theme-border)] last:border-0">
                        <td className="p-3 font-bold text-[var(--dawaa-theme-heading)]">{d.attendance_date}</td>
                        <td className="p-3 text-[var(--dawaa-theme-muted)]">{d.day_name}</td>
                        <td className="p-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${toneClasses(resolutionStatusTone(d.resolution_status))}`}>
                            {RESOLUTION_STATUS_LABELS[d.resolution_status] || d.resolution_status}
                          </span>
                          {d.time_off_kind && <span className="mr-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">({d.time_off_kind})</span>}
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
                        <td className="p-3">
                          {Number(d.late_minutes) > 0 ? <span className="font-bold">{d.late_minutes} د</span> : '—'}
                        </td>
                        <td className="p-3">{Number(d.early_leave_minutes) > 0 ? `${d.early_leave_minutes} د` : '—'}</td>
                        <td className="p-3">
                          {d.candidate_hours != null ? Number(d.candidate_hours).toFixed(1) : '—'}
                          {d.approval_state === 'pending_review' && d.candidate_hours != null && <span className="mr-1 text-[9px] font-black text-[var(--dawaa-status-warning-text)]">(معلقة)</span>}
                        </td>
                        <td className="p-3">
                          {d.overtime_hours > 0 ? (
                            <span className="flex items-center gap-1">
                              {d.overtime_hours.toFixed(1)}
                              {d.overtime_approval_status === 'approved' && <span className="rounded-full border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-success-text)]">معتمد</span>}
                              {d.overtime_approval_status === 'pending' && <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">بانتظار الموافقة</span>}
                              {d.overtime_approval_status === 'rejected' && <span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-danger-text)]">مرفوض</span>}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                    {!detail.days.length && (
                      <tr><td colSpan={10} className="p-6 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد بيانات لهذه الفترة</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!loadingDetail && !detail && (
            <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-10 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">
              اختر موظفًا من القائمة لعرض تفاصيل حضوره
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
