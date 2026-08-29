import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, HeartPulse, ShieldCheck, Star,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { canViewAllBranches } from '@/lib/security/userDataScope';
import { normalizeBranchName } from '@/lib/branch';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import CustomerServiceHealthPanel from '@/components/customerService/CustomerServiceHealthPanel';
import CustomerServicePersonalDashboard from '@/components/customerService/CustomerServicePersonalDashboard';
import CustomerServiceManagerDashboardV3 from '@/pages/CustomerServiceManagerDashboardV3';
import { ManagerScoreBreakdownTab } from '@/components/evaluations/ManagerScoreBreakdownTab';
import { Panel } from '@/components/dashboard/DashboardPrimitives';
import '@/styles/dashboard-theme-scopes.css';

type PulseState = 'loading' | 'ready' | 'error';
type PulsePayload = {
  completionRate: number | null;
  avgScore: number | null;
  overdue: number | null;
  needsManager: number | null;
};

const emptyPulse: PulsePayload = { completionRate: null, avgScore: null, overdue: null, needsManager: null };

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(resolve, reject).finally(() => window.clearTimeout(id));
  });
}

/**
 * "نبض الفرع" — a single composite read of how customer service is doing right
 * now, built only from canonical aggregates already approved for this domain
 * (get_cs_manager_followup_summary_v1 / get_cs_manager_supporting_metrics_v1 —
 * the same RPCs the detailed tabs below use). This is a presentation-only
 * summary; it never invents its own number and never turns a failed read into
 * a value-looking 0.
 */
function usePulse(scopeBranch: string | null) {
  const [state, setState] = useState<PulseState>('loading');
  const [data, setData] = useState<PulsePayload>(emptyPulse);

  useEffect(() => {
    let cancelled = false;
    const cycle = getPharmacyCycleRange(new Date());
    setState('loading');

    Promise.all([
      withTimeout(
        supabase.rpc('get_cs_manager_followup_summary_v1', {
          p_branch: scopeBranch,
          p_start: cycle.start,
          p_end: cycle.end,
          p_responsible: null,
          p_status: null,
        }),
        10000,
        'cs-pulse-followups'
      ),
      withTimeout(
        supabase.rpc('get_cs_manager_supporting_metrics_v1', {
          p_branch: scopeBranch,
          p_start: cycle.start,
          p_end: cycle.end,
          p_responsible: null,
        }),
        10000,
        'cs-pulse-supporting'
      ),
    ])
      .then(([followupResult, supportingResult]: any[]) => {
        if (cancelled) return;
        if (followupResult.error || supportingResult.error) throw followupResult.error || supportingResult.error;
        const summary = followupResult.data?.summary || {};
        const supporting = supportingResult.data || {};
        const completionRate = summary.period_total
          ? Math.round((Number(summary.completed || 0) / Number(summary.period_total)) * 100)
          : null;
        setData({
          completionRate,
          avgScore: supporting.avg_score == null ? null : Number(supporting.avg_score),
          overdue: summary.overdue == null ? null : Number(summary.overdue),
          needsManager: summary.needs_manager == null ? null : Number(summary.needs_manager),
        });
        setState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[CustomerServiceManagerDashboard] pulse failed', error);
        setState('error');
      });

    return () => { cancelled = true; };
  }, [scopeBranch]);

  return { state, data };
}

function PulseRing({ score, state }: { score: number | null; state: PulseState }) {
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const tone = score == null ? 'var(--dawaa-theme-muted)' : score >= 80 ? 'var(--dawaa-status-success-text)' : score >= 60 ? 'var(--dawaa-status-warning-text)' : 'var(--dawaa-status-danger-text)';
  return (
    <div
      className="relative flex h-28 w-28 shrink-0 items-center justify-center rounded-full"
      style={{ background: `conic-gradient(${tone} ${pct * 3.6}deg, var(--dawaa-theme-soft) 0deg)` }}
    >
      <div className="flex h-[92px] w-[92px] flex-col items-center justify-center rounded-full" style={{ background: 'var(--dawaa-theme-surface)' }}>
        {state === 'loading' ? (
          <span className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>…</span>
        ) : state === 'error' || score == null ? (
          <span className="text-xs font-black" style={{ color: 'var(--dawaa-theme-muted)' }}>غير متاح</span>
        ) : (
          <>
            <span className="text-3xl font-black" style={{ color: tone }}>{score}</span>
            <span className="text-[10px] font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>من 100</span>
          </>
        )}
      </div>
    </div>
  );
}

