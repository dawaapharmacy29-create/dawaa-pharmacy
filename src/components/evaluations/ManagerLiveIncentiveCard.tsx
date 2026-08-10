import { useEffect, useState } from 'react';
import { Star, Gift, Loader2 } from 'lucide-react';
import {
  fetchManagerLiveIncentiveSnapshot,
  EVALUATION_TYPE_TO_ROLE_LABEL,
  type ManagerLiveIncentiveSnapshot,
} from '@/lib/evaluations/managerLiveIncentiveService';
import type { EvaluationType } from '@/lib/evaluations/managerEvaluationCriteria';
import type { CriticalGateType } from '@/lib/evaluations/incentiveTiers';

function formatCurrency(value: number) {
  return `${value.toLocaleString('ar-EG')} ج.م`;
}

export function ManagerLiveIncentiveCard({
  evaluationType,
  staffId,
  branch,
  activeGates = [],
}: {
  evaluationType: EvaluationType;
  staffId: string | null | undefined;
  branch: string | null;
  activeGates?: CriticalGateType[];
}) {
  const [snapshot, setSnapshot] = useState<ManagerLiveIncentiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!staffId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetchManagerLiveIncentiveSnapshot(evaluationType, staffId, branch, activeGates)
      .then((result) => {
        if (!cancelled) setSnapshot(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'تعذّر تحميل الحافز الحالي');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [evaluationType, staffId, branch, JSON.stringify(activeGates)]);

  if (!staffId) return null;

  return (
    <div className="rounded-2xl border border-teal-500/25 bg-gradient-to-br from-teal-950/40 to-slate-900/40 p-4">
      <h2 className="text-lg font-black text-white">نقاطي وحافزي الحالي — {EVALUATION_TYPE_TO_ROLE_LABEL[evaluationType]}</h2>
      <p className="mt-1 text-xs text-slate-400">
        محسوب مباشرة من أداء الأسبوع الجاري وتقييمات الدورة المعتمدة — بيتحدّث أول بأول، مش لازم ننتظر قفل الدورة.
      </p>

      {loading ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> جارٍ التحميل...
        </div>
      ) : error ? (
        <p className="mt-3 text-sm text-red-400">{error}</p>
      ) : !snapshot ? (
        <p className="mt-3 text-sm text-slate-400">مفيش سقف حافز مالي منفصل مربوط بالدور ده حاليًا.</p>
      ) : (
        <div className="mt-3 space-y-2 text-sm text-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5">
              <Star size={14} /> درجة الأسبوع الجاري: {snapshot.liveScore}/100
            </span>
            <span className="flex items-center gap-1.5">
              <Star size={14} /> متوسط الدورة الحالية: {snapshot.cycleAverageScore}/100
            </span>
          </div>
          <div className="rounded-xl bg-black/20 p-3">
            <div className="flex items-center gap-1.5 font-black text-teal-200">
              <Gift size={14} /> الحافز التقديري لو الدورة قفلت النهاردة: {formatCurrency(snapshot.estimatedIncentiveEgp)} من أصل {formatCurrency(snapshot.maxIncentiveEgp)}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              شريحة الأداء: {snapshot.tierLabel} → {snapshot.payoutPercent}% من السقف
              {snapshot.approvedWeeksInCycle > 0
                ? ` — مبني على ${snapshot.approvedWeeksInCycle} تقييم أسبوعي معتمد + الأسبوع الجاري`
                : ' — مفيش تقييم أسبوعي معتمد لسه هذا الشهر، الرقم من الأسبوع الجاري فقط'}
              . الرقم ده تقديري وقابل للتغيير لحد قفل الدورة رسميًا.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
