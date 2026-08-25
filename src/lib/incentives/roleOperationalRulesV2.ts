import type { IncentiveRuleDefinition } from '@/lib/incentives/incentiveRulesEngine';

function operationalRule(
  rule_code: string,
  title_ar: string,
  role_scope: 'cleaning' | 'assistant',
  category: string,
  points_delta: number,
  options: Partial<IncentiveRuleDefinition> = {}
): IncentiveRuleDefinition {
  const magnitude = Math.abs(points_delta);
  return {
    rule_code,
    title_ar,
    description_ar: options.description_ar || title_ar,
    role_scope,
    category,
    impact_type:
      options.impact_type ||
      (points_delta > 0 ? 'monthly_exceptional_reward' : 'monthly_points_deduction'),
    points_delta,
    money_delta: options.money_delta || 0,
    approval_required: options.approval_required ?? points_delta < 0,
    severity:
      options.severity ||
      (magnitude >= 30 ? 'high' : magnitude >= 15 ? 'medium' : 'low'),
    repeat_policy:
      options.repeat_policy ||
      (points_delta < 0 ? 'linear_multiplier' : 'none'),
    visible_to_staff: options.visible_to_staff ?? true,
    included_in_pdf: options.included_in_pdf ?? true,
    source_module: options.source_module || 'operations_core',
    active: options.active ?? true,
    pillar_key: options.pillar_key,
  };
}

/**
 * قواعد v2 التشغيلية لا تُنشأ لمجرد الضغط على زر "تم".
 * كل قاعدة مصممة ليتم إصدارها من Event موثق: مهمة + مسؤول + موعد + دليل + مراجعة.
 */
export const CLEANING_OPERATIONAL_RULES_V2: IncentiveRuleDefinition[] = [
  operationalRule(
    'CLEAN-V2-D001',
    'عدم إغلاق Checklist الافتتاح في موعده بدون عذر موثق',
    'cleaning',
    'النظافة والتشغيل',
    -10,
    { source_module: 'cleaning_workflow' }
  ),
  operationalRule(
    'CLEAN-V2-D002',
    'عدم إغلاق Checklist الإغلاق في موعده بدون عذر موثق',
    'cleaning',
    'النظافة والتشغيل',
    -10,
    { source_module: 'cleaning_workflow' }
  ),
  operationalRule(
    'CLEAN-V2-D003',
    'منطقة نظافة فشلت في المراجعة الفعلية',
    'cleaning',
    'جودة النظافة',
    -10,
    { source_module: 'cleaning_review' }
  ),
  operationalRule(
    'CLEAN-V2-D004',
    'إهمال منطقة حساسة للنظافة أو دورة المياه أو منطقة العملاء',
    'cleaning',
    'جودة النظافة',
    -20,
    { approval_required: true, source_module: 'cleaning_review' }
  ),
  operationalRule(
    'CLEAN-V2-D005',
    'تأخير تصحيح ملاحظة نظافة بعد التكليف بدون سبب',
    'cleaning',
    'الاستجابة للملاحظات',
    -10,
    { source_module: 'cleaning_rework' }
  ),
  operationalRule(
    'CLEAN-V2-D006',
    'إغلاق مهمة نظافة كمكتملة بدون تنفيذ فعلي أو دليل مطلوب',
    'cleaning',
    'نزاهة التنفيذ',
    -30,
    {
      approval_required: true,
      repeat_policy: 'manager_review_only',
      severity: 'high',
      source_module: 'cleaning_verification',
    }
  ),
  operationalRule(
    'CLEAN-V2-R001',
    'أسبوع نظافة موثق بنسبة التزام 95% فأكثر بدون إعادة عمل مؤثرة',
    'cleaning',
    'جودة النظافة',
    10,
    { approval_required: false, source_module: 'cleaning_weekly_score' }
  ),
  operationalRule(
    'CLEAN-V2-R002',
    'اكتشاف مشكلة نظافة أو تلف والإبلاغ عنها قبل تحولها لمشكلة تشغيلية',
    'cleaning',
    'المبادرة',
    5,
    { approval_required: false, source_module: 'cleaning_issue_report' }
  ),
];

export const ASSISTANT_OPERATIONAL_RULES_V2: IncentiveRuleDefinition[] = [
  operationalRule(
    'ASSIST-V2-R001',
    'اكتشاف نقص مؤثر والإبلاغ عنه قبل نفاد الصنف',
    'assistant',
    'المخزون والنواقص',
    5,
    { approval_required: false, source_module: 'shortage_workflow' }
  ),
  operationalRule(
    'ASSIST-V2-R002',
    'اكتشاف فرق جرد والإبلاغ عنه قبل اعتماد الجرد النهائي',
    'assistant',
    'الجرد',
    5,
    { approval_required: false, source_module: 'inventory_count' }
  ),
  operationalRule(
    'ASSIST-V2-D001',
    'فرق جرد غير مبرر ثبت أنه ناتج عن إهمال في العهدة',
    'assistant',
    'الجرد',
    -15,
    { approval_required: true, source_module: 'inventory_variance_review' }
  ),
  operationalRule(
    'ASSIST-V2-D002',
    'إغلاق مهمة رص أو جرد بدون مراجعة النطاق المكلف به فعليًا',
    'assistant',
    'الرص والجرد',
    -20,
    { approval_required: true, source_module: 'shelf_verification' }
  ),
];

export const ROLE_OPERATIONAL_RULES_V2: IncentiveRuleDefinition[] = [
  ...CLEANING_OPERATIONAL_RULES_V2,
  ...ASSISTANT_OPERATIONAL_RULES_V2,
];
