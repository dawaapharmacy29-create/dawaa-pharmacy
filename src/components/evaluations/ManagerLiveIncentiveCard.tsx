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
  if (score >= 90) return 'dawaa-badge--success';
  if (score >= 80) return 'dawaa-badge--info';
  if (score >= 60) return 'dawaa-badge--warning';
  return 'dawaa-badge--danger';
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
    <div className="dawaa-card dawaa-card--raised p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="dawaa-title text-lg">نقاطي وحافزي الحالي — {EVALUATION_TYPE_TO_ROLE_LABEL[evaluationType]}</h2>
          <p className="dawaa-caption mt-1 text-xs leading-5">
            كل أسبوع له تقييم وقيمة مستقلة. الأسبوع الجاري تقديري حتى الاعتماد، وبعد الاعتماد تُثبت الدرجة وقيمة الأسبوع داخل سجل الدورة.
          </p>
        </div>
        <div className="dawaa-icon-tile h-10 w-10"><Gift size={18} /></div>
      </div>

      {loading ? (
        <div className="dawaa-caption mt-3 flex items-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> جارٍ التحميل...
        </div>
      ) : error ? (
        <div className="dawaa-alert dawaa-alert--danger mt-3 text-sm">{error}</div>
      ) : !snapshot ? (
        <p className="dawaa-caption mt-3 text-sm">مفيش سقف حافز مالي منفصل مربوط بالدور ده حاليًا.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="dawaa-badge dawaa-badge--info"><Star size={14} /> درجة الأسبوع: {snapshot.liveScore}/100</span>
            <span className="dawaa-badge dawaa-badge--info"><Star size={14} /> متوسط الدورة: {snapshot.cycleAverageScore}/100</span>
            <span className="dawaa-badge dawaa-badge--info"><Database size={14} /> تغطية البيانات: {snapshot.dataCoveragePercent}%</span>
          </div>

          <div className="dawaa-card dawaa-card--soft p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="dawaa-title flex items-center gap-1.5 text-sm"><CalendarDays size={15} /> التقييم الأسبوعي وقيمة كل أسبوع</div>
                <div className="dawaa-caption mt-1 text-[11px]">
                  الدورة بها {snapshot.cycleWeekCount} أسابيع تقييمية، ونصيب الأسبوع الأساسي {formatCurrency(snapshot.weeklyBaseEgp)} قبل تطبيق شريحة الدرجة.
                </div>
              </div>
              <span className="dawaa-badge dawaa-badge--success">
                إجمالي المعتمد: {formatCurrency(snapshot.approvedWeeklyIncentiveEgp)}
              </span>
            </div>

            <div className="dawaa-table-shell">
              <table className="dawaa-table-semantic min-w-[650px] text-right text-xs">
                <thead>
                  <tr>
                    <th>الأسبوع</th>
                    <th>الدرجة</th>
                    <th>الشريحة</th>
                    <th>نسبة الصرف</th>
                    <th>قيمة الأسبوع</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.weeklyBreakdown.map((row) => (
                    <tr key={`${row.weekStart}-${row.status}`}>
                      <td>
                        <div className="dawaa-title text-xs">{row.weekStart}</div>
                        <div className="dawaa-caption mt-0.5 text-[10px]">إلى {row.weekEnd}</div>
                      </td>
                      <td><span className={`dawaa-badge ${scoreTone(row.score)}`}>{row.score}/100</span></td>
                      <td className="dawaa-text">{row.tierLabel}</td>
                      <td className="dawaa-text font-bold">{row.payoutPercent}%</td>
                      <td className="dawaa-title text-sm">{formatCurrency(row.weeklyIncentiveEgp)}</td>
                      <td>
                        {row.status === 'submitted' ? (
                          <span className="dawaa-badge dawaa-badge--success"><CheckCircle2 size={12} /> معتمد</span>
                        ) : (
                          <span className="dawaa-badge dawaa-badge--warning"><Clock3 size={12} /> تقديري حي</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="dawaa-card dawaa-card--soft p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <IncentiveMetric label="حافز الأداء المتوقع للدورة" value={formatCurrency(snapshot.performanceIncentiveEgp)} />
              <IncentiveMetric
                label="حافز التارجت الإضافي"
                value={snapshot.targetBonusEgp === null ? 'غير قابل للحساب' : formatCurrency(snapshot.targetBonusEgp)}
                hint={snapshot.targetAchievementPercent === null ? snapshot.targetBonusTierLabel : `${snapshot.targetAchievementPercent}% — ${snapshot.targetBonusTierLabel}`}
              />
              <IncentiveMetric label="إجمالي الحافز المتوقع" value={formatCurrency(snapshot.totalEstimatedIncentiveEgp)} tone="success" />
            </div>

            <div className="dawaa-caption mt-3 flex items-center gap-1.5 font-bold">
              <Gift size={14} /> حافز الأداء من أصل {formatCurrency(snapshot.maxIncentiveEgp)} للدورة، وحافز التارجت مستقل وإضافي.
            </div>

            <div className={`dawaa-alert mt-2 text-xs font-bold ${snapshot.payoutEligible ? 'dawaa-alert--success' : 'dawaa-alert--warning'}`}>
              {snapshot.payoutEligible ? 'مؤهل لتسوية حافز الأداء عند إغلاق الدورة.' : `غير مؤهل للصرف حاليًا: ${snapshot.eligibilityReasons.join(' ')}`}
            </div>

            <p className="dawaa-caption mt-2 text-xs leading-5">
              الدورة: {snapshot.cycleStart} إلى {snapshot.cycleEnd}. شريحة متوسط الدورة: {snapshot.tierLabel} → {snapshot.payoutPercent}% من السقف. القيمة النهائية للدورة تظل تقديرية حتى اكتمال واعتماد الأسابيع وإغلاق الدورة رسميًا.
            </p>

            {snapshot.neutralDataSources.length > 0 && (
              <div className="dawaa-alert dawaa-alert--warning mt-2 text-xs">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                توجد {snapshot.neutralDataSources.length} وحدات بلا بيانات كافية؛ احتُسبت بصورة محايدة ولم تُستبدل بتقدير شخصي.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IncentiveMetric({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint?: string; tone?: 'neutral' | 'success' }) {
  return (
    <div className="dawaa-card p-3">
      <div className="dawaa-caption text-[11px]">{label}</div>
      <div className="dawaa-title mt-1 text-sm">{value}</div>
      {tone === 'success' ? <span className="dawaa-badge dawaa-badge--success mt-2">تقدير إجمالي</span> : null}
      {hint ? <div className="dawaa-caption mt-1 text-[10px]">{hint}</div> : null}
    </div>
  );
}
