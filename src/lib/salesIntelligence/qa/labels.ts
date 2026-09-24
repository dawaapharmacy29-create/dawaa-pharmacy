// Sales Intelligence QA Review UI — Arabic label maps.
//
// Pure, read-only presentation labels. Never used to alter engine output, never gates any
// business logic — this file exists purely to translate the engine's own English enum/reason
// vocabulary into Arabic-friendly text for the QA reviewer. Any string not in a map falls back to
// a humanized version of the raw value (underscores -> spaces) rather than throwing or hiding it,
// since a QA tool must never silently drop a real engine output just because it's unmapped.

function humanize(value: string): string {
  return value.replace(/_/g, ' ');
}

export function labelOr(map: Record<string, string>, value: string | null | undefined, fallback = '—'): string {
  if (!value) return fallback;
  return map[value] ?? humanize(value);
}

export const caseTypeLabels: Record<string, string> = {
  information_only: 'استفسار / معلومات فقط',
  sales_opportunity: 'فرصة بيعية',
  complaint: 'شكوى',
  follow_up: 'متابعة',
  mixed: 'مختلطة',
};

export const caseStatusLabels: Record<string, string> = {
  information_only: 'معلومات فقط',
  sales_opportunity: 'فرصة بيعية',
  basket_building: 'جارٍ تكوين السلة',
  awaiting_customer_confirmation: 'بانتظار تأكيد العميل',
  customer_confirmed: 'تأكيد العميل تم',
};

export const pipelineStatusLabels: Record<string, string> = {
  analyzed: 'تم التحليل',
  partial: 'تحليل جزئي',
  needs_human_review: 'يحتاج مراجعة بشرية',
  insufficient_data: 'بيانات غير كافية',
};

export const historicalClosureLabels: Record<string, string> = {
  explicit: 'صريح',
  strongly_inferred: 'مُستدل بقوة',
  weakly_inferred: 'مُستدل بضعف',
  not_closed: 'لم يُغلق',
  unknown: 'غير معروف',
};

export const protocolApplicabilityLabels: Record<string, string> = {
  applicable: 'ينطبق',
  not_reached: 'لم تصل المحادثة لهذه المرحلة',
  not_applicable: 'لا ينطبق',
  unknown: 'غير معروف',
};

export const confidenceLevelLabels: Record<string, string> = {
  proven: 'مؤكد',
  strongly_inferred: 'مُستدل بقوة',
  weakly_inferred: 'مُستدل بضعف',
  unknown: 'غير معروف',
};

/** Final Pilot Readiness — I.C.2 canonical SaleProofState labels. See saleProofState.ts. */
export const saleProofStateLabels: Record<string, string> = {
  proven: 'مؤكد بفاتورة موثوقة',
  strongly_supported: 'مدعوم بقوة (إحصائي)',
  weakly_supported: 'مدعوم بضعف',
  unknown: 'غير معروف',
  contradicted: 'متناقض',
};

/** SaleProofSource vocab — see saleProofState.ts's own SaleProofSource union. */
export const saleProofSourceLabels: Record<string, string> = {
  trusted_invoice: 'فاتورة موثوقة (رابط مباشر)',
  statistical_strong: 'استدلال إحصائي قوي',
  statistical_weak: 'استدلال إحصائي ضعيف',
  none: 'لا يوجد مصدر إثبات',
  trusted_invoice_with_contradiction: 'فاتورة موثوقة — لكن يوجد تناقض مكتشف',
  statistical_with_contradiction: 'استدلال إحصائي — لكن يوجد تناقض مكتشف',
};

