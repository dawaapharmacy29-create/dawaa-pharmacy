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
      {!error && filtered.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, 60).map((row) => (
            <div key={row.staff_id + row.punch_date} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3 text-xs">
              <div className="font-black">{row.staff_name} · {row.punch_date}</div>
              <p className="mt-1 text-[var(--dawaa-theme-muted)]">{row.branch} · {row.staff_role || 'موظف'}</p>
              <p className="mt-2">البصمات: {row.raw_events} · تحتاج تفسير: {row.review_events} · قبول خام: {row.fallback_accepted}</p>
              <p className="mt-1">الفعلية: {cairoTime(row.first_punch)} — {cairoTime(row.last_punch)}</p>
              <p className="mt-1">الجدول: {cairoTime(row.scheduled_start_at)} — {cairoTime(row.scheduled_end_at)}</p>
              <p className="mt-2 font-semibold text-[var(--dawaa-status-warning-text)]">القرار: معلّق للتحقق من تغيير الميعاد؛ لا تستنتج غيابًا أو خصمًا من هذه البصمات وحدها.</p>
            </div>
          ))}
        </div>
      )}
      {filtered.length > 60 && <p className="mt-2 text-xs">تظهر أول 60 حالة فقط؛ ضيّق فترة البحث أو الفرع للمراجعة.</p>}
    </section>
  );
}
