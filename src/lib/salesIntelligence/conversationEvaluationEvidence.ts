import type { ReviewCriterionKey } from '@/lib/conversationReviews';
import { isStaffFollowUpPromiseV32 } from '../whatsappSemanticSignalsV32';
import { buildConversationClinicalReview, type ConversationClinicalReview } from './conversationClinicalReview';
import type { CaseIntelligenceView } from './types';

export type ConversationEvaluationEvidenceSource =
  | 'interaction_timing'
  | 'interaction_text'
  | 'customer_identity'
  | 'staff_identity'
  | 'customer_need'
  | 'product_lifecycle'
  | 'basket'
  | 'sale_proof'
  | 'journey'
  | 'lost_opportunity'
  | 'follow_up'
  | 'invoice_items'
  | 'operational_request_log'
  | 'purchase_history';

export type ConversationEvaluationEvidenceReadiness =
  | 'ready'
  | 'not_applicable'
  | 'needs_external_evidence'
  | 'manual_review_required'
  | 'insufficient_evidence';

export interface ConversationEvaluationCriterionContract {
  key: ReviewCriterionKey;
  /** Canonical evidence owners that are allowed to support this criterion. */
  sources: ConversationEvaluationEvidenceSource[];
  /** Extra source required before this criterion can be fully assessed. */
  externalSources: ConversationEvaluationEvidenceSource[];
  /** Human-readable rule: what this criterion is actually measuring. */
  question: string;
  /** Things that must never be used as a shortcut for this criterion. */
  forbiddenShortcuts: string[];
}

export interface ConversationEvaluationCriterionEvidence {
  key: ReviewCriterionKey;
  readiness: ConversationEvaluationEvidenceReadiness;
  availableSources: ConversationEvaluationEvidenceSource[];
  missingSources: ConversationEvaluationEvidenceSource[];
  evidenceMessageIds: string[];
  reason: string;
}

export interface ConversationEvaluationEvidenceSnapshot {
  version: 'conversation-evaluation-evidence-v1';
  caseId: string;
  criteria: ConversationEvaluationCriterionEvidence[];
}

export interface ConversationEvaluationExternalEvidence {
  operationalRequestLogAvailable?: boolean;
  purchaseHistoryAvailable?: boolean;
  invoiceItemsAvailable?: boolean;
}

/**
 * The 19 conversation-review criteria each get ONE explicit evidence contract.
 * This file does not score a doctor. It only answers: "what evidence is allowed to decide this item?"
 *
 * Important: a missing source is NOT a negative score. It is missing evidence.
 */
export const CONVERSATION_EVALUATION_CONTRACT: Record<
  ReviewCriterionKey,
  ConversationEvaluationCriterionContract