/** Named contradiction categories deriveSaleProofState() produces — see saleProofState.ts's own CONTRADICTION_CATEGORY_BY_EXCEPTION_TYPE. */
export const contradictionCategoryLabels: Record<string, string> = {
  cross_customer_invoice_link: 'الفاتورة مرتبطة بمعرف عميل مختلف رغم تطابق رقم الهاتف',
  cross_case_invoice_collision: 'نفس الفاتورة اختارتها حالة محادثة أخرى بشكل مستقل',
  cancelled_invoice_linked_to_case: 'الفاتورة المرتبطة بهذه الحالة ملغاة',
  returned_invoice_linked_to_case: 'الفاتورة المرتبطة بهذه الحالة مرتجعة',
  unexplained_amount_conflict: 'فرق حقيقي غير مُفسَّر بين إجمالي السلة وإجمالي الفاتورة',
  item_evidence_conflict: 'تعارض في بنود/كميات الفاتورة مقابل السلة',
  cross_branch_invoice_link: 'فرع الفاتورة يختلف عن فرع المحادثة رغم أن الفاتورة موثوقة',
  temporal_inversion_conflict: 'توقيت الفاتورة يسبق توقيت المحادثة بشكل غير منطقي',
};

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info';

/** Shared tone rule for any ConfidenceLevel-shaped value (attribution level, etc.). */
export function attributionLevelBadgeTone(value: string): BadgeTone {
  if (value === 'proven' || value === 'strongly_inferred') return 'success';
  if (value === 'weakly_inferred') return 'warning';
  return 'danger';
}

export function historicalClosureBadgeTone(value: string): BadgeTone {
  if (value === 'explicit' || value === 'strongly_inferred') return 'success';
  if (value === 'weakly_inferred') return 'warning';
  if (value === 'not_closed') return 'danger';
  return 'info';
}

export const integrityScopeLabels: Record<string, string> = {
  header_only: 'رأس الفاتورة فقط',
  header_and_items: 'الرأس والأصناف',
  insufficient: 'غير كافٍ',
};

export const protocolPolicyComplianceLabels: Record<string, string> = {
  not_enforced: 'البروتوكول غير مُفعّل بعد',
  compliant: 'متوافق',
  non_compliant: 'غير متوافق',
  not_applicable: 'لا ينطبق',
  not_reached: 'لم تصل المحادثة لهذه المرحلة',
  unknown: 'غير معروف',
};

export const fieldMatchStatusLabels: Record<string, string> = {
  exact: 'تطابق تام',
  near_match: 'تطابق تقريبي',
  partial: 'تطابق جزئي',
  mismatch: 'عدم تطابق',
  insufficient_data: 'بيانات غير كافية',
};

export const ambiguityStatusLabels: Record<string, string> = {
  none: 'لا يوجد التباس',
  ambiguous_multiple_candidates: 'مرشحون متعددون ملتبسون',
};

export const itemResolutionStatusLabels: Record<string, string> = {
  proven: 'مؤكد',
  partially_proven: 'مؤكد جزئيًا',
  missing: 'غير موجود',
  contradicted: 'متناقض',
  unknown: 'غير معروف',
};

/** Human-review / failure reason vocab actually observed across the engines — see salesIntegrityEngine.ts, saleAttributionEngine.ts, commercialConfirmationEngine.ts, conversationCaseEngine.ts. Never framed as an accusation. */
export const reviewReasonLabels: Record<string, string> = {
  competing_case_attribution: 'منافسة على نفس الفاتورة مع حالة أخرى',
  possible_unsegmented_multiple_requests: 'احتمال وجود طلبات متعددة غير مقسّمة بوضوح',
  ambiguous_multiple_candidates: 'أكثر من فاتورة مرشحة دون ترجيح واضح',
  no_basket_state_for_case: 'لا توجد سلة لهذه الحالة',
  confirmation_protocol_incomplete: 'خطوات ناقصة في بروتوكول التأكيد (دلالة إجرائية فقط)',
  final_total_missing: 'لم يُعلن الموظف إجمالي حساب صريح (دلالة إجرائية فقط)',
  staff_final_confirmation_missing: 'لا يوجد تأكيد نهائي موثّق من الموظف (دلالة إجرائية فقط)',
  insufficient_evidence: 'أدلة غير كافية لاتخاذ قرار',
  invoice_candidates_ambiguous: 'مرشحو الفواتير غير حاسمين',
  ambiguous_product_alias: 'اسم منتج يحتمل أكثر من صنف',
  active_basket_conflict: 'أكثر من نسخة سلة نشطة في نفس الوقت',
  basket_modified_after_confirmation: 'تم تعديل السلة بعد تأكيد سابق',
};

