/**
 * "نقاطي وحافزي الحالي" لمدير الفرع / مدير الفروع / مسؤول خدمة العملاء.
 * يعرض الدرجة الحية، متوسط الدورة، وسجل قيمة كل أسبوع معتمد داخل دورة 26→25.
 */
import {
  EVALUATION_MAX_MONTHLY_INCENTIVE_EGP,
  computeTotalScore,
  type EvaluationType,
} from '@/lib/evaluations/managerEvaluationCriteria';
import {
  fetchWeeklyAutoMetrics,
  fetchWeeklyChecklistCompletion,
  weekBoundsOf,
  previousWeekOf,
  fetchEvaluationHistory,
  fetchManagerCycleSalesTargetSummary,
} from '@/lib/evaluations/managerEvaluationService';
import { calculateTieredIncentiveValue, type CriticalGateType } from '@/lib/evaluations/incentiveTiers';
import { formatCycleDate, getCurrentCycle, getCycleForDate } from '@/lib/pharmacy-cycle';
import { calculateTargetAchievementBonus } from '@/lib/incentives/targetAchievementBonus';
import { evaluatePerformanceIncentiveEligibility } from '@/lib/evaluations/incentiveEligibility';

export type ManagerWeeklyIncentiveBreakdown = {
  weekStart: string;
  weekEnd: string;
  score: number;
  tierLabel: string;
  payoutPercent: number;
  weeklyBaseEgp: number;
  weeklyIncentiveEgp: number;
  status: 'submitted' | 'live';
};

export type ManagerLiveIncentiveSnapshot = {
  evaluationType: EvaluationType;
  weekStart: string;
  weekEnd: string;
  liveScore: number;
  cycleAverageScore: number;
  maxIncentiveEgp: number;
  tierLabel: string;
  payoutPercent: number;
  estimatedIncentiveEgp: number;
  performanceIncentiveEgp: number;
  targetAchievementPercent: number | null;
  targetBonusEgp: number | null;
  targetBonusTierLabel: string;
  totalEstimatedIncentiveEgp: number;
  payoutEligible: boolean;
  eligibilityReasons: string[];
  approvedWeeksInCycle: number;
  cycleWeekCount: number;
  weeklyBaseEgp: number;
  weeklyBreakdown: ManagerWeeklyIncentiveBreakdown[];
  approvedWeeklyIncentiveEgp: number;
  cycleStart: string;
  cycleEnd: string;
  dataCoveragePercent: number;
  neutralDataSources: string[];
  isEstimate: true;
};

function dateOnly(date: Date) {
  return formatCycleDate(date);
}

/**
 * الأسبوع يتبع الدورة التي يقع فيها يوم إقفاله (الجمعة).
 * عدد أنصبة الحافز الأسبوعية = عدد أيام الجمعة الواقعة داخل الدورة 26→25.
 */