> = {
  first_response_speed: {
    key: 'first_response_speed',
    sources: ['interaction_timing'],
    externalSources: [],
    question: 'كم استغرق أول رد حقيقي من الصيدلية بعد أول رسالة عميل في هذا التفاعل؟',
    forbiddenShortcuts: ['created_at للمصدر', 'وقت رفع الملف', 'توقيت رسالة من تفاعل آخر'],
  },
  greeting: {
    key: 'greeting',
    sources: ['interaction_text'],
    externalSources: [],
    question: 'هل بدأ الرد بترحيب مهني مناسب لهذا التفاعل؟',
    forbiddenShortcuts: ['وجود كلمة السلام في رسالة العميل', 'رسالة ترحيب من تفاعل آخر'],
  },
  doctor_name: {
    key: 'doctor_name',
    sources: ['interaction_text', 'staff_identity'],
    externalSources: [],
    question: 'هل عرّف الموظف نفسه بوضوح في المحادثة؟',
    forbiddenShortcuts: ['sender تقني مثل You', 'تخمين الاسم من الفرع أو الشيفت'],
  },
  customer_name: {
    key: 'customer_name',
    sources: ['customer_identity', 'interaction_text'],
    externalSources: [],
    question: 'إذا كانت هوية العميل موثوقة، هل تم استخدام اسمه بشكل مناسب؟',
    forbiddenShortcuts: ['اسم غير محسوم', 'جزء رقمي من كود العميل كأنه اسم'],
  },
  tone: {
    key: 'tone',
    sources: ['interaction_text'],
    externalSources: [],
    question: 'هل أسلوب الرد محترم وواضح ومهني عبر الرسائل الفعلية؟',
    forbiddenShortcuts: ['كلمة واحدة منفردة', 'إيموجي واحد', 'طول الرسالة وحده'],
  },
  understanding: {
    key: 'understanding',
    sources: ['customer_need', 'interaction_text', 'product_lifecycle'],
    externalSources: [],
    question: 'هل فهم الموظف احتياج العميل الحقيقي وتعامل معه دون اختراع طلب أو صنف؟',
    forbiddenShortcuts: ['جملة ترحيب كطلب', 'الحاجات دي كاسم صنف', 'محتوى صورة/فويس غير متاح'],
  },
  followup_after_wait: {
    key: 'followup_after_wait',
    sources: ['interaction_timing', 'follow_up', 'interaction_text'],
    externalSources: [],
    question: 'إذا وعد الموظف بالرجوع، هل رجع خلال الوقت المناسب وبنفس موضوع الطلب؟',
    forbiddenShortcuts: ['أي رسالة لاحقة غير مرتبطة بالوعد', 'فرق وقت بين جلستين مختلفتين'],
  },
  consultation_quality: {
    key: 'consultation_quality',
    sources: ['customer_need', 'product_lifecycle', 'interaction_text'],
    externalSources: [],
    question: 'إذا كانت هناك استشارة فعلية، هل الرد مناسب للاحتياج ومسنود بمحتوى واضح؟',
    forbiddenShortcuts: ['تقييم طبي من صورة/فويس غير مقروء', 'قوة البيع كبديل عن جودة الاستشارة'],
  },
  dosage_explanation: {
    key: 'dosage_explanation',
    sources: ['interaction_text', 'product_lifecycle'],
    externalSources: [],
    question: 'عندما يلزم شرح استخدام/جرعة، هل تم شرحه نصيًا بشكل واضح؟',
    forbiddenShortcuts: ['افتراض الجرعة من اسم الصنف', 'افتراض أن الفاتورة تثبت شرح الجرعة'],
  },
  unavailable_items: {
    key: 'unavailable_items',
    sources: ['product_lifecycle', 'customer_need', 'lost_opportunity', 'follow_up'],
    externalSources: [],
    question: 'إذا كان هناك نقص مثبت، هل تم التعامل معه ببديل/تسجيل/متابعة مناسبة؟',
    forbiddenShortcuts: ['كلمة متاحة في سياق التوصيل', 'سؤال العميل وحده كإثبات عدم التوفر'],
  },
  sales_closing: {
    key: 'sales_closing',
    sources: ['customer_need', 'basket', 'sale_proof', 'journey', 'lost_opportunity'],
    externalSources: [],
    question: 'هل أدار الموظف فرصة البيع حتى نتيجة واضحة، مع فصل البيع المثبت عن الفرصة المفتوحة؟',
    forbiddenShortcuts: ['مجرد وجود فاتورة مرشحة', 'رسالة جاري الإرسال وحدها كبيع', 'العميل لم يرد = تقصير موظف'],
  },
  cross_sell_upsell: {
    key: 'cross_sell_upsell',
    sources: ['customer_need', 'product_lifecycle', 'interaction_text'],
    externalSources: [],
    question: 'هل كانت هناك فرصة مكملة حقيقية وهل تم اقتراحها بشكل مناسب دون ضغط؟',
    forbiddenShortcuts: ['وجود أكثر من صنف في الفاتورة وحده', 'أي إضافة للسلة = Cross-sell'],
  },
  angry_customer: {
    key: 'angry_customer',
    sources: ['interaction_text', 'lost_opportunity', 'journey'],
    externalSources: [],
    question: 'إذا وُجد غضب/شكوى حقيقية، كيف احتواها الموظف وهل قدم حلًا واضحًا؟',
    forbiddenShortcuts: ['كلمة مشكلة وحدها', 'تأخير تشغيلي وحده كخطأ موظف'],
  },
  order_confirmation: {
    key: 'order_confirmation',
    sources: ['basket', 'sale_proof', 'journey', 'interaction_text'],
    externalSources: [],
    question: 'هل تم تلخيص الطلب وتأكيده بشكل مناسب قبل التنفيذ، عندما يكون البروتوكول منطبقًا؟',
    forbiddenShortcuts: ['تطبيق البروتوكول على استفسار فقط', 'اعتبار الفاتورة بديلًا عن سلوك التأكيد داخل المحادثة'],
  },
  order_delay_handling: {
    key: 'order_delay_handling',
    sources: ['interaction_timing', 'follow_up', 'lost_opportunity', 'interaction_text'],
    externalSources: [],
    question: 'عند وجود تأخير مثبت، هل أبلغ العميل وتابع بصورة مناسبة دون تحميله سببًا خارج إرادته؟',
    forbiddenShortcuts: ['زمن طويل بدون دليل أنه تأخير أوردر', 'نسبة خطأ التشغيل للدكتور تلقائيًا'],
  },
  customer_request_registration: {
    key: 'customer_request_registration',
    sources: ['customer_need', 'follow_up', 'interaction_text'],
    externalSources: ['operational_request_log'],
    question: 'إذا وعد بتوفير صنف أو متابعة طلب، هل تم تسجيل الطلب فعليًا في النظام؟',
    forbiddenShortcuts: ['قال سجلت في واتساب = إثبات التسجيل', 'وجود Follow-up نصي بدون سجل نظام'],
  },
  exceptional_followup_recognition: {
    key: 'exceptional_followup_recognition',
    sources: ['customer_need', 'follow_up', 'customer_identity'],
    externalSources: ['operational_request_log'],
    question: 'إذا كانت الحالة تستحق متابعة استثنائية، هل تم التعرف عليها وتسجيلها بالفعل؟',
    forbiddenShortcuts: ['اعتبار كل عميل متابعة استثنائية', 'استنتاج التسجيل من نص المحادثة فقط'],
  },
  purchase_history_usage: {
    key: 'purchase_history_usage',
    sources: ['customer_identity', 'interaction_text'],
    externalSources: ['purchase_history'],
    question: 'إذا كان تاريخ الشراء متاحًا ومفيدًا، هل استُخدم بشكل صحيح في الرد أو الترشيح؟',
    forbiddenShortcuts: ['وجود فاتورة حالية كأنه تاريخ شراء سابق', 'خصم لعدم الاستخدام بدون إثبات أن التاريخ كان متاحًا ومفيدًا'],
  },
  closing_message: {
    key: 'closing_message',
    sources: ['interaction_text', 'journey'],
    externalSources: [],
    question: 'هل انتهى التفاعل فعلًا، وإذا انتهى هل كان الختام مناسبًا؟',
    forbiddenShortcuts: ['معاقبة محادثة ما زالت مفتوحة', 'اعتبار أي رسالة شكر ختامًا من الموظف'],
  },
};

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function interactionEvidence(view: CaseIntelligenceView): string[] {
  return view.interaction.messages.map((message) => message.id);
}

