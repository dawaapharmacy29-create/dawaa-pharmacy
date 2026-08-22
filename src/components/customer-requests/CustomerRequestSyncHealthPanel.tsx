import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, Link2, RefreshCw, ShieldAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type BranchHealth = { branch: string; total: number; open: number; last_received: string | null };
type LatestRow = {
  source_record_id: string;
  order_number: string | null;
  customer_name: string | null;
  branch: string | null;
  medicine_name: string | null;
  source_status: string | null;
  source_updated_at: string | null;
  received_at: string | null;
  sync_conflict: boolean;
};
type SyncHealth = {
  total_synced: number;
  seen_today: number;
  seen_last_hour: number;
  last_received: string | null;
  sync_lag_minutes: number | null;
  sync_conflicts: number;
  no_branch: number;
  unlinked_customer: number;
  pending: number;
  failed_or_conflict: number;
  open_requests: number;
  branches: BranchHealth[];
  latest: LatestRow[];
};

function cairoDateTime(value?: string | null) {
  if (!value) return 'لم يصل سجل بعد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', {
    timeZone: 'Africa/Cairo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(date);
}

export default function CustomerRequestSyncHealthPanel({ onReview }: { onReview?: () => void }) {
  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('get_customer_request_sync_health_v1');
      if (rpcError) throw rpcError;
      setHealth((data || null) as SyncHealth | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر قراءة حالة المزامنة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const state = useMemo(() => {
    if (!health) return { label: 'جاري الفحص', tone: 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] text-[var(--dawaa-theme-text)]', icon: Clock3, note: 'يتم فحص قناة الربط الآن.' };
    if (health.pending > 0 || health.failed_or_conflict > 0) {
      return { label: 'المزامنة تحتاج تدخل', tone: 'border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] text-[var(--dawaa-status-danger-text)]', icon: AlertTriangle, note: 'هناك سجلات لم تُعالج بعد أو فشل تقني داخل صندوق المزامنة.' };
    }
    const qualityIssues = Number(health.sync_conflicts || 0) + Number(health.no_branch || 0) + Number(health.unlinked_customer || 0);
    if (qualityIssues > 0) {
      return { label: 'المزامنة تعمل • جودة البيانات تحتاج مراجعة', tone: 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] text-[var(--dawaa-status-warning-text)]', icon: ShieldAlert, note: 'الطلبات تصل، لكن توجد سجلات تحتاج تنظيف فرع أو ربط عميل أو حسم تعارض.' };
    }
    return { label: 'المزامنة سليمة', tone: 'border-[var(--dawaa-status-success-border)] bg-[var(--dawaa-status-success-bg)] text-[var(--dawaa-status-success-text)]', icon: CheckCircle2, note: 'لا توجد مشكلات معالجة أو جودة معلقة.' };
  }, [health]);
  const StateIcon = state.icon;

  return (
    <section className="rounded-3xl border border-[var(--dawaa-theme-accent-border)] bg-[var(--dawaa-theme-surface)] p-4 shadow-xl" dir="rtl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-[var(--dawaa-theme-accent-soft)] p-3 text-[var(--dawaa-theme-primary)]"><DatabaseZap size={22} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-black text-[var(--dawaa-theme-heading)]">ربط DawaaWael → تطبيق الإدارة</h2>
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black ${state.tone}`}><StateIcon size={13} />{state.label}</span>
            </div>
            <p className="mt-1 text-xs font-bold leading-6 text-[var(--dawaa-theme-muted)]">إنشاء وتعديل طلبات Base44 يصل تلقائيًا إلى Supabase، مع مراجعة تصحيحية دورية لمنع فقد أي طلب.</p>
            <p className="mt-1 text-[11px] font-bold leading-5 text-[var(--dawaa-theme-muted)]">{state.note}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onReview && <button type="button" onClick={onReview} className="rounded-xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)] px-3 py-2 text-xs font-black text-[var(--dawaa-status-warning-text)]"><ShieldAlert size={14} className="ml-1 inline" /> فتح قائمة مراجعة الجودة</button>}
          <button type="button" onClick={() => void load()} disabled={loading} className="rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] px-3 py-2 text-xs font-black text-[var(--dawaa-theme-heading)]"><RefreshCw size={14} className={`ml-1 inline ${loading ? 'animate-spin' : ''}`} /> تحديث الحالة</button>
        </div>
      </div>

      {error ? <div className="mt-3 rounded-xl border border-[var(--dawaa-status-danger-border)] bg-[var(--dawaa-status-danger-bg)] p-3 text-xs font-bold text-[var(--dawaa-status-danger-text)]">{error}</div> : null}
      {health ? <>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Metric label="طلبات من Base44" value={health.total_synced} />
          <Metric label="وصلت اليوم" value={health.seen_today} />
          <Metric label="آخر ساعة" value={health.seen_last_hour} />
          <Metric label="طلبات مفتوحة" value={health.open_requests} />
          <Metric label="تعارضات" value={health.sync_conflicts} danger={health.sync_conflicts > 0} />
          <Metric label="بدون فرع" value={health.no_branch} danger={health.no_branch > 0} />
          <Metric label="عميل غير مربوط" value={health.unlinked_customer} danger={health.unlinked_customer > 0} />
          <Metric label="بانتظار المعالجة" value={health.pending} danger={health.pending > 0} />
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]/[0.035] p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">آخر وصول من Base44</div><div className="mt-1 font-black text-[var(--dawaa-theme-heading)]">{cairoDateTime(health.last_received)}</div></div>
          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]/[0.035] p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">منذ آخر دفعة وصلت</div><div className="mt-1 font-black text-[var(--dawaa-theme-heading)]">{health.sync_lag_minutes == null ? '—' : `${health.sync_lag_minutes} دقيقة`}</div><div className="mt-1 text-[10px] leading-4 text-[var(--dawaa-theme-muted)]">هذا المؤشر لا يعني عطلًا وحده إذا لم تُسجل طلبات جديدة على Base44.</div></div>
          <div className="rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]/[0.035] p-3"><div className="text-[11px] font-bold text-[var(--dawaa-theme-muted)]">توزيع الفروع</div><div className="mt-1 flex flex-wrap gap-2">{(health.branches || []).map((item) => <span key={item.branch} className="rounded-full bg-[var(--dawaa-theme-surface-2)] px-2 py-1 text-[11px] font-black text-[var(--dawaa-theme-heading)]">{item.branch}: {item.total}</span>)}</div></div>
        </div>

        {(health.sync_conflicts > 0 || health.no_branch > 0 || health.unlinked_customer > 0) && onReview ? <button type="button" onClick={onReview} className="mt-3 w-full rounded-2xl border border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]/[0.07] px-4 py-3 text-right text-xs font-black text-[var(--dawaa-status-warning-text)]">يوجد {Number(health.sync_conflicts || 0) + Number(health.no_branch || 0) + Number(health.unlinked_customer || 0)} ملاحظة جودة مسجلة — افتح قائمة المراجعة بدل اعتبارها عطلًا في النقل.</button> : null}

        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-3 flex items-center gap-2 text-xs font-black text-[var(--dawaa-theme-primary)]"><Link2 size={14} />{expanded ? 'إخفاء آخر الطلبات الواصلة' : 'عرض آخر الطلبات الواصلة'}</button>
        {expanded ? <div className="mt-2 overflow-x-auto rounded-2xl border border-[var(--dawaa-theme-border)]"><table className="min-w-[850px] w-full text-xs"><thead className="bg-[var(--dawaa-theme-surface)] text-[var(--dawaa-theme-muted)]"><tr>{['رقم الطلب','العميل','الصنف','الفرع','حالة Base44','وقت الوصول'].map((h) => <th key={h} className="p-2 text-right font-black">{h}</th>)}</tr></thead><tbody>{(health.latest || []).map((row) => <tr key={row.source_record_id} className="border-t border-[var(--dawaa-theme-border)] text-[var(--dawaa-theme-heading)]"><td className="p-2 font-black text-[var(--dawaa-theme-primary)]">{row.order_number || row.source_record_id.slice(-6)}</td><td className="p-2">{row.customer_name || '—'}</td><td className="p-2">{row.medicine_name || '—'}</td><td className="p-2">{row.branch || 'بدون فرع'}</td><td className="p-2">{row.source_status || '—'}</td><td className="p-2">{cairoDateTime(row.received_at)}</td></tr>)}</tbody></table></div> : null}
      </> : null}
    </section>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <div className={`rounded-2xl border p-3 text-center ${danger ? 'border-[var(--dawaa-status-warning-border)] bg-[var(--dawaa-status-warning-bg)]/[0.06]' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)]/[0.035]'}`}><div className="text-[10px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div><div className={`mt-1 text-xl font-black ${danger ? 'text-[var(--dawaa-status-warning-text)]' : 'text-[var(--dawaa-theme-heading)]'}`}>{Number(value || 0).toLocaleString('ar-EG')}</div></div>;
}
