import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Database, Fingerprint, RefreshCw, Search, ShieldAlert, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type StreamHealth = {
  stream?: string;
  source_system?: string;
  source_entity?: string;
  status?: string;
  heartbeat_age_seconds?: number | null;
  total_canonical?: number;
  total_synced?: number;
  total_raw?: number;
  inbox_pending?: number;
  inbox_failed?: number;
  matched?: number;
  ambiguous?: number;
  unmatched?: number;
  mapping_rate?: number;
  mapped?: number;
  unmapped?: number;
  last_seen_at?: string | null;
  last_source_updated_at?: string | null;
  inbox_last_received?: string | null;
  inbox_last_processed?: string | null;
  last_record_synced_at?: string | null;
  last_reconcile_at?: string | null;
  last_run_status?: string | null;
  last_run_error?: string | null;
  last_punch_time?: string | null;
  last_ingested_at?: string | null;
  last_client_seen_at?: string | null;
  complete_through?: string | null;
};

type UnifiedHealth = {
  generated_at?: string;
  overall_status?: string;
  streams?: StreamHealth[];
};

type SyncAlert = {
  id: string;
  detected_at: string;
  sync_name: string;
  last_activity_at: string | null;
  minutes_stale: number | null;
  severity: string | null;
  resolved: boolean;
  resolved_at: string | null;
  details: Record<string, unknown> | null;
};

type BiometricEvent = {
  id: string;
  provider: string | null;
  external_event_id: string | null;
  biometric_user_id: string | null;
  staff_id: string | null;
  staff_name: string | null;
  branch: string | null;
  punch_time: string | null;
  punch_type: string | null;
  ingested_at: string | null;
  ingestion_lag_seconds: number | null;
  mapping_status: 'mapped' | 'unmapped' | string;
  device_id: string | null;
  total_count: number;
};

type Props = {
  branches: string[];
  defaultBranch?: string;
};

const PAGE_SIZE = 50;

function formatDateTime(value?: string | null) {
  if (!value) return 'غير مسجل';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Cairo' });
}

