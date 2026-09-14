import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Fingerprint, RefreshCw, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type DailyCommandRow = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  work_date: string;
  schedule_status: string;
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

type TimelineEvent = {
  id: string;
  time: string | null;
  raw_type: string | null;
  semantic_type: string | null;
  decision: string;
  confidence: number | null;
  reason: string | null;
  duplicate_of: string | null;
  device_id: string | null;
  provider: string | null;
};

type DailyIntelRow = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  raw_events: number;
  effective_events: number;
  duplicate_events: number;
  corrected_type_events: number;
  review_events: number;
  first_effective_at: string | null;
  last_effective_at: string | null;
  avg_confidence: number | null;
  intelligence_status: string;
  timeline: TimelineEvent[];
};

type Props = {
  rows: DailyCommandRow[];
  date: string;
  branch: string;
};

function formatTime(value?: string | null, withSeconds = false) {
  if (!value) return '-';
  if (/^\d{2}:\d{2}/.test(value)) return withSeconds ? value.slice(0, 8) : value.slice(0, 5);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, withSeconds ? 8 : 5);
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: withSeconds ? '2-digit' : undefined, timeZone: 'Africa/Cairo' });
}

function attendanceLabel(status: string) {
  const map: Record<string, string> = {
    on_time: 'في الموعد', late: 'متأخر', very_late: 'متأخر جدًا', absent: 'غياب', not_arrived: 'لم يحضر بعد', scheduled: 'لم يبدأ موعده',
    working_now: 'موجود الآن', missing_checkin: 'بصمة دخول ناقصة', missing_checkout: 'بصمة خروج ناقصة', sync_pending: 'في انتظار المزامنة',
    sync_pending_checkout: 'في انتظار مزامنة الخروج', sync_pending_verification: 'في انتظار تأكيد المزامنة', off: 'إجازة', worked_on_off: 'حضور في إجازة',
    approved_exception: 'استثناء معتمد', schedule_conflict: 'تعارض في الجدول', schedule_missing: 'الجدول غير مكتمل', no_schedule: 'لا يوجد جدول معتمد',
    invalid_schedule_time: 'وقت الشيفت غير صالح', punch_without_valid_schedule: 'بصمة بدون جدول صالح', needs_event_review: 'بصمة تحتاج مراجعة',
    shift_in_progress: 'الشيفت ما زال مستمرًا', invalid_duration: 'مدة عمل غير منطقية', manual_review: 'مراجعة يدوية',
  };
  return map[status] || status;
}

function statusClass(status: string) {
  if (['on_time', 'working_now'].includes(status)) return 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]';
  if (['late', 'approved_exception', 'worked_on_off', 'scheduled'].includes(status)) return 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]';
  if (['very_late', 'absent', 'not_arrived', 'missing_checkin', 'missing_checkout', 'invalid_duration'].includes(status)) return 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]';
  if (['sync_pending', 'sync_pending_checkout', 'sync_pending_verification', 'shift_in_progress', 'no_schedule'].includes(status)) return 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]';
  return 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]';
}

