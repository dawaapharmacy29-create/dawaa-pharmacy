import { useEffect, useState } from 'react';
import { AlertTriangle, MessageCircle, Package, ShieldCheck, Trophy, UserRound, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type IncentiveTotal = {
  staff_name: string;
  tier_key: string;
  total_points: number;
  target_points: number;
  point_rate_egp: number;
  base_incentive_egp: number;
  points_incentive_egp: number;
  competition_bonus_egp: number;
  final_incentive_egp: number;
  progress_pct: number;
};

type PillarRow = { pillar_key: string; points: number; has_competition_win: boolean };

const PILLAR_META: Record<string, { label: string; icon: typeof MessageCircle }> = {
  محادثات: { label: 'المحادثات', icon: MessageCircle },
  متابعات: { label: 'طلبات المتابعة', icon: UserRound },
  'طلبات العملاء': { label: 'طلبات العملاء', icon: Package },
  الرواكد: { label: 'الرواكد', icon: Package },
  الالتزام: { label: 'الالتزام', icon: ShieldCheck },
};

function progressColor(progressPct: number) {
  if (progressPct >= 80) return 'var(--dawaa-status-success-text)';
  if (progressPct >= 40) return 'var(--dawaa-status-warning-text)';
  return 'var(--dawaa-status-danger-text)';
}

export default function DoctorIncentiveSummaryCard({
  staffId,
  onNavigate,
}: {
  staffId: string;
  onNavigate?: () => void;
}) {
  const [data, setData] = useState<IncentiveTotal | null>(null);
  const [pillars, setPillars] = useState<PillarRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!staffId) {
      setLoading(false);
      setData(null);
      setPillars([]);
      return;
    }

    setLoading(true);
    setError('');
    void Promise.allSettled([
      supabase.rpc('calculate_staff_incentive_egp', { p_staff_id: staffId }),
      supabase.rpc('get_doctor_pillar_breakdown', { p_staff_id: staffId }),
    ]).then(([incentiveResult, pillarResult]) => {
      if (cancelled) return;

      const issues: string[] = [];
      if (incentiveResult.status === 'fulfilled' && !incentiveResult.value.error) {
        const row = Array.isArray(incentiveResult.value.data)
          ? incentiveResult.value.data[0]
          : incentiveResult.value.data;
        setData((row as IncentiveTotal) || null);
      } else {
        setData(null);
        const message =
          incentiveResult.status === 'rejected'
            ? String(incentiveResult.reason || '')
            : incentiveResult.value.error?.message || '';
        issues.push(`تعذر تحميل إجمالي الحافز${message ? `: ${message}` : ''}`);
      }

      if (pillarResult.status === 'fulfilled' && !pillarResult.value.error) {
        setPillars((pillarResult.value.data as PillarRow[]) || []);
      } else {
        setPillars([]);
        const message =
          pillarResult.status === 'rejected'
            ? String(pillarResult.reason || '')
            : pillarResult.value.error?.message || '';
        issues.push(`تعذر تحميل توزيع بنود النقاط${message ? `: ${message}` : ''}`);
      }

      setError(issues.join(' — '));
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [staffId]);

  if (loading) {
    return (
      <div className="dawaa-card dawaa-card--soft p-5">
        <div className="dawaa-surface-soft h-24 animate-pulse rounded-2xl" />
      </div>
    );
  }

  if (!data) {
    return error ? (
      <div className="dawaa-alert dawaa-alert--warning p-4 text-sm font-bold">
        <AlertTriangle size={17} />
        <span>{error}</span>
      </div>
    ) : null;
  }

  const progressPct = Math.min(100, Math.round(data.progress_pct));

  return (
    <button
      type="button"
      onClick={onNavigate}
      className="dawaa-card dawaa-card--interactive w-full p-5 text-right"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="dawaa-icon-tile h-9 w-9"><Wallet size={18} /></div>
          <span className="dawaa-title">حافزك المتوقع هذا الشهر</span>
        </div>
        <span className="dawaa-caption text-xs font-bold">اضغط لمزيد من التفاصيل ←</span>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <span className="dawaa-title text-4xl">{data.final_incentive_egp.toLocaleString('ar-EG')}</span>
        <span className="dawaa-title mb-1 text-lg">جنيه</span>
        <span className="dawaa-caption mb-1.5 text-xs font-bold">(نقطتك = {data.point_rate_egp} ج)</span>
      </div>

      <div className="dawaa-surface-soft mt-3 h-2.5 w-full overflow-hidden rounded-full">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${progressPct}%`, background: progressColor(progressPct) }}
        />
      </div>
      <p className="dawaa-caption mt-1.5 text-xs font-bold">
        {data.total_points} من {data.target_points} نقطة ({progressPct}%) — نقاط = {data.points_incentive_egp.toLocaleString('ar-EG')} ج
        {data.competition_bonus_egp > 0 ? ` + ${data.competition_bonus_egp.toLocaleString('ar-EG')} ج مسابقة` : ''}
      </p>

      {error ? (
        <div className="dawaa-alert dawaa-alert--warning mt-3 p-2.5 text-xs font-bold">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      ) : null}

      {data.competition_bonus_egp > 0 ? (
        <div className="dawaa-alert dawaa-alert--warning mt-3 p-2.5 text-xs font-black">
          <Trophy size={16} />
          <span>فايز في مسابقة بند هذا الشهر — {data.competition_bonus_egp} ج إضافية 🎉</span>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {pillars.map((pillar) => {
          const meta = PILLAR_META[pillar.pillar_key] || { label: pillar.pillar_key, icon: AlertTriangle };
          const Icon = meta.icon;
          return (
            <div key={pillar.pillar_key} className="dawaa-card dawaa-card--soft p-2 text-center">
              <Icon size={14} className="dawaa-muted mx-auto" />
              <p className="dawaa-title mt-1 text-sm">{pillar.points}</p>
              <p className="dawaa-caption text-[9px] font-bold leading-tight">{meta.label}</p>
              {pillar.has_competition_win ? (
                <span className="dawaa-badge dawaa-badge--warning mt-2 text-[9px]">فائز</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </button>
  );
}
