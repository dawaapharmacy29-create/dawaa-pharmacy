// Case Intelligence Workspace — display-only helpers.
//
// Labels and a strict reader for the persisted `caseIntelligence` read model. Nothing here decides a
// business truth: every value shown comes from the canonical view; unknown codes render as
// "غير محسوم" instead of being guessed. There is deliberately NO fallback to V6/V7/V22 fields.
import type { CaseIntelligenceView, ConfidenceLevel } from '../types';
import { reviewReasonLabels as canonicalReviewReasonLabels } from './labels';

export const SUPPORTED_CASE_INTELLIGENCE_VERSIONS = [
  'case-intelligence-v2',
  'case-intelligence-v3',
] as const;

/** Returns the persisted view, or null for older analyses (never rebuilt in the browser). */
export function readCaseIntelligence(analysisRow: { evidence_snapshot?: Record<string, any> | null } | null | undefined): CaseIntelligenceView | null {
  const view = analysisRow?.evidence_snapshot?.caseIntelligence;
  if (!view || typeof view !== 'object') return null;
  if (!(SUPPORTED_CASE_INTELLIGENCE_VERSIONS as readonly string[]).includes(view.version)) return null;
  return view as CaseIntelligenceView;
}

/**
 * QA must prefer the freshly re-derived in-memory view when available. Persisted snapshots are
 * retained as an audit fallback only; showing an older snapshot beside current Sale Proof creates
 * contradictory truths in the same screen.
 */
export function selectCurrentCaseIntelligence(
  liveView: CaseIntelligenceView | null | undefined,
  analysisRow: { evidence_snapshot?: Record<string, any> | null } | null | undefined
): CaseIntelligenceView | null {
  return liveView ?? readCaseIntelligence(analysisRow);
}

export const UNKNOWN_LABEL = 'غير محسوم';

function label(map: Record<string, string>, value: string | null | undefined): string {
  if (value == null || value === '') return UNKNOWN_LABEL;
  return map[value] ?? UNKNOWN_LABEL;
}

export function confidenceBand(level: ConfidenceLevel | null | undefined): { label: string; tone: 'high' | 'medium' | 'low' | 'unknown' } {
  switch (level) {
    case 'proven':
    case 'strongly_inferred':
      return { label: 'عالية', tone: 'high' };
    case 'weakly_inferred':
      return { label: 'متوسطة', tone: 'medium' };
    case 'unknown':
      return { label: 'منخفضة', tone: 'low' };
    default:
      return { label: UNKNOWN_LABEL, tone: 'unknown' };
  }
}

export const journeyStateLabel = (v: string | null | undefined) =>
  label(
    {
      information_only: 'استفسار فقط',
      need_identified: 'تم تحديد الطلب',
      clarifying: 'جاري التوضيح',
      offer_made: 'تم تقديم عرض',
      basket_building: 'تكوين الطلب',
      awaiting_customer_confirmation: 'في انتظار تأكيد العميل',
      customer_confirmed: 'العميل أكد',
      awaiting_invoice: 'في انتظار الفاتورة',
      financially_settled: 'تمت التسوية المالية — إثبات البيع الرسمي معلق',
      sale_proven: 'بيع مثبت',
      customer_declined: 'العميل رفض',
    },
    v
  );

export const saleOutcomeLabel = (v: string | null | undefined) =>
  label(
    {
      sale_proven: 'بيع مثبت بفاتورة',
      order_confirmed_unproven: 'طلب مؤكد — البيع غير مثبت بعد',
      customer_confirmed_unproven: 'العميل وافق — البيع غير مثبت',
      open_opportunity: 'فرصة مفتوحة',
      customer_rejected: 'العميل رفض',
      information_only: 'استفسار فقط',
      needs_review: 'يحتاج مراجعة',
    },
    v
  );

export const saleProofLabel = (v: string | null | undefined) =>
  label(
    {
      proven: 'مثبت',
      strongly_supported: 'مدعوم بقوة (غير مثبت)',
      weakly_supported: 'مدعوم بضعف (غير مثبت)',
      contradicted: 'متعارض',
    },
    v
  );

export const lostStateLabel = (v: string | null | undefined) =>
  label(
    {
      won: 'تم البيع',
      closed_order_unproven: 'الطلب مغلق ماليًا — البيع الرسمي غير مثبت',
      open: 'مفتوحة',
      recoverable: 'قابلة للاسترداد',
      lost: 'ضاعت',
      no_commercial_opportunity: 'لا توجد فرصة بيع',
    },
    v
  );

