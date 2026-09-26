import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bike, CheckCircle2, ChevronDown, ChevronUp, Fingerprint, LayoutGrid, MapPin, RefreshCw, Sparkles, Stethoscope, Users2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import AttendanceAnomalyPanel from '@/components/attendance/AttendanceAnomalyPanel';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EmployeeProfileDrawer from '@/components/attendance/EmployeeProfileDrawer';

type RoleGroup = 'الكل' | 'دكاترة وصيادلة' | 'دليفري' | 'باقي الفريق';

function roleGroupOf(role: string | null): Exclude<RoleGroup, 'الكل'> {
  if (role === 'توصيل') return 'دليفري';
  if (role === 'صيدلاني' || role === 'pharmacist') return 'دكاترة وصيادلة';
  return 'باقي الفريق';
}

const ROLE_GROUP_ICON: Record<RoleGroup, typeof Bike> = {
  'الكل': LayoutGrid,
  'دكاترة وصيادلة': Stethoscope,
  'دليفري': Bike,
  'باقي الفريق': Users2,
};

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
  source_branch?: string | null;
  home_branch?: string | null;
  cross_branch?: boolean;
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

type Props = { rows: DailyCommandRow[]; date: string; branch: string; preloadedIntel?: DailyIntelRow[] | null };

function formatTime(value?: string | null, withSeconds = false) {
  if (!value) return '-';
  if (/^\d{2}:\d{2}/.test(value)) return withSeconds ? value.slice(0, 8) : value.slice(0, 5);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, withSeconds ? 8 : 5);
  return d.toLocaleTimeString('ar-EG', {
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    timeZone: 'Africa/Cairo',
  });
}

