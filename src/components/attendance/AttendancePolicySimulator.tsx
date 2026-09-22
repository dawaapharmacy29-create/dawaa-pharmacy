import { useEffect, useState } from 'react';
import { FlaskConical, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cairoToday, startOfMonth } from '@/lib/attendance/period';
import { simulateAttendancePolicy, type PolicySimulation } from '@/lib/hr/workforceService';

function numberOrNull(value: string) {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export default function AttendancePolicySimulator({
  activePolicy,
}: {
  activePolicy: Record<string, unknown> | null;
}) {
  const today = cairoToday();
  const [start, setStart] = useState(startOfMonth(today));
  const [end, setEnd] = useState(today);
  const [branch, setBranch] = useState('الكل');
  const [lateGrace, setLateGrace] = useState('');
  const [veryLate, setVeryLate] = useState('');
  const [earlyGrace, setEarlyGrace] = useState('');
  const [result, setResult] = useState<PolicySimulation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activePolicy) return;
    setLateGrace(activePolicy.late_grace_minutes == null ? '' : String(activePolicy.late_grace_minutes));
    setVeryLate(activePolicy.very_late_minutes == null ? '' : String(activePolicy.very_late_minutes));
    setEarlyGrace(activePolicy.early_leave_grace_minutes == null ? '0' : String(activePolicy.early_leave_grace_minutes));
  }, [activePolicy]);

  async function run() {
    const late = numberOrNull(lateGrace);
    const severe = numberOrNull(veryLate);
    const early = numberOrNull(earlyGrace);
    if (late == null || severe == null || early == null) {
      toast.warning('أدخل قيم صحيحة للـGrace والتأخير الشديد والخروج المبكر.');
      return;
    }
    if (severe < late) {
      toast.warning('حد التأخير الشديد يجب أن يكون أكبر من أو يساوي Grace التأخير.');
      return;
    }
    setLoading(true);
    try {
      setResult(await simulateAttendancePolicy({
        start,
        end,
        branch: branch === 'الكل' ? null : branch,
        lateGraceMinutes: late,
        veryLateMinutes: severe,
        earlyLeaveGraceMinutes: early,
      }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تشغيل محاكاة السياسة');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 font-black text-[var(--dawaa-theme-heading)]">
            <FlaskConical size={18} /> مختبر سياسة الحضور
          </div>
          <p className="mt-1 max-w-3xl text-xs font-bold leading-5 text-[var(--dawaa-theme-muted)]">
            جرّب أي Grace أو حد تأخير على بيانات الحضور الفعلية قبل التفعيل. المحاكاة للقراءة فقط ولا تعدّل Attendance Truth أو المرتب.
          </p>
        </div>
        <button onClick={() => void run()} className="btn-primary" disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تشغيل المحاكاة
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          من
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="input-dark mt-1 w-full" />
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          إلى
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="input-dark mt-1 w-full" />
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          الفرع
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark mt-1 w-full">
            <option value="الكل">كل الفروع</option>
            <option value="فرع الشامي">فرع الشامي</option>
            <option value="فرع شكري">فرع شكري</option>
          </select>
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          Grace التأخير
          <input type="number" min="0" max="240" value={lateGrace} onChange={(e) => setLateGrace(e.target.value)} className="input-dark mt-1 w-full" />
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          تأخير شديد من
          <input type="number" min="0" max="480" value={veryLate} onChange={(e) => setVeryLate(e.target.value)} className="input-dark mt-1 w-full" />
        </label>
        <label className="text-xs font-black text-[var(--dawaa-theme-muted)]">
          Grace الخروج المبكر
          <input type="number" min="0" max="240" value={earlyGrace} onChange={(e) => setEarlyGrace(e.target.value)} className="input-dark mt-1 w-full" />
        </label>
      </div>

      {result && (
        <>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
            <Mini label="أيام تم تقييمها" value={result.evaluated_days} />
            <Mini label="أيام ستتغير" value={result.changed_days} warn={result.changed_days > 0} />
            <Mini label="تأخير سيصبح في الموعد" value={result.late_to_on_time} />
            <Mini label="في الموعد سيصبح متأخر" value={result.on_time_to_late} warn={result.on_time_to_late > 0} />
            <Mini label="خروج مبكر سيتم إعفاؤه" value={result.early_leave_cleared} />
            <Mini label="خروج مبكر جديد" value={result.early_leave_new} warn={result.early_leave_new > 0} />
          </div>

          <div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
            النتيجة الحالية مجرد What-if. لا يوجد أي تغيير في بيانات الموظفين أو الاعتمادات أو الرواتب.
          </div>

          {!!result.samples?.length && (
            <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]">
              <table className="min-w-[760px] w-full text-xs">
                <thead className="border-b border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-muted)]">
                  <tr>
                    <th className="p-3 text-right">الموظف</th>
                    <th className="p-3 text-right">اليوم</th>
                    <th className="p-3 text-right">الحالي</th>
                    <th className="p-3 text-right">لو طُبقت السياسة</th>
                    <th className="p-3 text-right">تأخير</th>
                    <th className="p-3 text-right">خروج مبكر</th>
                  </tr>
                </thead>
                <tbody>
                  {result.samples.slice(0, 15).map((row) => (
                    <tr key={row.staff_id + '-' + row.attendance_date} className="border-b border-[var(--dawaa-theme-border)]/60 last:border-0">
                      <td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}<div className="text-[10px] text-[var(--dawaa-theme-muted)]">{row.branch}</div></td>
                      <td className="p-3">{row.attendance_date}</td>
                      <td className="p-3">{row.current_status}</td>
                      <td className="p-3 font-black">{row.candidate_status}</td>
                      <td className="p-3">{row.late_minutes} د</td>
                      <td className="p-3">{row.early_leave_minutes} د</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Mini({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={warn
      ? 'rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3'
      : 'rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-3'}>
      <div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div>
      <div className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}