function intelMeta(status?: string) {
  if (status === 'clean') return { label: 'سليم', cls: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' };
  if (status === 'smart_corrected') return { label: 'صححه النظام', cls: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]' };
  if (status === 'needs_review') return { label: 'يحتاج مراجعة', cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' };
  return { label: 'لا توجد بصمات', cls: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]' };
}

function punchLabel(value?: string | null) {
  if (value === 'check_in' || value === 'in') return 'دخول';
  if (value === 'check_out' || value === 'out') return 'خروج';
  return value || '-';
}

function reasonLabel(value?: string | null) {
  const labels: Record<string, string> = {
    schedule_start_window: 'قريب من بداية الشيفت',
    schedule_end_window: 'قريب من نهاية الشيفت',
    nearest_schedule_start: 'أقرب لبداية الشيفت',
    nearest_schedule_end: 'أقرب لنهاية الشيفت',
    same_employee_within_120_seconds: 'بصمة تأكيد مكررة خلال دقيقتين',
    raw_type_fallback: 'اعتماد مبدئي على نوع الجهاز لعدم كفاية قرائن الجدول',
  };
  return labels[value || ''] || value || 'سبب غير محدد';
}

export default function SmartDailyCommandTable({ rows, date, branch }: Props) {
  const [intel, setIntel] = useState<DailyIntelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadIntel = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('attendance_daily_intelligence_v2', {
        p_date: date,
        p_branch: branch === 'الكل' ? null : branch,
      });
      if (rpcError) throw rpcError;
      setIntel((data || []) as DailyIntelRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل ذكاء البصمات');
    } finally {
      setLoading(false);
    }
  }, [branch, date]);

  useEffect(() => { void loadIntel(); }, [loadIntel]);
  useEffect(() => {
    const id = window.setInterval(() => void loadIntel(), 30_000);
    return () => window.clearInterval(id);
  }, [loadIntel]);

  const intelMap = useMemo(() => new Map(intel.map((item) => [item.staff_id, item])), [intel]);
  const smartTotals = useMemo(() => intel.reduce((acc, item) => ({
    raw: acc.raw + Number(item.raw_events || 0),
    effective: acc.effective + Number(item.effective_events || 0),
    duplicates: acc.duplicates + Number(item.duplicate_events || 0),
    corrected: acc.corrected + Number(item.corrected_type_events || 0),
    review: acc.review + Number(item.review_events || 0),
  }), { raw: 0, effective: 0, duplicates: 0, corrected: 0, review: 0 }), [intel]);

  return <div className="space-y-3">
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3 shadow-sm">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2"><Sparkles size={18} className="text-[var(--dawaa-theme-primary-strong)]"/><div><div className="font-black text-[var(--dawaa-theme-heading)]">ذكاء البصمة مدمج في جدول اليوم</div><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">الخام لا يساوي المحتسب: التكرار يُستبعد وتصحيح دخول/خروج يظهر بوضوح مع سبب القرار.</div></div></div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-black">
          <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-1">خام {smartTotals.raw}</span>
          <span className="rounded-full border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] px-2 py-1 text-[var(--dawaa-status-success-text)]">محتسب {smartTotals.effective}</span>
          <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-1 text-[var(--dawaa-status-warning-text)]">مكرر {smartTotals.duplicates}</span>
          <span className="rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-2 py-1 text-[var(--dawaa-status-info-text)]">تصحيح {smartTotals.corrected}</span>
          {!!smartTotals.review && <span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-2 py-1 text-[var(--dawaa-status-danger-text)]">مراجعة {smartTotals.review}</span>}
          <button onClick={() => void loadIntel()} className="btn-secondary px-2 py-1"><RefreshCw size={14} className={loading ? 'animate-spin' : ''}/> تحديث الذكاء</button>
        </div>
      </div>
      {error && <div className="mt-2 rounded-lg border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">⚠️ {error} — جدول الحضور الأساسي ما زال ظاهرًا بدون تعطيل.</div>}
    </div>

    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm overflow-hidden">
      <div className="overflow-x-auto"><table className="dawaa-table-semantic min-w-full text-sm">
        <thead><tr className="text-right"><th className="p-3">الموظف</th><th className="p-3">الفرع</th><th className="p-3">الشيفت</th><th className="p-3">الدخول</th><th className="p-3">التأخير</th><th className="p-3">الخروج</th><th className="p-3">خروج مبكر</th><th className="p-3">الحالة</th><th className="p-3 min-w-[250px]">ملاحظة ذكية</th></tr></thead>
        <tbody>{rows.map((row) => {
          const item = intelMap.get(row.staff_id);
          const meta = intelMeta(item?.intelligence_status);
          const isOpen = expanded === row.staff_id;
          const note = row.approved_exception_type
            ? `${row.approved_exception_type}${row.approved_exception_reason ? ` — ${row.approved_exception_reason}` : ''}`
            : row.schedule_status === 'conflict'
              ? 'لا يتم احتساب جزاء حتى تصحيح الجدول'
              : null;
          return <>
            <tr key={`${row.staff_id}-${row.work_date}`} className="border-t border-[var(--dawaa-theme-divider)] align-top">
              <td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}<div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.role || '-'}</div></td>
              <td className="p-3">{row.branch || '-'}</td>
              <td className="p-3 font-bold">{row.schedule_status === 'off' ? 'إجازة' : row.shift_start && row.shift_end ? `${formatTime(row.shift_start)} ← ${formatTime(row.shift_end)}` : row.schedule_status === 'conflict' ? 'تعارض' : 'غير مكتمل'}</td>
              <td className="p-3 font-bold">{formatTime(row.first_check_in)}</td>
              <td className="p-3 font-black text-[var(--dawaa-status-warning-text)]">{row.late_minutes > 0 ? `${row.late_minutes} د` : '-'}</td>
              <td className="p-3 font-bold">{formatTime(row.last_check_out)}</td>
              <td className="p-3 font-black text-[var(--dawaa-status-danger-text)]">{row.early_leave_minutes > 0 ? `${row.early_leave_minutes} د` : '-'}</td>
              <td className="p-3"><span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-black', statusClass(row.attendance_status))}>{attendanceLabel(row.attendance_status)}</span></td>
              <td className="p-3">
                {note ? <div className="mb-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">{note}</div> : null}
                {item ? <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5"><span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', meta.cls)}>{meta.label}</span><span className="text-[11px] font-black text-[var(--dawaa-theme-heading)]">{item.raw_events} خام · {item.effective_events} محتسبة{item.duplicate_events ? ` · ${item.duplicate_events} مكررة` : ''}</span></div>
                  {!!item.corrected_type_events && <div className="flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-info-text)]"><Sparkles size={13}/> صحح النظام نوع {item.corrected_type_events} بصمة</div>}
                  {!!item.review_events && <div className="flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={13}/> {item.review_events} بصمة تحتاج مراجعة</div>}
                  <button onClick={() => setExpanded(isOpen ? null : row.staff_id)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--dawaa-theme-border)] px-2 py-1 text-[11px] font-black hover:bg-[var(--dawaa-theme-surface-2)]">{isOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>} {isOpen ? 'إخفاء المسار' : 'تفاصيل البصمات'}</button>
                </div> : <div className="flex items-center gap-1 text-xs font-bold text-[var(--dawaa-theme-muted)]"><Fingerprint size={14}/> {row.biometric_events ? `${row.biometric_events} بصمة — جاري التحليل الذكي` : 'لا توجد بصمات'}</div>}
              </td>
            </tr>
            {isOpen && item && <tr key={`${row.staff_id}-${row.work_date}-intel`} className="border-t border-[var(--dawaa-theme-divider)] bg-[var(--dawaa-theme-surface-2)]"><td colSpan={9} className="p-4">
              <div className="grid gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">أول بصمة محتسبة</div><div className="mt-1 font-black">{formatTime(item.first_effective_at, true)}</div></div>
                <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">آخر بصمة محتسبة</div><div className="mt-1 font-black">{formatTime(item.last_effective_at, true)}</div></div>
                <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">متوسط الثقة</div><div className="mt-1 font-black">{item.avg_confidence == null ? '-' : `${Math.round(Number(item.avg_confidence) * (Number(item.avg_confidence) <= 1 ? 100 : 1))}%`}</div></div>
                <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">القرار</div><div className="mt-1 flex items-center gap-1 font-black">{item.review_events ? <AlertTriangle size={15}/> : <CheckCircle2 size={15}/>} {meta.label}</div></div>
              </div>
              <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface">
                <table className="min-w-full text-xs"><thead><tr className="text-right"><th className="p-2">الوقت</th><th className="p-2">الجهاز قال</th><th className="p-2">النظام فهم</th><th className="p-2">القرار</th><th className="p-2">الثقة</th><th className="p-2">السبب</th><th className="p-2">الجهاز</th></tr></thead><tbody>{(item.timeline || []).map((event) => {
                  const duplicate = event.decision === 'duplicate' || Boolean(event.duplicate_of);
                  const corrected = !duplicate && event.raw_type && event.semantic_type && event.raw_type !== event.semantic_type;
                  return <tr key={event.id} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-2 font-black">{formatTime(event.time, true)}</td><td className="p-2">{punchLabel(event.raw_type)}</td><td className="p-2 font-black">{duplicate ? 'غير محتسبة' : punchLabel(event.semantic_type)}</td><td className="p-2">{duplicate ? <span className="font-black text-[var(--dawaa-status-warning-text)]">تأكيد مكرر</span> : corrected ? <span className="font-black text-[var(--dawaa-status-info-text)]">تصحيح ذكي</span> : <span className="font-black text-[var(--dawaa-status-success-text)]">محتسبة</span>}</td><td className="p-2">{event.confidence == null ? '-' : `${Math.round(Number(event.confidence) * (Number(event.confidence) <= 1 ? 100 : 1))}%`}</td><td className="p-2 font-bold text-[var(--dawaa-theme-muted)]">{reasonLabel(event.reason)}</td><td className="p-2">{event.device_id || '-'}</td></tr>;
                })}{!(item.timeline || []).length && <tr><td colSpan={7} className="p-4 text-center font-bold text-[var(--dawaa-theme-muted)]">لا يوجد مسار تفصيلي متاح.</td></tr>}</tbody></table>
              </div>
            </td></tr>}
          </>;
        })}</tbody>
      </table></div>
    </div>
  </div>;
}
