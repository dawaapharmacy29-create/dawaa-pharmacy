import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Fingerprint,
  Gauge,
  Laptop,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
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
  allowed_branches?: string[] | null;
  last_seen_at: string | null;
  last_request_at: string | null;
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
  age_minutes: number | null;
  status: string;
};

type Watermark = {
  provider: string;
  scope_key: string;
  complete_through: string | null;
  reported_at: string | null;
  client_id: string | null;
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
  mapped_24h: number;
  unmapped_24h: number;
  status: string;
};

type HourlyActivity = {
  hour: string;
  events: number;
  mapped: number;
  unmapped: number;
};

type SyncAlert = {
  id: string;
  detected_at: string;
  last_activity_at: string | null;
  minutes_stale: number | null;
  resolved: boolean;
  severity: string | null;
  details: Record<string, unknown> | null;
};

type OperationsHealth = {
  checked_at?: string | null;
  status?: string;
  lag_minutes?: number | null;
  latest_activity_at?: string | null;
  latest_punch_time?: string | null;
  latest_ingested_at?: string | null;
  latest_complete_through?: string | null;
  latest_reported_at?: string | null;
  events_today?: number;
  events_24h?: number;
  events_last_hour?: number;
  mapped_24h?: number;
  unmapped_24h?: number;
  distinct_staff_24h?: number;
  active_clients?: number;
  clients?: ClientHealth[];
  watermarks?: Watermark[];
  devices?: DeviceHealth[];
  hourly_activity?: HourlyActivity[];
  alerts?: SyncAlert[];
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

function statusMeta(status?: string) {
  if (status === 'healthy') return { label: 'متصل وسليم', cls: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]', icon: CheckCircle2 };
  if (status === 'delayed') return { label: 'يوجد تأخير', cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]', icon: Clock };
  if (status === 'stale') return { label: 'المزامنة قديمة', cls: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]', icon: AlertTriangle };
  if (status === 'offline') return { label: 'متوقف', cls: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]', icon: WifiOff };
  if (status === 'disabled') return { label: 'غير مفعل', cls: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]', icon: XCircle };
  return { label: 'لم يتصل بعد', cls: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface-2)] text-[var(--dawaa-theme-muted)]', icon: ShieldAlert };
}

function punchLabel(value?: string | null) {
  if (value === 'check_in' || value === 'in') return 'حضور';
  if (value === 'check_out' || value === 'out') return 'انصراف';
  return value || '-';
}

