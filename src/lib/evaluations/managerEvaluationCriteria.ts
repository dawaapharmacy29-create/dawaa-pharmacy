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
  conversation_reviews_count: number;
  conversation_reviews_avg_score: number | null;
  points_transactions_total: number;
  points_transactions_contacted: number;
  new_customers_count: number;
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
  /** لعناصر checklist اللي بتتغذى من أكتر من بند فرعي — بيتاخد متوسط معدلات الإنجاز لكل المفاتيح. له أولوية على checklistTaskKey لو الاتنين موجودين. */
  checklistTaskKeys?: string[];
};

/** بيرجع كل مفاتيح الـ Checklist المرتبطة بمعيار معيّن (سواء مفتاح واحد أو أكتر). */
export function criterionChecklistKeys(criterion: EvaluationCriterion): string[] {
  if (criterion.checklistTaskKeys?.length) return criterion.checklistTaskKeys;
  if (criterion.checklistTaskKey) return [criterion.checklistTaskKey];
  return [];
}

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

/**
 * تقييم المحادثات وتحسين أداء الدكاترة: نصف الدرجة من مدى نشاط المراجعة نفسها
 * (هل مسئول خدمة العملاء بيراجع محادثات كفاية؟ هدف مرجعي 10 مراجعات/أسبوع)،
 * ونصها التاني من متوسط درجة المحادثات (هل الدكاترة فعلًا بيتحسنوا؟).
 */
function conversationQualityScore(current: WeeklyAutoMetrics): number {
  const activityScore = Math.max(0, Math.min(10, (current.conversation_reviews_count / 10) * 10));
  const qualityScore =
    current.conversation_reviews_avg_score !== null
      ? Math.max(0, Math.min(10, current.conversation_reviews_avg_score / 10))
      : 5;
  return activityScore * 0.4 + qualityScore * 0.6;
}

/** متابعة نقاط العملاء وإبلاغهم: نسبة معاملات النقاط اللي اتبلّغ فيها العميل فعليًا. */
function pointsCommunicationScore(current: WeeklyAutoMetrics): number {
  if (!current.points_transactions_total) return 5; // مفيش معاملات نقاط الأسبوع ده أصلًا — محايد
  return Math.max(0, Math.min(10, ratio(current.points_transactions_contacted, current.points_transactions_total) * 10));
}

