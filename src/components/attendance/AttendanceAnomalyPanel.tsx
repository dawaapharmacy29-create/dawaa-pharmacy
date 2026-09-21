import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Fingerprint, MapPin, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
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

type Props = { rows: DailyCommandRow[]; intel: DailyIntelRow[]; loading: boolean; onRefresh: () => void };
type Severity = 'critical' | 'high' | 'medium' | 'info';
type Filter = 'all' | 'critical' | 'review' | 'single' | 'corrected' | 'duplicate' | 'cross_branch';

type Anomaly = {
  staffId: string;
  staffName: string;
  branch: string;
  severity: Severity;
  score: number;
  title: string;
  reasons: string[];
  tags: string[];
  item?: DailyIntelRow;
  row: DailyCommandRow;
};

function pct(value?: number | null) {
  if (value == null) return null;
  const n = Number(value);
  return Math.round(n <= 1 ? n * 100 : n);
}

function formatTime(value?: string | null) {
  if (!value) return '-';
  if (/^\d{2}:\d{2}/.test(value)) return value.slice(0, 5);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 5) : d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Cairo' });
}

function typeLabel(value?: string | null) {
  if (value === 'check_in' || value === 'in') return 'دخول';
  if (value === 'check_out' || value === 'out') return 'خروج';
  if (value === 'unknown' || !value) return 'غير محدد';
  return value;
}

const REASON_LABELS: Record<string, string> = {
  no_matching_schedule_fallback_to_raw: 'البصمة خارج نطاق أي شيفت مجدول لهذا اليوم — لم يقدر النظام يربطها بدخول أو خروج',
  duplicate_confirmation_window: 'بصمة تأكيد متقاربة جدًا من بصمة سابقة (خلال دقيقتين تقريبًا)',
  matched_shift_start_window: 'قريبة من وقت بداية الشيفت المجدول',
  matched_shift_end_window: 'قريبة من وقت نهاية الشيفت المجدول',
  overnight_shift_previous_day: 'بصمة بعد منتصف الليل تخص شيفت اليوم السابق (شيفت ليلي)',
  low_confidence_ambiguous_position: 'موقع البصمة الزمني غامض ومش قريب بوضوح من بداية أو نهاية الشيفت',
};

function reasonLabel(value?: string | null) {
  if (!value) return 'بدون سبب مسجل';
  return REASON_LABELS[value] || value;
}

