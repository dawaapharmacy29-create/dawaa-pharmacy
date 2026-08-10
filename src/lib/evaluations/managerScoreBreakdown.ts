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
  mode: 'auto' | 'checklist';
  weight: number;
  score10: number; // من 0-10
  contribution: number; // من 0-100 (score10 * weight * 10)
  hint?: string;
  sourceRoute?: string;
  sourceLabel?: string;
  coverageState: 'available' | 'neutral_missing_data' | 'documented_task';
  coverageMessage: string;
};

export type ManagerDataCoverageItem = {
  key: string;
  label: string;
  available: boolean;
  route: string;
};

export type ManagerScoreBreakdown = {
  weekStart: string;
  weekEnd: string;
  rows: CriterionBreakdownRow[];
  totalScore: number;
  coveragePercent: number;
  coverage: ManagerDataCoverageItem[];
};

const COVERAGE_META: Record<string, { label: string; route: string }> = {
  sales: { label: 'المبيعات والفواتير', route: '/invoices' },
  targets: { label: 'تارجت الدورة', route: '/daily-target' },
  purchases: { label: 'المشتريات', route: '/purchases' },
  inventory: { label: 'الجرد والمخزون', route: '/inventory-counts' },
  followups: { label: 'متابعات العملاء', route: '/customer-service' },
  attendance: { label: 'الحضور والبصمة', route: '/attendance-report' },
  customers: { label: 'بيانات العملاء', route: '/customers' },
  reviews: { label: 'تقييمات الدكاترة', route: '/reviews' },
  points: { label: 'نقاط العملاء', route: '/customer-points-ledger' },
  customer_requests: { label: 'طلبات العملاء', route: '/customer-requests' },
  shift_notes: { label: 'ملاحظات الشيفت', route: '/shift-notes' },
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
    }
    score10 = Math.max(0, Math.min(10, score10));
    const coverageValues = (criterion.coverageKeys || []).map((key) => current.data_coverage?.[key] === true);
    const hasOperationalData = coverageValues.some(Boolean);
    const coverageState = criterion.mode === 'checklist'
      ? 'documented_task'
      : hasOperationalData
        ? 'available'
        : 'neutral_missing_data';
    return {
      key: criterion.key,
      label: criterion.label,
      mode: criterion.mode,
      weight: criterion.weight,
      score10: Math.round(score10 * 10) / 10,
      contribution: Math.round(score10 * criterion.weight * 10 * 10) / 10,
      hint: criterion.hint,
      sourceRoute: criterion.sourceRoute,
      sourceLabel: criterion.sourceLabel,
      coverageState,
      coverageMessage: coverageState === 'documented_task'
        ? 'الدرجة من إنجاز مهمة مسجلة باسم الموظف وتاريخها.'
        : coverageState === 'available'
          ? 'بيانات المصدر متاحة ودخلت في الحساب.'
          : 'بيانات المصدر غير متاحة في الفترة؛ طُبّقت الدرجة المحايدة بدون تخمين.',
    };
  });

  const totalScore = Math.round(rows.reduce((sum, r) => sum + r.contribution, 0) * 10) / 10;

  const coverage = Object.entries(COVERAGE_META).map(([key, meta]) => ({
    key,
    label: meta.label,
    route: meta.route,
    available: current.data_coverage?.[key] === true,
  }));
  const coveragePercent = Math.round((coverage.filter((item) => item.available).length / coverage.length) * 100);

  return { weekStart, weekEnd, rows, totalScore, coveragePercent, coverage };
}
