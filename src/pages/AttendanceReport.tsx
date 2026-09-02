import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Download, Filter, Fingerprint, LocateFixed, LogIn, LogOut, Printer, RefreshCw, ShieldAlert, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { exportAttendanceToExcel } from '@/lib/exportExcel';
import { Skeleton } from '@/components/ui/skeleton';
import { createNotification } from '@/lib/notificationService';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches } from '@/lib/security/permissionScopes';
import { fetchAttendanceReportRows, type AttendanceReportRow } from '@/lib/attendance/attendanceReportRows';
import {
  fetchAttendanceLocations,
  getDevicePosition,
  getRecentAttendanceLogs,
  saveAttendanceAttempt,
  validateAttendancePosition,
  verifyWithAvailableBiometric,
  type AttendanceLocation,
  type AttendanceType,
  type DevicePosition,
} from '@/lib/attendanceGeoService';

type Tab = 'clock' | 'today' | 'sync' | 'report' | 'logs';
type AttendanceRow = AttendanceReportRow;

type DailyCommandRow = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  work_date: string;
  schedule_status: 'scheduled' | 'off' | 'missing' | 'missing_time' | 'conflict' | string;
  shift_start: string | null;
  shift_end: string | null;
  first_check_in: string | null;
  last_check_out: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  attendance_status: string;
  approved_exception_type: string | null;
  approved_exception_reason: string | null;
  biometric_events: number;
  source_status: string;
};

type SyncHealth = {
  raw_events?: number;
  mapped_events?: number;
  unmapped_events?: number;
  last_ingested_at?: string | null;
  last_punch_time?: string | null;
  events_last_24h?: number;
  unmapped_last_24h?: number;
  provider_count?: number;
};

interface StaffSummary {
  staff_name: string;
  branch: string;
  present: number;
  absent: number;
  late: number;
  total_days: number;
  attendance_rate: number;
  avg_checkin: string | null;
}

const MANAGER_TODAY_ROLES = new Set(['general_manager', 'executive_manager', 'branches_manager', 'branch_manager', 'shift_supervisor_morning', 'shift_supervisor_evening']);
const SYNC_HEALTH_ROLES = new Set(['general_manager', 'executive_manager', 'branches_manager']);

function cairoDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

function round(value?: number | null) {
  return value == null ? 'غير محدد' : `${Math.round(Number(value))} متر`;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'غير مسجل';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Cairo' });
}

function formatTime(value?: string | null) {
  if (!value) return '-';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 5);
  return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });
}

function isLate(checkIn: string | null | undefined, shiftStart: string | null | undefined): boolean {
  if (!checkIn || !shiftStart) return false;
  try {
    const [ch, cm] = checkIn.slice(0, 5).split(':').map(Number);
    const [sh, sm] = shiftStart.slice(0, 5).split(':').map(Number);
    return ch * 60 + cm > sh * 60 + sm + 15;
  } catch {
    return false;
  }
}

function getMonthDays(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function monthLabel(value: string): string {
  const [y, m] = value.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long' });
}

function getDeviceId() {
  try {
    const key = 'dawaa_attendance_device_id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = `device-${crypto.randomUUID()}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

function TableSkeleton() {
  return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-6 shadow-sm"><Skeleton className="h-5 w-48" /><div className="mt-4 space-y-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div></div>;
}

function attendanceLabel(status: string) {
  const map: Record<string, string> = {
    on_time: 'في الموعد',
    late: 'متأخر',
    very_late: 'متأخر جدًا',
    absent: 'غياب',
    not_arrived: 'لم يحضر بعد',
    scheduled: 'لم يبدأ موعده',
    working_now: 'موجود الآن',
    missing_checkout: 'بصمة خروج ناقصة',
    off: 'إجازة',
    worked_on_off: 'حضور في إجازة',
    approved_exception: 'استثناء معتمد',
    schedule_conflict: 'تعارض في الجدول',
    schedule_missing: 'الجدول غير مكتمل',
    punch_without_valid_schedule: 'بصمة بدون جدول صالح',
  };
  return map[status] || status;
}

function statusClass(status: string) {
  if (['on_time', 'working_now'].includes(status)) return 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]';
  if (['late', 'approved_exception', 'worked_on_off', 'scheduled'].includes(status)) return 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]';
  if (['very_late', 'absent', 'not_arrived', 'missing_checkout'].includes(status)) return 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]';
  return 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]';
}

