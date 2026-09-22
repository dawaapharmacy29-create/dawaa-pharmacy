import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Fingerprint,
  Gauge,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type ClientHealth = {
  id: string;
  name: string | null;
  provider: string | null;
  active: boolean;
  last_seen_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_http_status: number | null;
  total_requests: number;
  total_received: number;
  total_accepted: number;
  total_duplicates: number;
  total_rejected: number;
  status: string;
};

type Watermark = {
  provider: string;
  complete_through: string | null;
  reported_at: string | null;
  metadata: Record<string, unknown> | null;
  report_age_minutes: number | null;
  coverage_lag_minutes: number | null;
};

type DeviceHealth = {
  device_id: string;
  provider: string;
  branch: string;
  last_punch_time: string | null;
  last_ingested_at: string | null;
  events_24h: number;
  unmapped_24h: number;
  status: string;
};

type SyncAlert = {
  id: string;
  detected_at: string;
  last_activity_at: string | null;
  minutes_stale: number | null;
  resolved: boolean;
  severity: string | null;
};

type OperationsHealth = {
  checked_at?: string | null;
  status?: string;
  lag_minutes?: number | null;
  latest_activity_at?: string | null;
  latest_punch_time?: string | null;
  latest_ingested_at?: string | null;
  latest_complete_through?: string | null;
  events_today?: number;
  events_24h?: number;
  events_last_hour?: number;
  mapped_24h?: number;
  unmapped_24h?: number;
  distinct_staff_24h?: number;
  clients?: ClientHealth[];
  watermarks?: Watermark[];
  devices?: DeviceHealth[];
  alerts?: SyncAlert[];
};

