import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, ChevronUp, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { cachedRpc, invalidateCachedRpc } from '@/lib/attendance/cachedRpc';
import { cn } from '@/lib/utils';

type Candidate = {
  staff_id: string;
  staff_name: string;
  branch: string;
  day_of_week: string;
  occurrences: number;
  distinct_dates: number;
  earliest_time: string;
  latest_time: string;
  spread_minutes: number;
  sample_dates: string[];
};

function formatTime(value: string) {
  const [h, m] = value.split(':');
  const hour = Number(h);
  const period = hour >= 12 ? 'م' : 'ص';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${m} ${period}`;
}

function confidenceLabel(spreadMinutes: number, distinctDates: number) {
  if (distinctDates >= 3 && spreadMinutes <= 15) return { label: 'نمط شبه مؤكد', cls: 'text-[var(--dawaa-status-danger-text)] bg-[var(--dawaa-status-danger-bg)] border-[var(--dawaa-status-danger-border)]' };
  if (distinctDates >= 3 && spreadMinutes <= 60) return { label: 'نمط محتمل', cls: 'text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]' };
  if (distinctDates === 2 && spreadMinutes <= 15) return { label: 'نمط محتمل', cls: 'text-[var(--dawaa-status-warning-text)] bg-[var(--dawaa-status-warning-bg)] border-[var(--dawaa-status-warning-border)]' };
  return { label: 'يحتاج تأكيد (يومين بس)', cls: 'text-[var(--dawaa-theme-muted)] bg-[var(--dawaa-theme-surface-2)] border-[var(--dawaa-theme-border)]' };
}

export default function ScheduleMismatchPanel() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dismissBusy, setDismissBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: rpcError } = await cachedRpc<Candidate[]>('attendance_schedule_mismatch_candidates_v1', { p_days: 21 }, 120);
      if (!cancelled) {
        if (rpcError) setError(rpcError.message);
        else setCandidates(data || []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function dismissCandidate(c: Candidate) {
    const key = `${c.staff_id}-${c.day_of_week}`;
    setDismissBusy(key);
    try {
      const { error } = await supabase.rpc('attendance_dismiss_schedule_mismatch_v1', {
        p_staff_id: c.staff_id, p_day_of_week: c.day_of_week, p_note: 'تمت المراجعة من الإدارة',
      });
      if (error) throw error;
      toast.success('تم إغلاق الحالة');
      invalidateCachedRpc('attendance_schedule_mismatch_candidates_v1');
      setCandidates((prev) => prev.filter((x) => !(x.staff_id === c.staff_id && x.day_of_week === c.day_of_week)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'تعذر إغلاق الحالة');
    } finally {
      setDismissBusy(null);
    }
  }

  if (loading) return <div className="h-16 animate-pulse rounded-2xl bg-[var(--dawaa-theme-surface-2)]" />;
  if (error) return null;
  if (!candidates.length) return null;

  const visible = expanded ? candidates : candidates.slice(0, 3);

  return (
    <div className="rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock size={18} className="text-[var(--dawaa-status-warning-text)]" />
          <div>
            <h3 className="font-black text-[var(--dawaa-status-warning-text)]">احتمالات جدول غير مطابق للواقع</h3>
            <p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">موظفين نشطين عندهم بصمات متكررة خارج شيفتهم المسجل في نفس يوم الأسبوع — ممكن يبقى الجدول المسجل غلط، زي ما اكتشفنا قبل كده.</p>
          </div>
        </div>
        <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-theme-surface)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-warning-text)]">{candidates.length}</span>
      </div>
      <div className="space-y-2">
        {visible.map((c) => {
          const conf = confidenceLabel(c.spread_minutes, c.distinct_dates);
          const key = `${c.staff_id}-${c.day_of_week}`;
          return (
            <div key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3">
              <div>
                <span className="font-black text-[var(--dawaa-theme-heading)]">{c.staff_name}</span>
                <span className="mr-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">{c.branch} · كل {c.day_of_week}</span>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold">
                <span className="text-[var(--dawaa-theme-muted)]">{formatTime(c.earliest_time)}{c.spread_minutes > 0 ? ` — ${formatTime(c.latest_time)}` : ''} ({c.distinct_dates} أيام مختلفة)</span>
                <span className={cn('rounded-full border px-2 py-1 text-[10px] font-black', conf.cls)}>{conf.label}</span>
                <button disabled={dismissBusy===key} onClick={() => void dismissCandidate(c)} title="إغلاق الحالة (تمت المراجعة)" className="rounded-full border border-[var(--dawaa-theme-border)] p-1.5 text-[var(--dawaa-theme-muted)] hover:bg-[var(--dawaa-theme-surface-2)]"><X size={12} /></button>
              </div>
            </div>
          );
        })}
      </div>
      {candidates.length > 3 && (
        <button onClick={() => setExpanded((v) => !v)} className="mt-2 flex items-center gap-1 text-xs font-black text-[var(--dawaa-status-warning-text)]">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {expanded ? 'عرض أقل' : `عرض كل الـ${candidates.length}`}
        </button>
      )}
      <p className="mt-3 flex items-start gap-1.5 text-[10px] font-bold text-[var(--dawaa-theme-muted)]"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> هذا اكتشاف احتمالي فقط بناءً على تكرار النمط — لا يُعدَّل أي جدول تلقائيًا؛ يحتاج تأكيدك قبل أي تعديل.</p>
    </div>
  );
}
