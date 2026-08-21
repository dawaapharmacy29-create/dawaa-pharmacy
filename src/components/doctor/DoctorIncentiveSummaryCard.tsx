import { useEffect, useState } from 'react';
import { AlertTriangle, MessageCircle, Package, ShieldCheck, TrendingUp, Trophy, UserRound, Wallet } from 'lucide-react';
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
  'محادثات': { label: 'المحادثات', icon: MessageCircle },
  'متابعات': { label: 'طلبات المتابعة', icon: UserRound },
  'طلبات العملاء': { label: 'طلبات العملاء', icon: Package },
  'الرواكد': { label: 'الرواكد', icon: Package },
  'الالتزام': { label: 'الالتزام', icon: ShieldCheck },
};

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

  useEffect(() => {
    let cancelled = false;
    if (!staffId) return;
    setLoading(true);
    void Promise.all([
      supabase.rpc('calculate_staff_incentive_egp', { p_staff_id: staffId }),
      supabase.rpc('get_doctor_pillar_breakdown', { p_staff_id: staffId }),
    ]).then(([incentiveRes, pillarRes]) => {
      if (cancelled) return;
      const row = Array.isArray(incentiveRes.data) ? incentiveRes.data[0] : incentiveRes.data;
      setData((row as IncentiveTotal) || null);
      setPillars((pillarRes.data as PillarRow[]) || []);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [staffId]);

  if (loading) {
    return (
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-teal-500/10 to-emerald-500/5 p-5">
        <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
      </div>
    );
  }

  if (!data) return null;

  const progressPct = Math.min(100, Math.round(data.progress_pct));

  return (
    <button
      type="button"
      onClick={onNavigate}
      className="w-full rounded-3xl border border-teal-400/25 bg-gradient-to-br from-teal-500/10 to-emerald-500/5 p-5 text-right transition hover:border-teal-400/40"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-teal-300">
          <Wallet size={20} />
          <span className="font-black">حافزك المتوقع هذا الشهر</span>
        </div>
        <span className="text-xs font-bold text-slate-400">اضغط لمزيد من التفاصيل ←</span>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span className="text-4xl font-black text-white">{data.final_incentive_egp.toLocaleString('ar-EG')}</span>
        <span className="mb-1 text-lg font-black text-teal-300">جنيه</span>
        <span className="mb-1.5 text-xs font-bold text-slate-400">(نقطتك = {data.point_rate_egp} ج)</span>
      </div>

      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={progressPct >= 80 ? 'h-full bg-emerald-400' : progressPct >= 40 ? 'h-full bg-amber-400' : 'h-full bg-rose-400'}
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs font-bold text-slate-400">
        {data.total_points} من {data.target_points} نقطة ({progressPct}%) — نقاط = {data.points_incentive_egp.toLocaleString('ar-EG')} ج
        {data.competition_bonus_egp > 0 ? ` + ${data.competition_bonus_egp.toLocaleString('ar-EG')} ج مسابقة` : ''}
      </p>

      {data.competition_bonus_egp > 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-400/30 p-2.5 text-amber-200">
          <Trophy size={16} />
          <span className="text-xs font-black">فايز في مسابقة بند هذا الشهر — {data.competition_bonus_egp} ج إضافية 🎉</span>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-5 gap-1.5">
        {pillars.map((pillar) => {
          const meta = PILLAR_META[pillar.pillar_key] || { label: pillar.pillar_key, icon: AlertTriangle };
          const Icon = meta.icon;
          return (
            <div
              key={pillar.pillar_key}
              className={`rounded-xl p-2 text-center ${pillar.has_competition_win ? 'bg-amber-500/15 border border-amber-400/30' : 'bg-black/20'}`}
            >
              <Icon size={14} className={`mx-auto ${pillar.has_competition_win ? 'text-amber-300' : 'text-teal-300'}`} />
              <p className="mt-1 text-sm font-black text-white">{pillar.points}</p>
              <p className="text-[9px] font-bold leading-tight text-slate-400">{meta.label}</p>
            </div>
          );
        })}
      </div>
    </button>
  );
}
