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
  if (!maxIncentiveEgp) return null; // customer_service مفيش ليها سقف مالي منفصل لسه

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

  // متوسط الدورة الحالية = تقييمات معتمدة (submitted) خلال الشهر الحالي + الدرجة الحية للأسبوع الجاري كتقدير له.
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const submittedThisMonth = (history || []).filter(
    (row: any) => row.status === 'submitted' && String(row.week_start || '').startsWith(monthKey)
  );
  const approvedScores = submittedThisMonth.map((row: any) => Number(row.total_score) || 0);
  const allScoresForCycle = [...approvedScores, liveScore];
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
    approvedWeeksInCycle: approvedScores.length,
    isEstimate: true,
  };
}

export const EVALUATION_TYPE_TO_ROLE_LABEL: Record<EvaluationType, string> = {
  branch_manager: 'مدير الفرع',
  branches_manager: 'مدير الفروع',
  customer_service: 'مسؤول خدمة العملاء',
};