export default function AttendanceSyncCommandCenter({ branches, defaultBranch = 'الكل' }: Props) {
  const [health, setHealth] = useState<OperationsHealth | null>(null);
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
  const clients = health?.clients || [];
  const devices = health?.devices || [];
  const watermarks = health?.watermarks || [];
  const alerts = health?.alerts || [];
  const openAlerts = useMemo(() => alerts.filter((a) => !a.resolved), [alerts]);
  const primaryClient = clients.find((c) => c.status === 'healthy') || clients[0] || null;
  const latestWatermark = watermarks[0] || null;
  const mappedRatio = Number(health?.events_24h || 0) > 0 ? Math.round((Number(health?.mapped_24h || 0) / Number(health?.events_24h || 1)) * 1000) / 10 : 0;

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('attendance_biometric_operations_v3');
      if (rpcError) throw rpcError;
      setHealth((data || {}) as OperationsHealth);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل مركز تشغيل البصمة');
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
    const id = window.setInterval(() => { void loadOverview(); void loadEvents(); }, 30_000);
    return () => window.clearInterval(id);
  }, [loadOverview, loadEvents]);
  useEffect(() => { setPage(0); }, [branch, mapping, search]);

  const meta = statusMeta(health?.status);
  const StatusIcon = meta.icon;

  return <div className="space-y-4">
    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-5 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black text-[var(--dawaa-theme-heading)]">لوحة تشغيل البصمة والمزامنة</h2>
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-black', meta.cls)}><StatusIcon size={14} /> {meta.label}</span>
          </div>
          <p className="mt-1 text-xs font-bold text-[var(--dawaa-theme-muted)]">تعرض حالة الـBridge والجهاز وآخر بصمة وآخر رفع والـWatermark ونسبة الربط وسجل الأحداث، ويتم تحديثها تلقائيًا كل 30 ثانية.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft px-3 py-2 text-xs font-black text-[var(--dawaa-theme-heading)]">آخر فحص: {formatDateTime(health?.checked_at)}</div>
          <button onClick={() => { void loadOverview(); void loadEvents(); }} className="btn-primary"><RefreshCw size={16} className={loading || eventsLoading ? 'animate-spin' : ''} /> تحديث الآن</button>
        </div>
      </div>
      {error && <div className="mt-4 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-black text-[var(--dawaa-status-danger-text)]">⚠️ {error}</div>}
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
      <Metric icon={Wifi} label="حالة الاتصال" value={meta.label} hint={`تأخير ${formatLagMinutes(health?.lag_minutes)}`} tone={health?.status === 'healthy' ? 'ok' : health?.status === 'offline' ? 'bad' : 'warn'} />
      <Metric icon={Clock} label="آخر اتصال" value={formatDateTime(health?.latest_activity_at)} hint={primaryClient?.name || 'لا يوجد عميل متصل'} />
      <Metric icon={Fingerprint} label="آخر بصمة" value={formatDateTime(health?.latest_punch_time)} hint="وقت الحدث من جهاز البصمة" />
      <Metric icon={Server} label="آخر رفع للقاعدة" value={formatDateTime(health?.latest_ingested_at)} hint="وقت وصول السجل إلى Supabase" />
      <Metric icon={Gauge} label="اكتمال المزامنة" value={formatDateTime(health?.latest_complete_through)} hint={`تأخير ${formatLagMinutes(latestWatermark?.coverage_lag_minutes)}`} />
      <Metric icon={Activity} label="بصمات اليوم" value={Number(health?.events_today || 0).toLocaleString('ar-EG')} hint={`${Number(health?.events_last_hour || 0).toLocaleString('ar-EG')} خلال آخر ساعة`} />
      <Metric icon={CheckCircle2} label="نسبة الربط 24 ساعة" value={`${mappedRatio}%`} hint={`${Number(health?.mapped_24h || 0).toLocaleString('ar-EG')} مربوط`} tone={Number(health?.unmapped_24h || 0) ? 'warn' : 'ok'} />
      <Metric icon={Users} label="موظفون نشطون 24 ساعة" value={Number(health?.distinct_staff_24h || 0).toLocaleString('ar-EG')} hint={`${Number(health?.unmapped_24h || 0).toLocaleString('ar-EG')} بصمة غير مربوطة`} />
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="font-black text-[var(--dawaa-theme-heading)]">مصادر الاتصال والـBridge</h3><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">يوضح أي برنامج متصل فعليًا وأي مصدر قديم أو غير متصل.</p></div><span className="rounded-full border border-[var(--dawaa-theme-border)] px-3 py-1 text-xs font-black">{clients.length}</span></div>
        <div className="space-y-2">
          {clients.map((client) => {
            const cMeta = statusMeta(client.status); const Icon = cMeta.icon;
            return <div key={client.id} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-2"><Laptop size={18} /><div><div className="font-black text-[var(--dawaa-theme-heading)]">{client.name || client.provider || 'مصدر غير معروف'}</div><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{client.provider || '-'} · HTTP {client.last_http_status || '-'}</div></div></div>
                <span className={cn('inline-flex items-center gap-1 self-start rounded-full border px-2 py-1 text-[11px] font-black', cMeta.cls)}><Icon size={12} />{cMeta.label}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4"><Mini label="آخر نجاح" value={formatDateTime(client.last_success_at || client.last_seen_at)} /><Mini label="الطلبات" value={Number(client.total_requests || 0).toLocaleString('ar-EG')} /><Mini label="مقبول" value={Number(client.total_accepted || 0).toLocaleString('ar-EG')} /><Mini label="مكرر/مرفوض" value={`${Number(client.total_duplicates || 0).toLocaleString('ar-EG')} / ${Number(client.total_rejected || 0).toLocaleString('ar-EG')}`} /></div>
              {client.last_error_at && <div className="mt-2 rounded-lg border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-2 text-[11px] font-bold text-[var(--dawaa-status-danger-text)]">آخر خطأ: {formatDateTime(client.last_error_at)} · {client.last_error_code || ''} {client.last_error_message || ''}</div>}
            </div>;
          })}
          {!clients.length && <Empty text="لا توجد مصادر بصمة مسجلة." />}
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="mb-3"><h3 className="font-black text-[var(--dawaa-theme-heading)]">الأجهزة الفعلية</h3><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">آخر نشاط لكل جهاز/مصدر مع عدد البصمات خلال 24 ساعة.</p></div>
        <div className="space-y-2">
          {devices.map((device, index) => {
            const dMeta = statusMeta(device.status); const Icon = dMeta.icon;
            return <div key={`${device.device_id}-${device.provider}-${index}`} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div><div className="font-black text-[var(--dawaa-theme-heading)]">جهاز {device.device_id}</div><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{device.branch} · {device.provider}</div></div><span className={cn('inline-flex items-center gap-1 self-start rounded-full border px-2 py-1 text-[11px] font-black', dMeta.cls)}><Icon size={12} />{dMeta.label}</span></div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4"><Mini label="آخر بصمة" value={formatDateTime(device.last_punch_time)} /><Mini label="آخر رفع" value={formatDateTime(device.last_ingested_at)} /><Mini label="أحداث 24س" value={Number(device.events_24h || 0).toLocaleString('ar-EG')} /><Mini label="غير مربوط" value={Number(device.unmapped_24h || 0).toLocaleString('ar-EG')} /></div>
            </div>;
          })}
          {!devices.length && <Empty text="لا توجد أجهزة أرسلت بيانات حتى الآن." />}
        </div>
      </div>
    </section>

    <section className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="mb-3"><h3 className="font-black text-[var(--dawaa-theme-heading)]">آخر Watermark للمزامنة</h3><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">أهم دليل على أن البرنامج قرأ الجهاز وأكد اكتمال البيانات حتى وقت محدد.</p></div>
        {latestWatermark ? <div className="space-y-2"><InfoRow label="المصدر" value={latestWatermark.provider} /><InfoRow label="اكتملت البيانات حتى" value={formatDateTime(latestWatermark.complete_through)} /><InfoRow label="تم الإبلاغ في" value={formatDateTime(latestWatermark.reported_at)} /><InfoRow label="عمر التقرير" value={formatLagMinutes(latestWatermark.report_age_minutes)} /><InfoRow label="فجوة التغطية" value={formatLagMinutes(latestWatermark.coverage_lag_minutes)} /><InfoRow label="آخر دفعة" value={`${Number(latestWatermark.metadata?.received || 0).toLocaleString('ar-EG')} مستلم · ${Number(latestWatermark.metadata?.accepted || 0).toLocaleString('ar-EG')} مقبول · ${Number(latestWatermark.metadata?.duplicates || 0).toLocaleString('ar-EG')} مكرر · ${Number(latestWatermark.metadata?.rejected || 0).toLocaleString('ar-EG')} مرفوض`} /></div> : <Empty text="لا يوجد Watermark مسجل حتى الآن." />}
      </div>
      <div className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="font-black text-[var(--dawaa-theme-heading)]">تنبيهات البصمة</h3><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">التنبيهات المفتوحة أولًا، مع الاحتفاظ بالتاريخ السابق.</p></div><span className={cn('rounded-full border px-3 py-1 text-xs font-black', openAlerts.length ? 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]' : 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]')}>{openAlerts.length} مفتوح</span></div>
        <div className="max-h-64 space-y-2 overflow-auto">{alerts.slice(0, 10).map((alert) => <div key={alert.id} className={cn('rounded-xl border p-3 text-xs', alert.resolved ? 'border-[var(--dawaa-theme-border)] dawaa-surface-soft' : 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)]')}><div className="flex items-center justify-between gap-2"><span className="font-black">{alert.resolved ? 'تم الحل' : 'يحتاج تدخل'} · {alert.severity || '-'}</span><span className="font-bold text-[var(--dawaa-theme-muted)]">{formatDateTime(alert.detected_at)}</span></div><div className="mt-1 font-bold text-[var(--dawaa-theme-muted)]">آخر نشاط وقت التنبيه: {formatDateTime(alert.last_activity_at)} · تأخير {formatLagMinutes(alert.minutes_stale)}</div></div>)}{!alerts.length && <Empty text="لا توجد تنبيهات بصمة مسجلة." />}</div>
      </div>
    </section>

    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="mb-3"><h3 className="font-black text-[var(--dawaa-theme-heading)]">نشاط آخر 12 ساعة</h3><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">يساعدك تلاحظ توقف الرفع أو وجود ساعات غير طبيعية بسرعة.</p></div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{(health?.hourly_activity || []).map((h) => <div key={h.hour} className="rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{new Date(h.hour).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' })}</div><div className="mt-1 text-xl font-black text-[var(--dawaa-theme-heading)]">{Number(h.events || 0).toLocaleString('ar-EG')}</div><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">مربوط {h.mapped} · غير مربوط {h.unmapped}</div></div>)}{!(health?.hourly_activity || []).length && <Empty text="لا يوجد نشاط خلال آخر 12 ساعة." />}</div>
    </section>

    <section className="rounded-2xl border border-[var(--dawaa-theme-border)] dawaa-surface p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div><h3 className="font-black text-[var(--dawaa-theme-heading)]">سجل البصمات الخام</h3><p className="text-xs font-bold text-[var(--dawaa-theme-muted)]">ابحث بالموظف أو كود البصمة أو الجهاز، وراجع هل السجل مربوط بموظف أم لا.</p></div>
        <div className="grid flex-1 gap-2 sm:grid-cols-3 lg:max-w-3xl"><select value={branch} onChange={(e) => setBranch(e.target.value)} className="input-dark"><option>الكل</option>{branches.filter((b) => b !== 'الكل').map((b) => <option key={b}>{b}</option>)}</select><select value={mapping} onChange={(e) => setMapping(e.target.value)} className="input-dark"><option value="all">كل حالات الربط</option><option value="mapped">مربوط</option><option value="unmapped">غير مربوط</option></select><div className="relative"><Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--dawaa-theme-muted)]" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم / كود / جهاز" className="input-dark w-full pr-9" /></div></div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--dawaa-theme-border)]"><table className="dawaa-table-semantic min-w-full text-xs"><thead><tr className="text-right"><th className="p-3">وقت البصمة</th><th className="p-3">الموظف</th><th className="p-3">كود البصمة</th><th className="p-3">النوع</th><th className="p-3">الفرع</th><th className="p-3">الجهاز</th><th className="p-3">المصدر</th><th className="p-3">وصلت للقاعدة</th><th className="p-3">تأخير الإدخال</th><th className="p-3">الربط</th></tr></thead><tbody>{events.map((event) => <tr key={event.id} className="border-t border-[var(--dawaa-theme-divider)]"><td className="p-3 font-black text-[var(--dawaa-theme-heading)]">{formatDateTime(event.punch_time)}</td><td className="p-3">{event.staff_name || '-'}</td><td className="p-3 font-mono">{event.biometric_user_id || '-'}</td><td className="p-3">{punchLabel(event.punch_type)}</td><td className="p-3">{event.branch || '-'}</td><td className="p-3 font-mono">{event.device_id || '-'}</td><td className="p-3">{event.provider || '-'}</td><td className="p-3">{formatDateTime(event.ingested_at)}</td><td className="p-3">{formatLagSeconds(event.ingestion_lag_seconds)}</td><td className="p-3"><span className={cn('rounded-full border px-2 py-1 font-black', event.mapping_status === 'mapped' ? 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]' : 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]')}>{event.mapping_status === 'mapped' ? 'مربوط' : 'غير مربوط'}</span></td></tr>)}</tbody></table>{!eventsLoading && !events.length && <Empty text="لا توجد بصمات مطابقة للفلاتر الحالية." />}</div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-[var(--dawaa-theme-muted)]"><span>إجمالي النتائج: {totalEvents.toLocaleString('ar-EG')}</span><div className="flex items-center gap-2"><button disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="btn-secondary px-3 py-2">السابق</button><span>صفحة {page + 1} من {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)} className="btn-secondary px-3 py-2">التالي</button></div></div>
    </section>
  </div>;
}