/** PipelineFailureReason vocab — WHY evidence fell short, never WHO is at fault. */
export const failureReasonLabels: Record<string, string> = {
  case_segmentation_uncertain: 'تقسيم الحالة غير مؤكد',
  customer_identity_unresolved: 'هوية العميل غير محسومة',
  basket_not_detected: 'لم يتم رصد سلة',
  product_identity_unresolved: 'هوية المنتج غير محسومة',
  quantity_unknown: 'الكمية غير معروفة',
  final_summary_missing: 'لا يوجد ملخص نهائي للطلب',
  announced_total_missing: 'لم يُعلن إجمالي الحساب',
  customer_confirmation_uncertain: 'تأكيد العميل غير مؤكد',
  invoice_candidates_ambiguous: 'مرشحو الفواتير غير حاسمين',
  invoice_items_unavailable: 'بيانات أصناف الفاتورة غير متاحة',
};


/** Arabic-only reviewer text for engine rule ids. Never changes engine logic or stored values. */
export const ruleIdLabels: Record<string, string> = {
  'case.classification.request_with_commercial_signal': 'تم تصنيف الحالة كطلب ذي إشارة شرائية واضحة',
  'case.classification.request_without_commercial_signal': 'تم تصنيف الحالة كطلب دون إشارة شرائية كافية',
  'historical_closure.customer_acceptance_and_staff_fulfillment_intent': 'يوجد قبول من العميل مع نية واضحة من الموظف لتنفيذ الطلب',
  'attribution.assessment.no_candidates': 'لم يتم العثور على فاتورة مرشحة مناسبة',
  'attribution.level.strongly_inferred': 'الإسناد مدعوم بقوة من مجموعة الأدلة المتاحة',
  'attribution.factor.customer_id_match': 'تطابق معرف العميل',
  'attribution.factor.phone_match': 'تطابق رقم الهاتف',
  'attribution.factor.branch_exact_canonical': 'تطابق الفرع',
  'attribution.factor.time_moderate': 'الفارق الزمني مقبول ويدعم الإسناد بدرجة متوسطة',
  'matching.insufficient_attribution': 'بيانات إسناد الفاتورة غير كافية لإجراء المطابقة',
  'matching.no_active_basket': 'لا توجد سلة نشطة قابلة للمطابقة',
  'matching.item.unavailable': 'بيانات أصناف الفاتورة غير متاحة للمطابقة',
  'matching.quantity.insufficient_data': 'بيانات الكمية غير كافية للمطابقة',
  'matching.overall.insufficient_data': 'بيانات المطابقة الكلية غير كافية',
};

export const pipelineWarningLabels: Record<string, string> = {
  raw_text_produced_no_parsed_messages: 'تعذر استخراج رسائل مفهومة من النص الأصلي للمحادثة',
  no_sessions_derived_from_raw_text: 'لم يتم تكوين جلسة محادثة قابلة للتحليل',
  active_basket_conflict_multiple_non_superseded_versions: 'يوجد أكثر من نسخة نشطة من السلة وتحتاج للمراجعة',
  selected_invoice_row_not_found_in_candidate_pool: 'الفاتورة المختارة لم تعد موجودة داخل مجموعة الفواتير المرشحة',
};

export const productMatchLabelLabels: Record<string, string> = {
  exact_name: 'تطابق اسم تام',
  exact_code: 'تطابق كود تام',
  normalized_exact: 'تطابق تام بعد توحيد الكتابة',
  strong: 'تطابق قوي',
  fuzzy: 'تطابق تقريبي',
  weak: 'تطابق ضعيف',
  ambiguous: 'تطابق ملتبس',
};