function sourceAvailability(
  view: CaseIntelligenceView,
  external: ConversationEvaluationExternalEvidence
): Set<ConversationEvaluationEvidenceSource> {
  const available = new Set<ConversationEvaluationEvidenceSource>();
  if (view.interaction.messages.length) {
    available.add('interaction_text');
    available.add('interaction_timing');
  }
  if (view.customer.identityStatus === 'resolved') available.add('customer_identity');
  if (view.staff.participants.some((participant) => participant.staffId)) available.add('staff_identity');
  if (view.need.primaryNeed || view.need.evidenceMessageIds.length || view.need.needDeclined) available.add('customer_need');
  if (view.products.length) available.add('product_lifecycle');
  if (view.basket.versions.length || view.basket.activeItems.length) available.add('basket');
  if (view.sale.proofState !== 'unknown' || view.sale.selectedInvoiceId) available.add('sale_proof');
  if (view.journey) available.add('journey');
  if (view.lostOpportunity) available.add('lost_opportunity');
  if (view.followUp) available.add('follow_up');
  if (external.invoiceItemsAvailable) available.add('invoice_items');
  if (external.operationalRequestLogAvailable) available.add('operational_request_log');
  if (external.purchaseHistoryAvailable) available.add('purchase_history');
  return available;
}

function criterionApplicable(
  view: CaseIntelligenceView,
  key: ReviewCriterionKey,
  clinical: ConversationClinicalReview
): boolean {
  switch (key) {
    case 'customer_name':
      return view.customer.identityStatus === 'resolved';
    case 'followup_after_wait':
      return view.interaction.messages.some(
        (message) => message.role === 'staff' && message.meaningful && isStaffFollowUpPromiseV32(message.text)
      );
    case 'consultation_quality':
      return clinical.consultation.present;
    case 'dosage_explanation':
      return clinical.dosageUsage.present;
    case 'unavailable_items':
      return view.unavailableDemand.length > 0 || view.products.some((product) => product.availability === 'unavailable');
    case 'sales_closing':
    case 'cross_sell_upsell':
    case 'order_confirmation':
      return view.interaction.caseType === 'sales_opportunity' || view.sale.isSaleCountable || view.basket.versions.length > 0;
    case 'angry_customer':
      return view.coachingEvidence.delayComplaintMessageIds.length > 0 ||
        view.interaction.messages.some((message) => /شكوى|زعلان|غاضب|مشكله|مشكلة|متأخر|تأخير/i.test(message.text));
    case 'order_delay_handling':
      return view.coachingEvidence.delayComplaintMessageIds.length > 0;
    case 'customer_request_registration':
      return view.unavailableDemand.length > 0 || view.followUp.opportunities.length > 0;
    case 'exceptional_followup_recognition':
      return view.followUp.opportunities.length > 0;
    case 'purchase_history_usage':
      return view.customer.identityStatus === 'resolved';
    default:
      return true;
  }
}

