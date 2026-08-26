import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { friendlySupabaseError } from '@/lib/supabaseError';

type BranchHealth = {
  branch: string;
  status: 'healthy' | 'warning' | 'critical';
  period_start: string;
  period_end: string;
  calculation_version: string;
  customers: number;
  total_purchases: number;
  total_cashback: number;
  total_redeemed: number;
  total_remaining: number;
  duplicate_groups: number;
  missing_code: number;
  over_redeemed_legacy: number;
  bad_remaining: number;
  wrong_period_links: number;
  header_mismatch: boolean;
};

type HealthPayload = {
  status: 'healthy' | 'warning' | 'critical';
  branches: BranchHealth[];
  generated_at: string;
};

const EMPTY: HealthPayload = { status: 'healthy', branches: [], generated_at: '' };

function StatusPill({ status }: { status: HealthPayload['status'] }) {
  if (status === 'critical') return <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs font-black text-rose-200"><AlertTriangle size={14} /> يحتاج تدخل</span>;
  if (status === 'warning') return <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-200"><AlertTriangle size={14} /> ملاحظة تاريخية</span>;
  return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs font-black text-emerald-200"><CheckCircle2 size={14} /> مستقر</span>;
}

export default function CustomerCashbackHealthPanel({ forcedBranch = '' }: { forcedBranch?: string }) {
  const [health, setHealth] = useState<HealthPayload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await (supabase as any).rpc('dawaa_customer_cashback_health_v1', {
        p_branch: forcedBranch || null,
      });
      if (rpcError) throw rpcError;
      setHealth({ ...EMPTY, ...((data || {}) as HealthPayload), branches: Array.isArray((data as any)?.branches) ? (data as any).branches : [] });
    } catch (loadError) {
      setError(friendlySupabaseError(loadError as any) || 'تعذر فحص صحة نظام النقاط');
    } finally {
      setLoading(false);
    }
  }, [forcedBranch]);

  useEffect(() => { void load(); }, [load]);
  const totalLegacy = useMemo(() => health.branches.reduce((sum, row) => sum + Number(row.over_redeemed_legacy || 0), 0), [health.branches]);

  return <section dir="rtl" className="mb-3 rounded-2xl border border-teal-400/20 bg-slate-950/20 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-black text-teal-100"><ShieldCheck size={18} /> صحة نظام نقاط العملاء</div>
        <div className="mt-1 text-xs font-semibold text-[var(--theme-muted)]">مقارنة رأس الدورة بالـSnapshot ومراقبة التكرار والرصيد وروابط الدورة تلقائيًا.</div>
      </div>
      <div className="flex items-center gap-2">
        {!error ? <StatusPill status={health.status} /> : null}
        <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => void load()} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> فحص</button>
      </div>
    </div>

    {error ? <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-xs font-bold text-amber-100">{error}</div> : (
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {health.branches.map((row) => <div key={`${row.branch}-${row.period_start}-${row.period_end}`} className="rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-surface)] p-3">
          <div className="flex items-center justify-between gap-2"><div className="font-black text-[var(--theme-heading)]">{row.branch}</div><StatusPill status={row.status} /></div>
          <div className="mt-1 text-[11px] font-bold text-[var(--theme-muted)]">{row.period_start} → {row.period_end} · {row.calculation_version || 'snapshot'}</div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div><div className="text-lg font-black text-white">{Number(row.customers || 0).toLocaleString('ar-EG')}</div><div className="text-[var(--theme-muted)]">عميل</div></div>
            <div><div className="text-lg font-black text-emerald-300">{Number(row.total_cashback || 0).toLocaleString('ar-EG')}</div><div className="text-[var(--theme-muted)]">إجمالي النقاط</div></div>
            <div><div className="text-lg font-black text-teal-300">{Number(row.total_remaining || 0).toLocaleString('ar-EG')}</div><div className="text-[var(--theme-muted)]">المتبقي</div></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
            <span className={row.duplicate_groups ? 'text-rose-300' : 'text-emerald-300'}>Duplicate: {row.duplicate_groups}</span>
            <span className={row.bad_remaining ? 'text-rose-300' : 'text-emerald-300'}>رصيد غير متطابق: {row.bad_remaining}</span>
            <span className={row.wrong_period_links ? 'text-rose-300' : 'text-emerald-300'}>ربط دورة خاطئ: {row.wrong_period_links}</span>
            <span className={row.header_mismatch ? 'text-rose-300' : 'text-emerald-300'}>Header: {row.header_mismatch ? 'غير متطابق' : 'مطابق'}</span>
            {row.over_redeemed_legacy ? <span className="text-amber-300">استثناء تاريخي: {row.over_redeemed_legacy}</span> : null}
          </div>
        </div>)}
      </div>
    )}
    {!error && totalLegacy > 0 ? <div className="mt-3 text-[11px] font-semibold text-amber-200">الاستثناءات التاريخية لا يتم تعديلها تلقائيًا؛ الحارس الجديد يمنع تكرارها في المعاملات الجديدة.</div> : null}
  </section>;
}