function formatLag(seconds?: number | null) {
  if (seconds == null) return '-';
  if (seconds < 60) return `${seconds} ث`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} د`;
  return `${(seconds / 3600).toFixed(1)} س`;
}

function streamTitle(stream?: string) {
  if (stream === 'customer_orders') return 'طلبات العملاء';
  if (stream === 'purchase_invoices') return 'فواتير المشتريات';
  if (stream === 'biometrics') return 'البصمات';
  return stream || 'مسار غير معروف';
}

function streamIcon(stream?: string) {
  if (stream === 'biometrics') return Fingerprint;
  if (stream === 'purchase_invoices') return Database;
  return Activity;
}

function healthStyle(status?: string) {
  if (status === 'healthy') return { label: 'سليم', cls: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]', icon: CheckCircle2 };
  if (status === 'delayed') return { label: 'متأخر', cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]', icon: Clock };
  if (status === 'offline') return { label: 'متوقف', cls: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]', icon: XCircle };
  return { label: 'غير محدد', cls: 'border-[var(--dawaa-status-info-border)] bg-[var(--dawaa-status-info-bg)] text-[var(--dawaa-status-info-text)]', icon: ShieldAlert };
}

function nextAction(stream: StreamHealth) {
  if (stream.status === 'healthy') return 'لا يوجد إجراء مطلوب الآن.';
  if (stream.stream === 'biometrics') return 'راجع Windows Fingerprint Agent والجهاز الرئيسي واتصال الإنترنت ثم تأكد من تحديث الـWatermark.';
  if (stream.stream === 'customer_orders') return 'راجع Base44 Outbox والـ5-minute reconciliation وتأكد من عدم وجود pending/failed events.';
  if (stream.stream === 'purchase_invoices') return 'راجع آخر reconciliation وحالة آخر run وأي unmatched أو خطأ مزامنة.';
  return 'راجع مصدر المزامنة وآخر heartbeat.';
}

export default function AttendanceSyncCommandCenter({ branches, defaultBranch = 'الكل' }: Props) {
  const [health, setHealth] = useState<UnifiedHealth | null>(null);
  const [alerts, setAlerts] = useState<SyncAlert[]>([]);
  const [events, setEvents] = useState<BiometricEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState(defaultBranch || 'الكل');
  const [mapping, setMapping] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const totalEvents = Number(events[0]?.total_count || 0);
  const pageCount = Math.max(1, Math.ceil(totalEvents / PAGE_SIZE));

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthResult, alertsResult] = await Promise.all([
        supabase.rpc('integration_sync_health_v1'),
        supabase.rpc('list_sync_health_alerts_v1', { p_limit: 20 }),
      ]);
      if (healthResult.error) throw healthResult.error;
      if (alertsResult.error) throw alertsResult.error;
      setHealth((healthResult.data || {}) as UnifiedHealth);
      setAlerts((alertsResult.data || []) as SyncAlert[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل مركز المزامنة');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const { data, error: eventError } = await supabase.rpc('list_biometric_event_log_v1', {
        p_branch: branch === 'الكل' ? null : branch,
        p_mapping_status: mapping === 'all' ? null : mapping,
        p_search: search.trim(),
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      });
      if (eventError) throw eventError;
      setEvents((data || []) as BiometricEvent[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل سجل البصمات');
    } finally {
      setEventsLoading(false);
    }
  }, [branch, mapping, page, search]);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadEvents(); }, [loadEvents]);
  useEffect(() => {
    const id = window.setInterval(() => { void loadOverview(); }, 30_000);
    return () => window.clearInterval(id);
  }, [loadOverview]);

  useEffect(() => { setPage(0); }, [branch, mapping, search]);

  const streams = health?.streams || [];
  const openAlerts = useMemo(() => alerts.filter((a) => !a.resolved), [alerts]);
  const attentionStreams = useMemo(() => streams.filter((s) => s.status !== 'healthy'), [streams]);

  return <div className="space-y-4">
    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-black text-[var(--dawaa-theme-heading)]">مركز تشغيل المزامنة</h2>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">صورة واحدة لحالة طلبات العملاء وفواتير المشتريات والبصمات، مع سجل الأعطال وسجل البصمات الخام.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black', health?.overall_status === 'healthy' ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]')}>
            <Activity size={15} /> الحالة العامة: {health?.overall_status === 'healthy' ? 'سليمة' : health?.overall_status === 'delayed' ? 'يوجد تأخير' : 'تحتاج متابعة'}
          </span>
          <button onClick={() => { void loadOverview(); void loadEvents(); }} className="btn-primary"><RefreshCw size={16} className={loading || eventsLoading ? 'animate-spin' : ''} /> تحديث الكل</button>
        </div>
      </div>
      {error && <div className="mt-3 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-black text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}
    </div>

    <div className="grid gap-4 xl:grid-cols-3">
      {streams.map((stream) => {
        const style = healthStyle(stream.status);
        const Icon = streamIcon(stream.stream);
        const StatusIcon = style.icon;
        const heartbeatMinutes = stream.heartbeat_age_seconds == null ? null : Math.round(Number(stream.heartbeat_age_seconds) / 60);
        return <div key={stream.stream} className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3"><span className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-2"><Icon size={22} /></span><div><div className="font-black text-[var(--dawaa-theme-heading)]">{streamTitle(stream.stream)}</div><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{stream.source_system || '-'}{stream.source_entity ? ` · ${stream.source_entity}` : ''}</div></div></div>
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black', style.cls)}><StatusIcon size={13} />{style.label}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Mini label="آخر heartbeat" value={heartbeatMinutes == null ? '-' : `${heartbeatMinutes} د`} />
            <Mini label="إجمالي" value={Number(stream.total_canonical ?? stream.total_synced ?? stream.total_raw ?? 0).toLocaleString('ar-EG')} />
            {stream.stream === 'customer_orders' && <><Mini label="Pending" value={Number(stream.inbox_pending || 0).toLocaleString('ar-EG')} /><Mini label="Failed" value={Number(stream.inbox_failed || 0).toLocaleString('ar-EG')} /></>}
            {stream.stream === 'purchase_invoices' && <><Mini label="Matched" value={Number(stream.matched || 0).toLocaleString('ar-EG')} /><Mini label="غير مطابق" value={Number((stream.ambiguous || 0) + (stream.unmatched || 0)).toLocaleString('ar-EG')} /></>}
            {stream.stream === 'biometrics' && <><Mini label="نسبة الربط" value={`${Number(stream.mapping_rate || 0).toFixed(1)}%`} /><Mini label="غير مربوط" value={Number(stream.unmapped || 0).toLocaleString('ar-EG')} /></>}
          </div>
          <div className="mt-3 rounded-xl dawaa-surface-soft p-3 text-xs font-bold text-[var(--dawaa-theme-muted)]">
            <div className="font-black text-[var(--dawaa-theme-heading)]">الإجراء التالي</div>
            <div className="mt-1">{nextAction(stream)}</div>
          </div>
        </div>;
      })}
    </div>

    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-black text-[var(--dawaa-theme-heading)]">قائمة الإجراءات الآن</h3><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">يعرض فقط المسارات التي تحتاج تدخلًا.</p></div><span className="rounded-full border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-warning-text)]">{attentionStreams.length}</span></div>
        {!attentionStreams.length ? <SuccessText text="كل مسارات المزامنة سليمة الآن." /> : <div className="space-y-2">{attentionStreams.map((stream) => <div key={stream.stream} className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] p-3 text-sm"><div className="font-black text-[var(--dawaa-status-warning-text)]">{streamTitle(stream.stream)} — {healthStyle(stream.status).label}</div><div className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">{nextAction(stream)}</div></div>)}</div>}
      </div>
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-black text-[var(--dawaa-theme-heading)]">أعطال المزامنة</h3><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">الأعطال المفتوحة أولًا ثم آخر الأعطال المغلقة.</p></div><span className="rounded-full border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] px-3 py-1 text-xs font-black text-[var(--dawaa-status-danger-text)]">{openAlerts.length} مفتوح</span></div>
        {!alerts.length ? <SuccessText text="لا توجد أعطال مسجلة." /> : <div className="max-h-72 space-y-2 overflow-auto">{alerts.map((alert) => <div key={alert.id} className={cn('rounded-xl border p-3', alert.resolved ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)]' : 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]')}><div className="flex items-center justify-between gap-2"><div className="font-black">{streamTitle(alert.sync_name === 'customer_orders' ? 'customer_orders' : alert.sync_name === 'purchase_invoices' ? 'purchase_invoices' : 'biometrics')}</div><span className="text-[11px] font-black">{alert.resolved ? 'تم الحل' : alert.severity || 'مفتوح'}</span></div><div className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">بدأ: {formatDateTime(alert.detected_at)} · آخر نشاط: {formatDateTime(alert.last_activity_at)} · تأخير: {alert.minutes_stale == null ? '-' : `${Math.round(Number(alert.minutes_stale))} د`}</div></div>)}</div>}
      </div>
    </div>

    <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex-1"><h3 className="font-black text-[var(--dawaa-theme-heading)]">سجل البصمات الكامل</h3><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">سجل خفيف Server-side مع فلترة وربط واضح بين وقت البصمة ووقت وصولها للنظام.</p></div>
        <label className="space-y-1 text-xs font-black text-[var(--dawaa-theme-muted)]"><span>الفرع</span><select value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark min-w-40"><option>الكل</option>{branches.filter((b) => b !== 'الكل').map((b) => <option key={b}>{b}</option>)}</select></label>
        <label className="space-y-1 text-xs font-black text-[var(--dawaa-theme-muted)]"><span>الربط</span><select value={mapping} onChange={(e) => setMapping(e.target.value)} className="input-dark min-w-36"><option value="all">الكل</option><option value="mapped">مربوط</option><option value="unmapped">غير مربوط</option></select></label>
        <label className="min-w-64 flex-1 space-y-1 text-xs font-black text-[var(--dawaa-theme-muted)]"><span>بحث</span><div className="relative"><Search size={15} className="absolute right-3 top-3 text-[var(--dawaa-theme-muted)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم الموظف، كود البصمة، Event ID" className="input-dark w-full pr-9" /></div></label>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="dawaa-table-semantic min-w-full text-sm"><thead><tr className="text-right"><th className="p-3">وقت البصمة</th><th className="p-3">وصلت للنظام</th><th className="p-3">التأخير</th><th className="p-3">الموظف</th><th className="p-3">كود الجهاز</th><th className="p-3">الفرع</th><th className="p-3">النوع</th><th className="p-3">الربط</th></tr></thead><tbody>
          {events.map((event) => <tr key={event.id} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{formatDateTime(event.punch_time)}</td><td className="p-3 text-xs font-bold">{formatDateTime(event.ingested_at)}</td><td className="p-3 font-black">{formatLag(event.ingestion_lag_seconds)}</td><td className="p-3"><div className="font-black text-[var(--dawaa-theme-heading)]">{event.staff_name || 'غير مربوط'}</div><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{event.staff_id || '-'}</div></td><td className="p-3 font-black">{event.biometric_user_id || '-'}</td><td className="p-3">{event.branch || '-'}</td><td className="p-3">{event.punch_type || '-'}</td><td className="p-3"><span className={cn('inline-flex rounded-full border px-2 py-1 text-[11px] font-black', event.mapping_status === 'mapped' ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]')}>{event.mapping_status === 'mapped' ? 'مربوط' : 'يحتاج ربط'}</span></td></tr>)}
        </tbody></table>
        {!eventsLoading && !events.length && <div className="p-8 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">لا توجد بصمات مطابقة للفلاتر الحالية.</div>}
        {eventsLoading && <div className="p-8 text-center text-sm font-bold text-[var(--dawaa-theme-muted)]">جارٍ تحميل سجل البصمات...</div>}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-[var(--dawaa-theme-muted)]"><span>{totalEvents.toLocaleString('ar-EG')} سجل · صفحة {Math.min(page + 1, pageCount)} من {pageCount}</span><div className="flex gap-2"><button disabled={page <= 0 || eventsLoading} onClick={() => setPage((p) => Math.max(0, p - 1))} className="btn-secondary">السابق</button><button disabled={(page + 1) * PAGE_SIZE >= totalEvents || eventsLoading} onClick={() => setPage((p) => p + 1)} className="btn-secondary">التالي</button></div></div>
    </div>
  </div>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl dawaa-surface-soft p-2"><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div><div className="mt-1 font-black text-[var(--dawaa-theme-heading)]">{value}</div></div>;
}

function SuccessText({ text }: { text: string }) {
  return <div className="rounded-xl border border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] p-4 text-sm font-black text-[var(--dawaa-status-success-text)]">{text}</div>;
}
