/**
 * تفصيل كامل لكل معيار في تقييم مدير الفرع/الفروع/خدمة العملاء — "تقييم كل جزء"
 * اللي طلبها المستخدم كتاب فوق صفحة المهام اليومية. بيعتمد على نفس EVALUATION_CRITERIA
 * ونفس البيانات اللي بيقرأها managerLiveIncentiveService، بس بيرجع تفصيل كل بند لوحده
 * بدل رقم إجمالي واحد بس.
 */
import {
  EVALUATION_CRITERIA,
  criterionChecklistKeys,
  type EvaluationType,
  type WeeklyAutoMetrics,
} from '@/lib/evaluations/managerEvaluationCriteria';
import {
  fetchWeeklyAutoMetrics,
  fetchWeeklyChecklistCompletion,
  weekBoundsOf,
  previousWeekOf,
} from '@/lib/evaluations/managerEvaluationService';

export type CriterionBreakdownRow = {
  key: string;
  label: string;
  mode: 'auto' | 'checklist' | 'manual';
  weight: number;
  score10: number; // من 0-10
  contribution: number; // من 0-100 (score10 * weight * 10)
  hint?: string;
};

export type ManagerScoreBreakdown = {
  weekStart: string;
  weekEnd: string;
  rows: CriterionBreakdownRow[];
  totalScore: number;
};

export async function fetchManagerScoreBreakdown(
  evaluationType: EvaluationType,
  subjectStaffId: string,
  branch: string | null
): Promise<ManagerScoreBreakdown> {
  const { start: weekStart, end: weekEnd } = weekBoundsOf(new Date());
  const previous = previousWeekOf(weekStart);

  const [current, prev, checklistRates] = await Promise.all([
    fetchWeeklyAutoMetrics(evaluationType, branch, weekStart, weekEnd),
    fetchWeeklyAutoMetrics(evaluationType, branch, previous.start, previous.end).catch(() => null as WeeklyAutoMetrics | null),
    fetchWeeklyChecklistCompletion(subjectStaffId, weekStart, weekEnd),
  ]);

  const criteria = EVALUATION_CRITERIA[evaluationType];
  const rows: CriterionBreakdownRow[] = criteria.map((criterion) => {
    let score10 = 0;
    if (criterion.mode === 'auto' && criterion.autoScore) {
      score10 = criterion.autoScore(current, prev);
    } else if (criterion.mode === 'checklist') {
      const keys = criterionChecklistKeys(criterion);
      const rates = keys.map((k) => checklistRates[k] ?? 0);
      const avgRate = rates.length ? rates.reduce((sum, r) => sum + r, 0) / rates.length : 0;
      score10 = avgRate / 10;
    } else {
      score10 = 0; // manual — لسه محتاج اعتماد المدير الأعلى، تقديريًا صفر لحد الاعتماد
    }
    score10 = Math.max(0, Math.min(10, score10));
    return {
      key: criterion.key,
      label: criterion.label,
      mode: criterion.mode,
      weight: criterion.weight,
      score10: Math.round(score10 * 10) / 10,
      contribution: Math.round(score10 * criterion.weight * 100 * 10) / 10,
      hint: criterion.hint,
    };
  });

  const totalScore = Math.round(rows.reduce((sum, r) => sum + r.contribution, 0) * 10) / 10;

  return { weekStart, weekEnd, rows, totalScore };
}
