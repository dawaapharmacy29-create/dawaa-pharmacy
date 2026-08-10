/**
 * "نقاطي وحافزي الحالي" لمدير الفرع / مدير الفروع / مسؤول خدمة العملاء.
 * نفس فلسفة اللي شغالة بالفعل للدكتور في DoctorDashboardStable: رقم تقديري بيتحدث
 * أول بأول من بيانات الأسبوع الجاري، مش لازم ننتظر قفل الدورة أو التقييم الرسمي.
 *
 * بيعتمد بالكامل على البنية الموجودة (managerEvaluationCriteria + managerEvaluationService)
 * — مفيش Backend جديد هنا، غير قراءة نفس الـ RPCs الموجودة زائد شرائح الحافز الجديدة.
 */
import {
  EVALUATION_CRITERIA,
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
} from '@/lib/evaluations/managerEvaluationService';
import { calculateTieredIncentiveValue, type CriticalGateType } from '@/lib/evaluations/incentiveTiers';
import { formatCycleDate, getCurrentCycle } from '@/lib/pharmacy-cycle';

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
  approvedWeeksInCycle: number;
  isEstimate: true;
};

/** متوسط الدرجات المعتمدة (status = submitted) في نفس الدورة (الشهر الحالي)، + الدرجة الحية للأسبوع الجاري. */
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

  const [current, prev, checklistRates, history] = await Promise.all([
    fetchWeeklyAutoMetrics(evaluationType, branch, weekStart, weekEnd),
    fetchWeeklyAutoMetrics(evaluationType, branch, previous.start, previous.end).catch(() => null),
    fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd),
    fetchEvaluationHistory(evaluationType, subjectStaffId),
  ]);

  // الدرجة الحية: نفس محرك computeTotalScore، بمعايير auto+checklist بس (manual = 0 لحد ما المدير يعتمدها فعليًا،
  // عشان الرقم يفضل تقديري ومحافظ ومايديش انطباع أعلى من الحقيقي قبل مراجعة المدير الأعلى).
  const liveScore = computeTotalScore(evaluationType, current, prev, {}, checklistRates);

  // دورة صيدليات دواء ثابتة من يوم 26 إلى 25، وليست الشهر الميلادي.
  const cycle = getCurrentCycle();
  const cycleStart = formatCycleDate(cycle.start);
  const cycleEnd = formatCycleDate(cycle.end);
  const submittedThisCycle = (history || []).filter((row: any) => {
    if (row.status !== 'submitted') return false;
    const evaluationDate = String(row.week_start || '').slice(0, 10);
    return evaluationDate >= cycleStart && evaluationDate <= cycleEnd;
  });
  // لو الأسبوع الجاري اتعمد بالفعل، نستخدم الدرجة المعتمدة بدل إضافة الدرجة الحية
  // مرة ثانية؛ كده كل أسبوع يدخل في متوسط الدورة مرة واحدة فقط.
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

  const { tier, payoutPercent, incentiveValue } = calculateTieredIncentiveValue(
    cycleAverageScore,
    maxIncentiveEgp,
    activeGates
  );

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
    approvedWeeksInCycle: submittedThisCycle.length,
    isEstimate: true,
  };
}

export const EVALUATION_TYPE_TO_ROLE_LABEL: Record<EvaluationType, string> = {
  branch_manager: 'مدير الفرع',
  branches_manager: 'مدير الفروع',
  customer_service: 'مدير خدمة العملاء',
};