function severityMeta(severity: Severity) {
  if (severity === 'critical') return { label: 'حرج', cls: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' };
  if (severity === 'high') return { label: 'مهم', cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' };
  if (severity === 'medium') return { label: 'مراجعة', cls: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]' };
  return { label: 'معلومة', cls: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]' };
}

function analyze(row: DailyCommandRow, item?: DailyIntelRow): Anomaly | null {
  const reasons: string[] = [];
  const tags: string[] = [];
  let score = 0;
  const confidence = pct(item?.avg_confidence);
  const status = row.attendance_status;
  const isInProgress = ['working_now', 'shift_in_progress', 'scheduled', 'sync_pending', 'sync_pending_checkout', 'sync_pending_verification'].includes(status);

  if (['missing_checkin', 'missing_checkout', 'invalid_duration', 'punch_without_valid_schedule', 'needs_event_review', 'schedule_conflict', 'schedule_missing'].includes(status)) {
    score += 45;
    reasons.push('حالة الحضور نفسها تحتاج مراجعة قبل أي احتساب مالي أو إداري.');
    tags.push('review');
  }
  if (['absent', 'not_arrived'].includes(status) && !row.approved_exception_type) {
    score += 35;
    reasons.push('لا توجد بصمة حضور مكتملة رغم وجود متابعة للشيفت.');
    tags.push('review');
  }
  if (item) {
    if (item.review_events > 0) {
      score += 50;
      reasons.push(`${item.review_events} بصمة لم يستطع النظام حسمها بثقة كافية.`);
      tags.push('review');
    }
    if (item.effective_events === 1 && !isInProgress && row.schedule_status !== 'off') {
      score += 38;
      reasons.push('يوجد حدث فعلي واحد فقط؛ لا يجوز افتراض أنه دخول وخروج معًا.');
      tags.push('single');
    }
    if (item.corrected_type_events > 0) {
      score += confidence != null && confidence < 80 ? 38 : 18;
      reasons.push(`النظام صحح نوع ${item.corrected_type_events} بصمة بدلًا من الاعتماد على نوع الجهاز.`);
      tags.push('corrected');
    }
    if (item.duplicate_events > 0) {
      score += 8;
      reasons.push(`${item.duplicate_events} بصمة تأكيد متقاربة تم استبعادها من الحساب مع الاحتفاظ بها كسجل خام.`);
      tags.push('duplicate');
    }
    if (confidence != null && confidence < 70) {
      score += 35;
      reasons.push(`متوسط ثقة التفسير منخفض (${confidence}%).`);
      tags.push('review');
    } else if (confidence != null && confidence < 85) {
      score += 18;
      reasons.push(`متوسط الثقة ${confidence}% ويستحق مراجعة عند وجود قرائن أخرى.`);
    }

    const crossBranchEvents = (item.timeline || []).filter((e) => Boolean(e.cross_branch));
    if (crossBranchEvents.length > 0) {
      const branches = Array.from(new Set(crossBranchEvents.map((e) => e.source_branch).filter(Boolean)));
      reasons.push(`بصم في فرع آخر: ${branches.join('، ')} — معلومة رقابية فقط ولا تمنع احتساب الحضور.`);
      tags.push('cross_branch');
    }

    const effective = (item.timeline || []).filter((e) => e.decision !== 'duplicate' && !e.duplicate_of && e.semantic_type);
    const hasIn = effective.some((e) => ['check_in', 'in'].includes(String(e.semantic_type)));
    const hasOut = effective.some((e) => ['check_out', 'out'].includes(String(e.semantic_type)));
    if (effective.length >= 1 && !hasIn && hasOut && !isInProgress) {
      score += 45;
      reasons.push('المسار الفعلي يحتوي خروجًا بدون دخول مؤكد.');
      tags.push('review');
    }
    if (effective.length >= 2 && hasIn && !hasOut && !isInProgress) {
      score += 35;
      reasons.push('يوجد دخول مؤكد بدون خروج مؤكد بعد انتهاء الشيفت.');
      tags.push('review');
    }
  } else if (row.biometric_events > 0) {
    score += 15;
    reasons.push('توجد بصمات خام لكن التحليل الدلالي لم يصل بعد؛ لا تعتمد قرارًا نهائيًا الآن.');
  }

  if (!reasons.length) return null;
  const severity: Severity = score >= 80 ? 'critical' : score >= 45 ? 'high' : score >= 20 ? 'medium' : 'info';
  const title = score >= 80 ? 'يحتاج تدخل قبل الاعتماد' : score >= 45 ? 'حالة تستحق المراجعة' : score >= 20 ? 'ملاحظة ذكية' : 'معلومة رقابية';
  return { staffId: row.staff_id, staffName: row.staff_name, branch: row.branch || '-', severity, score, title, reasons, tags: Array.from(new Set(tags)), item, row };
}

export default function AttendanceAnomalyPanel({ rows, intel, loading, onRefresh }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const map = useMemo(() => new Map(intel.map((x) => [x.staff_id, x])), [intel]);
  const anomalies = useMemo(() => rows.map((row) => analyze(row, map.get(row.staff_id))).filter(Boolean).sort((a, b) => (b!.score - a!.score)) as Anomaly[], [rows, map]);
  const filtered = useMemo(() => anomalies.filter((a) => {
    if (filter === 'all') return true;
    if (filter === 'critical') return a.severity === 'critical' || a.severity === 'high';
    return a.tags.includes(filter);
  }), [anomalies, filter]);

  const totals = useMemo(() => ({
    urgent: anomalies.filter((a) => a.severity === 'critical').length,
    important: anomalies.filter((a) => a.severity === 'high').length,
    review: anomalies.filter((a) => a.tags.includes('review')).length,
    single: anomalies.filter((a) => a.tags.includes('single')).length,
    corrected: anomalies.filter((a) => a.tags.includes('corrected')).length,
    duplicate: anomalies.filter((a) => a.tags.includes('duplicate')).length,
    crossBranch: anomalies.filter((a) => a.tags.includes('cross_branch')).length,
  }), [anomalies]);

  return <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
      <button onClick={() => setCollapsed((c) => !c)} className="flex flex-1 items-start gap-2 text-right"><ShieldAlert size={20} className="mt-0.5 text-[var(--dawaa-status-warning-text)]"/><div><h2 className="flex items-center gap-1.5 font-black text-[var(--dawaa-theme-heading)]">رادار الحالات غير الطبيعية {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}{anomalies.length > 0 && <span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-2 py-0.5 text-[11px] text-[var(--dawaa-status-warning-text)]">{anomalies.length} حالة تحتاج انتباه</span>}</h2><p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">يرتب الحالات التي تستحق انتباه المدير أولًا. لا يحذف الـRaw ولا ينشئ خصمًا تلقائيًا؛ هو طبقة تفسير ومراجعة قبل الاعتماد.</p></div></button>
      <button onClick={onRefresh} className="btn-secondary"><RefreshCw size={15} className={loading ? 'animate-spin' : ''}/> تحديث الرادار</button>
    </div>

    {!collapsed && <>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
      <RadarMetric label="حرجة" value={totals.urgent} tone="bad" />
      <RadarMetric label="مهمة" value={totals.important} tone="warn" />
      <RadarMetric label="تحتاج مراجعة" value={totals.review} tone="warn" />
      <RadarMetric label="بصمة واحدة" value={totals.single} />
      <RadarMetric label="تصحيح ذكي" value={totals.corrected} />
      <RadarMetric label="تأكيدات مكررة" value={totals.duplicate} />
      <RadarMetric label="بصم في فرع آخر" value={totals.crossBranch} />
    </div>

    <div className="mt-3 flex flex-wrap gap-2">
      {([['all','الكل'],['critical','الأهم أولًا'],['review','تحتاج مراجعة'],['single','بصمة واحدة'],['corrected','تصحيح دخول/خروج'],['duplicate','تكرار سريع'],['cross_branch','بصم في فرع آخر']] as Array<[Filter,string]>).map(([key,label]) => <button key={key} onClick={() => setFilter(key)} className={cn('rounded-full border px-3 py-1 text-[11px] font-black transition', filter === key ? 'border-[var(--dawaa-theme-primary)] bg-[var(--dawaa-theme-primary)] text-white' : 'border-[var(--dawaa-theme-border)] hover:bg-[var(--dawaa-theme-surface-2)]')}>{label}</button>)}
    </div>

    <div className="mt-4 space-y-2">
      {!loading && !filtered.length && <div className="rounded-xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-4 text-sm font-black text-[var(--dawaa-status-success-text)]"><CheckCircle2 size={17} className="ml-1 inline"/> لا توجد حالات ضمن الفلتر الحالي تحتاج تصعيدًا.</div>}
      {filtered.slice(0, 20).map((a) => {
        const meta = severityMeta(a.severity);
        const open = expanded === a.staffId;
        const confidence = pct(a.item?.avg_confidence);
        return <div key={a.staffId} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-2"><span className={cn('rounded-full border px-2 py-1 text-[10px] font-black', meta.cls)}>{meta.label} · {a.score}</span><div><div className="font-black text-[var(--dawaa-theme-heading)]">{a.staffName} <span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">· {a.branch}</span></div><div className="mt-0.5 text-xs font-black text-[var(--dawaa-theme-text)]">{a.title}</div></div></div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold"><span>الشيفت {formatTime(a.row.shift_start)} ← {formatTime(a.row.shift_end)}</span>{a.item && <span>{a.item.raw_events} خام / {a.item.effective_events} محتسبة</span>}{confidence != null && <span>ثقة {confidence}%</span>}<button onClick={() => setExpanded(open ? null : a.staffId)} className="inline-flex items-center gap-1 rounded-lg border border-[var(--dawaa-theme-border)] px-2 py-1 font-black">{open ? <ChevronUp size={13}/> : <ChevronDown size={13}/>} التفاصيل</button></div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">{a.reasons.slice(0, 2).map((reason) => <span key={reason} className="rounded-lg border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-2 py-1 text-[11px] font-bold">{reason}</span>)}</div>
          {open && <div className="mt-3 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-3">
            <div className="space-y-1 text-xs font-bold text-[var(--dawaa-theme-text)]">{a.reasons.map((reason) => <div key={reason} className="flex gap-2"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--dawaa-status-warning-text)]"/><span>{reason}</span></div>)}</div>
            {!!a.item?.timeline?.length && <div className="mt-3 overflow-x-auto"><table className="min-w-full text-[11px]"><thead><tr className="text-right"><th className="p-2">الوقت</th><th className="p-2">نوع البصمة</th><th className="p-2">الجهاز</th><th className="p-2">مكان البصمة</th><th className="p-2">التفسير</th><th className="p-2">القرار</th><th className="p-2">الثقة</th></tr></thead><tbody>{a.item.timeline.map((event) => { const duplicate = event.decision === 'duplicate' || Boolean(event.duplicate_of); const corrected = !duplicate && event.raw_type && event.semantic_type && event.raw_type !== event.semantic_type; return <tr key={event.id} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-2 font-black">{formatTime(event.time)}</td><td className="p-2">{typeLabel(duplicate ? event.raw_type : event.semantic_type || event.raw_type)}</td><td className="p-2 text-[var(--dawaa-theme-muted)]">{event.device_id || '-'}</td><td className="p-2">{event.cross_branch ? <span className="inline-flex items-center gap-1 rounded-full border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] px-2 py-0.5 font-black text-[var(--dawaa-status-info-text)]"><MapPin size={11}/>{event.source_branch || '-'}</span> : (event.source_branch || '-')}</td><td className="p-2 max-w-[220px] whitespace-normal text-[var(--dawaa-theme-muted)]">{reasonLabel(event.reason)}</td><td className="p-2">{duplicate ? 'تأكيد مكرر' : corrected ? 'تصحيح ذكي' : 'محتسبة'}</td><td className="p-2">{pct(event.confidence) == null ? '-' : `${pct(event.confidence)}%`}</td></tr>; })}</tbody></table></div>}
          </div>}
        </div>;
      })}
    </div>
    </>}
  </section>;
}

function RadarMetric({ label, value, tone }: { label: string; value: number; tone?: 'bad' | 'warn' }) {
  const cls = tone === 'bad' ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' : tone === 'warn' ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-heading)]';
  return <div className={cn('rounded-xl border p-3', cls)}><div className="text-[10px] font-bold">{label}</div><div className="mt-1 flex items-center gap-1 text-xl font-black"><Fingerprint size={16}/>{value.toLocaleString('ar-EG')}</div></div>;
}