type BiometricEvent = {
  id: string;
  provider: string | null;
  biometric_user_id: string | null;
  staff_name: string | null;
  branch: string | null;
  punch_time: string | null;
  punch_type: string | null;
  ingested_at: string | null;
  ingestion_lag_seconds: number | null;
  mapping_status: string;
  device_id: string | null;
  total_count: number;
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

type Props = { branches: string[]; defaultBranch?: string };
const PAGE_SIZE = 50;

function cairoDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function cycleStartFor(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const cycleEnd = day >= 26
    ? new Date(Date.UTC(year, month, 25))
    : new Date(Date.UTC(year, month - 1, 25));
  return new Date(Date.UTC(cycleEnd.getUTCFullYear(), cycleEnd.getUTCMonth() - 1, 26))
    .toISOString()
    .slice(0, 10);
}
function formatDateTime(value?: string | null) {
  if (!value) return 'غير مسجل';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Cairo' });
}
function formatTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Africa/Cairo' });
}
function formatLagMinutes(value?: number | null) {
  if (value == null) return '-';
  if (value < 1) return '< دقيقة';
  if (value < 60) return `${Math.round(value)} د`;
  return `${(value / 60).toFixed(1)} س`;
}
function formatLagSeconds(value?: number | null) {
  if (value == null) return '-';
  if (value < 60) return `${Math.round(value)} ث`;
  if (value < 3600) return `${Math.round(value / 60)} د`;
  return `${(value / 3600).toFixed(1)} س`;
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
function statusMeta(status?: string) {
  if (status === 'healthy') return { label: 'متصل وسليم', cls: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]', icon: CheckCircle2 };
  if (status === 'offline') return { label: 'متوقف', cls: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]', icon: WifiOff };
  if (status === 'delayed' || status === 'stale') return { label: 'يوجد تأخير', cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]', icon: Clock };
  return { label: 'غير محدد', cls: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]', icon: ShieldAlert };
}
function intelMeta(status: string) {
  if (status === 'clean') return { label: 'سليم', cls: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' };
  if (status === 'smart_corrected') return { label: 'صححه النظام', cls: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]' };
  if (status === 'needs_review') return { label: 'يحتاج مراجعة', cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]' };
  return { label: 'لا توجد بصمات', cls: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]' };
}

export default function AttendanceSyncCommandCenter({ branches, defaultBranch = 'الكل' }: Props) {
  const [health, setHealth] = useState<OperationsHealth | null>(null);
  const [events, setEvents] = useState<BiometricEvent[]>([]);
  const [intel, setIntel] = useState<DailyIntelRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [intelLoading, setIntelLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [intelDate, setIntelDate] = useState(cairoDate());
  const [mapping, setMapping] = useState('all');
  const today = cairoDate();
  const [search, setSearch] = useState('');
  const [eventStart, setEventStart] = useState(() => cycleStartFor(today));
  const [eventEnd, setEventEnd] = useState(today);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const totalEvents = Number(events[0]?.total_count || 0);
  const pageCount = Math.max(1, Math.ceil(totalEvents / PAGE_SIZE));
  const clients = health?.clients || [];
  const devices = health?.devices || [];
  const alerts = health?.alerts || [];
  const activeAlerts = alerts.filter((a) => !a.resolved);
  const recentlyResolvedAlerts = alerts.filter((a) => a.resolved);
  const watermark = health?.watermarks?.[0] || null;
  const mappedRatio = Number(health?.events_24h || 0) ? Math.round((Number(health?.mapped_24h || 0) / Number(health?.events_24h || 1)) * 1000) / 10 : 0;

  const intelTotals = useMemo(() => intel.reduce((a, r) => ({
    staff: a.staff + 1,
    raw: a.raw + Number(r.raw_events || 0),
    effective: a.effective + Number(r.effective_events || 0),
    duplicates: a.duplicates + Number(r.duplicate_events || 0),
    corrected: a.corrected + Number(r.corrected_type_events || 0),
    review: a.review + Number(r.review_events || 0),
  }), { staff: 0, raw: 0, effective: 0, duplicates: 0, corrected: 0, review: 0 }), [intel]);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('attendance_biometric_operations_v3');
      if (e) throw e;
      setHealth((data || {}) as OperationsHealth);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل حالة البصمة'); }
    finally { setLoading(false); }
  }, []);

  const loadIntel = useCallback(async () => {
    setIntelLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('attendance_daily_intelligence_v2', { p_date: intelDate, p_branch: branch === 'الكل' ? null : branch });
      if (e) throw e;
      setIntel((data || []) as DailyIntelRow[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل التحليل الذكي للبصمات'); }
    finally { setIntelLoading(false); }
  }, [branch, intelDate]);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const { data, error: e } = await supabase.rpc('list_biometric_event_log_v2', {
        p_start: eventStart,
        p_end: eventEnd,
        p_branch: branch === 'الكل' ? null : branch,
        p_mapping_status: mapping === 'all' ? null : mapping,
        p_search: search.trim(), p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE,
      });
      if (e) throw e;
      setEvents((data || []) as BiometricEvent[]);
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل سجل البصمات الخام'); }
    finally { setEventsLoading(false); }
  }, [branch, eventEnd, eventStart, mapping, page, search]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadIntel(); }, [loadIntel]);
  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void loadOverview();
      void loadIntel();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [loadOverview, loadIntel]);
  useEffect(() => { setPage(0); }, [branch, eventEnd, eventStart, mapping, search]);

  const meta = statusMeta(health?.status);
  const StatusIcon = meta.icon;

  return <div className="space-y-5">
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black text-[var(--dawaa-theme-heading)]">مركز البصمة الذكي</h2><span className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-black', meta.cls)}><StatusIcon size={14}/>{meta.label}</span></div><p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">الجهاز يرسل الحدث الخام، والنظام يفسره مع جدول الشيفت ويستبعد بصمات التأكيد المتكررة قبل احتساب الحضور.</p></div>
        <button onClick={() => { setError(null); void loadOverview(); void loadIntel(); void loadEvents(); }} className="btn-primary"><RefreshCw size={16} className={loading || intelLoading || eventsLoading ? 'animate-spin' : ''}/> تحديث الكل</button>
      </div>
      {error && <div className="mt-3 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-black text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
      <Metric icon={Wifi} label="الاتصال" value={meta.label} hint={`تأخير ${formatLagMinutes(health?.lag_minutes)}`} tone={health?.status === 'healthy' ? 'ok' : 'warn'}/>
      <Metric icon={Clock} label="آخر اتصال" value={formatDateTime(health?.latest_activity_at)} hint={clients.find(c => c.status === 'healthy')?.name || '-'}/>
      <Metric icon={Fingerprint} label="آخر بصمة" value={formatDateTime(health?.latest_punch_time)} hint="وقت الجهاز"/>
      <Metric icon={Server} label="آخر رفع" value={formatDateTime(health?.latest_ingested_at)} hint="وصول Supabase"/>
      <Metric icon={Gauge} label="اكتمال المزامنة" value={formatDateTime(health?.latest_complete_through)} hint={`فجوة ${formatLagMinutes(watermark?.coverage_lag_minutes)}`}/>
      <Metric icon={Activity} label="بصمات اليوم" value={Number(health?.events_today || 0).toLocaleString('ar-EG')} hint={`${Number(health?.events_last_hour || 0)} آخر ساعة`}/>
      <Metric icon={CheckCircle2} label="نسبة الربط" value={`${mappedRatio}%`} hint={`${Number(health?.unmapped_24h || 0)} غير مربوط`} tone={Number(health?.unmapped_24h || 0) ? 'warn' : 'ok'}/>
      <Metric icon={Users} label="موظفون نشطون" value={Number(health?.distinct_staff_24h || 0).toLocaleString('ar-EG')} hint="خلال 24 ساعة"/>
    </section>

    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div><div className="flex items-center gap-2"><Sparkles size={20}/><h3 className="text-lg font-black text-[var(--dawaa-theme-heading)]">ذكاء البصمات اليومي</h3></div><p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">يعرض الفرق بين البصمات الخام والبصمات المحتسبة، وتصحيحات دخول/خروج، والبصمات المتكررة، مع سبب القرار ونسبة الثقة.</p></div>
        <div className="flex flex-wrap gap-2"><input type="date" value={intelDate} onChange={e => setIntelDate(e.target.value)} className="input-dark"/><select value={branch} onChange={e => setBranch(e.target.value)} className="input-dark">{branches.map(b => <option key={b}>{b}</option>)}</select></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <MiniMetric label="موظفون لهم بصمة" value={intelTotals.staff}/><MiniMetric label="بصمات خام" value={intelTotals.raw}/><MiniMetric label="محتسبة فعليًا" value={intelTotals.effective}/><MiniMetric label="تأكيد مكرر مستبعد" value={intelTotals.duplicates} warn={intelTotals.duplicates > 0}/><MiniMetric label="تصحيح دخول/خروج" value={intelTotals.corrected} info={intelTotals.corrected > 0}/><MiniMetric label="تحتاج مراجعة" value={intelTotals.review} warn={intelTotals.review > 0}/>
      </div>
      <div className="mt-4 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">الدليل الخام لا يتم حذفه أبدًا. بصمة التأكيد المكررة تظل محفوظة للمراجعة لكنها لا تُحسب مرة ثانية في الحضور أو الساعات أو المرتب.</div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]">
        <table className="dawaa-table-semantic min-w-[1050px] w-full text-sm"><thead><tr><th className="p-3 text-right">الموظف</th><th className="p-3">خام ← محتسب</th><th className="p-3">مكرر</th><th className="p-3">تصحيح النوع</th><th className="p-3">أول فعلي</th><th className="p-3">آخر فعلي</th><th className="p-3">الثقة</th><th className="p-3">الحالة</th><th className="p-3">التفاصيل</th></tr></thead>
          <tbody>{intel.map(row => { const im = intelMeta(row.intelligence_status); const isOpen = expanded === row.staff_id; return <>
            <tr key={row.staff_id} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{row.staff_name}</div><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{row.role || '-'} · {row.branch || '-'}</div></td><td className="p-3 text-center font-black">{row.raw_events} ← {row.effective_events}</td><td className="p-3 text-center font-black text-[var(--dawaa-status-warning-text)]">{row.duplicate_events || '-'}</td><td className="p-3 text-center font-black text-[var(--dawaa-status-info-text)]">{row.corrected_type_events || '-'}</td><td className="p-3 text-center">{formatTime(row.first_effective_at)}</td><td className="p-3 text-center">{formatTime(row.last_effective_at)}</td><td className="p-3 text-center font-black">{row.avg_confidence == null ? '-' : `${Math.round(Number(row.avg_confidence) * 100)}%`}</td><td className="p-3 text-center"><span className={cn('rounded-full border px-2 py-1 text-[11px] font-black', im.cls)}>{im.label}</span></td><td className="p-3 text-center"><button onClick={() => setExpanded(isOpen ? null : row.staff_id)} className="btn-secondary px-2 py-1 text-xs">{isOpen ? <ChevronUp size={14}/> : <ChevronDown size={14}/>} المسار</button></td></tr>
            {isOpen && <tr key={`${row.staff_id}-details`} className="border-t border-[var(--dawaa-theme-divider)] bg-[var(--dawaa-theme-surface-2)]"><td colSpan={9} className="p-4"><div className="space-y-2">{row.timeline.map((ev, i) => <Timeline key={ev.id || i} event={ev} index={i}/>)}</div></td></tr>}
          </>; })}</tbody></table>
        {!intelLoading && !intel.length && <Empty text="لا توجد بصمات في اليوم والنطاق المحددين."/>}
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <Panel title="مصادر الاتصال والـBridge">{clients.map(c => { const cm = statusMeta(c.status); return <div key={c.id} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3"><div className="flex items-center justify-between gap-2"><div><div className="font-black">{c.name || c.provider}</div><div className="text-[11px] text-[var(--dawaa-theme-muted)]">{c.provider} · HTTP {c.last_http_status || '-'}</div></div><span className={cn('rounded-full border px-2 py-1 text-[11px] font-black', cm.cls)}>{cm.label}</span></div><div className="mt-2 grid gap-2 sm:grid-cols-3"><Mini label="آخر نجاح" value={formatDateTime(c.last_success_at)}/><Mini label="آخر اتصال" value={formatDateTime(c.last_seen_at)}/><Mini label="آخر خطأ" value={c.last_error_at ? formatDateTime(c.last_error_at) : 'لا يوجد'}/></div><div className="mt-2 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">الإجماليات التاريخية محفوظة داخليًا ولا تُستخدم كمؤشر تشغيلي.</div></div>})}{!clients.length && <Empty text="لا توجد مصادر تشغيل نشطة."/>}</Panel>
      <Panel title="الأجهزة الفعلية">{devices.map((d, i) => <div key={`${d.device_id}-${i}`} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3"><div className="font-black">جهاز {d.device_id}</div><div className="text-[11px] text-[var(--dawaa-theme-muted)]">{d.branch} · {d.provider}</div><div className="mt-2 grid grid-cols-3 gap-2"><Mini label="آخر بصمة" value={formatDateTime(d.last_punch_time)}/><Mini label="أحداث 24س" value={String(d.events_24h || 0)}/><Mini label="غير مربوط" value={String(d.unmapped_24h || 0)}/></div></div>)}{!devices.length && <Empty text="لا توجد أجهزة نشطة."/>}</Panel>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <Panel title="آخر Watermark">{watermark ? <><InfoRow label="المصدر" value={watermark.provider}/><InfoRow label="مكتمل حتى" value={formatDateTime(watermark.complete_through)}/><InfoRow label="تم الإبلاغ" value={formatDateTime(watermark.reported_at)}/><InfoRow label="آخر دفعة" value={`${Number(watermark.metadata?.received || 0)} مستلم · ${Number(watermark.metadata?.accepted || 0)} مقبول · ${Number(watermark.metadata?.duplicates || 0)} مكرر`}/></> : <Empty text="لا يوجد Watermark."/>}</Panel>
      <Panel title="تنبيهات البصمة الحالية">{activeAlerts.map(a => <div key={a.id} className="rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs"><div className="font-black text-[var(--dawaa-status-danger-text)]">يحتاج تدخل · {a.severity || '-'}</div><div className="mt-1 text-[var(--dawaa-theme-muted)]">{formatDateTime(a.detected_at)} · تأخير {formatLagMinutes(a.minutes_stale)}</div></div>)}{!activeAlerts.length && <Empty text="لا توجد تنبيهات مفتوحة حاليًا."/>}{recentlyResolvedAlerts.length > 0 && <div className="rounded-lg border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-2 text-[10px] font-bold text-[var(--dawaa-status-success-text)]">تم حل {recentlyResolvedAlerts.length.toLocaleString('ar-EG')} تنبيه حديث تلقائيًا ولم يعد يحتاج تدخلك.</div>}</Panel>
    </section>

    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <label className="flex-1 text-xs font-black"><span>بحث بالاسم أو كود البصمة</span><div className="relative mt-1"><Search size={15} className="absolute right-3 top-3"/><input value={search} onChange={e => setSearch(e.target.value)} className="input-dark w-full pr-9" placeholder="اسم الموظف أو كود البصمة"/></div></label>
        <label className="text-xs font-black"><span>من</span><input type="date" value={eventStart} onChange={e => setEventStart(e.target.value)} className="input-dark mt-1"/></label>
        <label className="text-xs font-black"><span>إلى</span><input type="date" value={eventEnd} onChange={e => setEventEnd(e.target.value)} className="input-dark mt-1"/></label>
        <label className="text-xs font-black"><span>الربط</span><select value={mapping} onChange={e => setMapping(e.target.value)} className="input-dark mt-1"><option value="all">الكل</option><option value="mapped">مربوط</option><option value="unmapped">غير مربوط</option></select></label>
      </div>
      <div className="mt-3 rounded-xl border border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-info-text)]">
        السجل يفتح افتراضيًا على الدورة الحالية فقط. غيّر التاريخ عند الحاجة لمراجعة الأرشيف؛ الأرشيف لا يدخل ضمن قائمة العمل اليومية.
      </div>
      <h3 className="mt-4 font-black text-[var(--dawaa-theme-heading)]">السجل الخام للبصمات — الفترة المحددة</h3>
      <div className="mt-2 overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]"><table className="dawaa-table-semantic min-w-[1000px] w-full text-xs"><thead><tr><th>الموظف</th><th>الكود</th><th>الفرع</th><th>نوع الجهاز</th><th>وقت البصمة</th><th>وقت الوصول</th><th>تأخير</th><th>الجهاز/المصدر</th></tr></thead><tbody>{events.map(e => <tr key={e.id} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-2 font-black">{e.staff_name || 'غير مربوط'}</td><td className="p-2">{e.biometric_user_id || '-'}</td><td className="p-2">{e.branch || '-'}</td><td className="p-2">{punchLabel(e.punch_type)}</td><td className="p-2">{formatDateTime(e.punch_time)}</td><td className="p-2">{formatDateTime(e.ingested_at)}</td><td className="p-2">{formatLagSeconds(e.ingestion_lag_seconds)}</td><td className="p-2"><div>{e.device_id || '-'}</div><div className="text-[10px] text-[var(--dawaa-theme-muted)]">{e.provider || '-'}</div></td></tr>)}</tbody></table>{!eventsLoading && !events.length && <Empty text="لا توجد نتائج."/>}</div>
      <div className="mt-3 flex items-center justify-between text-xs font-bold"><span>{totalEvents.toLocaleString('ar-EG')} حدث في الفترة المحددة</span><div className="flex gap-2"><button disabled={page <= 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="btn-secondary px-3 py-1">السابق</button><span className="px-2 py-2">{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)} className="btn-secondary px-3 py-1">التالي</button></div></div>
    </section>
  </div>;
}

function Timeline({ event, index }: { event: TimelineEvent; index: number }) {
  const duplicate = event.decision === 'duplicate';
  const corrected = event.semantic_type && event.raw_type && event.semantic_type !== event.raw_type;
  return <div className={cn('grid gap-2 rounded-xl border p-3 md:grid-cols-[80px_1fr_160px_180px]', duplicate ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]' : corrected ? 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)]' : 'border-[var(--dawaa-theme-border)] dawaa-surface')}>
    <div className="font-black">#{index + 1} · {formatTime(event.time)}</div>
    <div><div className="font-black">{duplicate ? 'تأكيد مكرر — غير محتسب' : corrected ? `الجهاز: ${punchLabel(event.raw_type)} ← النظام: ${punchLabel(event.semantic_type)}` : `${punchLabel(event.semantic_type || event.raw_type)} محتسبة`}</div><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{reasonLabel(event.reason)}</div></div>
    <div className="text-xs font-black">الثقة: {event.confidence == null ? '-' : `${Math.round(Number(event.confidence) * 100)}%`}</div>
    <div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{event.device_id || '-'} · {event.provider || '-'}</div>
  </div>;
}
function Metric({ icon: Icon, label, value, hint, tone }: { icon: any; label: string; value: string; hint?: string; tone?: 'ok'|'warn'|'bad' }) { return <div className={cn('rounded-2xl border p-3 shadow-sm', tone === 'ok' ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]' : tone === 'bad' ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]' : 'border-[var(--dawaa-theme-border)] dawaa-surface')}><div className="flex items-center gap-2 text-[11px] font-black text-[var(--dawaa-theme-muted)]"><Icon size={15}/>{label}</div><div className="mt-2 break-words text-sm font-black text-[var(--dawaa-theme-heading)]">{value}</div>{hint && <div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{hint}</div>}</div> }
function MiniMetric({ label, value, warn, info }: { label: string; value: number; warn?: boolean; info?: boolean }) { return <div className={cn('rounded-xl border p-3', warn ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]' : info ? 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)]' : 'border-[var(--dawaa-theme-border)] dawaa-surface-soft')}><div className="text-[10px] font-black text-[var(--dawaa-theme-muted)]">{label}</div><div className="mt-1 text-xl font-black">{Number(value || 0).toLocaleString('ar-EG')}</div></div> }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-[var(--dawaa-theme-border)] p-2"><div className="text-[9px] font-black text-[var(--dawaa-theme-muted)]">{label}</div><div className="mt-1 break-words text-[11px] font-black">{value}</div></div> }
function Panel({ title, children }: { title: string; children: React.ReactNode }) { return <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm"><h3 className="mb-3 font-black text-[var(--dawaa-theme-heading)]">{title}</h3><div className="space-y-2">{children}</div></div> }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-3 border-b border-[var(--dawaa-theme-divider)] py-2 text-xs"><span className="font-bold text-[var(--dawaa-theme-muted)]">{label}</span><span className="text-left font-black">{value}</span></div> }
function Empty({ text }: { text: string }) { return <div className="p-5 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">{text}</div> }
