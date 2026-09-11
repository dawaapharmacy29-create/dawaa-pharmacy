import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Loader2, RefreshCw, Users } from 'lucide-react';
import { toast } from 'sonner';
import {
  getBranchAttendanceRoster,
  getStaffAttendanceDetail,
  RESOLUTION_STATUS_LABELS,
  resolutionStatusTone,
  type AttendanceDayRow,
  type BranchRosterRow,
  type StaffAttendanceDetail,
} from '@/lib/attendance/attendanceBreakdownService';
import { Skeleton } from '@/components/ui/skeleton';

type PeriodMode = 'day' | 'week' | 'month';

function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function startOfWeek(date: string): string {
  // Egyptian week starts Saturday
  const d = new Date(`${date}T00:00:00`);
  const dow = d.getDay(); // 0=Sunday..6=Saturday
  const diff = (dow + 1) % 7; // days since last Saturday
  return addDays(date, -diff);
}

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function endOfMonth(date: string): string {
  const [y, m] = date.slice(0, 7).split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

function computeRange(mode: PeriodMode, anchor: string): { start: string; end: string } {
  if (mode === 'day') return { start: anchor, end: anchor };
  if (mode === 'week') { const s = startOfWeek(anchor); return { start: s, end: addDays(s, 6) }; }
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
}

function shiftAnchor(mode: PeriodMode, anchor: string, dir: 1 | -1): string {
  if (mode === 'day') return addDays(anchor, dir);
  if (mode === 'week') return addDays(anchor, dir * 7);
  return addMonths(anchor, dir);
}

function rangeLabel(mode: PeriodMode, start: string, end: string): string {
  const fmt = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
  if (mode === 'day') return fmt(start);
  if (mode === 'month') return new Date(`${start}T00:00:00`).toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
  return `${fmt(start)} — ${fmt(end)}`;
}

function formatClock(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });
}

function toneClasses(tone: ReturnType<typeof resolutionStatusTone>): string {
  if (tone === 'success') return 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]';
  if (tone === 'warning') return 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]';
  if (tone === 'danger') return 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]';
  if (tone === 'info') return 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]';
  return 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-input)] text-[var(--dawaa-theme-muted)]';
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3">
      <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{label}</p>
      <p className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">{value}</p>
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
  const [branch, setBranch] = useState(defaultBranch);
  const [mode, setMode] = useState<PeriodMode>('month');
  const [anchor, setAnchor] = useState(cairoToday());
  const [roster, setRoster] = useState<BranchRosterRow[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StaffAttendanceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => { setBranch(defaultBranch); }, [defaultBranch]);

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

  const summary = detail?.summary;
  const money = (v: number | null | undefined) => (v == null ? 'غير محدد' : `${v.toLocaleString('ar-EG')} ج.م`);

  return (
    <div className="grid gap-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {canAllBranches && branches.map((b) => (
            <button key={b} onClick={() => setBranch(b)} className={branch === b ? 'btn-primary' : 'btn-secondary'}>{b}</button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-[var(--dawaa-theme-border)] p-1">
            {(['day', 'week', 'month'] as PeriodMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 text-xs font-black ${mode === m ? 'bg-[var(--dawaa-theme-accent)] text-white' : 'text-[var(--dawaa-theme-muted)]'}`}>
                {m === 'day' ? 'يومي' : m === 'week' ? 'أسبوعي' : 'شهري'}
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
                  <p className="truncate text-sm font-black text-[var(--dawaa-theme-heading)]">{r.staff_name}</p>
                  <p className="truncate text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{r.role || '—'}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.total_late_minutes > 0 && <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-warning-text)]">تأخير {r.total_late_minutes} د</span>}
                    {r.absence_review_days > 0 && <span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-status-danger-text)]">غياب {r.absence_review_days}</span>}
                    {r.needs_review_days > 0 && <span className="rounded-full border border-[var(--dawaa-theme-border)] px-1.5 py-0.5 text-[10px] font-black text-[var(--dawaa-theme-muted)]">مراجعة {r.needs_review_days}</span>}
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
                    <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{detail.staff.role} · {detail.staff.branch}</p>
                  </div>
                </div>

                {summary && !summary.compensation_profile_complete && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-2 text-xs font-black text-[var(--dawaa-status-warning-text)]">
                    <AlertTriangle size={14} /> بيانات المرتب (سعر الساعة) غير مسجلة لهذا الموظف — الخصومات المالية لن تظهر حتى تُستكمل
                  </div>
                )}

                {summary && (
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <StatCard label="أيام العمل" value={String(summary.period_days - summary.off_days - summary.approved_leave_days)} />
                    <StatCard label="أيام التأخير" value={String(summary.late_days)} sub={`${summary.total_late_minutes} دقيقة`} />
                    <StatCard label="غياب/مراجعة" value={String(summary.absence_review_days + summary.needs_review_days)} />
                    <StatCard label="ساعات العمل" value={summary.total_worked_hours.toFixed(1)} />
                    <StatCard label="أوفر تايم" value={summary.total_overtime_hours.toFixed(1)} sub={summary.overtime_amount != null ? money(summary.overtime_amount) : undefined} />
                    <StatCard label="إجازات معتمدة" value={String(summary.approved_leave_days)} />
                  </div>
                )}

                {summary?.compensation_profile_complete && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <StatCard label="خصم التأخير" value={money(summary.late_deduction_amount)} />
                    <StatCard label="خصم المغادرة المبكرة" value={money(summary.early_leave_deduction_amount)} />
                    <StatCard label="خصم الغياب" value={money(summary.absence_deduction_amount)} />
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
                        <td className="p-3">{formatClock(d.first_in)}</td>
                        <td className="p-3">{formatClock(d.last_out)}</td>
                        <td className="p-3">{Number(d.late_minutes) > 0 ? `${d.late_minutes} د` : '—'}</td>
                        <td className="p-3">{Number(d.early_leave_minutes) > 0 ? `${d.early_leave_minutes} د` : '—'}</td>
                        <td className="p-3">{d.candidate_hours != null ? Number(d.candidate_hours).toFixed(1) : '—'}</td>
                        <td className="p-3">{d.overtime_hours > 0 ? d.overtime_hours.toFixed(1) : '—'}</td>
                      </tr>
                    ))}
                    {!detail.days.length && (
                      <tr><td colSpan={9} className="p-6 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">لا توجد بيانات لهذه الفترة</td></tr>
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
