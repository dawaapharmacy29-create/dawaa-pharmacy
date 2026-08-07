export type EvaluationType = 'branch_manager' | 'branches_manager' | 'customer_service';

export type WeeklyAutoMetrics = {
  sales_total: number;
  purchases_total: number;
  purchases_count: number;
  inventory_sessions_due: number;
  inventory_closed_on_time: number;
  inventory_overdue: number;
  followups_total: number;
  followups_expired: number;
  followups_closed: number;
  attendance_late_minutes: number;
  attendance_missing_punch: number;
  active_customers: number;
  vip_customers: number;
  vip_customers_still_active: number;
  vip_retention_rate: number | null;
};

export type EvaluationCriterion = {
  key: string;
  label: string;
  weight: number;
  mode: 'auto' | 'manual' | 'checklist';
  hint?: string;
  /** لعناصر auto فقط — بيحسب درجة من 0-10 من المقاييس (الحالية + السابقة للمقارنة). */
  autoScore?: (current: WeeklyAutoMetrics, previous: WeeklyAutoMetrics | null) => number;
  /** لعناصر checklist فقط — مفتاح المهمة اليومية اللي معدل إنجازها الأسبوعي بيحدد الدرجة. */
  checklistTaskKey?: string;
};

function ratio(part: number, total: number): number {
  if (!total) return 0;
  return part / total;
}

/** نمو المبيعات مقارنة بالأسبوع السابق — 5 نقطة أساس + مكافأة/خصم حسب نسبة النمو. */
function salesGrowthScore(current: WeeklyAutoMetrics, previous: WeeklyAutoMetrics | null): number {
  if (!previous || !previous.sales_total) return 5;
  const growthPct = ((current.sales_total - previous.sales_total) / previous.sales_total) * 100;
  return Math.max(0, Math.min(10, 5 + growthPct / 5));
}

/** جودة إغلاق المتابعات: نسبة المغلق من الإجمالي، بعد خصم وزن المنتهي بدون رد. */
function followupClosureScore(current: WeeklyAutoMetrics): number {
  const closedRatio = ratio(current.followups_closed, current.followups_total);
  const expiredPenalty = ratio(current.followups_expired, current.followups_total);
  return Math.max(0, Math.min(10, closedRatio * 10 - expiredPenalty * 5));
}

function vipRetentionScore(current: WeeklyAutoMetrics): number {
  if (current.vip_retention_rate === null) return 5;
  return Math.max(0, Math.min(10, current.vip_retention_rate / 10));
}

function weekOverWeekImprovementScore(current: WeeklyAutoMetrics, previous: WeeklyAutoMetrics | null): number {
  if (!previous) return 5;
  const currentClosure = ratio(current.followups_closed, current.followups_total);
  const previousClosure = ratio(previous.followups_closed, previous.followups_total);
  const delta = (currentClosure - previousClosure) * 100;
  return Math.max(0, Math.min(10, 5 + delta / 4));
}