export const lostReasonLabel = (v: string | null | undefined) =>
  label(
    {
      stock_unavailable: 'الصنف غير متوفر',
      price: 'السعر',
      alternative_rejected: 'رفض البديل',
      customer_no_response: 'العميل لم يرد',
      staff_no_response: 'لم يتم الرد على العميل',
      slow_response: 'تأخر الرد',
      delivery_issue: 'مشكلة توصيل',
      product_not_suitable: 'الصنف غير مناسب',
      prescription_unclear: 'الروشتة غير واضحة',
      customer_declined: 'العميل رفض',
      competitor: 'اشترى من مكان آخر',
    },
    v
  );

export const lostStageLabel = (v: string | null | undefined) =>
  label({ need: 'الطلب', availability: 'التوفر', offer: 'العرض', price: 'السعر', closing: 'الإغلاق', fulfillment: 'التنفيذ', response: 'الرد' }, v);

export const responsibilityLabel = (v: string | null | undefined) =>
  label({ customer: 'العميل', staff: 'الموظف', inventory: 'المخزون', delivery: 'التوصيل', process: 'الإجراءات' }, v);

export const recoverabilityLabel = (v: string | null | undefined) =>
  label({ high: 'عالية', medium: 'متوسطة', low: 'منخفضة', none: 'لا يمكن' }, v);

export const waitingOnLabel = (v: string | null | undefined) =>
  label({ customer: 'العميل', staff: 'الصيدلية', stock: 'توفر الصنف', invoice: 'الفاتورة' }, v);

export const followUpDecisionLabel = (v: string | null | undefined) =>
  label(
    {
      actionable: 'متابعة مطلوبة',
      blocked: 'متابعة معطلة',
      suppressed: 'لا متابعة (موقوفة)',
      review_required: 'تحتاج مراجعة قبل تحديد المتابعة',
      not_needed: 'لا تحتاج متابعة',
    },
    v
  );

export const followUpStatusLabel = (v: string | null | undefined) =>
  label({ actionable: 'مطلوبة', blocked: 'معطلة', suppressed: 'موقوفة' }, v);

export const followUpReasonLabel = (v: string | null | undefined) =>
  label(
    {
      stock_unavailable: 'الصنف غير متوفر',
      stock_check_pending: 'انتظار نتيجة التحقق من التوفر',
      customer_asked_to_wait: 'العميل طلب إبلاغه عند التوفر',
      customer_considering: 'العميل يفكر',
      price_objection: 'اعتراض على السعر',
      alternative_open: 'قرار البديل لم يُحسم',
      prescription_incomplete: 'الروشتة ناقصة',
      staff_promised_check: 'الموظف وعد بالرجوع للعميل',
      callback_requested: 'العميل طلب التواصل لاحقًا',
      delivery_unresolved: 'مشكلة توصيل غير محلولة',
      customer_no_response: 'العميل لم يرد',
      staff_no_response: 'طلب العميل بدون رد',
    },
    v
  );

export const nextBestActionLabel = (v: string | null | undefined) =>
  label(
    {
      respond_to_customer_request: 'الرد على طلب العميل',
      complete_stock_check_and_reply: 'إكمال التحقق من التوفر والرد',
      complete_promised_check: 'تنفيذ ما وعد به الموظف',
      contact_customer_when_product_available: 'التواصل مع العميل عند توفر الصنف',
      confirm_alternative_decision: 'تأكيد قرار العميل بخصوص البديل',
      check_customer_decision: 'متابعة قرار العميل',
      follow_up_with_value_or_allowed_offer: 'متابعة بالقيمة أو عرض مسموح',
      request_missing_prescription_details: 'طلب بيانات الروشتة الناقصة',
      resolve_delivery_status: 'حل مشكلة التوصيل',
      contact_customer_at_requested_time: 'التواصل في الوقت الذي طلبه العميل',
      send_single_recovery_followup: 'رسالة متابعة واحدة للاسترداد',
    },
    v
  );

export const duePolicyLabel = (v: string | null | undefined) =>
  label(
    {
      immediate: 'فورًا',
      same_shift: 'في نفس الوردية',
      next_day: 'اليوم التالي',
      customer_requested_time: 'في الوقت الذي حدده العميل',
      when_in_stock: 'عند توفر الصنف',
      manual_schedule: 'يحدد يدويًا',
    },
    v
  );

export const assignedRoleLabel = (v: string | null | undefined) =>
  label({ branch_staff: 'فريق الفرع', pharmacist: 'الصيدلي', customer_service: 'خدمة العملاء', delivery_team: 'فريق التوصيل' }, v);