export default function AttendanceReport() {
  const { user } = useAuth();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const canAllBranches = canSeeAllBranches(user?.role);
  const normalizedUserBranch = normalizeBranchName(user?.branch || '');
  const isOperationalManager = MANAGER_TODAY_ROLES.has(user?.role || '');
  const canViewSyncHealth = SYNC_HEALTH_ROLES.has(user?.role || '');
  const [tab, setTab] = useState<Tab>(() => (isOperationalManager ? 'today' : 'clock'));
  const [month, setMonth] = useState(defaultMonth);
  const [dailyDate, setDailyDate] = useState(cairoDate());
  const [branchFilter, setBranchFilter] = useState(() => (canAllBranches ? 'الكل' : normalizedUserBranch || 'الكل'));
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [dailyRows, setDailyRows] = useState<DailyCommandRow[]>([]);
  const [syncHealth, setSyncHealth] = useState<SyncHealth | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [locations, setLocations] = useState<AttendanceLocation[]>([]);
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const [loadingSync, setLoadingSync] = useState(false);
  const [clocking, setClocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = user?.staffId || user?.id || null;
  const userName = user?.name || 'غير محدد';
  const userBranch = user?.branch || null;

  useEffect(() => {
    if (!canAllBranches) setBranchFilter(normalizedUserBranch || 'الكل');
  }, [canAllBranches, normalizedUserBranch]);

  const [year, monthNum] = month.split('-').map(Number);
  const startDate = `${month}-01`;
  const endDate = `${month}-${String(getMonthDays(year, monthNum)).padStart(2, '0')}`;

  const nearest = useMemo(() => (position && locations.length ? validateAttendancePosition(position, locations) : null), [position, locations]);
  const lastCheckIn = logs.find((log) => log.attendance_type === 'check_in' && ['accepted', 'manual_review'].includes(log.status));
  const lastCheckOut = logs.find((log) => log.attendance_type === 'check_out' && ['accepted', 'manual_review'].includes(log.status));

  const loadClock = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const [locs, pos, lastLogs] = await Promise.all([
        fetchAttendanceLocations(),
        getDevicePosition().catch(() => null),
        getRecentAttendanceLogs(userId, 30),
      ]);
      setLocations(locs);
      setPosition(pos);
      setLogs(lastLogs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات البصمة');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const effectiveBranch = !canAllBranches && normalizedUserBranch ? normalizedUserBranch : branchFilter;

  const loadDaily = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoadingDaily(true);
    setError(null);
    try {
      const { data, error: dailyError } = await supabase.rpc('attendance_daily_command_v1', {
        p_date: dailyDate,
        p_branch: effectiveBranch === 'الكل' ? null : effectiveBranch,
      });
      if (dailyError) throw dailyError;
      setDailyRows((data || []) as DailyCommandRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل مركز الحضور اليومي');
    } finally {
      setLoadingDaily(false);
    }
  }, [dailyDate, effectiveBranch]);

  const loadSyncHealth = useCallback(async () => {
    if (!isSupabaseConfigured || !canViewSyncHealth) return;
    setLoadingSync(true);
    try {
      const { data, error: syncError } = await supabase.rpc('attendance_sync_health_v1');
      if (syncError) throw syncError;
      setSyncHealth((data || {}) as SyncHealth);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل حالة مزامنة البصمة');
    } finally {
      setLoadingSync(false);
    }
  }, [canViewSyncHealth]);

  const loadReport = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAttendanceReportRows({ startDate, endDate, branchFilter: effectiveBranch });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات الحضور الشهرية');
    } finally {
      setLoading(false);
    }
  }, [effectiveBranch, endDate, startDate]);

  useEffect(() => { void loadClock(); }, [loadClock]);
  useEffect(() => { if (tab === 'today') void loadDaily(); }, [tab, loadDaily]);
  useEffect(() => { if (tab === 'sync') void loadSyncHealth(); }, [tab, loadSyncHealth]);
  useEffect(() => { if (tab === 'report') void loadReport(); }, [tab, loadReport]);

  const branches = useMemo(() => {
    if (!canAllBranches && normalizedUserBranch) return [normalizedUserBranch];
    const set = new Set<string>(['الكل']);
    rows.forEach((r) => { if (r.branch) set.add(normalizeBranchName(r.branch) || r.branch); });
    dailyRows.forEach((r) => { if (r.branch) set.add(normalizeBranchName(r.branch) || r.branch); });
    ['فرع شكري', 'فرع الشامي', 'المخزن'].forEach((b) => set.add(b));
    return Array.from(set);
  }, [canAllBranches, normalizedUserBranch, rows, dailyRows]);

  const dailyTotals = useMemo(() => {
    const statuses = dailyRows.map((r) => r.attendance_status);
    return {
      staff: dailyRows.length,
      onTime: statuses.filter((s) => ['on_time', 'working_now'].includes(s)).length,
      late: statuses.filter((s) => ['late', 'very_late'].includes(s)).length,
      missing: statuses.filter((s) => ['absent', 'not_arrived', 'missing_checkout'].includes(s)).length,
      issues: statuses.filter((s) => ['schedule_conflict', 'schedule_missing', 'punch_without_valid_schedule'].includes(s)).length,
    };
  }, [dailyRows]);

  const summaries = useMemo((): StaffSummary[] => {
    const map = new Map<string, { rows: AttendanceRow[]; branch: string }>();
    rows.filter((r) => effectiveBranch === 'الكل' || normalizeBranchName(r.branch || '') === normalizeBranchName(effectiveBranch)).forEach((r) => {
      const name = r.staff_name || r.staff_id || 'غير محدد';
      const key = `${name}__${r.branch || ''}`;
      if (!map.has(key)) map.set(key, { rows: [], branch: r.branch || '-' });
      map.get(key)!.rows.push(r);
    });
    return Array.from(map.entries()).map(([, { rows: staffRows, branch }]) => {
      const name = staffRows[0]?.staff_name || staffRows[0]?.staff_id || 'غير محدد';
      const present = staffRows.filter((r) => r.check_in).length;
      const late = staffRows.filter((r) => isLate(r.check_in, r.shift_start)).length;
      const absent = staffRows.filter((r) => String(r.status || '').toLowerCase() === 'absent').length;
      const totalDays = Math.max(staffRows.length, present + absent);
      const checkins = staffRows.filter((r) => r.check_in).map((r) => r.check_in!);
      const avgCheckin = checkins.length ? (() => {
        const totalMins = checkins.reduce((sum, ci) => {
          const [h, m] = ci.slice(0, 5).split(':').map(Number);
          return sum + h * 60 + m;
        }, 0) / checkins.length;
        return `${String(Math.floor(totalMins / 60)).padStart(2, '0')}:${String(Math.round(totalMins % 60)).padStart(2, '0')}`;
      })() : null;
      return { staff_name: name, branch, present, absent, late, total_days: totalDays, attendance_rate: totalDays > 0 ? Math.round((present / totalDays) * 100) : 0, avg_checkin: avgCheckin };
    }).sort((a, b) => b.attendance_rate - a.attendance_rate || a.staff_name.localeCompare(b.staff_name, 'ar'));
  }, [rows, effectiveBranch]);

  const totals = useMemo(() => ({ staff: summaries.length, present: summaries.reduce((s, r) => s + r.present, 0), absent: summaries.reduce((s, r) => s + r.absent, 0), late: summaries.reduce((s, r) => s + r.late, 0) }), [summaries]);

  async function notifyManager(type: AttendanceType, finalValidation: { status: string; rejectionReason?: string | null; nearestLocation?: AttendanceLocation | null; distanceMeters?: number | null }, biometric: { verified: boolean; method: string }, pos: DevicePosition) {
    const eventName = type === 'check_in' ? 'حضور' : 'انصراف';
    const nowText = new Date().toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
    const statusText = finalValidation.status === 'accepted' ? 'مقبول' : finalValidation.status === 'manual_review' ? 'مراجعة يدوية' : 'مرفوض';
    const locationName = finalValidation.nearestLocation?.name || userBranch || 'غير محدد';
    const message = `${userName} سجل ${eventName} الساعة ${nowText} - ${locationName} - الحالة: ${statusText} - المسافة: ${round(finalValidation.distanceMeters)} - GPS: ${round(pos.accuracy)} - التحقق: ${biometric.verified ? 'تم' : 'لم يتم'}`;
    await createNotification({
      title: `تنبيه ${eventName}: ${userName}`,
      message,
      type: 'attendance',
      priority: finalValidation.status === 'rejected' ? 'urgent' : 'high',
      branch: userBranch || finalValidation.nearestLocation?.branch_name || null,
      target_type: 'attendance',
      target_id: userId,
      target_route: '/attendance-report?tab=logs',
      recipient_role: 'general_manager',
      created_by: user?.id || null,
      created_by_name: userName,
      metadata: { attendance_type: type, status: finalValidation.status, rejection_reason: finalValidation.rejectionReason || null },
    }).catch((notificationError) => console.warn('[attendance] manager notification skipped', notificationError));
  }

  async function handleClock(type: AttendanceType) {
    setClocking(true);
    setError(null);
    try {
      const [locs, pos] = await Promise.all([fetchAttendanceLocations(), getDevicePosition()]);
      const validation = validateAttendancePosition(pos, locs);
      const biometric = validation.status === 'accepted' ? await verifyWithAvailableBiometric() : { verified: false, method: 'not_checked', message: validation.rejectionReason || '' };
      const finalValidation = validation.status === 'accepted' && !biometric.verified ? { ...validation, status: 'manual_review' as const, rejectionReason: biometric.message } : validation;
      await saveAttendanceAttempt({ user: { id: userId, name: userName, role: user?.role, branch: userBranch }, attendanceType: type, position: pos, validation: finalValidation, biometric: { verified: biometric.verified, method: biometric.method }, deviceId: getDeviceId() });
      await notifyManager(type, finalValidation, biometric, pos);
      toast[finalValidation.status === 'accepted' ? 'success' : finalValidation.status === 'manual_review' ? 'warning' : 'error'](finalValidation.status === 'accepted' ? (type === 'check_in' ? 'تم تسجيل الحضور وإرسال إشعار فوري للإدارة' : 'تم تسجيل الانصراف وإرسال إشعار فوري للإدارة') : finalValidation.rejectionReason || 'تم تسجيل المحاولة للمراجعة وإرسال إشعار للإدارة');
      await loadClock();
      if (tab === 'report') await loadReport();
      if (tab === 'today') await loadDaily();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر تسجيل الحضور';
      setError(message);
      toast.error(message);
    } finally {
      setClocking(false);
    }
  }

  return (
    <div className="dawaa-text dawaa-print-surface space-y-6 print:space-y-4" dir="rtl">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm print:hidden">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black text-[var(--dawaa-theme-heading)]">مركز الحضور والانصراف</h1>
            <p className="mt-1 text-sm font-bold text-[var(--dawaa-theme-muted)]">الجدول المعتمد + بصمة الجهاز + الاستثناءات في مسار واحد، مع إيقاف الحكم تلقائيًا عند تعارض الجدول.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isOperationalManager && <button onClick={() => setTab('today')} className={tab === 'today' ? 'btn-primary' : 'btn-secondary'}><Users size={16} /> اليوم</button>}
            {canViewSyncHealth && <button onClick={() => setTab('sync')} className={tab === 'sync' ? 'btn-primary' : 'btn-secondary'}><ShieldAlert size={16} /> البصمات</button>}
            <button onClick={() => setTab('report')} className={tab === 'report' ? 'btn-primary' : 'btn-secondary'}><Filter size={16} /> التقرير الشهري</button>
            <button onClick={() => setTab('clock')} className={tab === 'clock' ? 'btn-primary' : 'btn-secondary'}><Fingerprint size={16} /> تسجيل حضور</button>
            <button onClick={() => setTab('logs')} className={tab === 'logs' ? 'btn-primary' : 'btn-secondary'}><Clock size={16} /> محاولاتي</button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-4 text-sm font-bold text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}

      {tab === 'today' && (
        <>
          <div className="flex flex-col gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm sm:flex-row sm:items-end">
            <label className="flex-1 space-y-1 text-xs font-black text-[var(--dawaa-theme-muted)]"><span>اليوم</span><input type="date" value={dailyDate} onChange={(e) => setDailyDate(e.target.value)} className="input-dark w-full" /></label>
            <label className="flex-1 space-y-1 text-xs font-black text-[var(--dawaa-theme-muted)]"><span>الفرع</span><select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="input-dark w-full">{branches.map((b) => <option key={b}>{b}</option>)}</select></label>
            <button onClick={() => void loadDaily()} className="btn-primary"><RefreshCw size={16} className={loadingDaily ? 'animate-spin' : ''} /> تحديث</button>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            <Metric label="موظفين في المتابعة" value={dailyTotals.staff} icon={Users} color="text-[var(--dawaa-status-info-text)] bg-[var(--dawaa-status-info-bg)] border-[var(--dawaa-status-info-border)]" />
            <Metric label="في الموعد/موجود" value={dailyTotals.onTime} icon={CheckCircle2} color="text-[var(--dawaa-status-success-text)] bg-[var(--dawaa-status-success-bg)] border-[var(--dawaa-status-success-border)]" />
            <Metric label="متأخر" value={dailyTotals.late} icon={Clock} color="text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]" />
            <Metric label="غياب/بصمة ناقصة" value={dailyTotals.missing} icon={XCircle} color="text-[var(--dawaa-status-danger-text)] bg-[var(--dawaa-status-danger-bg)] border-[var(--dawaa-status-danger-border)]" />
            <Metric label="مشاكل جدول" value={dailyTotals.issues} icon={AlertTriangle} color="text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]" />
          </div>
          {loadingDaily ? <TableSkeleton /> : dailyRows.length ? <DailyCommandTable rows={dailyRows} /> : <Empty text="لا توجد بيانات جدول أو بصمة لهذا اليوم في النطاق الحالي." />}
        </>
      )}

      {tab === 'sync' && (
        <>
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
            <div><h2 className="font-black text-[var(--dawaa-theme-heading)]">صحة مزامنة جهاز البصمة</h2><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">Raw events للرقابة فقط؛ الواجهة لا تملك تعديل سجل البصمات الخام.</p></div>
            <button onClick={() => void loadSyncHealth()} className="btn-primary"><RefreshCw size={16} className={loadingSync ? 'animate-spin' : ''} /> تحديث</button>
          </div>
          {loadingSync ? <TableSkeleton /> : syncHealth ? <SyncHealthPanel health={syncHealth} /> : <Empty text="لا توجد بيانات مزامنة متاحة." />}
        </>
      )}

      {tab === 'clock' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="بيانات الموظف" icon={Fingerprint}><Info label="الاسم" value={userName} /><Info label="الدور" value={user?.role || 'غير محدد'} /><Info label="الفرع" value={userBranch || 'غير محدد'} /></Panel>
          <Panel title="حالة الموقع" icon={LocateFixed}>{loading ? <Skeleton className="h-24 w-full" /> : nearest ? <><Info label="أقرب موقع" value={nearest.nearestLocation?.name || 'غير محدد'} /><Info label="المسافة" value={round(nearest.distanceMeters)} /><Info label="دقة GPS" value={round(position?.accuracy)} /><div className={cn('mt-3 rounded-xl border p-3 text-sm font-black', nearest.status === 'accepted' ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]')}>{nearest.status === 'accepted' ? 'داخل النطاق ومتاح التسجيل' : nearest.rejectionReason}</div></> : <div className="text-sm font-bold text-[var(--dawaa-theme-muted)]">اضغط تحديث للحصول على الموقع قبل التسجيل.</div>}</Panel>
          <Panel title="تسجيل سريع" icon={Clock}><Info label="آخر حضور" value={formatDateTime(lastCheckIn?.recorded_at)} /><Info label="آخر انصراف" value={formatDateTime(lastCheckOut?.recorded_at)} /><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={clocking} onClick={() => void handleClock('check_in')} className="btn-primary"><LogIn size={16} /> حضور</button><button disabled={clocking} onClick={() => void handleClock('check_out')} className="btn-secondary"><LogOut size={16} /> انصراف</button></div><button onClick={() => void loadClock()} className="btn-secondary mt-2 w-full"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث الموقع</button><div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-black text-[var(--dawaa-status-info-text)]">أي حضور أو انصراف مقبول أو مرفوض يرسل إشعارًا فوريًا للإدارة لأن الوقت مرتبط بالمرتب.</div></Panel>
        </div>
      )}

      {tab === 'logs' && <AttendanceLogs logs={logs} loading={loading} />}

      {tab === 'report' && <><div className="flex flex-col gap-3 rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm sm:flex-row sm:items-center print:hidden"><div className="flex items-center gap-2 flex-1"><Filter size={16} className="text-[var(--dawaa-theme-muted)] shrink-0" /><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="dawaa-focus-ring bg-[var(--dawaa-theme-input)] text-[var(--dawaa-theme-heading)] rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-2 text-sm font-bold" /><span className="text-sm font-bold text-[var(--dawaa-theme-muted)]">{monthLabel(month)}</span></div><select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="dawaa-focus-ring bg-[var(--dawaa-theme-input)] text-[var(--dawaa-theme-heading)] rounded-xl border border-[var(--dawaa-theme-border)] px-3 py-2 text-sm font-bold">{branches.map((b) => <option key={b}>{b}</option>)}</select><button onClick={() => void loadReport()} className="btn-primary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button><button onClick={() => void exportAttendanceToExcel(summaries, month)} disabled={!summaries.length} className="btn-secondary"><Download size={16} /> Excel</button><button onClick={() => window.print()} className="btn-secondary"><Printer size={16} /> طباعة</button></div><div className="rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-black text-[var(--dawaa-status-info-text)] print:hidden">التقرير الشهري الحالي مرحلة انتقالية. لم نعد نفترض أن كل يوم في الشهر يوم عمل؛ الغياب المالي النهائي سيأتي من جدول اليوم المعتمد + البصمة + الاستثناءات.</div><div className="grid gap-3 md:grid-cols-4"><Metric label="عدد الموظفين" value={totals.staff} icon={Users} color="text-[var(--dawaa-status-info-text)] bg-[var(--dawaa-status-info-bg)] border-[var(--dawaa-status-info-border)]" /><Metric label="أيام بها حضور" value={totals.present} icon={CheckCircle2} color="text-[var(--dawaa-status-success-text)] bg-[var(--dawaa-status-success-bg)] border-[var(--dawaa-status-success-border)]" /><Metric label="غياب مسجل صراحة" value={totals.absent} icon={XCircle} color="text-[var(--dawaa-status-danger-text)] bg-[var(--dawaa-status-danger-bg)] border-[var(--dawaa-status-danger-border)]" /><Metric label="أيام تأخير قابلة للحساب" value={totals.late} icon={Clock} color="text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]" /></div>{loading && <TableSkeleton />}{!loading && summaries.length === 0 && <Empty text="لا توجد بيانات حضور لهذا الشهر." />}{!loading && summaries.length > 0 && <SummaryTable summaries={summaries} />}</>}
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) { return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm"><h2 className="mb-4 flex items-center gap-2 text-lg font-black text-[var(--dawaa-theme-heading)]"><Icon size={20} className="text-[var(--dawaa-theme-primary-strong)]" /> {title}</h2>{children}</div>; }
function Info({ label, value }: { label: string; value: React.ReactNode }) { return <div className="mb-2 flex items-center justify-between gap-3 rounded-xl dawaa-surface-soft px-3 py-2 text-sm"><span className="font-bold text-[var(--dawaa-theme-muted)]">{label}</span><b className="text-[var(--dawaa-theme-heading)]">{value}</b></div>; }
function Metric({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) { return <div className="dawaa-surface flex items-center gap-3 rounded-2xl border p-4 shadow-sm"><span className={cn('rounded-xl border p-2', color)}><Icon size={28} /></span><div><div className="text-xs font-bold">{label}</div><div className="text-3xl font-black">{value.toLocaleString('ar-EG')}</div></div></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-8 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">{text}</div>; }

function DailyCommandTable({ rows }: { rows: DailyCommandRow[] }) {
  return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="dawaa-table-semantic min-w-full text-sm"><thead><tr className="text-right"><th className="p-3">الموظف</th><th className="p-3">الفرع</th><th className="p-3">الشيفت</th><th className="p-3">الدخول</th><th className="p-3">التأخير</th><th className="p-3">الخروج</th><th className="p-3">خروج مبكر</th><th className="p-3">الحالة</th><th className="p-3">ملاحظة</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.staff_id}-${row.work_date}`} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}<div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.role || '-'}</div></td><td className="p-3">{row.branch || '-'}</td><td className="p-3 font-bold">{row.schedule_status === 'off' ? 'إجازة' : row.shift_start && row.shift_end ? `${formatTime(row.shift_start)} ← ${formatTime(row.shift_end)}` : row.schedule_status === 'conflict' ? 'تعارض' : 'غير مكتمل'}</td><td className="p-3 font-bold">{formatTime(row.first_check_in)}</td><td className="p-3 font-black text-[var(--dawaa-status-warning-text)]">{row.late_minutes > 0 ? `${row.late_minutes} د` : '-'}</td><td className="p-3 font-bold">{formatTime(row.last_check_out)}</td><td className="p-3 font-black text-[var(--dawaa-status-danger-text)]">{row.early_leave_minutes > 0 ? `${row.early_leave_minutes} د` : '-'}</td><td className="p-3"><span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-black', statusClass(row.attendance_status))}>{attendanceLabel(row.attendance_status)}</span></td><td className="p-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">{row.approved_exception_type ? `${row.approved_exception_type}${row.approved_exception_reason ? ` — ${row.approved_exception_reason}` : ''}` : row.schedule_status === 'conflict' ? 'لا يتم احتساب جزاء حتى تصحيح الجدول' : row.biometric_events ? `${row.biometric_events} بصمة` : '-'}</td></tr>)}</tbody></table></div></div>;
}

function SyncHealthPanel({ health }: { health: SyncHealth }) {
  const mapped = Number(health.mapped_events || 0);
  const raw = Number(health.raw_events || 0);
  const unmapped = Number(health.unmapped_events || 0);
  const rate = raw > 0 ? Math.round((mapped / raw) * 100) : 0;
  return <><div className="grid gap-3 md:grid-cols-4"><Metric label="إجمالي البصمات الخام" value={raw} icon={Fingerprint} color="text-[var(--dawaa-status-info-text)] bg-[var(--dawaa-status-info-bg)] border-[var(--dawaa-status-info-border)]" /><Metric label="مربوطة بموظفين" value={mapped} icon={CheckCircle2} color="text-[var(--dawaa-status-success-text)] bg-[var(--dawaa-status-success-bg)] border-[var(--dawaa-status-success-border)]" /><Metric label="غير مربوطة" value={unmapped} icon={AlertTriangle} color="text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]" /><Metric label="وصلت آخر 24 ساعة" value={Number(health.events_last_24h || 0)} icon={Clock} color="text-[var(--dawaa-status-info-text)] bg-[var(--dawaa-status-info-bg)] border-[var(--dawaa-status-info-border)]" /></div><div className="grid gap-3 lg:grid-cols-3"><Panel title="آخر مزامنة" icon={RefreshCw}><Info label="آخر حدث وصل" value={formatDateTime(health.last_ingested_at)} /><Info label="آخر وقت بصمة" value={formatDateTime(health.last_punch_time)} /></Panel><Panel title="جودة الربط" icon={CheckCircle2}><Info label="نسبة الربط" value={`${rate}%`} /><Info label="غير مربوط آخر 24 ساعة" value={Number(health.unmapped_last_24h || 0).toLocaleString('ar-EG')} /></Panel><Panel title="حماية السجل" icon={ShieldAlert}><div className="rounded-xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-3 text-sm font-black text-[var(--dawaa-status-success-text)]">رفع البصمات يتم من الـIntegration فقط، والواجهة لا تملك تعديل Raw evidence.</div></Panel></div></>;
}

function AttendanceLogs({ logs, loading }: { logs: any[]; loading: boolean }) { if (loading) return <TableSkeleton />; if (!logs.length) return <Empty text="لا توجد محاولات حضور بعد." />; return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="dawaa-table-semantic min-w-full text-sm"><thead><tr className="text-right"><th className="p-3">الوقت</th><th className="p-3">النوع</th><th className="p-3">الحالة</th><th className="p-3">الفرع</th><th className="p-3">المسافة</th><th className="p-3">GPS</th><th className="p-3">التحقق</th><th className="p-3">السبب</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-3 font-bold text-[var(--dawaa-theme-heading)]">{formatDateTime(log.recorded_at)}</td><td className="p-3">{log.attendance_type === 'check_in' ? 'حضور' : 'انصراف'}</td><td className="p-3">{log.status}</td><td className="p-3">{log.branch_name || '-'}</td><td className="p-3">{round(log.distance_from_location_meters)}</td><td className="p-3">{round(log.gps_accuracy_meters)}</td><td className="p-3">{log.biometric_verified ? 'تم' : 'مراجعة'}</td><td className="p-3 text-[var(--dawaa-theme-muted)]">{log.rejection_reason || '-'}</td></tr>)}</tbody></table></div></div>; }
function SummaryTable({ summaries }: { summaries: StaffSummary[] }) { return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="dawaa-table-semantic min-w-full text-sm"><thead><tr className="text-right"><th className="p-3">الموظف</th><th className="p-3">الفرع</th><th className="p-3">أيام بها حضور</th><th className="p-3">غياب مسجل</th><th className="p-3">أيام التأخير</th><th className="p-3">متوسط الدخول</th><th className="p-3">معدل السجلات</th></tr></thead><tbody>{summaries.map((s) => <tr key={`${s.staff_name}-${s.branch}`} className="border-t hover:bg-[var(--dawaa-theme-surface-2)] transition"><td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{s.staff_name}</td><td className="p-3 text-[var(--dawaa-theme-text)]">{s.branch}</td><td className="p-3 font-bold text-[var(--dawaa-status-success-text)]">{s.present}</td><td className="p-3 font-bold text-[var(--dawaa-status-danger-text)]">{s.absent}</td><td className="p-3 font-bold text-[var(--dawaa-status-warning-text)]">{s.late}</td><td className="p-3 font-bold text-[var(--dawaa-theme-text)]">{s.avg_checkin || '-'}</td><td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{s.attendance_rate}%</td></tr>)}</tbody></table></div></div>; }
