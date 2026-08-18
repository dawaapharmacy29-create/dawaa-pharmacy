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
  sales_invoices_count?: number;
  coded_sales_invoices_count?: number;
  sales_coding_rate?: number | null;
  sales_target_amount?: number;
  sales_target_achievement_rate?: number | null;
  followups_purchase_amount?: number;
  customer_requests_total?: number;
  customer_requests_closed?: number;
  customer_requests_closed_on_time?: number;
  customer_requests_overdue?: number;
  shift_notes_total?: number;
  shift_notes_completed?: number;
  shift_notes_overdue?: number;
  attendance_days_count?: number;
  daily_queues_total?: number;
  daily_queues_handled?: number;
  daily_queues_completion_rate?: number | null;
  data_coverage?: Record<string, boolean>;
};

export type EvaluationCriterion = {
  key: string;
  label: string;
  weight: number;
  mode: 'auto' | 'checklist';
  hint?: string;
  sourceRoute?: string;
  sourceLabel?: string;
  coverageKeys?: string[];
  autoScore?: (current: WeeklyAutoMetrics, previous: WeeklyAutoMetrics | null) => number;
  checklistTaskKey?: string;
  checklistTaskKeys?: string[];
  requiredOperational?: boolean;
};

export function criterionChecklistKeys(criterion: EvaluationCriterion): string[] {
  if (criterion.checklistTaskKeys?.length) return criterion.checklistTaskKeys;
  return criterion.checklistTaskKey ? [criterion.checklistTaskKey] : [];
}

const clamp10 = (value: number) => Math.max(0, Math.min(10, Number.isFinite(value) ? value : 0));
const ratio = (part: number, total: number) => (total > 0 ? part / total : 0);

function salesPerformanceScore(current: WeeklyAutoMetrics, previous: WeeklyAutoMetrics | null): number {
  const targetRate = current.sales_target_achievement_rate;
  if (targetRate !== null && targetRate !== undefined) return clamp10(targetRate / 10);
  if (!previous?.sales_total) return current.sales_total > 0 ? 5 : 0;
  const growthPct = ((current.sales_total - previous.sales_total) / previous.sales_total) * 100;
  return clamp10(5 + growthPct / 5);
}

function attendanceScore(current: WeeklyAutoMetrics): number {
  const days = current.attendance_days_count || 0;
  if (!days) return 5; // غياب ملف الحضور لا يتحول إلى استبعاد ولا عقوبة كاملة.
  const latePenalty = Math.min(5, current.attendance_late_minutes / Math.max(1, days) / 12);
  const punchPenalty = Math.min(5, current.attendance_missing_punch / Math.max(1, days) * 5);
  return clamp10(10 - latePenalty - punchPenalty);
}

function customerRequestsScore(current: WeeklyAutoMetrics): number {
  const total = current.customer_requests_total || 0;
  if (!total) return 5; // لا توجد حالات تشغيلية مسجلة خلال الأسبوع.
  const onTime = ratio(current.customer_requests_closed_on_time || 0, total);
  const overdue = ratio(current.customer_requests_overdue || 0, total);
  return clamp10(onTime * 10 - overdue * 5);
}

function coordinationScore(current: WeeklyAutoMetrics): number {
  const scores: number[] = [];
  const shiftTotal = current.shift_notes_total || 0;
  if (shiftTotal) {
    scores.push(clamp10(
      ratio(current.shift_notes_completed || 0, shiftTotal) * 10 -
      ratio(current.shift_notes_overdue || 0, shiftTotal) * 5
    ));
  }
  if ((current.customer_requests_total || 0) > 0) scores.push(customerRequestsScore(current));
  return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 5;
}

function followupClosureScore(current: WeeklyAutoMetrics): number {
  if (!current.followups_total) return 0;
  const closed = ratio(current.followups_closed, current.followups_total);
  const expired = ratio(current.followups_expired, current.followups_total);
  return clamp10(closed * 10 - expired * 5);
}

function vipRetentionScore(current: WeeklyAutoMetrics): number {
  if (current.vip_retention_rate === null || current.vip_retention_rate === undefined) return 0;
  return clamp10(current.vip_retention_rate / 10);
}

