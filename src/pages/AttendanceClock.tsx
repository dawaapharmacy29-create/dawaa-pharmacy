import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Fingerprint, LocateFixed, LogIn, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
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

function round(value?: number | null) {
  return value == null ? 'غير محدد' : `${Math.round(value)} متر`;
}

export default function AttendanceClock() {
  const { user } = useAuth();
  const [locations, setLocations] = useState<AttendanceLocation[]>([]);
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<AttendanceType | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const validation = useMemo(() => (position ? validateAttendancePosition(position, locations) : null), [position, locations]);
  const lastCheckIn = logs.find((log) => log.attendance_type === 'check_in');
  const lastCheckOut = logs.find((log) => log.attendance_type === 'check_out');

  const refresh = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [locs, currentPosition, recent] = await Promise.all([
        fetchAttendanceLocations(),
        getDevicePosition(),
        getRecentAttendanceLogs(user?.id, 10),
      ]);
      setLocations(locs);
      setPosition(currentPosition);
      setLogs(recent);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'تعذر تحديث بيانات الحضور.';
      setMessage(text);
      toast.error(text);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [user?.id]);

  const record = async (attendanceType: AttendanceType) => {
    setSaving(attendanceType);
    setMessage(null);
    try {
      const currentPosition = await getDevicePosition();
      const locs = locations.length ? locations : await fetchAttendanceLocations();
      const result = validateAttendancePosition(currentPosition, locs);
      const biometric = await verifyWithAvailableBiometric();
      const finalResult = biometric.verified ? result : { ...result, status: result.status === 'accepted' ? 'manual_review' as const : result.status, rejectionReason: result.rejectionReason || biometric.message };
      const saved = await saveAttendanceAttempt({
        user: { id: user?.id, name: user?.name, role: user?.role, branch: user?.branch },
        attendanceType,
        position: currentPosition,
        validation: finalResult,
        biometric: { verified: biometric.verified, method: biometric.method },
        deviceId: localStorage.getItem('dawaa_device_id') || navigator.userAgent.slice(0, 90),
      });
      setPosition(currentPosition);
      setLogs((current) => [saved, ...current]);
      if (saved.status === 'accepted') toast.success(attendanceType === 'check_in' ? 'تم تسجيل الحضور بنجاح.' : 'تم تسجيل الانصراف بنجاح.');
      else toast.warning(saved.rejection_reason || 'تم تسجيل المحاولة للمراجعة اليدوية.');
    } catch (error) {
      const text = error instanceof Error ? error.message : 'تعذر تسجيل الحضور.';
      setMessage(text);
      toast.error(text);
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-3xl border border-cyan-500/30 bg-gradient-to-l from-[#102640] via-slate-900 to-slate-950 p-5 text-slate-100 shadow-xl">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex rounded-full border border-cyan-400/30 bg-cyan-500/15 px-3 py-1 text-xs font-black text-cyan-100">GPS + Passkey</span>
            <h1 className="mt-3 text-2xl font-black text-white">الحضور والانصراف من داخل الفرع</h1>
            <p className="mt-1 text-sm font-semibold text-slate-200">افتح الصفحة داخل الفرع أو المخزن، فعّل الموقع، ثم أكد الهوية بالبصمة/Face ID/Passkey عند توفرها.</p>
          </div>
          <button onClick={refresh} disabled={loading} className="btn-secondary flex items-center gap-2"><RefreshCw className={loading ? 'animate-spin' : ''} size={16} /> تحديث الموقع</button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="dawaa-panel lg:col-span-2">
          <h2 className="mb-4 text-xl font-black text-white">حالة التسجيل الآن</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <Info label="الموظف" value={user?.name || 'غير محدد'} />
            <Info label="الفرع المسجل" value={user?.branch || 'غير محدد'} />
            <Info label="أقرب موقع" value={validation?.nearestLocation?.name || 'غير محدد'} />
            <Info label="حالة الموقع" value={validation?.status === 'accepted' ? 'داخل النطاق' : validation?.status === 'rejected' ? 'مرفوض' : 'يحتاج مراجعة'} />
            <Info label="المسافة من الموقع" value={round(validation?.distanceMeters)} />
            <Info label="دقة GPS" value={round(position?.accuracy)} />
          </div>
          {message && <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100"><ShieldAlert className="ml-2 inline h-5 w-5" />{message}</div>}
          {validation?.rejectionReason && <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-100">{validation.rejectionReason}</div>}
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <button onClick={() => record('check_in')} disabled={Boolean(saving)} className="btn-primary flex items-center justify-center gap-2 py-4"><LogIn size={18} /> {saving === 'check_in' ? 'جاري التسجيل...' : 'تسجيل حضور'}</button>
            <button onClick={() => record('check_out')} disabled={Boolean(saving)} className="btn-secondary flex items-center justify-center gap-2 py-4"><LogOut size={18} /> {saving === 'check_out' ? 'جاري التسجيل...' : 'تسجيل انصراف'}</button>
          </div>
        </div>

        <div className="dawaa-panel">
          <Fingerprint className="mb-3 h-8 w-8 text-cyan-300" />
          <h2 className="text-lg font-black text-white">ملاحظة مهمة عن البصمة</h2>
          <p className="mt-3 text-sm leading-7 text-slate-300">المتصفح لا يسمح للتطبيق بحفظ البصمة نفسها. النظام يستخدم WebAuthn/Passkey أو Windows Hello/Face ID كتحقق هوية آمن، ويحفظ فقط نتيجة التحقق وليس البصمة.</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="dawaa-panel">
          <h3 className="mb-3 font-black text-white">آخر حضور</h3>
          {lastCheckIn ? <LogCard log={lastCheckIn} /> : <Empty text="لا يوجد حضور مسجل بعد." />}
        </div>
        <div className="dawaa-panel">
          <h3 className="mb-3 font-black text-white">آخر انصراف</h3>
          {lastCheckOut ? <LogCard log={lastCheckOut} /> : <Empty text="لا يوجد انصراف مسجل بعد." />}
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-4"><div className="text-xs text-slate-400">{label}</div><div className="mt-2 font-black text-white">{value}</div></div>;
}

function LogCard({ log }: { log: any }) {
  return <div className="space-y-2 rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-300"><div className="font-black text-white"><CheckCircle2 className="ml-2 inline h-4 w-4 text-emerald-300" />{log.status === 'accepted' ? 'مقبول' : log.status === 'rejected' ? 'مرفوض' : 'مراجعة يدوية'}</div><div>الوقت: {new Date(log.recorded_at).toLocaleString('ar-EG')}</div><div>المسافة: {round(log.distance_from_location_meters)}</div><div>دقة GPS: {round(log.gps_accuracy_meters)}</div><div>البصمة: {log.biometric_verified ? 'تم التحقق' : 'لم تكتمل'}</div>{log.rejection_reason && <div className="text-amber-200">السبب: {log.rejection_reason}</div>}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">{text}</div>;
}
