import { useEffect, useState } from 'react';
import { Star, Gift, Loader2, Database, AlertTriangle, CalendarDays, CheckCircle2, Clock3 } from 'lucide-react';
import {
  fetchManagerLiveIncentiveSnapshot,
  EVALUATION_TYPE_TO_ROLE_LABEL,
  type ManagerLiveIncentiveSnapshot,
} from '@/lib/evaluations/managerLiveIncentiveService';
import type { EvaluationType } from '@/lib/evaluations/managerEvaluationCriteria';
import type { CriticalGateType } from '@/lib/evaluations/incentiveTiers';

function formatCurrency(value: number) {
  return `${value.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ج.م`;
}

function scoreTone(score: number) {
  if (score >= 90) return 'text-emerald-300';
  if (score >= 80) return 'text-teal-300';
  if (score >= 60) return 'text-amber-300';
  return 'text-red-300';
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
        كل أسبوع له تقييم وقيمة مستقلة. الأسبوع الجاري تقديري حتى الاعتماد، وبعد الاعتماد تُثبت الدرجة وقيمة الأسبوع داخل سجل الدورة.
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
        <div className="mt-3 space-y-3 text-sm text-slate-200">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5">
              <Star size={14} /> درجة الأسبوع الجاري: {snapshot.liveScore}/100
            </span>
            <span className="flex items-center gap-1.5">
              <Star size={14} /> متوسط الدورة الحالية: {snapshot.cycleAverageScore}/100
            </span>
            <span className="flex items-center gap-1.5">
              <Database size={14} /> تغطية البيانات: {snapshot.dataCoveragePercent}%
            </span>
          </div>

          <div className="rounded-xl border border-teal-500/15 bg-black/20 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 font-black text-white"><CalendarDays size={15} className="text-teal-300" /> التقييم الأسبوعي وقيمة كل أسبوع</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  الدورة بها {snapshot.cycleWeekCount} أسابيع تقييمية، ونصيب الأسبوع الأساسي {formatCurrency(snapshot.weeklyBaseEgp)} قبل تطبيق شريحة الدرجة.
                </div>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 px-3 py-2 text-xs font-bold text-emerald-200">
                إجمالي الأسابيع المعتمدة: {formatCurrency(snapshot.approvedWeeklyIncentiveEgp)}
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/5">
              <table className="w-full min-w-[650px] text-right text-xs">
                <thead className="bg-slate-950/60 text-slate-400">
                  <tr>
                    <th className="px-3 py-2.5">الأسبوع</th>
                    <th className="px-3 py-2.5">الدرجة</th>
                    <th className="px-3 py-2.5">الشريحة</th>
                    <th className="px-3 py-2.5">نسبة الصرف</th>
                    <th className="px-3 py-2.5">قيمة الأسبوع</th>
                    <th className="px-3 py-2.5">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.weeklyBreakdown.map((row) => (
                    <tr key={`${row.weekStart}-${row.status}`} className="border-t border-white/5 bg-black/10">
                      <td className="px-3 py-3">
                        <div className="font-bold text-white">{row.weekStart}</div>
                        <div className="mt-0.5 text-[10px] text-slate-500">إلى {row.weekEnd}</div>
                      </td>
                      <td className={`px-3 py-3 text-base font-black ${scoreTone(row.score)}`}>{row.score}/100</td>
                      <td className="px-3 py-3 text-slate-300">{row.tierLabel}</td>
                      <td className="px-3 py-3 font-bold text-slate-200">{row.payoutPercent}%</td>
                      <td className="px-3 py-3 text-base font-black text-teal-200">{formatCurrency(row.weeklyIncentiveEgp)}</td>
                      <td className="px-3 py-3">
                        {row.status === 'submitted' ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-950/20 px-2 py-1 font-bold text-emerald-300"><CheckCircle2 size={12} /> معتمد</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-950/20 px-2 py-1 font-bold text-amber-300"><Clock3 size={12} /> تقديري حي</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl bg-black/20 p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-white/5 bg-slate-950/30 p-2"><div className="text-[11px] text-slate-400">حافز الأداء المتوقع للدورة</div><div className="mt-1 font-black text-teal-200">{formatCurrency(snapshot.performanceIncentiveEgp)}</div></div>
              <div className="rounded-lg border border-white/5 bg-slate-950/30 p-2"><div className="text-[11px] text-slate-400">حافز التارجت الإضافي</div><div className="mt-1 font-black text-amber-200">{snapshot.targetBonusEgp === null ? 'غير قابل للحساب' : formatCurrency(snapshot.targetBonusEgp)}</div><div className="mt-0.5 text-[10px] text-slate-500">{snapshot.targetAchievementPercent === null ? snapshot.targetBonusTierLabel : `${snapshot.targetAchievementPercent}% — ${snapshot.targetBonusTierLabel}`}</div></div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-2"><div className="text-[11px] text-emerald-300">إجمالي الحافز المتوقع</div><div className="mt-1 font-black text-emerald-200">{formatCurrency(snapshot.totalEstimatedIncentiveEgp)}</div></div>
            </div>
            <div className="mt-2 flex items-center gap-1.5 font-black text-teal-200"><Gift size={14} /> حافز الأداء من أصل {formatCurrency(snapshot.maxIncentiveEgp)} للدورة، وحافز التارجت مستقل وإضافي.</div>
            <div className={`mt-2 rounded-lg border p-2 text-xs font-bold ${snapshot.payoutEligible ? 'border-emerald-500/20 bg-emerald-950/20 text-emerald-300' : 'border-amber-500/20 bg-amber-950/20 text-amber-200'}`}>
              {snapshot.payoutEligible ? 'مؤهل لتسوية حافز الأداء عند إغلاق الدورة.' : `غير مؤهل للصرف حاليًا: ${snapshot.eligibilityReasons.join(' ')}`}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              الدورة: {snapshot.cycleStart} إلى {snapshot.cycleEnd}. شريحة متوسط الدورة: {snapshot.tierLabel} → {snapshot.payoutPercent}% من السقف.
              {' '}القيمة النهائية للدورة تظل تقديرية حتى اكتمال واعتماد الأسابيع وإغلاق الدورة رسميًا.
            </p>
            {snapshot.neutralDataSources.length > 0 && (
              <p className="mt-2 flex items-start gap-1 text-xs text-amber-300">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                توجد {snapshot.neutralDataSources.length} وحدات بلا بيانات كافية؛ احتُسبت بصورة محايدة ولم تُستبدل بتقدير شخصي.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
