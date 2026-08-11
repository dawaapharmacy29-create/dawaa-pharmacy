import type { IncentiveSnapshot } from '@/lib/incentives/incentiveGovernanceService';

export type IncentiveHistoryPoint = IncentiveSnapshot & {
  cycleStart: string;
  cycleEnd: string;
  cycleStatus: string;
};

export type PerformanceInsight = {
  level: 'good' | 'warning' | 'critical' | 'info';
  title: string;
  detail: string;
};

const change = (current: number | null, previous: number | null) =>
  current === null || previous === null ? null : Math.round((current - previous) * 10) / 10;

export function compareHistory(points: IncentiveHistoryPoint[]) {
  const current = points[0];
  const previous = points[1];
  return {
    score: current && previous ? change(current.performanceScore, previous.performanceScore) : null,
    coverage:
      current && previous
        ? change(current.dataCoveragePercent, previous.dataCoveragePercent)
        : null,
    sales: current && previous ? change(current.salesAmount, previous.salesAmount) : null,
    total: current && previous ? change(current.totalIncentive, previous.totalIncentive) : null,
  };
}

export function buildPerformanceInsights(points: IncentiveHistoryPoint[]): PerformanceInsight[] {
  const current = points[0];
  if (!current)
    return [
      {
        level: 'info',
        title: 'لا يوجد تاريخ متاح',
        detail: 'تظهر التحليلات بعد إنشاء لقطة موظف للدورة.',
      },
    ];

  const previous = points[1];
  const differences = compareHistory(points);
  const insights: PerformanceInsight[] = [];

  if (current.approvedWeeks < 3) {
    insights.push({
      level: 'critical',
      title: 'التقييم الأسبوعي غير مكتمل',
      detail: `المعتمد ${current.approvedWeeks} من 3 أسابيع مطلوبة على الأقل.`,
    });
  }
  if (current.dataCoveragePercent === null) {
    insights.push({
      level: 'critical',
      title: 'مصادر الأداء غير مكتملة',
      detail: 'نسبة التغطية غير متاحة؛ يجب استكمال ربط المصادر قبل التسوية.',
    });
  } else if (current.dataCoveragePercent < 80) {
    insights.push({
      level: 'critical',
      title: 'تغطية البيانات أقل من الحد',
      detail: `التغطية ${current.dataCoveragePercent}%، والمطلوب 80% على الأقل.`,
    });
  }
  if (
    current.targetAmount > 0 &&
    current.targetAchievementPercent !== null &&
    current.targetAchievementPercent < 90
  ) {
    insights.push({
      level: 'warning',
      title: 'التارجت دون شريحة الحافز',
      detail: `التحقيق ${current.targetAchievementPercent}%؛ أول شريحة تبدأ من 90%.`,
    });
  }
  if (differences.score !== null && differences.score <= -5) {
    insights.push({
      level: 'warning',
      title: 'تراجع ملحوظ في الأداء',
      detail: `انخفضت الدرجة ${Math.abs(differences.score)} نقطة مقارنة بالدورة السابقة.`,
    });
  }
  if (differences.coverage !== null && differences.coverage < 0) {
    insights.push({
      level: 'warning',
      title: 'انخفاض تغطية البيانات',
      detail: `انخفضت التغطية ${Math.abs(differences.coverage)} نقطة مئوية؛ راجع المصادر غير الواصلة.`,
    });
  }
  if (current.eligibilityReasons.length) {
    insights.push({
      level: 'info',
      title: 'أسباب تحتاج معالجة',
      detail: current.eligibilityReasons.join('، '),
    });
  }
  if (!insights.length) {
    insights.push({
      level: 'good',
      title: 'المؤشرات مستقرة',
      detail: previous
        ? 'لا توجد إشارة تراجع جوهرية مقارنة بالدورة السابقة.'
        : 'اللقطة الحالية مستوفية ولا توجد موانع ظاهرة.',
    });
  }
  return insights.slice(0, 5);
}
