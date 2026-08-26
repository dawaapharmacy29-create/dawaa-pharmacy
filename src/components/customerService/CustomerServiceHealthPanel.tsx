import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';

const ALL = 'كل الفروع';
const BRANCHES = ['فرع الشامي', 'فرع شكري'];

type HealthPayload = {
  status: 'healthy' | 'warning' | 'critical';
  scope_branch: string;
  open_total: number;
  official_duplicate_groups: number;
  official_duplicate_rows: number;
  open_without_schedule: number;
  missing_identity: number;
  invalid_branch_rows: number;
  completed_without_summary: number;
  orphan_events: number;
  generated_at: string;
};

const emptyHealth: HealthPayload = {
  status: 'healthy',
  scope_branch: '',
  open_total: 0,
  official_duplicate_groups: 0,
  official_duplicate_rows: 0,
  open_without_schedule: 0,
  missing_identity: 0,
  invalid_branch_rows: 0,
  completed_without_summary: 0,
  orphan_events: 0,
  generated_at: '',
};

function Metric({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return <div className={`rounded-2xl border p-3 ${warning && value > 0 ? 'border-amber-400/35 bg-amber-500/10' : 'border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-bg-soft)]'}`}>
    <div className={`text-xl font-black ${warning && value > 0 ? 'text-amber-200' : 'text-white'}`}>{Number(value || 0).toLocaleString('ar-EG')}</div>
    <div className="mt-1 text-[11px] font-bold text-[var(--dawaa-theme-muted)]">{label}</div>
  </div>;
}

export default function CustomerServiceHealthPanel() {
  const { user } = useAuth();
  const allBranches = canViewAllBranches(user);
  const ownBranch = normalizeBranchName(user?.branch || '');
  const [branch, setBranch] = useState(allBranches ? ALL : ownBranch);
  const [health, setHealth] = useState<HealthPayload>(emptyHealth);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('dawaa_customer_service_health_v1', {
        p_branch: branch === ALL ? null : branch,
      });
      if (rpcError) throw rpcError;
      setHealth({ ...emptyHealth, ...((data || {}) as HealthPayload) });
    } catch (loadError) {
      console.error('[CustomerServiceHealthPanel] failed', loadError);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [branch]);

  useEffect(() => { void load(); }, [load]);

  const statusMeta = useMemo(() => {
    if (health.status === 'critical') return { label: 'يحتاج تدخل', className: 'border-rose-400/35 bg-rose-500/10 text-rose-200', Icon: AlertTriangle };
    if (health.status === 'warning') return { label: 'ملاحظات محدودة', className: 'border-amber-400/35 bg-amber-500/10 text-amber-200', Icon: AlertTriangle };
    return { label: 'مستقر', className: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200', Icon: CheckCircle2 };
  }, [health.status]);
  const StatusIcon = statusMeta.Icon;

  return <section className="mx-4 mt-4 rounded-3xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-surface)] p-4 md:mx-6 md:mt-6" dir="rtl">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-2 text-sm font-black text-teal-200"><ShieldCheck size={18} /> صحة نظام خدمة العملاء</div>
        <div className="mt-1 text-xs font-semibold text-[var(--dawaa-theme-muted)]">مراقبة تلقائية للتكرار، المواعيد، هوية العملاء وسلامة سجل الأحداث.</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {allBranches ? <select className="input" value={branch} onChange={(e) => setBranch(e.target.value)}><option value={ALL}>كل الفروع</option>{BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}</select> : null}
        {!error ? <span className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-black ${statusMeta.className}`}><StatusIcon size={14} /> {loading ? 'جارٍ الفحص…' : statusMeta.label}</span> : null}
        <button type="button" className="btn-secondary flex items-center gap-1.5 text-xs" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> فحص</button>
      </div>
    </div>

    {error ? <div className="mt-3 rounded-2xl border border-amber-400/35 bg-amber-500/10 p-3 text-xs font-bold text-amber-100">تعذر تحميل فحص الصحة مؤقتًا. {error}</div> : <>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <Metric label="متابعات مفتوحة" value={health.open_total} />
        <Metric label="Duplicate رسمي" value={health.official_duplicate_groups} warning />
        <Metric label="مفتوحة بدون موعد" value={health.open_without_schedule} warning />
        <Metric label="هوية ناقصة" value={health.missing_identity} warning />
        <Metric label="فرع غير محدد" value={health.invalid_branch_rows} warning />
        <Metric label="أحداث يتيمة" value={health.orphan_events} warning />
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-semibold text-[var(--dawaa-theme-muted)]">
        <span>النطاق: {health.scope_branch || branch}</span>
        <span>سجلات تاريخية مكتملة بملخص قديم ناقص: {Number(health.completed_without_summary || 0).toLocaleString('ar-EG')}</span>
        <span>آخر فحص: {health.generated_at ? new Date(health.generated_at).toLocaleString('ar-EG') : '—'}</span>
      </div>
    </>}
  </section>;
}
