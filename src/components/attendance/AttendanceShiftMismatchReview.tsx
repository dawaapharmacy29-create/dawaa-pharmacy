import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type MismatchRow = {
  staff_id: string;
  staff_name: string;
  staff_role: string | null;
  branch: string | null;
  punch_date: string;
  raw_events: number;
  review_events: number;
  fallback_accepted: number;
  first_punch: string;
  last_punch: string;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
};
function possibleShift(row: MismatchRow): string | null {
  // This is a hypothesis, never a canonical punch pairing or an approval.
  if (row.raw_events !== 2 || !row.first_punch || !row.last_punch) return null;
  const first = new Date(row.first_punch).getTime();
  const last = new Date(row.last_punch).getTime();
  const hours = (last - first) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 4 || hours > 12) return null;
  return `${cairoTime(row.first_punch)} – ${cairoTime(row.last_punch)}`;
}
function possibleOvernightShift(row: MismatchRow, days: MismatchRow[]): string | null {
  // Only a hypothesis: one isolated evening event plus one early event on the following date.
  // Other accepted punches may exist outside this anomaly feed; never auto-apply.
  if (row.raw_events !== 1 || !row.first_punch) return null;
  const nextDate = new Date(`${row.punch_date}T12:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const tomorrow = nextDate.toISOString().slice(0, 10);
  const next = days.find((day) => day.punch_date === tomorrow && day.raw_events === 1);
  if (!next?.first_punch) return null;
  const first = new Date(row.first_punch);
  const last = new Date(next.first_punch);
  const hours = (last.getTime() - first.getTime()) / 3_600_000;
  const startHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(first));
  const endHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hourCycle: 'h23' }).format(last));
  if (!Number.isFinite(hours) || hours < 4 || hours > 12 || startHour < 15 || endHour > 10) return null;
  return `${cairoTime(row.first_punch)} – ${cairoTime(next.first_punch)} (اليوم التالي)`;
}
function cairoTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit',
  }).format(date);
}
export default function AttendanceShiftMismatchReview({
  start, end, branch, staffId,
}: { start: string; end: string; branch: string; staffId?: string | null }) {
  const [rows, setRows] = useState<MismatchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [expandedStaff, setExpandedStaff] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void (async () => {
      // Use the current effect lifetime so stale reads cannot replace newer filters.
      setBusy(true);
      const { data, error: fetchError } = await supabase.rpc('attendance_shift_mismatch_review_v1', {
        p_start: start, p_end: end,
        p_branch: branch === 'الكل' ? null : branch, p_limit: 500,
      });
      if (!active) return;
      setBusy(false);
      if (fetchError) {
        setRows([]);
        setError('تعذر قراءة حالات اختلاف المواعيد: ' + fetchError.message);
      } else {
        setError('');
        setRows((data || []) as MismatchRow[]);
      }
    })();
    return () => { active = false; };
  }, [start, end, branch, refresh]);
  const filtered = staffId && staffId !== 'all' ? rows.filter((row) => row.staff_id === staffId) : rows;
  const unverified = filtered.reduce((sum, row) => sum + row.fallback_accepted, 0);
  const groups = Object.values(filtered.reduce<Record<string, {
    staffId: string; name: string; role: string | null; branch: string | null;
    days: MismatchRow[]; raw: number; pending: number; fallback: number;
  }>>((acc, row) => {
    const group = acc[row.staff_id] ||= {
      staffId: row.staff_id, name: row.staff_name, role: row.staff_role,
      branch: row.branch, days: [], raw: 0, pending: 0, fallback: 0,
    };
    group.days.push(row);
    group.raw += row.raw_events;
    group.pending += row.review_events;
    group.fallback += row.fallback_accepted;
    return acc;
  }, {})).sort((a, b) => b.days.length - a.days.length || b.raw - a.raw);
  return (
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4" dir="rtl" aria-label="مراجعة اختلاف مواعيد الشيفت">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 font-black"><AlertTriangle size={16} /> بصمات خارج الشيفت — تحتاج مراجعة</h3>
          <p className="mt-1 text-xs text-[var(--dawaa-theme-muted)]">مؤشرات اختلاف موعد أو جدول، وليست إثباتًا لتغيير الشيفت أو مخالفة الموظف. لا ينتج عن هذا التقرير اعتماد أو خصم.</p>
        </div>
        <button type="button" className="btn-secondary text-xs" onClick={() => setRefresh((value) => value + 1)} disabled={busy}>
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-[var(--dawaa-status-warning-text)]">{error}</p>}
      {!error && <p className="mt-3 text-xs font-bold">{filtered.length} يوم/موظف بحاجة تدقيق · {unverified} بصمة قُبلت بتفسير خام دون جدول مطابق</p>}
      {busy && <p className="mt-2 text-xs">جارٍ تحميل الأدلة...</p>}
      {!busy && !error && filtered.length === 0 && <p className="mt-2 text-xs">لا توجد مؤشرات ضمن النطاق المختار.</p>}
      {!error && groups.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-[var(--dawaa-theme-muted)]">الترتيب حسب الأيام التي ظهر فيها اختلاف. كل يوم يحتاج تحققًا مستقلًا؛ لا يوجد اعتماد جماعي تلقائي.</p>
          {groups.map((group) => (
            <div key={group.staffId} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-black">{group.name} · {group.branch || 'الفرع غير محدد'}</div>
                  <p className="mt-1 text-[var(--dawaa-theme-muted)]">{group.role || 'موظف'} · {group.days.length} يوم للمراجعة · {group.raw} بصمة · {group.fallback} قبول خام</p>
                </div>
                <button type="button" className="btn-secondary text-xs" aria-expanded={expandedStaff === group.staffId} onClick={() => setExpandedStaff((value) => value === group.staffId ? null : group.staffId)}>
                  {expandedStaff === group.staffId ? 'إخفاء الأيام' : 'عرض الأيام'}
                </button>
              </div>
              {expandedStaff === group.staffId && (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {group.days.map((row) => (
                    <div key={row.punch_date} className="rounded-lg border border-[var(--dawaa-theme-border)] p-3">
                      <div className="font-bold">{row.punch_date}</div>
                      <p className="mt-1">البصمات: {row.raw_events} · تحتاج تفسير: {row.review_events} · قبول خام: {row.fallback_accepted}</p>
                      <p className="mt-1">المرصود: {cairoTime(row.first_punch)} — {cairoTime(row.last_punch)}</p>
                      {(possibleShift(row) || possibleOvernightShift(row, group.days)) ? (
                        <p className="mt-1 font-bold">احتمال شيفت من البصمات: {possibleShift(row) || possibleOvernightShift(row, group.days)} (غير مؤكد؛ قد توجد بصمات أخرى خارج هذا التقرير)</p>
                      ) : <p className="mt-1 text-[var(--dawaa-theme-muted)]">لا تكفي البصمات لاقتراح شيفت موثوق.</p>}
                      <p className="mt-1">المسجل: {cairoTime(row.scheduled_start_at)} — {cairoTime(row.scheduled_end_at)}</p>
                      <p className="mt-2 font-semibold text-[var(--dawaa-status-warning-text)]">تحقق من اليوم والشيفت الفعلي؛ البصمات بعد منتصف الليل قد تتبع اليوم السابق.</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