/** نمو عدد العملاء: مقارنة عدد العملاء الجدد بالأسبوع اللي فات. */
function customerGrowthScore(current: WeeklyAutoMetrics, previous: WeeklyAutoMetrics | null): number {
  if (!previous || !previous.new_customers_count) return 5;
  const growthPct = ((current.new_customers_count - previous.new_customers_count) / previous.new_customers_count) * 100;
  return Math.max(0, Math.min(10, 5 + growthPct / 10));
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
      weight: 0.15,
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
      weight: 0.08,
      mode: 'checklist',
      checklistTaskKey: 'purchases_review',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي سجّل فيها المدير مراجعة المشتريات فعليًا في المهام اليومية.',
    },
    {
      key: 'inventory',
      label: 'متابعة الجرد والمخزون',
      weight: 0.08,
      mode: 'checklist',
      checklistTaskKey: 'inventory_review',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي سجّل فيها المدير متابعة الجرد فعليًا في المهام اليومية.',
    },
    {
      key: 'shortages_handling',
      label: 'حسن التصرف في النواقص ومكانها المخصص',
      weight: 0.05,
      mode: 'checklist',
      checklistTaskKey: 'shortages_handling',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي اتسجّل فيها التعامل مع النواقص فعليًا.',
    },
    {
      key: 'expiry_compliance',
      label: 'الالتزام بمراجعة أصناف الإكسباير',
      weight: 0.04,
      mode: 'checklist',
      checklistTaskKey: 'expiry_check',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي اتسجّلت فيها مراجعة الإكسباير فعليًا.',
    },
    {
      key: 'shift_briefing',
      label: 'تسليم الشيفت والتجميعة اليومية مع الفريق',
      weight: 0.03,
      mode: 'checklist',
      checklistTaskKey: 'team_briefing',
    },
    {
      key: 'attendance',
      label: 'الحضور والانضباط لفريق الفرع + الزي واستخدام PConnect الشخصي',
      weight: 0.07,
      mode: 'manual',
      hint: 'لسه مش متتبّعة تلقائيًا في النظام — تقييم يدوي من مدير الفروع.',
    },
  ],
  branches_manager: [
    {
      key: 'sales',
      label: 'أداء المبيعات الكلي (الفرعين معًا)',
      weight: 0.19,
      mode: 'auto',
      autoScore: salesGrowthScore,
    },
    {
      key: 'customer_service',
      label: 'جودة خدمة العملاء الكلية',
      weight: 0.17,
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
      weight: 0.08,
      mode: 'manual',
      hint: 'تقييم كيفي من المدير العام لجودة التنسيق بين الفرعين والمخزن.',
    },
    {
      key: 'warehouse',
      label: 'متابعة أداء المخزن (مواعيد، أذونات تحويل، باركود)',
      weight: 0.08,
      mode: 'checklist',
      checklistTaskKey: 'warehouse_review',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي اتسجّلت فيها متابعة المخزن المركزي فعليًا.',
    },
    {
      key: 'top20_customers',
      label: 'مراجعة أهم 20 عميل بكل فرع (استمرارية وجودة خدمة)',
      weight: 0.08,
      mode: 'checklist',
      checklistTaskKey: 'top20_customers_retention_review',
    },
    {
      key: 'purchases_speed',
      label: 'سرعة المشتريات وتوافر الأصناف',
      weight: 0.07,
      mode: 'checklist',
      checklistTaskKey: 'purchases_speed_availability_review',
    },
    {
      key: 'shift_notes_compliance',
      label: 'الالتزام بمتابعة ملاحظات الشيفتات',
      weight: 0.05,
      mode: 'checklist',
      checklistTaskKey: 'shift_notes_compliance_review',
    },
    {
      key: 'infrastructure',
      label: 'الكاميرات والخط الأرضي والنت',
      weight: 0.04,
      mode: 'checklist',
      checklistTaskKey: 'infrastructure_check',
    },
    {
      key: 'consumables',
      label: 'توافر الأكياس وبكر الريسيت والباركود',
      weight: 0.03,
      mode: 'checklist',
      checklistTaskKey: 'consumables_check',
    },
    {
      key: 'stagnant_compliance',
      label: 'التزام الدكاترة بالرواكد واللستة',
      weight: 0.05,
      mode: 'checklist',
      checklistTaskKey: 'stagnant_compliance_review',
    },
    {
      key: 'leadership',
      label: 'القدرة على القيادة واتخاذ القرار',
      weight: 0.06,
      mode: 'manual',
      hint: 'تقييم كيفي من المدير العام — الحسم في القرارات، إدارة الأزمات، والتأثير على الفريق.',
    },
  ],
  customer_service: [
    {
      key: 'conversation_quality',
      label: 'تقييم المحادثات وتحسين تعامل الدكاترة',
      weight: 0.18,
      mode: 'auto',
      autoScore: conversationQualityScore,
      hint: 'محسوبة من عدد مراجعات المحادثات المنجزة + متوسط درجتها خلال الأسبوع.',
    },
    {
      key: 'followups_execution',
      label: 'تنفيذ المتابعات الاستثنائية (طلب → تواصل → رد → نتيجة)',
      weight: 0.2,
      mode: 'auto',
      autoScore: followupClosureScore,
      hint: 'محسوبة تلقائيًا من نسبة إغلاق كل المتابعات الاستثنائية (دكاترة، أبلكيشن، شكاوى، قائمة مدير الفروع) بنتيجة فعلية موثّقة، مش مجرد "تم الاتصال".',
    },
    {
      key: 'points_communication',
      label: 'متابعة نقاط العملاء وإبلاغهم بالتفاصيل',
      weight: 0.08,
      mode: 'auto',
      autoScore: pointsCommunicationScore,
      hint: 'محسوبة تلقائيًا من نسبة معاملات نقاط العملاء اللي اتبلّغ فيها العميل فعليًا.',
    },
    {
      key: 'customer_growth',
      label: 'نمو عدد العملاء الشهري',
      weight: 0.08,
      mode: 'auto',
      autoScore: customerGrowthScore,
      hint: 'محسوبة تلقائيًا من عدد العملاء الجدد مقارنة بالأسبوع اللي فات.',
    },
    {
      key: 'vip_retention',
      label: 'أهم 20 عميل بالفرع: الرضا والنمو',
      weight: 0.15,
      mode: 'auto',
      autoScore: vipRetentionScore,
      hint: 'تقريب مبدئي من نسبة الاحتفاظ بكبار العملاء لحد ما نضيف مقياس رضا مخصص لقائمة أهم 20 عميل.',
    },
    {
      key: 'classification_accuracy',
      label: 'الالتزام بالتصنيف ودقته',
      weight: 0.1,
      mode: 'checklist',
      checklistTaskKey: 'classification_accuracy_review',
    },
    {
      key: 'doctor_coaching',
      label: 'تطوير وتوجيه الدكاترة في الفرع',
      weight: 0.08,
      mode: 'checklist',
      checklistTaskKey: 'doctor_coaching',
      hint: 'محسوبة من نسبة أيام الأسبوع اللي اترسل فيها توجيه/تدريب موثّق لدكتور.',
    },
    {
      key: 'sales_quality',
      label: 'جودة عمليات البيع (Cross/Up-selling)',
      weight: 0.08,
      mode: 'checklist',
      checklistTaskKeys: ['cross_selling_review', 'up_selling_review'],
    },
    {
      key: 'branches_manager_alignment',
      label: 'تنفيذ ملاحظات مدير الفروع',
      weight: 0.05,
      mode: 'checklist',
      checklistTaskKey: 'branches_manager_notes_followup',
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
    } else if (criterion.mode === 'checklist') {
      const keys = criterionChecklistKeys(criterion);
      const rates = keys.map((k) => checklistRates[k] ?? 0);
      const avgRate = rates.length ? rates.reduce((sum, r) => sum + r, 0) / rates.length : 0;
      score = avgRate / 10;
    } else {
      score = manualScores[criterion.key] ?? 0;
    }
    total += score * criterion.weight;
  }
  // الدرجة النهائية من 100 (كل معيار من 10 × وزنه، مجموع الأوزان = 1، فالمجموع من 10 × 10 = 100)
  return Math.round(total * 10 * 10) / 10;
}