function conversationQualityScore(current: WeeklyAutoMetrics): number {
  if (!current.conversation_reviews_count) return 0;
  const activityScore = clamp10(current.conversation_reviews_count); // 10 مراجعات أسبوعيًا تحقق سقف النشاط.
  const qualityScore = current.conversation_reviews_avg_score !== null
    ? clamp10(current.conversation_reviews_avg_score / 10)
    : 0;
  return activityScore * 0.4 + qualityScore * 0.6;
}

function pointsCommunicationScore(current: WeeklyAutoMetrics): number {
  if (!current.points_transactions_total) return 0;
  return clamp10(ratio(current.points_transactions_contacted, current.points_transactions_total) * 10);
}

function customerGrowthScore(current: WeeklyAutoMetrics, previous: WeeklyAutoMetrics | null): number {
  if (!previous?.new_customers_count) return current.new_customers_count > 0 ? 5 : 0;
  const growthPct = ((current.new_customers_count - previous.new_customers_count) / previous.new_customers_count) * 100;
  return clamp10(5 + growthPct / 10);
}

function dailyQueuesExecutionScore(current: WeeklyAutoMetrics): number {
  if (current.daily_queues_completion_rate === null || current.daily_queues_completion_rate === undefined) return 0;
  return clamp10(current.daily_queues_completion_rate / 10);
}