function Metric({ icon: Icon, label, value, hint, tone = 'neutral' }: { icon: typeof Activity; label: string; value: string; hint: string; tone?: 'neutral' | 'ok' | 'warn' | 'bad' }) {
  const cls = tone === 'ok' ? 'border-[var(--dawaa-status-success-border)]' : tone === 'warn' ? 'border-[var(--dawaa-status-warning-border)]' : tone === 'bad' ? 'border-[var(--dawaa-status-danger-border)]' : 'border-[var(--dawaa-theme-border)]';
  return <div className={cn('rounded-2xl border dawaa-surface p-3 shadow-sm', cls)}><div className="flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-muted)]"><Icon size={15} />{label}</div><div className="mt-2 break-words text-base font-black text-[var(--dawaa-theme-heading)]">{value}</div><div className="mt-1 text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{hint}</div></div>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-2"><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div><div className="mt-1 break-words text-xs font-black text-[var(--dawaa-theme-heading)]">{value}</div></div>;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return <div className="flex flex-col gap-1 rounded-xl border border-[var(--dawaa-theme-border)] dawaa-surface-soft p-3 sm:flex-row sm:items-center sm:justify-between"><span className="text-xs font-bold text-[var(--dawaa-theme-muted)]">{label}</span><span className="text-xs font-black text-[var(--dawaa-theme-heading)]">{value}</span></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-[var(--dawaa-theme-border)] p-5 text-center text-xs font-bold text-[var(--dawaa-theme-muted)]">{text}</div>;
}