export const EVALUATION_CRITERIA: Record<EvaluationType, EvaluationCriterion[]> = {
  branch_manager: [
    {
      key: 'sales',
      label: 'أداء المبيعات (مقارنة بالأسبوع السابق)',
      weight: 0.2,
      mode: 'auto',
      autoScore: salesGrowthScore,
      hint: 'محسوبة تلقائيًا من إجمالي مبيعات الفرع مقارنة بالأسبوع اللي فات.',
    },
    {
      key: 'customer_service',
      label: 'خدمة العملاء والمتابعات',
      weight: 0.2,
      mode: 'auto',
      autoScore: followupClosureScore,
      hint: 'محسوبة تلقائيًا من نسبة إغلاق المتابعات مقابل المنتهي بدون رد.',
    },
    {
      key: 'vip_retention',
      label: 'الاحتفاظ بكبار العملاء',
      weight: 0.1,
      mode: 'auto',
      autoScore: vipRetentionScore,
      hint: 'محسوبة تلقائيًا من نسبة كبار العملاء اللي فضلوا نشطين.',
    },
    {
      key: 'cash_integrity',
      label: 'الضبط المالي اليومي (مطابقة الكاش)',
      weight: 0.1,
      mode: 'checklist',
      checklistTaskKey: 'cash_reconciliation',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي اتسجّلت فيها مطابقة الكاش والعهدة فعليًا.',
    },
    {
      key: 'complaints_handling',
      label: 'التعامل مع الشكاوى المتصاعدة',
      weight: 0.1,
      mode: 'checklist',
      checklistTaskKey: 'complaints_escalation',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي اتراجعت فيها الشكاوى المتصاعدة وحلولها.',
    },
    {
      key: 'purchases',
      label: 'مراجعة المشتريات وإدارة الموردين',
      weight: 0.1,
      mode: 'checklist',
      checklistTaskKey: 'purchases_review',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي سجّل فيها المدير مراجعة المشتريات فعليًا في المهام اليومية.',
    },
    {
      key: 'inventory',
      label: 'متابعة الجرد والمخزون',
      weight: 0.1,
      mode: 'checklist',
      checklistTaskKey: 'inventory_review',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي سجّل فيها المدير متابعة الجرد فعليًا في المهام اليومية.',
    },
    {
      key: 'attendance',
      label: 'الحضور والانضباط لفريق الفرع',
      weight: 0.1,
      mode: 'manual',
      hint: 'لسه مش متتبّعة تلقائيًا في النظام — تقييم يدوي من مدير الفروع.',
    },
  ],
  branches_manager: [
    {
      key: 'sales',
      label: 'أداء المبيعات الكلي (الفرعين معًا)',
      weight: 0.2,
      mode: 'auto',
      autoScore: salesGrowthScore,
    },
    {
      key: 'customer_service',
      label: 'جودة خدمة العملاء الكلية',
      weight: 0.2,
      mode: 'auto',
      autoScore: followupClosureScore,
    },
    {
      key: 'vip_retention',
      label: 'الاحتفاظ بكبار العملاء على مستوى الفروع',
      weight: 0.1,
      mode: 'auto',
      autoScore: vipRetentionScore,
    },
    {
      key: 'coordination',
      label: 'جودة سير العمل والتنسيق بين الفروع',
      weight: 0.1,
      mode: 'manual',
    },
    {
      key: 'warehouse',
      label: 'متابعة المخزن المركزي',
      weight: 0.1,
      mode: 'checklist',
      checklistTaskKey: 'warehouse_review',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي اتسجّلت فيها متابعة المخزن المركزي فعليًا.',
    },
    {
      key: 'budget_control',
      label: 'مراجعة المصروفات والميزانية التشغيلية',
      weight: 0.1,
      mode: 'checklist',
      checklistTaskKey: 'budget_expense_review',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي اتراجعت فيها المصروفات فعليًا مقابل الميزانية.',
    },
    {
      key: 'supplier_relations',
      label: 'متابعة علاقات الموردين الاستراتيجيين',
      weight: 0.05,
      mode: 'checklist',
      checklistTaskKey: 'supplier_relations_review',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي اتابعت فيها علاقات الموردين فعليًا.',
    },
    {
      key: 'leadership',
      label: 'القدرة على القيادة واتخاذ القرار',
      weight: 0.15,
      mode: 'manual',
    },
  ],
  customer_service: [
    {
      key: 'closure_rate',
      label: 'نسبة إغلاق المتابعات',
      weight: 0.25,
      mode: 'auto',
      autoScore: followupClosureScore,
    },
    {
      key: 'expired_control',
      label: 'التحكم في المتابعات المنتهية بدون رد',
      weight: 0.2,
      mode: 'auto',
      autoScore: (c) => Math.max(0, Math.min(10, 10 - ratio(c.followups_expired, c.followups_total) * 20)),
    },
    {
      key: 'vip_retention',
      label: 'الاحتفاظ بكبار العملاء',
      weight: 0.25,
      mode: 'auto',
      autoScore: vipRetentionScore,
    },
    {
      key: 'week_over_week',
      label: 'التحسن أسبوع عن أسبوع',
      weight: 0.15,
      mode: 'auto',
      autoScore: weekOverWeekImprovementScore,
      hint: 'محسوبة تلقائيًا من مقارنة نسبة إغلاق المتابعات بالأسبوع اللي فات.',
    },
    {
      key: 'communication_quality',
      label: 'جودة التواصل والتعامل مع الشكاوى',
      weight: 0.15,
      mode: 'manual',
      hint: 'تقييم كيفي من واقع مراجعة المحادثات — يدوي.',
    },
  ],
};

export const EVALUATION_TYPE_LABELS: Record<EvaluationType, string> = {
  branch_manager: 'تقييم مدير الفرع',
  branches_manager: 'تقييم مدير الفروع',
  customer_service: 'تقييم أداء خدمة العملاء الأسبوعي',
};

/**
 * سقف الحافز الشهري بالجنيه عند متوسط تقييم 100/100 خلال الدورة — الحافز
 * الفعلي = (متوسط درجات التقييمات المعتمدة في الدورة / 100) × السقف.
 * customer_service مفيش ليها حافز مالي منفصل هنا (خارج نطاق هذه المرحلة).
 */
export const EVALUATION_MAX_MONTHLY_INCENTIVE_EGP: Partial<Record<EvaluationType, number>> = {
  branch_manager: 3000,
  branches_manager: 4000,
};

export function computeTotalScore(
  type: EvaluationType,
  current: WeeklyAutoMetrics,
  previous: WeeklyAutoMetrics | null,
  manualScores: Record<string, number>,
  checklistRates: Record<string, number> = {}
): number {
  const criteria = EVALUATION_CRITERIA[type];
  let total = 0;
  for (const criterion of criteria) {
    let score: number;
    if (criterion.mode === 'auto' && criterion.autoScore) {
      score = criterion.autoScore(current, previous);
    } else if (criterion.mode === 'checklist' && criterion.checklistTaskKey) {
      score = (checklistRates[criterion.checklistTaskKey] ?? 0) / 10;
    } else {
      score = manualScores[criterion.key] ?? 0;
    }
    total += score * criterion.weight;
  }
  // الدرجة النهائية من 100 (كل معيار من 10 × وزنه، مجموع الأوزان = 1، فالمجموع من 10 × 10 = 100)
  return Math.round(total * 10 * 10) / 10;
}