export const EVALUATION_CRITERIA: Record<EvaluationType, EvaluationCriterion[]> = {
  branch_manager: [
    {
      key: 'sales', label: 'تحقيق تارجت المبيعات الأسبوعي', weight: 0.20, mode: 'auto', autoScore: salesPerformanceScore,
      hint: 'إجمالي مبيعات الفرع ÷ نصيب الأسبوع من تارجت دورة 26→25. عند غياب التارجت فقط تتم المقارنة بالأسبوع السابق.',
      sourceRoute: '/daily-target', sourceLabel: 'المبيعات والتارجت', coverageKeys: ['sales','targets'],
    },
    {
      key: 'customer_service', label: 'إدارة متابعة العملاء وإغلاق الحالات', weight: 0.15, mode: 'auto', autoScore: followupClosureScore,
      hint: 'نسبة المتابعات المغلقة بنتيجة فعلية مع خصم الحالات المنتهية بدون رد.',
      sourceRoute: '/customer-service', sourceLabel: 'متابعة العملاء', coverageKeys: ['followups'],
    },
    {
      key: 'vip_retention', label: 'الاحتفاظ بالعملاء المهمين وVIP', weight: 0.10, mode: 'auto', autoScore: vipRetentionScore,
      hint: 'نسبة كبار العملاء الذين ظلوا نشطين خلال الفترة.', sourceRoute: '/customers', sourceLabel: 'العملاء', coverageKeys: ['customers'],
    },
    {
      key: 'cash_integrity', label: 'مطابقة الكاش والعهدة اليومية', weight: 0.10, mode: 'checklist', checklistTaskKey: 'cash_reconciliation',
      hint: 'نسبة الأيام التي تم فيها توثيق مطابقة الكاش والعهدة.', sourceRoute: '/daily-manager-checklist', sourceLabel: 'مهام المدير',
    },
    {
      key: 'complaints_handling', label: 'سرعة تنفيذ طلبات العملاء والحالات المتأخرة', weight: 0.10, mode: 'auto', autoScore: customerRequestsScore,
      hint: 'من الطلبات المغلقة في موعدها مقابل الطلبات المتأخرة.', sourceRoute: '/customer-requests', sourceLabel: 'طلبات العملاء', coverageKeys: ['customer_requests'],
    },
    {
      key: 'purchases', label: 'مراجعة المشتريات والموردين', weight: 0.08, mode: 'checklist', checklistTaskKey: 'purchases_review',
      sourceRoute: '/purchases', sourceLabel: 'المشتريات',
    },
    {
      key: 'inventory', label: 'متابعة الجرد والمخزون', weight: 0.03, mode: 'checklist', checklistTaskKey: 'inventory_review',
      sourceRoute: '/inventory-counts', sourceLabel: 'الجرد والمخزون',
    },
    {
      key: 'cleanliness_compliance', label: 'الالتزام بالتشيك ليست اليومي للنظافة ورص الأرفف', weight: 0.05, mode: 'checklist',
      checklistTaskKeys: ['branch_appearance_cleanliness_audit', 'floor_cleanliness'],
      hint: 'نسبة الأيام التي راجع فيها مدير الفرع تشيك ليست عامل النظافة والمساعدين واعتمدها فعليًا.',
      sourceRoute: '/branch-checklist-review', sourceLabel: 'مراجعة تشيك ليست النظافة والمساعدين',
    },
    {
      key: 'shortages_handling', label: 'التعامل السليم مع النواقص', weight: 0.05, mode: 'checklist', checklistTaskKey: 'shortages_handling',
      sourceRoute: '/shortages', sourceLabel: 'النواقص',
    },
    {
      key: 'expiry_compliance', label: 'مراجعة الأصناف القريبة من الانتهاء والإكسباير', weight: 0.04, mode: 'checklist', checklistTaskKey: 'expiry_check',
      sourceRoute: '/medicine-expiry', sourceLabel: 'الصلاحية',
    },
    {
      key: 'shift_briefing', label: 'تسليم الشيفت والتجميعة اليومية مع الفريق', weight: 0.03, mode: 'checklist', checklistTaskKey: 'team_briefing',
      sourceRoute: '/shift-notes', sourceLabel: 'ملاحظات الشيفت',
    },
    {
      key: 'attendance', label: 'انضباط الحضور لفريق الفرع', weight: 0.07, mode: 'auto', autoScore: attendanceScore,
      hint: 'دقائق التأخير والبصمات الناقصة فقط؛ الزي وPConnect لهما مهام موثقة منفصلة ولا يتم خلطهما بالحضور.',
      sourceRoute: '/attendance-report', sourceLabel: 'الحضور', coverageKeys: ['attendance'],
    },
  ],

  branches_manager: [
    {
      key: 'sales', label: 'تحقيق تارجت المبيعات الكلي للفروع', weight: 0.19, mode: 'auto', autoScore: salesPerformanceScore,
      hint: 'مجموع مبيعات الفروع ÷ مجموع نصيب الأسبوع من تارجت كل فرع.', sourceRoute: '/branch-comparison', sourceLabel: 'مقارنة الفروع', coverageKeys: ['sales','targets'],
    },
    {
      key: 'customer_service', label: 'جودة تنفيذ المتابعات على مستوى الفروع', weight: 0.17, mode: 'auto', autoScore: followupClosureScore,
      sourceRoute: '/customer-service-dashboard', sourceLabel: 'خدمة العملاء', coverageKeys: ['followups'],
    },
    {
      key: 'vip_retention', label: 'الاحتفاظ بالعملاء المهمين على مستوى الفروع', weight: 0.10, mode: 'auto', autoScore: vipRetentionScore,
      sourceRoute: '/customers', sourceLabel: 'العملاء', coverageKeys: ['customers'],
    },
    {
      key: 'coordination', label: 'سرعة إغلاق مشكلات التشغيل والتنسيق بين الفروع', weight: 0.08, mode: 'auto', autoScore: coordinationScore,
      hint: 'من ملاحظات الشيفت وطلبات العملاء الموثقة والمتأخرة.', sourceRoute: '/operations-center', sourceLabel: 'مركز العمليات', coverageKeys: ['shift_notes','customer_requests'],
    },
    {
      key: 'warehouse', label: 'متابعة أداء المخزن والتحويلات والباركود', weight: 0.08, mode: 'checklist', checklistTaskKey: 'warehouse_review',
      sourceRoute: '/inventory-counts', sourceLabel: 'الجرد والمخزن',
    },
    {
      key: 'top20_customers', label: 'مراجعة أهم 20 عميل بكل فرع', weight: 0.08, mode: 'checklist', checklistTaskKey: 'top20_customers_retention_review',
      sourceRoute: '/customers', sourceLabel: 'أهم العملاء',
    },
    {
      key: 'purchases_speed', label: 'سرعة المشتريات وتوافر الأصناف', weight: 0.07, mode: 'checklist', checklistTaskKey: 'purchases_speed_availability_review',
      sourceRoute: '/purchases', sourceLabel: 'المشتريات',
    },
    {
      key: 'shift_notes_compliance', label: 'متابعة وتنفيذ ملاحظات الشيفتات', weight: 0.05, mode: 'checklist', checklistTaskKey: 'shift_notes_compliance_review',
      sourceRoute: '/shift-notes', sourceLabel: 'ملاحظات الشيفت',
    },
    { key: 'infrastructure', label: 'جاهزية الكاميرات والخط الأرضي والإنترنت', weight: 0.04, mode: 'checklist', checklistTaskKey: 'infrastructure_check' },
    { key: 'consumables', label: 'توافر الأكياس وبكر الريسيت والباركود', weight: 0.03, mode: 'checklist', checklistTaskKey: 'consumables_check' },
    { key: 'stagnant_compliance', label: 'متابعة التزام الدكاترة بخطة الرواكد', weight: 0.05, mode: 'checklist', checklistTaskKey: 'stagnant_compliance_review' },
    {
      key: 'leadership', label: 'القيادة وسرعة اتخاذ القرار التشغيلي', weight: 0.06, mode: 'auto', autoScore: coordinationScore,
      hint: 'مؤشر موضوعي من سرعة إغلاق المشكلات والطلبات وملاحظات التشغيل.', sourceRoute: '/operations-center', sourceLabel: 'التشغيل والقرارات', coverageKeys: ['shift_notes','customer_requests'],
    },
  ],

  customer_service: [
    {
      key: 'conversation_quality', label: 'مراجعة المحادثات وجودة تعامل الدكاترة', weight: 0.18, mode: 'auto', autoScore: conversationQualityScore,
      hint: '40% من حجم المراجعات و60% من متوسط جودة المحادثات.', sourceRoute: '/reviews', sourceLabel: 'تقييم المحادثات', coverageKeys: ['reviews'], requiredOperational: true,
    },
    {
      key: 'followups_execution', label: 'تنفيذ المتابعات حتى نتيجة فعلية', weight: 0.14, mode: 'auto', autoScore: followupClosureScore,
      hint: 'طلب → تواصل → رد → نتيجة موثقة، مع احتساب المتأخر والمنتهي بدون رد.', sourceRoute: '/customer-service', sourceLabel: 'المتابعات', coverageKeys: ['followups'], requiredOperational: true,
    },
    {
      key: 'daily_queues_execution', label: 'إنجاز قوائم المتابعة اليومية (VIP + فواتير 500+ + النقاط)', weight: 0.10, mode: 'auto', autoScore: dailyQueuesExecutionScore,
      hint: 'نسبة عملاء قوائم اليوم (7 VIP لكل فرع + كل فواتير الـ500+ + قائمة النقاط) اللي اتسجلت لهم متابعة فعلية في نفس اليوم.',
      sourceRoute: '/customer-service', sourceLabel: 'القوائم الذكية', coverageKeys: ['daily_queues'], requiredOperational: true,
    },
    {
      key: 'points_communication', label: 'إبلاغ العملاء بالنقاط ومتابعة الاستفادة منها', weight: 0.04, mode: 'auto', autoScore: pointsCommunicationScore,
      sourceRoute: '/customer-points-ledger', sourceLabel: 'سجل النقاط', coverageKeys: ['points'], requiredOperational: true,
    },
    {
      key: 'customer_growth', label: 'اكتساب عملاء جدد', weight: 0.08, mode: 'auto', autoScore: customerGrowthScore,
      hint: 'عدد العملاء الجدد مقارنة بالأسبوع السابق.', sourceRoute: '/customers', sourceLabel: 'العملاء الجدد', coverageKeys: ['customers'], requiredOperational: true,
    },
    {
      key: 'vip_retention', label: 'الاحتفاظ بأهم العملاء واستمرار نشاطهم', weight: 0.15, mode: 'auto', autoScore: vipRetentionScore,
      sourceRoute: '/customers', sourceLabel: 'أهم العملاء', coverageKeys: ['customers'], requiredOperational: true,
    },
    {
      key: 'classification_accuracy', label: 'مراجعة دقة تصنيف العملاء', weight: 0.10, mode: 'checklist', checklistTaskKey: 'classification_accuracy_review',
      sourceRoute: '/customer-coding', sourceLabel: 'تكويد العملاء',
    },
    {
      key: 'doctor_coaching', label: 'توجيه وتطوير الدكاترة', weight: 0.08, mode: 'checklist', checklistTaskKey: 'doctor_coaching',
      sourceRoute: '/training', sourceLabel: 'التدريب والتوجيه',
    },
    {
      key: 'sales_quality', label: 'مراجعة جودة البيع وCross/Up-selling', weight: 0.08, mode: 'checklist', checklistTaskKeys: ['cross_selling_review','up_selling_review'],
      sourceRoute: '/reviews', sourceLabel: 'جودة البيع',
    },
    {
      key: 'branches_manager_alignment', label: 'تنفيذ ملاحظات مدير الفروع', weight: 0.05, mode: 'checklist', checklistTaskKey: 'branches_manager_notes_followup',
      sourceRoute: '/shift-notes', sourceLabel: 'ملاحظات الإدارة',
    },
  ],
};

