import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type ArchitectureHealth = {
  engine_version?: number;
  scope_branch?: string;
  active_staff?: number;
  missing_compensation_profiles?: number;
  active_legacy_rules?: number;
  duplicate_active_event_groups?: number;
  transactions_missing_cycle?: number;
  transactions_missing_source?: number;
  transactions_missing_points?: number;
  status?: 'healthy' | 'warning' | 'critical' | string;
};

type CoverageRole = {
  role: string;
  staff_count: number;
  configured_count: number;
  missing_count: number;
};

type CompensationCoverage = {
  engine_version?: number;
  scope_branch?: string;
  active_staff?: number;
  configured_profiles?: number;
  missing_profiles?: number;
  coverage_pct?: number;
  roles?: CoverageRole[];
};

function n(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function statusLabel(status: string) {
  if (status === 'healthy') return 'مستقر';
  if (status === 'critical') return 'حرج';
  return 'يحتاج مراجعة';
}

function statusClass(status: string) {
  if (status === 'healthy') return 'dawaa-badge--success';
  if (status === 'critical') return 'dawaa-badge--danger';
  return 'dawaa-badge--warning';
}

export default function PointsArchitectureHealthPanel() {
  const [health, setHealth] = useState<ArchitectureHealth | null>(null);
  const [coverage, setCoverage] = useState<CompensationCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [healthResult, coverageResult] = await Promise.allSettled([
      supabase.rpc('get_points_architecture_health_v3'),
      supabase.rpc('get_compensation_profile_coverage_v3', { p_branch: null }),
    ]);

    const issues: string[] = [];
    if (healthResult.status === 'fulfilled' && !healthResult.value.error) {
      setHealth((healthResult.value.data || null) as ArchitectureHealth | null);
    } else {
      setHealth(null);
      const message = healthResult.status === 'fulfilled'
        ? healthResult.value.error?.message
        : healthResult.reason instanceof Error ? healthResult.reason.message : String(healthResult.reason || '');
      if (message) issues.push(`فحص النقاط: ${message}`);
    }

    if (coverageResult.status === 'fulfilled' && !coverageResult.value.error) {
      setCoverage((coverageResult.value.data || null) as CompensationCoverage | null);
    } else {
      setCoverage(null);
      const message = coverageResult.status === 'fulfilled'
        ? coverageResult.value.error?.message
        : coverageResult.reason instanceof Error ? coverageResult.reason.message : String(coverageResult.reason || '');
      if (message) issues.push(`تغطية الحوافز: ${message}`);
    }

    setError(issues.length ? issues.join(' — ') : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const healthStatus = String(health?.status || (error ? 'warning' : 'healthy'));
  const roleGaps = [...(coverage?.roles || [])]
    .filter((row) => n(row.missing_count) > 0)
    .sort((a, b) => n(b.missing_count) - n(a.missing_count))
    .slice(0, 8);

  return (
    <section className="dawaa-card dawaa-card--raised space-y-4" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="dawaa-icon-tile h-11 w-11"><ShieldCheck size={21} /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="dawaa-title text-lg">صحة منظومة الموظف والنقاط والحوافز V3</h2>
              <span className={`dawaa-badge ${statusClass(healthStatus)}`}>{statusLabel(healthStatus)}</span>
            </div>
            <p className="dawaa-caption mt-1 text-sm leading-6">
              يراجع مصدر النقاط الموحد، التكرارات، سلامة الحركات، وتغطية Compensation Profiles بدون افتراض أي مبلغ مالي.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="dawaa-button dawaa-button--secondary">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> تحديث
        </button>
      </div>

      {error ? (
        <div className="dawaa-alert dawaa-alert--warning text-xs leading-6">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="موظفون نشطون" value={n(coverage?.active_staff ?? health?.active_staff)} />
        <Metric label="تغطية البروفايلات" value={`${n(coverage?.coverage_pct)}%`} good={n(coverage?.missing_profiles) === 0} />
        <Metric label="بروفايلات ناقصة" value={n(coverage?.missing_profiles ?? health?.missing_compensation_profiles)} good={n(coverage?.missing_profiles ?? health?.missing_compensation_profiles) === 0} />
        <Metric label="Legacy Rules نشطة" value={n(health?.active_legacy_rules)} good={n(health?.active_legacy_rules) === 0} />
        <Metric label="مجموعات مكررة" value={n(health?.duplicate_active_event_groups)} good={n(health?.duplicate_active_event_groups) === 0} />
        <Metric
          label="حركات ناقصة البيانات"
          value={n(health?.transactions_missing_cycle) + n(health?.transactions_missing_source) + n(health?.transactions_missing_points)}
          good={n(health?.transactions_missing_cycle) + n(health?.transactions_missing_source) + n(health?.transactions_missing_points) === 0}
        />
      </div>

      {roleGaps.length ? (
        <div className="dawaa-card dawaa-card--soft p-4">
          <div className="mb-3 flex items-center gap-2">
            <WalletCards size={17} />
            <h3 className="dawaa-title text-sm">الأدوار التي تحتاج استكمال Compensation Profile</h3>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {roleGaps.map((row) => (
              <div key={row.role || 'غير محدد'} className="rounded-xl border border-[var(--dawaa-theme-border)] p-3">
                <div className="text-sm font-black">{row.role || 'غير محدد'}</div>
                <div className="dawaa-caption mt-1 text-xs">
                  مضبوط {n(row.configured_count)} / {n(row.staff_count)} — ناقص {n(row.missing_count)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : coverage ? (
        <div className="dawaa-alert dawaa-alert--success text-sm">
          <CheckCircle2 size={17} /> جميع الموظفين داخل النطاق لديهم Compensation Profile صالح.
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, good }: { label: string; value: number | string; good?: boolean }) {
  return (
    <div className="dawaa-card dawaa-card--soft p-3">
      <div className="dawaa-caption text-xs">{label}</div>
      <div className={`dawaa-title mt-2 text-xl ${good === false ? 'text-amber-300' : good === true ? 'text-emerald-300' : ''}`}>{value}</div>
    </div>
  );
}
