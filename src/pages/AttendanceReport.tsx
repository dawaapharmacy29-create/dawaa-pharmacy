import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Download, Filter, Fingerprint, LocateFixed, LogIn, LogOut, Printer, RefreshCw, ShieldAlert, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { isSupabaseConfigured } from '@/lib/supabase';
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

type Tab = 'clock' | 'report' | 'logs';
type AttendanceRow = AttendanceReportRow;

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

function round(value?: number | null) {
  return value == null ? 'غير محدد' : `${Math.round(Number(value))} متر`;
}

function formatDateTime(value?: string | null) {
  if (!value) return 'غير مسجل';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
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
  return <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><Skeleton className="h-5 w-48" /><div className="mt-4 space-y-3">{Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}</div></div>;
}

export default function AttendanceReport() {
  const { user } = useAuth();
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const canAllBranches = canSeeAllBranches(user?.role);
  const normalizedUserBranch = normalizeBranchName(user?.branch || '');
  const [tab, setTab] = useState<Tab>('clock');
  const [month, setMonth] = useState(defaultMonth);
  const [branchFilter, setBranchFilter] = useState(() => (canAllBranches ? 'الكل' : normalizedUserBranch || 'الكل'));
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [locations, setLocations] = useState<AttendanceLocation[]>([]);
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [loading, setLoading] = useState(false);
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
  useEffect(() => { if (tab === 'report') void loadReport(); }, [tab, loadReport]);

  const branches = useMemo(() => {
    if (!canAllBranches && normalizedUserBranch) return [normalizedUserBranch];
    const set = new Set<string>(['الكل']);
    rows.forEach((r) => { if (r.branch) set.add(normalizeBranchName(r.branch) || r.branch); });
    ['فرع شكري', 'فرع الشامي', 'المخزن'].forEach((b) => set.add(b));
    return Array.from(set);
  }, [canAllBranches, normalizedUserBranch, rows]);

  const summaries = useMemo((): StaffSummary[] => {
    const map = new Map<string, { rows: AttendanceRow[]; branch: string }>();
    rows.filter((r) => effectiveBranch === 'الكل' || normalizeBranchName(r.branch || '') === normalizeBranchName(effectiveBranch)).forEach((r) => {
      const name = r.staff_name || r.staff_id || 'غير محدد';
      const key = `${name}__${r.branch || ''}`;
      if (!map.has(key)) map.set(key, { rows: [], branch: r.branch || '-' });
      map.get(key)!.rows.push(r);
    });
    const totalDays = getMonthDays(year, monthNum);
    return Array.from(map.entries()).map(([, { rows: staffRows, branch }]) => {
      const name = staffRows[0]?.staff_name || staffRows[0]?.staff_id || 'غير محدد';
      const present = staffRows.filter((r) => r.check_in).length;
      const late = staffRows.filter((r) => isLate(r.check_in, r.shift_start)).length;
      const absent = Math.max(totalDays - present, 0);
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
  }, [rows, effectiveBranch, year, monthNum]);

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
    } catch (e) {
      const message = e instanceof Error ? e.message : 'تعذر تسجيل الحضور';
      setError(message);
      toast.error(message);
    } finally {
      setClocking(false);
    }
  }

  return (
    <div className="space-y-6 print:space-y-4" dir="rtl">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm print:hidden">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">الحضور والانصراف</h1>
            <p className="mt-1 text-sm font-bold text-slate-500">التقرير يجمع جدول attendance القديم مع بصمة staff_attendance_logs الحديثة، لذلك تظهر بصمات د علا وأي موظف سجّل من البصمة حتى لو لم تنتقل للجدول الشهري القديم.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setTab('clock')} className={tab === 'clock' ? 'btn-primary' : 'btn-secondary'}><Fingerprint size={16} /> تسجيل حضور</button>
            <button onClick={() => setTab('report')} className={tab === 'report' ? 'btn-primary' : 'btn-secondary'}><Users size={16} /> التقرير الشهري</button>
            <button onClick={() => setTab('logs')} className={tab === 'logs' ? 'btn-primary' : 'btn-secondary'}><ShieldAlert size={16} /> محاولاتي</button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">⚠️ {error}</div>}

      {tab === 'clock' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="بيانات الموظف" icon={Fingerprint}><Info label="الاسم" value={userName} /><Info label="الدور" value={user?.role || 'غير محدد'} /><Info label="الفرع" value={userBranch || 'غير محدد'} /></Panel>
          <Panel title="حالة الموقع" icon={LocateFixed}>{loading ? <Skeleton className="h-24 w-full" /> : nearest ? <><Info label="أقرب موقع" value={nearest.nearestLocation?.name || 'غير محدد'} /><Info label="المسافة" value={round(nearest.distanceMeters)} /><Info label="دقة GPS" value={round(position?.accuracy)} /><div className={cn('mt-3 rounded-xl border p-3 text-sm font-black', nearest.status === 'accepted' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700')}>{nearest.status === 'accepted' ? 'داخل النطاق ومتاح التسجيل' : nearest.rejectionReason}</div></> : <div className="text-sm font-bold text-slate-500">اضغط تحديث للحصول على الموقع قبل التسجيل.</div>}</Panel>
          <Panel title="تسجيل سريع" icon={Clock}><Info label="آخر حضور" value={formatDateTime(lastCheckIn?.recorded_at)} /><Info label="آخر انصراف" value={formatDateTime(lastCheckOut?.recorded_at)} /><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={clocking} onClick={() => void handleClock('check_in')} className="btn-primary"><LogIn size={16} /> حضور</button><button disabled={clocking} onClick={() => void handleClock('check_out')} className="btn-secondary"><LogOut size={16} /> انصراف</button></div><button onClick={() => void loadClock()} className="btn-secondary mt-2 w-full"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث الموقع</button><div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs font-black text-cyan-700">أي حضور أو انصراف مقبول أو مرفوض يرسل إشعارًا فوريًا للإدارة لأن الوقت مرتبط بالمرتب.</div></Panel>
        </div>
      )}

      {tab === 'logs' && <AttendanceLogs logs={logs} loading={loading} />}

      {tab === 'report' && <><div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center print:hidden"><div className="flex items-center gap-2 flex-1"><Filter size={16} className="text-slate-400 shrink-0" /><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold" /><span className="text-sm font-bold text-slate-600">{monthLabel(month)}</span></div><select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold">{branches.map((b) => <option key={b}>{b}</option>)}</select><button onClick={() => void loadReport()} className="btn-primary"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> تحديث</button><button onClick={() => void exportAttendanceToExcel(summaries, month)} disabled={!summaries.length} className="btn-secondary"><Download size={16} /> Excel</button><button onClick={() => window.print()} className="btn-secondary"><Printer size={16} /> طباعة</button></div><div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-xs font-black text-cyan-800 print:hidden">مصدر التقرير الآن: attendance + staff_attendance_logs. لو موظف بصم لكنه لم يظهر سابقًا، سيظهر هنا من سجل البصمة الحديث.</div><div className="grid gap-3 md:grid-cols-4"><Metric label="عدد الموظفين" value={totals.staff} icon={Users} color="text-blue-600 bg-blue-50 border-blue-200" /><Metric label="إجمالي أيام الحضور" value={totals.present} icon={CheckCircle2} color="text-emerald-700 bg-emerald-50 border-emerald-200" /><Metric label="إجمالي أيام الغياب" value={totals.absent} icon={XCircle} color="text-red-700 bg-red-50 border-red-200" /><Metric label="إجمالي أيام التأخير" value={totals.late} icon={Clock} color="text-amber-700 bg-amber-50 border-amber-200" /></div>{loading && <TableSkeleton />}{!loading && summaries.length === 0 && <Empty text="لا توجد بيانات حضور لهذا الشهر." />}{!loading && summaries.length > 0 && <SummaryTable summaries={summaries} />}</>}
    </div>
  );
}

function Panel({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) { return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 flex items-center gap-2 text-lg font-black text-slate-900"><Icon size={20} className="text-teal-600" /> {title}</h2>{children}</div>; }
function Info({ label, value }: { label: string; value: React.ReactNode }) { return <div className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm"><span className="font-bold text-slate-500">{label}</span><b className="text-slate-900">{value}</b></div>; }
function Metric({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) { return <div className={cn('flex items-center gap-3 rounded-2xl border p-4 shadow-sm', color)}><Icon size={28} /><div><div className="text-xs font-bold">{label}</div><div className="text-3xl font-black">{value.toLocaleString('ar-EG')}</div></div></div>; }
function Empty({ text }: { text: string }) { return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">{text}</div>; }
function AttendanceLogs({ logs, loading }: { logs: any[]; loading: boolean }) { if (loading) return <TableSkeleton />; if (!logs.length) return <Empty text="لا توجد محاولات حضور بعد." />; return <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="bg-slate-50 text-slate-600 text-right"><th className="p-3">الوقت</th><th className="p-3">النوع</th><th className="p-3">الحالة</th><th className="p-3">الفرع</th><th className="p-3">المسافة</th><th className="p-3">GPS</th><th className="p-3">التحقق</th><th className="p-3">السبب</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id} className="border-t"><td className="p-3 font-bold text-slate-800">{formatDateTime(log.recorded_at)}</td><td className="p-3">{log.attendance_type === 'check_in' ? 'حضور' : 'انصراف'}</td><td className="p-3">{log.status}</td><td className="p-3">{log.branch_name || '-'}</td><td className="p-3">{round(log.distance_from_location_meters)}</td><td className="p-3">{round(log.gps_accuracy_meters)}</td><td className="p-3">{log.biometric_verified ? 'تم' : 'مراجعة'}</td><td className="p-3 text-slate-500">{log.rejection_reason || '-'}</td></tr>)}</tbody></table></div></div>; }
function SummaryTable({ summaries }: { summaries: StaffSummary[] }) { return <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead><tr className="bg-slate-50 text-slate-600 text-right"><th className="p-3">الموظف</th><th className="p-3">الفرع</th><th className="p-3">أيام الحضور</th><th className="p-3">أيام الغياب</th><th className="p-3">أيام التأخير</th><th className="p-3">متوسط الدخول</th><th className="p-3">معدل الانتظام</th></tr></thead><tbody>{summaries.map((s) => <tr key={`${s.staff_name}-${s.branch}`} className="border-t hover:bg-slate-50 transition"><td className="p-3 font-black text-slate-900">{s.staff_name}</td><td className="p-3 text-slate-700">{s.branch}</td><td className="p-3 font-bold text-emerald-700">{s.present}</td><td className="p-3 font-bold text-red-700">{s.absent}</td><td className="p-3 font-bold text-amber-700">{s.late}</td><td className="p-3 font-bold text-slate-700">{s.avg_checkin || '-'}</td><td className="p-3 font-black text-slate-900">{s.attendance_rate}%</td></tr>)}</tbody></table></div></div>; }