const TABS = [
  { key: 'personal', label: 'أدائي الشخصي' },
  { key: 'team', label: 'أداء الفريق التشغيلي' },
  { key: 'incentive', label: 'التقييم والحافز' },
] as const;
type TabKey = typeof TABS[number]['key'];

export default function CustomerServiceManagerDashboard() {
  const { user } = useAuth();
  const allBranches = canViewAllBranches(user);
  const ownBranch = normalizeBranchName(user?.branch || '');
  const scopeBranch = allBranches ? null : ownBranch;
  const pulse = usePulse(scopeBranch);
  const [healthOpen, setHealthOpen] = useState(false);
  const availableTabs = useMemo(() => TABS.filter((tab) => tab.key !== 'personal' || !allBranches), [allBranches]);
  const [tab, setTab] = useState<TabKey>(availableTabs[0].key);

  useEffect(() => {
    if (!availableTabs.some((item) => item.key === tab)) setTab(availableTabs[0].key);
  }, [availableTabs, tab]);

  const diagnosis = useMemo(() => {
    if (pulse.state !== 'ready' || pulse.data.completionRate == null) return 'جاري تجميع الصورة الكاملة لأداء الفرع...';
    const needsManager = pulse.data.needsManager || 0;
    if (needsManager > 0) return `فيه ${needsManager} حالة محتاجة قرار مدير دلوقتي — يستاهل نظرة في تاب "أداء الفريق التشغيلي".`;
    if (pulse.data.completionRate >= 80) return 'الفريق ماشي كويس — نسبة إنجاز المتابعات فوق ٨٠٪ في الدورة الحالية.';
    return 'نسبة الإنجاز محتاجة دفعة — راجع المتابعات المتأخرة في تاب "أداء الفريق التشغيلي".';
  }, [pulse]);

  return (
    <div className="customer-service-dashboard-theme space-y-4" dir="rtl">
      <Panel className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:p-6">
        <PulseRing score={pulse.data.completionRate} state={pulse.state} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2" style={{ color: 'var(--dawaa-theme-primary)' }}>
            <HeartPulse size={17} />
            <span className="text-xs font-black">نبض {allBranches ? 'خدمة العملاء — كل الفروع' : `فرع ${ownBranch}`}</span>
          </div>
          <h1 className="mt-1 text-2xl font-black" style={{ color: 'var(--dawaa-theme-heading)' }}>أهلًا يا {user?.name || 'مدير خدمة العملاء'}</h1>
          <p className="mt-2 text-sm font-bold" style={{ color: 'var(--dawaa-theme-text)' }}>{diagnosis}</p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold" style={{ color: 'var(--dawaa-theme-muted)' }}>
            <span className="flex items-center gap-1"><Star size={13} /> متوسط التقييمات: {pulse.state === 'ready' && pulse.data.avgScore != null ? pulse.data.avgScore : '—'}</span>
            <span className="flex items-center gap-1"><AlertTriangle size={13} /> متأخرة: {pulse.state === 'ready' && pulse.data.overdue != null ? pulse.data.overdue : '—'}</span>
          </div>
        </div>
      </Panel>

      <div className="rounded-2xl border" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-bg-soft)' }}>
        <button
          type="button"
          onClick={() => setHealthOpen((value) => !value)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-xs font-black"
          style={{ color: 'var(--dawaa-theme-primary)' }}
        >
          <span className="flex items-center gap-2"><ShieldCheck size={16} /> صحة نظام خدمة العملاء</span>
          <ChevronDown size={15} className={healthOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
        </button>
        {healthOpen ? <div className="border-t px-1 pb-1" style={{ borderColor: 'var(--dawaa-theme-border)' }}><CustomerServiceHealthPanel /></div> : null}
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border p-1.5" style={{ borderColor: 'var(--dawaa-theme-border)', background: 'var(--dawaa-theme-bg-soft)' }}>
        {availableTabs.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className="flex-1 rounded-xl px-3 py-2 text-xs font-black transition-colors"
            style={tab === item.key
              ? { background: 'var(--dawaa-theme-primary)', color: 'var(--dawaa-theme-primary-text)' }
              : { color: 'var(--dawaa-theme-muted)' }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'personal' && !allBranches ? (
        <CustomerServicePersonalDashboard branch={ownBranch} staffName={String(user?.name || '')} />
      ) : null}

      {tab === 'team' ? <CustomerServiceManagerDashboardV3 headerVariant="compact" /> : null}

      {tab === 'incentive' ? (
        <Panel className="p-5">
          <ManagerScoreBreakdownTab evaluationType="customer_service" staffId={user?.staffId || user?.id} branch={allBranches ? null : ownBranch} />
        </Panel>
      ) : null}
    </div>
  );
}