export function countEvaluationWeeksInCycle(cycleStart: Date, cycleEnd: Date): number {
  const cursor = new Date(cycleStart);
  cursor.setHours(12, 0, 0, 0);
  const end = new Date(cycleEnd);
  end.setHours(12, 0, 0, 0);
  let count = 0;
  while (cursor <= end) {
    if (cursor.getDay() === 5) count += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.max(1, count);
}

export function calculateWeeklyIncentiveForScore(
  evaluationType: EvaluationType,
  score: number,
  weekEnd: string,
  activeGates: CriticalGateType[] = []
) {
  const maxMonthly = EVALUATION_MAX_MONTHLY_INCENTIVE_EGP[evaluationType] || 0;
  const cycle = getCycleForDate(new Date(`${weekEnd.slice(0, 10)}T12:00:00`));
  const cycleWeekCount = countEvaluationWeeksInCycle(cycle.start, cycle.end);
  const weeklyBaseEgp = maxMonthly / cycleWeekCount;
  const { tier, payoutPercent } = calculateTieredIncentiveValue(score, weeklyBaseEgp, activeGates);
  const weeklyIncentiveEgp = Math.round((weeklyBaseEgp * payoutPercent) / 100);
  return { tier, payoutPercent, weeklyBaseEgp, weeklyIncentiveEgp, cycleWeekCount };
}

/** متوسط الدرجات المعتمدة في نفس الدورة + الدرجة الحية للأسبوع الجاري إن لم يُعتمد بعد. */
export async function fetchManagerLiveIncentiveSnapshot(
  evaluationType: EvaluationType,
  subjectStaffId: string,
  branch: string | null,
  activeGates: CriticalGateType[] = []
): Promise<ManagerLiveIncentiveSnapshot | null> {
  const maxIncentiveEgp = EVALUATION_MAX_MONTHLY_INCENTIVE_EGP[evaluationType];
  if (!maxIncentiveEgp) return null;

  const { start: weekStart, end: weekEnd } = weekBoundsOf(new Date());
  const previous = previousWeekOf(weekStart);
  const cycle = getCurrentCycle();
  const cycleStart = dateOnly(cycle.start);
  const cycleEnd = dateOnly(cycle.end);
  const today = formatCycleDate(new Date());
  const cycleWeekCount = countEvaluationWeeksInCycle(cycle.start, cycle.end);
  const weeklyBaseEgp = maxIncentiveEgp / cycleWeekCount;

  // مهم للأداء: لا نعيد تشغيل محرك التقييم الكامل على الدورة كلها.
  // المبيعات/التارجت للدورة تأتي من RPC خفيف ومفصول، بينما تغطية البيانات
  // تؤخذ من الأسبوع الجاري؛ وبذلك نقلل الضغط الذي كان يسبب statement timeout.
  const [current, prev, checklistRates, history, cycleSalesTarget] = await Promise.all([
    fetchWeeklyAutoMetrics(evaluationType, branch, weekStart, weekEnd),
    fetchWeeklyAutoMetrics(evaluationType, branch, previous.start, previous.end).catch(() => null),
    fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd, branch).catch(() => ({})),
    fetchEvaluationHistory(evaluationType, subjectStaffId, branch).catch(() => []),
    fetchManagerCycleSalesTargetSummary(evaluationType, branch, cycleStart, today).catch(() => null),
  ]);

  const liveScore = computeTotalScore(evaluationType, current, prev, {}, checklistRates);

  const submittedThisCycle = (history || []).filter((row: any) => {
    if (row.status !== 'submitted') return false;
    const evaluationDate = String(row.week_end || row.week_start || '').slice(0, 10);
    return evaluationDate >= cycleStart && evaluationDate <= cycleEnd;
  });

  const currentWeekSubmitted = submittedThisCycle.find(
    (row: any) => String(row.week_start || '').slice(0, 10) === weekStart
  );
  const approvedHistoricalScores = submittedThisCycle
    .filter((row: any) => String(row.week_start || '').slice(0, 10) !== weekStart)
    .map((row: any) => Number(row.total_score) || 0);
  const currentWeekScore = currentWeekSubmitted
    ? Number(currentWeekSubmitted.total_score) || 0
    : liveScore;
  const allScoresForCycle = [...approvedHistoricalScores, currentWeekScore];
  const cycleAverageScore =
    allScoresForCycle.reduce((sum, s) => sum + s, 0) / (allScoresForCycle.length || 1);

  const weeklyBreakdown: ManagerWeeklyIncentiveBreakdown[] = submittedThisCycle
    .map((row: any) => {
      const score = Math.round((Number(row.total_score) || 0) * 10) / 10;
      const end = String(row.week_end || row.week_start || '').slice(0, 10);
      const weekly = calculateWeeklyIncentiveForScore(evaluationType, score, end, activeGates);
      return {
        weekStart: String(row.week_start || '').slice(0, 10),
        weekEnd: end,
        score,
        tierLabel: weekly.tier.label,
        payoutPercent: weekly.payoutPercent,
        weeklyBaseEgp: Math.round(weekly.weeklyBaseEgp * 100) / 100,
        weeklyIncentiveEgp: weekly.weeklyIncentiveEgp,
        status: 'submitted' as const,
      };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  if (!currentWeekSubmitted) {
    const weekly = calculateWeeklyIncentiveForScore(evaluationType, liveScore, weekEnd, activeGates);
    weeklyBreakdown.push({
      weekStart,
      weekEnd,
      score: Math.round(liveScore * 10) / 10,
      tierLabel: weekly.tier.label,
      payoutPercent: weekly.payoutPercent,
      weeklyBaseEgp: Math.round(weekly.weeklyBaseEgp * 100) / 100,
      weeklyIncentiveEgp: weekly.weeklyIncentiveEgp,
      status: 'live',
    });
  }

  const approvedWeeklyIncentiveEgp = weeklyBreakdown
    .filter((row) => row.status === 'submitted')
    .reduce((sum, row) => sum + row.weeklyIncentiveEgp, 0);

  const { tier, payoutPercent, incentiveValue } = calculateTieredIncentiveValue(
    cycleAverageScore,
    maxIncentiveEgp,
    activeGates
  );
  const coverage = current.data_coverage || {};
  const coverageEntries = Object.entries(coverage);
  const dataCoveragePercent = coverageEntries.length
    ? Math.round((coverageEntries.filter(([, available]) => available).length / coverageEntries.length) * 100)
    : 0;
  const neutralDataSources = coverageEntries.filter(([, available]) => !available).map(([key]) => key);
  const targetBonus = cycleSalesTarget
    ? calculateTargetAchievementBonus(
        Number(cycleSalesTarget.sales_total || 0),
        Number(cycleSalesTarget.sales_target_amount || 0),
        evaluationType === 'customer_service' ? 'not_eligible' : 'manager'
      )
    : calculateTargetAchievementBonus(0, 0, evaluationType === 'customer_service' ? 'not_eligible' : 'manager');
  const eligibility = evaluatePerformanceIncentiveEligibility(submittedThisCycle.length, dataCoveragePercent);

  return {
    evaluationType,
    weekStart,
    weekEnd,
    liveScore: Math.round(liveScore * 10) / 10,
    cycleAverageScore: Math.round(cycleAverageScore * 10) / 10,
    maxIncentiveEgp,
    tierLabel: tier.label,
    payoutPercent,
    estimatedIncentiveEgp: incentiveValue,
    performanceIncentiveEgp: incentiveValue,
    targetAchievementPercent: cycleSalesTarget ? targetBonus.achievementPercent : null,
    targetBonusEgp: cycleSalesTarget ? targetBonus.amountEgp : null,
    targetBonusTierLabel: cycleSalesTarget ? targetBonus.tierLabel : 'تعذّر تحميل بيانات التارجت مؤقتًا',
    totalEstimatedIncentiveEgp: incentiveValue + Number(cycleSalesTarget ? targetBonus.amountEgp || 0 : 0),
    payoutEligible: eligibility.eligible,
    eligibilityReasons: eligibility.reasons,
    approvedWeeksInCycle: submittedThisCycle.length,
    cycleWeekCount,
    weeklyBaseEgp: Math.round(weeklyBaseEgp * 100) / 100,
    weeklyBreakdown,
    approvedWeeklyIncentiveEgp,
    cycleStart,
    cycleEnd,
    dataCoveragePercent,
    neutralDataSources,
    isEstimate: true,
  };
}

export const EVALUATION_TYPE_TO_ROLE_LABEL: Record<EvaluationType, string> = {
  branch_manager: 'مدير الفرع',
  branches_manager: 'مدير الفروع',
  customer_service: 'مدير خدمة العملاء',
};