function evidenceIdsFor(
  view: CaseIntelligenceView,
  key: ReviewCriterionKey,
  clinical: ConversationClinicalReview
): string[] {
  switch (key) {
    case 'understanding':
    case 'unavailable_items':
      return uniq([...view.need.evidenceMessageIds, ...view.evidenceSummary.evidenceMessageIds]);
    case 'consultation_quality':
      return clinical.consultation.evidenceMessageIds;
    case 'dosage_explanation':
      return clinical.dosageUsage.evidenceMessageIds;
    case 'followup_after_wait':
      return uniq([
        ...view.interaction.messages
          .filter((message) => message.role === 'staff' && message.meaningful && isStaffFollowUpPromiseV32(message.text))
          .map((message) => message.id),
        ...view.followUp.opportunities.flatMap((item) => item.evidenceMessageIds),
      ]);
    case 'order_delay_handling':
    case 'customer_request_registration':
    case 'exceptional_followup_recognition':
      return uniq(view.followUp.opportunities.flatMap((item) => item.evidenceMessageIds));
    case 'sales_closing':
    case 'order_confirmation':
      return uniq([...view.sale.confirmationMessageIds, ...view.lostOpportunity.evidenceMessageIds]);
    case 'angry_customer':
      return uniq([...view.coachingEvidence.delayComplaintMessageIds, ...view.lostOpportunity.evidenceMessageIds]);
    default:
      return interactionEvidence(view);
  }
}

export function buildConversationEvaluationEvidence(
  view: CaseIntelligenceView,
  external: ConversationEvaluationExternalEvidence = {}
): ConversationEvaluationEvidenceSnapshot {
  const available = sourceAvailability(view, external);
  const clinical = buildConversationClinicalReview(view);
  const criteria = (Object.keys(CONVERSATION_EVALUATION_CONTRACT) as ReviewCriterionKey[]).map((key) => {
    const contract = CONVERSATION_EVALUATION_CONTRACT[key];
    const applicable = criterionApplicable(view, key, clinical);
    if (!applicable) {
      return {
        key,
        readiness: 'not_applicable' as const,
        availableSources: contract.sources.filter((source) => available.has(source)),
        missingSources: [],
        evidenceMessageIds: evidenceIdsFor(view, key, clinical),
        reason: 'البند غير منطبق على هذا التفاعل وفق حالة المحادثة نفسها.',
      };
    }

    if (key === 'consultation_quality' || key === 'dosage_explanation') {
      return {
        key,
        readiness: 'manual_review_required' as const,
        availableSources: contract.sources.filter((source) => available.has(source)),
        missingSources: [],
        evidenceMessageIds: evidenceIdsFor(view, key, clinical),
        reason: key === 'consultation_quality'
          ? 'تم رصد جزء استشارة طبية؛ يُفصل للمراجعة ولا يحصل على درجة آلية.'
          : 'تم رصد جرعة/طريقة استخدام؛ تُفصل للمراجعة ولا تحصل على درجة آلية.',
      };
    }

    const missingExternal = contract.externalSources.filter((source) => !available.has(source));
    if (missingExternal.length) {
      return {
        key,
        readiness: 'needs_external_evidence' as const,
        availableSources: contract.sources.filter((source) => available.has(source)),
        missingSources: missingExternal,
        evidenceMessageIds: evidenceIdsFor(view, key, clinical),
        reason: 'التحليل يحتاج مصدر نظام إضافي قبل إصدار حكم على هذا البند.',
      };
    }

    const hasCanonicalEvidence = contract.sources.some((source) => available.has(source));
    return {
      key,
      readiness: hasCanonicalEvidence ? ('ready' as const) : ('insufficient_evidence' as const),
      availableSources: contract.sources.filter((source) => available.has(source)),
      missingSources: hasCanonicalEvidence ? [] : [...contract.sources],
      evidenceMessageIds: evidenceIdsFor(view, key, clinical),
      reason: hasCanonicalEvidence
        ? 'يوجد دليل مسموح كافٍ لبدء تحليل هذا البند.'
        : 'لا يوجد دليل كافٍ؛ لا يجوز تحويل غياب الدليل إلى خصم أو مدح.',
    };
  });

  return {
    version: 'conversation-evaluation-evidence-v1',
    caseId: view.caseId,
    criteria,
  };
}