export const EVALUATION_TYPE_LABELS: Record<EvaluationType, string> = {
  branch_manager: 'تقييم مدير الفرع',
  branches_manager: 'تقييم مدير الفروع',
  customer_service: 'تقييم مسؤول خدمة العملاء',
};

export const EVALUATION_MAX_MONTHLY_INCENTIVE_EGP: Partial<Record<EvaluationType, number>> = {
  branch_manager: 3000,
  branches_manager: 4000,
  customer_service: 2500,
};

/**
 * من الإصدار الحالي لا يوجد مفهوم «مستبعد». كل معيار داخل الخطة محسوب بوزنه الأصلي.
 * عدم وجود نشاط موثق يعني أن دالة المعيار نفسها تحدد الدرجة (غالبًا صفر، أو محايد فقط
 * عندما يكون غياب المصدر خارج سيطرة الموظف مثل ملف الحضور).
 */
export function criterionHasData(
  criterion: EvaluationCriterion,
  _current: WeeklyAutoMetrics,
  _checklistRates: Record<string, number>
): boolean {
  return Boolean(criterion);
}

export type WeightedCriterionScore = {
  criterion: EvaluationCriterion;
  score10: number;
  originalWeight: number;
  effectiveWeight: number;
  included: boolean;
  contribution: number;
};