function confidencePct(value?: number | null) {
  if (value == null) return null;
  const n = Number(value);
  return Math.round(n <= 1 ? n * 100 : n);
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

export default function SmartDailyCommandTable({ rows, date, branch, preloadedIntel }: Props) {
  const [intel, setIntel] = useState<DailyIntelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<RoleGroup>('الكل');
  const [profileStaffId, setProfileStaffId] = useState<string | null>(null);

  const groupCounts = useMemo(() => {
    const counts: Record<RoleGroup, number> = { 'الكل': rows.length, 'دكاترة وصيادلة': 0, 'دليفري': 0, 'باقي الفريق': 0 };
    for (const row of rows) counts[roleGroupOf(row.role)] += 1;
    return counts;
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (activeGroup === 'الكل') return rows;
    return rows.filter((row) => roleGroupOf(row.role) === activeGroup);
  }, [rows, activeGroup]);

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

  useEffect(() => {
    if (preloadedIntel) {
      setIntel(preloadedIntel);
      setError(null);
      return;
    }
    void loadIntel();
  }, [loadIntel, preloadedIntel]);
  useEffect(() => {
    const id = window.setInterval(() => { if (!document.hidden) void loadIntel(); }, 90_000);
    return () => window.clearInterval(id);
  }, [loadIntel]);

  const intelMap = useMemo(() => new Map(intel.map((item) => [item.staff_id, item])), [intel]);
  const reviewCount = useMemo(() => intel.reduce((sum, item) => sum + Number(item.review_events || 0), 0), [intel]);
  const crossBranchStaff = useMemo(() => intel.filter((item) =>
    (item.timeline || []).some((event) => Boolean(event.cross_branch))
  ).length, [intel]);

  return <div className="space-y-3">
    <AttendanceAnomalyPanel rows={rows} intel={intel} loading={loading} onRefresh={() => void loadIntel()} />

    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--dawaa-theme-muted)]"><Sparkles size={15} className="text-[var(--dawaa-theme-primary-strong)]"/> ذكاء البصمة مدمج في الجدول أدناه{!!reviewCount && <span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-2 py-0.5 font-black text-[var(--dawaa-status-danger-text)]">{reviewCount} بصمة تحتاج مراجعة اليوم</span>}{crossBranchStaff > 0 && <span className="rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-2 py-0.5 font-black text-[var(--dawaa-status-info-text)]"><MapPin size={12} className="ml-1 inline"/>{crossBranchStaff} موظف بصم في فرع آخر</span>}</div>
      <button onClick={() => void loadIntel()} className="btn-secondary px-2 py-1 text-xs"><RefreshCw size={13} className={loading ? 'animate-spin' : ''}/> تحديث الذكاء</button>
    </div>
    {error && <div className="rounded-lg border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-2 text-xs font-bold text-[var(--dawaa-status-danger-text)]">⚠️ {error} — جدول الحضور الأساسي ما زال ظاهرًا بدون تعطيل.</div>}

    <Tabs value={activeGroup} onValueChange={(v) => setActiveGroup(v as RoleGroup)} dir="rtl">
      <TabsList className="h-auto flex-wrap justify-start gap-1.5 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] p-1.5">
        {(['الكل', 'دكاترة وصيادلة', 'دليفري', 'باقي الفريق'] as RoleGroup[]).map((group) => {
          const Icon = ROLE_GROUP_ICON[group];
          return <TabsTrigger key={group} value={group} className="gap-1.5 rounded-xl px-3 py-2 font-black text-[var(--dawaa-theme-muted)] data-[state=active]:bg-[var(--dawaa-theme-primary)] data-[state=active]:text-white data-[state=active]:shadow-md">
            <Icon size={15} /> {group} <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px]">{groupCounts[group]}</span>
          </TabsTrigger>;
        })}
      </TabsList>
    </Tabs>

    <div className="overflow-hidden rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface shadow-sm">
      <div className="overflow-x-auto"><table className="dawaa-table-semantic min-w-full text-sm">
        <thead><tr className="text-right"><th className="p-3">الموظف</th><th className="p-3">الفرع</th><th className="p-3">الشيفت</th><th className="p-3">الدخول</th><th className="p-3">التأخير</th><th className="p-3">الخروج</th><th className="p-3">خروج مبكر</th><th className="p-3">الحالة</th><th className="min-w-[250px] p-3">ملاحظة ذكية</th></tr></thead>
        <tbody>{visibleRows.map((row) => {
          const item = intelMap.get(row.staff_id);
          const meta = intelMeta(item?.intelligence_status);
          const isOpen = expanded === row.staff_id;
          const punchBranches = Array.from(new Set((item?.timeline || []).map((event) => event.source_branch).filter(Boolean))) as string[];
          const crossBranches = punchBranches.filter((sourceBranch) => String(sourceBranch).trim() !== String(row.branch || '').trim());
          const hasCrossBranch = crossBranches.length > 0;
          const note = row.approved_exception_type
            ? `${row.approved_exception_type}${row.approved_exception_reason ? ` — ${row.approved_exception_reason}` : ''}`
            : row.schedule_status === 'conflict'
              ? 'لا يتم احتساب جزاء حتى تصحيح الجدول'
              : null;
          return <Fragment key={`${row.staff_id}-${row.work_date}`}>
            <tr className={cn('border-t border-[var(--dawaa-theme-divider)] align-top', hasCrossBranch && 'bg-[var(--dawaa-status-info-bg)]/40')}>
              <td className="p-3 font-black text-[var(--dawaa-theme-heading)]"><button onClick={() => setProfileStaffId(row.staff_id)} className="text-right hover:underline hover:text-[var(--dawaa-theme-primary-strong)]">{row.staff_name}</button><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{row.role || '-'}</div></td>
              <td className="p-3">
                <div className="font-bold">{row.branch || '-'}</div>
                {hasCrossBranch && <div className="mt-1 flex flex-wrap gap-1">{crossBranches.map((sourceBranch) => <span key={sourceBranch} className="inline-flex items-center gap-1 rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-2 py-0.5 text-[10px] font-black text-[var(--dawaa-status-info-text)]"><MapPin size={11}/> بصم في {sourceBranch}</span>)}</div>}
              </td>
              <td className="p-3 font-bold">{row.schedule_status === 'off' ? 'إجازة' : row.shift_start && row.shift_end ? `${formatTime(row.shift_start)} ← ${formatTime(row.shift_end)}` : row.schedule_status === 'conflict' ? 'تعارض' : 'غير مكتمل'}</td>
              <td className="p-3 font-bold">{formatTime(row.first_check_in)}</td>
              <td className="p-3 font-black text-[var(--dawaa-status-warning-text)]">{row.late_minutes > 0 ? `${row.late_minutes} د` : '-'}</td>
              <td className="p-3 font-bold">{formatTime(row.last_check_out)}</td>
              <td className="p-3 font-black text-[var(--dawaa-status-danger-text)]">{row.early_leave_minutes > 0 ? `${row.early_leave_minutes} د` : '-'}</td>
              <td className="p-3"><span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-black', statusClass(row.attendance_status))}>{attendanceLabel(row.attendance_status)}</span></td>
              <td className="p-3">
                {note && <div className="mb-2 text-xs font-bold text-[var(--dawaa-theme-muted)]">{note}</div>}
                {item ? <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5"><span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-black', meta.cls)}>{meta.label}</span><span className="text-[11px] font-black text-[var(--dawaa-theme-heading)]">{item.raw_events} خام · {item.effective_events} محتسبة{item.duplicate_events ? ` · ${item.duplicate_events} مكررة` : ''}</span></div>
                  {!!item.corrected_type_events && <div className="flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-info-text)]"><Sparkles size={13}/> صحح النظام نوع {item.corrected_type_events} بصمة</div>}
                  {!!item.review_events && <div className="flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-warning-text)]"><AlertTriangle size={13}/> {item.review_events} بصمة تحتاج مراجعة</div>}
                  {hasCrossBranch && <div className="flex items-center gap-1 text-[11px] font-black text-[var(--dawaa-status-info-text)]"><MapPin size={13}/> البصمة من فرع آخر — تُحتسب طبيعيًا مع تمييز مكانها</div>}
                  <button onClick={() => setExpanded(isOpen ? null : row.staff_id)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--dawaa-theme-border)] px-2 py-1 text-[11px] font-black hover:bg-[var(--dawaa-theme-surface-2)]">{isOpen ? <ChevronUp size={13}/> : <ChevronDown size={13}/>} {isOpen ? 'إخفاء المسار' : 'تفاصيل البصمات'}</button>
                </div> : <div className="flex items-center gap-1 text-xs font-bold text-[var(--dawaa-theme-muted)]"><Fingerprint size={14}/> {row.biometric_events ? `${row.biometric_events} بصمة — جاري التحليل الذكي` : 'لا توجد بصمات'}</div>}
              </td>
            </tr>
            {isOpen && item && <tr className="border-t border-[var(--dawaa-theme-divider)] bg-[var(--dawaa-theme-surface-2)]"><td colSpan={9} className="p-4">
              <div className="grid gap-3 lg:grid-cols-4">
                <IntelCard label="أول بصمة محتسبة" value={formatTime(item.first_effective_at, true)} />
                <IntelCard label="آخر بصمة محتسبة" value={formatTime(item.last_effective_at, true)} />
                <IntelCard label="متوسط الثقة" value={confidencePct(item.avg_confidence) == null ? '-' : `${confidencePct(item.avg_confidence)}%`} />
                <IntelCard label="القرار" value={<span className="flex items-center gap-1">{item.review_events ? <AlertTriangle size={15}/> : <CheckCircle2 size={15}/>} {meta.label}</span>} />
              </div>
              <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface">
                <table className="min-w-full text-xs"><thead><tr className="text-right"><th className="p-2">الوقت</th><th className="p-2">الجهاز قال</th><th className="p-2">النظام فهم</th><th className="p-2">القرار</th><th className="p-2">الثقة</th><th className="p-2">السبب</th><th className="p-2">مكان البصمة</th><th className="p-2">الجهاز</th></tr></thead><tbody>{(item.timeline || []).map((event) => {
                  const duplicate = event.decision === 'duplicate' || Boolean(event.duplicate_of);
                  const corrected = !duplicate && event.raw_type && event.semantic_type && event.raw_type !== event.semantic_type;
                  return <tr key={event.id} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-2 font-black">{formatTime(event.time, true)}</td><td className="p-2">{punchLabel(event.raw_type)}</td><td className="p-2 font-black">{duplicate ? 'غير محتسبة' : punchLabel(event.semantic_type)}</td><td className="p-2">{duplicate ? <span className="font-black text-[var(--dawaa-status-warning-text)]">تأكيد مكرر</span> : corrected ? <span className="font-black text-[var(--dawaa-status-info-text)]">تصحيح ذكي</span> : <span className="font-black text-[var(--dawaa-status-success-text)]">محتسبة</span>}</td><td className="p-2">{confidencePct(event.confidence) == null ? '-' : `${confidencePct(event.confidence)}%`}</td><td className="p-2 font-bold text-[var(--dawaa-theme-muted)]">{reasonLabel(event.reason)}</td><td className="p-2">{event.cross_branch ? <span className="inline-flex items-center gap-1 rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-2 py-0.5 font-black text-[var(--dawaa-status-info-text)]"><MapPin size={11}/>{event.source_branch || '-'}</span> : (event.source_branch || row.branch || '-')}</td><td className="p-2">{event.device_id || '-'}</td></tr>;
                })}{!(item.timeline || []).length && <tr><td colSpan={8} className="p-4 text-center font-bold text-[var(--dawaa-theme-muted)]">لا يوجد مسار تفصيلي متاح.</td></tr>}</tbody></table>
              </div>
            </td></tr>}
          </Fragment>;
        })}{!visibleRows.length && <tr><td colSpan={9} className="p-6 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">لا يوجد موظفون ضمن "{activeGroup}" لهذا اليوم/الفرع.</td></tr>}</tbody>
      </table></div>
    </div>
    {profileStaffId && <EmployeeProfileDrawer staffId={profileStaffId} onClose={() => setProfileStaffId(null)} />}
  </div>;
}

function IntelCard({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div><div className="mt-1 font-black">{value}</div></div>;
}
