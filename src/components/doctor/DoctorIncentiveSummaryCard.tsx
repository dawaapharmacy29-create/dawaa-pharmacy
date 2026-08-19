import { useEffect, useState } from 'react';
import { Award, TrendingUp, Trophy, Wallet } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type IncentiveTotal = {
  reward_points: number;
  deduction_points: number;
  final_points: number;
  target_points: number;
  base_incentive_egp: number;
  max_incentive_egp: number;
  target_bonus_egp: number;
  followup_bonus_egp: number;
  request_bonus_egp: number;
  star_bonus_egp: number;
  total_expected_egp: number;
};

export default function DoctorIncentiveSummaryCard({
  staffId,
  onNavigate,
}: {
  staffId: string;
  onNavigate?: () => void;
}) {
  const [data, setData] = useState<IncentiveTotal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!staffId) return;
    setLoading(true);
    void supabase
      .rpc('get_doctor_live_incentive_total', { p_doctor_id: staffId })
      .then(({ data: result }) => {
        if (cancelled) return;
        setData((result as IncentiveTotal) || null);
        setLoading(false);
      })
      .catch(() => {
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

  const extras = data.target_bonus_egp + data.followup_bonus_egp + data.request_bonus_egp + data.star_bonus_egp;
  const progressPct = Math.min(100, Math.round((data.final_points / data.target_points) * 100));

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
        <span className="text-4xl font-black text-white">{data.total_expected_egp.toLocaleString('ar-EG')}</span>
        <span className="mb-1 text-lg font-black text-teal-300">جنيه</span>
      </div>

      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={progressPct >= 80 ? 'h-full bg-emerald-400' : progressPct >= 40 ? 'h-full bg-amber-400' : 'h-full bg-rose-400'}
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs font-bold text-slate-400">
        {data.final_points} من {data.target_points} نقطة ({progressPct}%) — الحافز الأساسي {data.base_incentive_egp.toLocaleString('ar-EG')} جنيه
      </p>

      {extras > 0 ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {data.target_bonus_egp > 0 ? (
            <div className="rounded-xl bg-black/20 p-2.5 text-center">
              <TrendingUp size={16} className="mx-auto text-emerald-300" />
              <p className="mt-1 text-sm font-black text-white">{data.target_bonus_egp} ج</p>
              <p className="text-[10px] font-bold text-slate-400">حافز التارجت</p>
            </div>
          ) : null}
          {data.followup_bonus_egp > 0 ? (
            <div className="rounded-xl bg-black/20 p-2.5 text-center">
              <Award size={16} className="mx-auto text-cyan-300" />
              <p className="mt-1 text-sm font-black text-white">{data.followup_bonus_egp} ج</p>
              <p className="text-[10px] font-bold text-slate-400">هدف المتابعات</p>
            </div>
          ) : null}
          {data.request_bonus_egp > 0 ? (
            <div className="rounded-xl bg-black/20 p-2.5 text-center">
              <Award size={16} className="mx-auto text-purple-300" />
              <p className="mt-1 text-sm font-black text-white">{data.request_bonus_egp} ج</p>
              <p className="text-[10px] font-bold text-slate-400">هدف طلبات العملاء</p>
            </div>
          ) : null}
          {data.star_bonus_egp > 0 ? (
            <div className="rounded-xl bg-amber-500/10 p-2.5 text-center">
              <Trophy size={16} className="mx-auto text-amber-300" />
              <p className="mt-1 text-sm font-black text-white">{data.star_bonus_egp} ج</p>
              <p className="text-[10px] font-bold text-amber-200">نجم الفرع 🌟</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </button>
  );
}