export function computeWeightedCriterionScores(
  type: EvaluationType,
  current: WeeklyAutoMetrics,
  previous: WeeklyAutoMetrics | null,
  manualScores: Record<string, number>,
  checklistRates: Record<string, number> = {}
): WeightedCriterionScore[] {
  return EVALUATION_CRITERIA[type].map((criterion) => {
    let score10 = 0;
    if (criterion.mode === 'auto' && criterion.autoScore) {
      score10 = criterion.autoScore(current, previous);
    } else if (criterion.mode === 'checklist') {
      const keys = criterionChecklistKeys(criterion);
      const rates = keys.map((key) => Number(checklistRates[key] ?? 0));
      score10 = rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length / 10 : 0;
    } else {
      score10 = manualScores[criterion.key] ?? 0;
    }
    const normalizedScore = Math.round(clamp10(score10) * 10) / 10;
    const contribution = Math.round(normalizedScore * criterion.weight * 10 * 10) / 10;
    return {
      criterion,
      score10: normalizedScore,
      originalWeight: criterion.weight,
      effectiveWeight: criterion.weight,
      included: true,
      contribution,
    };
  });
}

export function computeTotalScore(
  type: EvaluationType,
  current: WeeklyAutoMetrics,
  previous: WeeklyAutoMetrics | null,
  manualScores: Record<string, number>,
  checklistRates: Record<string, number> = {}
): number {
  return Math.round(
    computeWeightedCriterionScores(type,current,previous,manualScores,checklistRates)
      .reduce((sum,row) => sum + row.contribution,0) * 10
  ) / 10;
}