export const suppressionLabel = (v: string | null | undefined) =>
  label(
    {
      sale_proven: 'البيع تم',
      customer_final_decline: 'العميل رفض نهائيًا',
      bought_elsewhere: 'اشترى من مكان آخر',
      information_only: 'استفسار فقط',
      no_customer_need: 'لا يوجد طلب حقيقي',
      weak_evidence: 'الأدلة غير كافية',
      financially_settled: 'الطلب تمت تسويته ماليًا ولا يحتاج متابعة استرداد',
      covered_by_specific_follow_up: 'مغطاة بمتابعة أدق',
    },
    v
  );

export const availabilityLabel = (v: string | null | undefined) =>
  label({ available: 'متوفر', unavailable: 'غير متوفر', check_pending: 'جاري التحقق من التوفر' }, v);

export const alternativeResponseLabel = (v: string | null | undefined) =>
  label({ accepted: 'وافق على البديل', rejected: 'رفض البديل', considering: 'يفكر في البديل', no_response: 'لم يرد على البديل' }, v);

export const productLossLabel = (v: string | null | undefined) =>
  label({ replaced_by_alternative: 'استُبدل ببديل', recoverable: 'قابل للاسترداد', lost: 'ضاع' }, v);

export const objectionLabel = (v: string | null | undefined) =>
  label(
    { price: 'السعر', availability: 'التوفر', delivery: 'التوصيل', product_fit: 'ملاءمة الصنف', timing: 'التوقيت', customer_declined: 'رفض' },
    v
  );

export const identityStatusLabel = (v: string | null | undefined) =>
  label({ resolved: 'هوية مؤكدة', unresolved: 'هوية غير محسومة', ambiguous: 'هوية ملتبسة', contradicted: 'هوية متعارضة', not_provided: 'هوية غير محسومة' }, v);

export const staffFactLabel = (v: string | null | undefined) =>
  label(
    {
      stated_available: 'قال إن الصنف متوفر',
      stated_unavailable: 'قال إن الصنف غير متوفر',
      stated_check_pending: 'قال إنه سيتحقق من التوفر',
      offered_product: 'عرض الصنف',
      offered_alternative: 'عرض بديلًا',
      confirmed_order: 'أكد الطلب',
      awaiting_customer_reply: 'ينتظر رد العميل',
      promised_follow_up: 'وعد بالمتابعة',
    },
    v
  );

export const basketStatusLabel = (v: string | null | undefined) =>
  label({ draft: 'مسودة', awaiting_confirmation: 'في انتظار التأكيد', confirmed: 'مؤكدة', superseded: 'تم استبدالها', cancelled: 'ملغاة' }, v);

export const confirmationStateLabel = (v: string | null | undefined) =>
  label(
    {
      basket_in_progress: 'الطلب قيد التكوين',
      awaiting_customer_confirmation: 'في انتظار تأكيد العميل',
      customer_confirmed: 'العميل أكد',
      modified_after_confirmation: 'تعديل بعد التأكيد',
      commercial_confirmation_complete: 'تأكيد تجاري مكتمل',
      rejected: 'مرفوض',
    },
    v
  );

/** Review reason codes are canonical; one shared Arabic vocabulary is used across list + case detail. */
export const reviewReasonLabel = (code: string) =>
  canonicalReviewReasonLabels[code] ?? UNKNOWN_LABEL;

/** Product status as the view already states it; the UI never derives "sold". */
export function productStatus(product: CaseIntelligenceView['products'][number], saleOutcome: string): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (product.lossOutcome === 'lost') return { label: 'ضاع', tone: 'bad' };
  if (product.lossOutcome === 'recoverable') return { label: 'غير متوفر — قابل للاسترداد', tone: 'warn' };
  if (product.lossOutcome === 'replaced_by_alternative') return { label: 'استُبدل ببديل', tone: 'neutral' };
  // Stated by the view (canonical Need availability): a pending stock check is not a loss and not yet a basket line outcome.
  if (product.availability === 'check_pending') return { label: 'جاري مراجعة التوفر', tone: 'warn' };
  if (product.inFinalBasket) return { label: saleOutcome === 'sale_proven' ? 'ضمن بيع مثبت' : 'في الطلب النهائي', tone: 'good' };
  if (product.availability === 'unavailable') return { label: 'غير متوفر', tone: 'warn' };
  return { label: UNKNOWN_LABEL, tone: 'neutral' };
}
