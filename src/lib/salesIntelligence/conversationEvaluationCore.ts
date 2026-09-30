import { REVIEW_CRITERIA } from '@/lib/conversationReviews';
import type { CaseIntelligenceView } from './types';
import { buildConversationEvaluationEvidence } from './conversationEvaluationEvidence';

export type CoreCriterionKey = 'tone' | 'understanding';
export type CoreAssessmentStatus = 'assessed' | 'not_applicable' | 'insufficient_evidence';

export interface CoreCriterionAssessment {
  key: CoreCriterionKey;
  label: string;
  status: CoreAssessmentStatus;
  selectedOption: string | null;
  selectedLabel: string;
  pointsEarned: number | null;
  maxPoints: number;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
}

export interface ConversationEvaluationCore {
  version: 'conversation-evaluation-core-v1';
  caseId: string;
  items: CoreCriterionAssessment[];
}

const criterionMap = new Map(REVIEW_CRITERIA.map((criterion) => [criterion.key, criterion]));

const RESPECT_RX =
  /(?:حضرتك|يا\s*فندم|يا\s*افندم|تحت\s*(?:أمر|امر)(?:\s*حضرتك)?|من\s*فضلك|لو\s*سمحت|حاضر|عنيا|نورتنا|نتشرف|شكرا|شكرًا)/i;
const APOLOGY_RX = /(?:معلش|متاسف|متأسف|آسف|اسف|بنعتذر|نعتذر)/i;
const STRONG_HOSTILITY_RX =
  /(?:يا\s*(?:غبي|اهبل|أهبل|حمار)|اخرس|اخرسي|قليل\s*الادب|قليلة\s*الادب|مش\s*ناقصينك|لو\s*مش\s*عاجبك|روح\s*اشتكي)/i;
const DISMISSIVE_RX =
  /(?:مش\s*فاضي|مش\s*شغلي|مش\s*مسؤوليتي|بلاش\s*زن|ما\s*تزنش|خلصنا\s*بقى|استنى\s*بقى)/i;
const CLARIFICATION_RX =
  /(?:تقصد|حضرتك\s*تقصد|كام\s*(?:علبة|علب|شريط)|الكمية|التركيز|سن\s*(?:الطفل|حضرتك)?|الوزن|الأعراض|الاعراض|حضرتك\s*(?:عايز|عاوزه|عايزة)|صح\s*[؟?]?|صحيح\s*[؟?]?)/i;
const CUSTOMER_CORRECTION_RX =
  /(?:(?:لا|لأ)\s*(?:قصدي|اقصد)|مش\s*(?:ده|دي|دا|هو)\s*(?:اللي\s*)?(?:طلبت|قصدي|عايز|عاوزه|عايزة)|انا\s*(?:قلت|قولت)|أنا\s*(?:قلت|قولت))/i;
const CLARIFYING_QUESTION_RX = /(?:تقصد|حضرتك\s*تقصد|يعني\s*حضرتك|هل\s*تقصد|صح\s*[؟?]?|صحيح\s*[؟?]?)/i;

function make(
  key: CoreCriterionKey,
  option: string | null,
  status: CoreAssessmentStatus,
  confidence: number,
  reason: string,
  evidenceMessageIds: string[]
): CoreCriterionAssessment {
  const criterion = criterionMap.get(key);
  if (!criterion) throw new Error(`Unknown review criterion: ${key}`);
  const choice = option ? criterion.choices.find((item) => item.value === option) ?? null : null;
  return {
    key,
    label: criterion.label,
    status,
    selectedOption: option,
    selectedLabel:
      status === 'not_applicable'
        ? 'غير منطبق على المحادثة'
        : status === 'insufficient_evidence'
          ? 'الدليل غير كافٍ للحكم'
          : choice?.label || 'تم التقييم',
    pointsEarned: status === 'assessed' ? choice?.pointsEarned ?? null : null,
    maxPoints: criterion.maxPoints,
    confidence,
    reason,
    evidenceMessageIds: Array.from(new Set(evidenceMessageIds.filter(Boolean))),
  };
}

function staffMessages(view: CaseIntelligenceView) {
  return view.interaction.messages
    .filter((message) => message.role === 'staff' && message.meaningful)
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function customerMessages(view: CaseIntelligenceView) {
  return view.interaction.messages
    .filter((message) => message.role === 'customer' && message.meaningful)
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function wordCount(value: string): number {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length;
}

function assessTone(view: CaseIntelligenceView): CoreCriterionAssessment {
  const staff = staffMessages(view);
  if (!staff.length) {
    return make('tone', null, 'insufficient_evidence', 25, 'لا توجد رسائل موظف كافية لتحليل الأسلوب.', []);
  }

  const hostile = staff.find((message) => STRONG_HOSTILITY_RX.test(message.text));
  if (hostile) {
    return make(
      'tone',
      'insult',
      'assessed',
      99,
      'تم رصد إساءة نصية صريحة في رسالة الموظف؛ الحكم مبني على نص مباشر وليس على طول الرسالة أو الانطباع.',
      [hostile.id]
    );
  }

  const dismissive = staff.find((message) => DISMISSIVE_RX.test(message.text));
  if (dismissive) {
    return make(
      'tone',
      'bad',
      'assessed',
      96,
      'تم رصد صياغة رفض/تجاهل غير مهنية بشكل مباشر في رسالة الموظف.',
      [dismissive.id]
    );
  }

  const respectMessages = staff.filter((message) => RESPECT_RX.test(message.text) || APOLOGY_RX.test(message.text));
  if (respectMessages.length >= 2) {
    return make(
      'tone',
      'professional',
      'assessed',
      94,
      'تكرر عبر أكثر من رسالة استخدام مخاطبة محترمة/اهتمام واضح بدون دليل نصي على إساءة أو تجاهل.',
      respectMessages.map((message) => message.id)
    );
  }

  if (respectMessages.length === 1) {
    return make(
      'tone',
      'acceptable',
      'assessed',
      86,
      'يوجد دليل واضح على مخاطبة محترمة، لكن الدليل المتاح لا يكفي لرفع الحكم إلى أعلى مستوى.',
      [respectMessages[0].id]
    );
  }

  const terse = staff.filter((message) => {
    const text = message.text.trim();
    return text.length <= 14 && wordCount(text) <= 2;
  });
  if (staff.length >= 3 && terse.length / staff.length >= 0.67) {
    return make(
      'tone',
      'dry',
      'assessed',
      84,
      'معظم ردود الموظف قصيرة جدًا ومتتابعة بدون مؤشرات مخاطبة محترمة أو احتواء؛ النمط كاملًا هو الدليل وليس رسالة واحدة.',
      terse.map((message) => message.id)
    );
  }

  return make(
    'tone',
    null,
    'insufficient_evidence',
    55,
    'لا يوجد دليل كافٍ لمدح الأسلوب أو خصمه: الردود ليست مسيئة، لكن لا توجد إشارات كافية للحكم على جودتها بثقة.',
    staff.slice(0, 3).map((message) => message.id)
  );
}

function precedingStaffMessage(view: CaseIntelligenceView, messageId: string) {
  const ordered = view.interaction.messages
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const index = ordered.findIndex((message) => message.id === messageId);
  if (index < 0) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (ordered[i].role === 'staff' && ordered[i].meaningful) return ordered[i];
    if (ordered[i].role === 'customer' && ordered[i].meaningful) break;
  }
  return null;
}

function assessUnderstanding(view: CaseIntelligenceView): CoreCriterionAssessment {
  if (!view.need.primaryNeed) {
    return make(
      'understanding',
      null,
      'not_applicable',
      95,
      'لا يوجد احتياج عميل واضح في هذا التفاعل يجعل بند فهم الطلب قابلًا للتقييم.',
      []
    );
  }

  const customers = customerMessages(view);
  const staff = staffMessages(view);
  const correction = customers.find((message) => CUSTOMER_CORRECTION_RX.test(message.text));
  if (correction) {
    const preceding = precedingStaffMessage(view, correction.id);
    if (preceding && CLARIFYING_QUESTION_RX.test(preceding.text)) {
      return make(
        'understanding',
        'strong',
        'assessed',
        93,
        'العميل صحح/حدد المقصود بعد سؤال استيضاح صريح من الموظف؛ ده دليل على أن الموظف لم يخمن وطلب توضيحًا قبل الحسم.',
        [preceding.id, correction.id]
      );
    }
    if (preceding) {
      return make(
        'understanding',
        'wrong',
        'assessed',
        95,
        'ظهر تصحيح صريح من العميل بعد رد موظف غير استيضاحي، ما يدل على أن الطلب فُهم بشكل خاطئ في هذه النقطة.',
        [preceding.id, correction.id]
      );
    }
  }

  // Missing image/voice product context is absence of evidence, never poor understanding.
  if (view.need.unresolvedNeed && view.products.length === 0) {
    return make(
      'understanding',
      null,
      'insufficient_evidence',
      100,
      'الاحتياج مرتبط بمحتوى غير ظاهر في التصدير (مثل صورة/فويس) ولا توجد هوية صنف نصية موثوقة؛ لا يجوز مدح أو خصم فهم الموظف من دليل غير متاح.',
      view.need.evidenceMessageIds
    );
  }

  const clarification = staff.find((message) => CLARIFICATION_RX.test(message.text));
  const requested = view.products.filter((product) => product.roles.includes('requested'));
  const coveredKeys = new Set(
    view.staff.facts
      .filter((fact) =>
        ['stated_available', 'stated_unavailable', 'stated_check_pending', 'offered_product', 'offered_alternative', 'confirmed_order'].includes(fact.fact)
      )
      .map((fact) => fact.productKey)
      .filter((key): key is string => Boolean(key))
  );
  const covered = requested.filter((product) => product.inFinalBasket || coveredKeys.has(product.productKey));

  if (requested.length > 0 && covered.length === requested.length && !view.need.unresolvedNeed) {
    const evidence = [
      ...view.need.evidenceMessageIds,
      ...view.staff.facts
        .filter((fact) => fact.productKey && coveredKeys.has(fact.productKey))
        .map((fact) => fact.messageId),
      ...(clarification ? [clarification.id] : []),
    ];
    return make(
      'understanding',
      'strong',
      'assessed',
      clarification ? 96 : 91,
      clarification
        ? 'الطلب النصي محدد، وتم ربط الأصناف المطلوبة بردود الموظف مع استيضاح مناسب قبل الإكمال.'
        : 'الطلب النصي محدد، وتم ربط جميع الأصناف المطلوبة بردود الموظف/السلة بدون تعارض أو احتياج غير محسوم.',
      evidence
    );
  }

  if (requested.length > 0 && covered.length > 0) {
    return make(
      'understanding',
      'acceptable',
      'assessed',
      82,
      'تم التعامل مع جزء واضح من الطلب بشكل صحيح، لكن بعض عناصر الاحتياج ما زالت غير محسومة أو غير مغطاة بالكامل.',
      [
        ...view.need.evidenceMessageIds,
        ...view.staff.facts
          .filter((fact) => fact.productKey && coveredKeys.has(fact.productKey))
          .map((fact) => fact.messageId),
      ]
    );
  }

  if (!view.need.unresolvedNeed && clarification) {
    return make(
      'understanding',
      'acceptable',
      'assessed',
      80,
      'تم رصد سؤال استيضاح مناسب مرتبط بطلب العميل، لكن لا توجد أدلة منتج كافية لاعتبار الفهم قويًا بالكامل.',
      [...view.need.evidenceMessageIds, clarification.id]
    );
  }

  if (view.need.unresolvedNeed && staff.length) {
    return make(
      'understanding',
      null,
      'insufficient_evidence',
      65,
      'الطلب ما زال غير محسوم، لكن الدليل الحالي لا يثبت أن السبب استعجال أو سوء فهم من الموظف؛ لذلك لا يوجد خصم تلقائي.',
      [...view.need.evidenceMessageIds, ...staff.slice(0, 2).map((message) => message.id)]
    );
  }

  return make(
    'understanding',
    null,
    'insufficient_evidence',
    50,
    'لا توجد أدلة كافية تربط احتياج العميل برد الموظف بشكل يسمح بدرجة عادلة.',
    view.need.evidenceMessageIds
  );
}

export function analyzeConversationEvaluationCore(view: CaseIntelligenceView): ConversationEvaluationCore {
  const contract = buildConversationEvaluationEvidence(view);
  const readiness = new Map(contract.criteria.map((item) => [item.key, item.readiness]));

  const items = [assessTone(view), assessUnderstanding(view)].map((item) => {
    const gate = readiness.get(item.key);
    if (gate === 'not_applicable') {
      return item.status === 'not_applicable'
        ? item
        : make(item.key, null, 'not_applicable', 100, 'البند غير منطبق وفق عقد الأدلة.', []);
    }
    if (gate === 'insufficient_evidence' && item.status === 'assessed') {
      return make(
        item.key,
        null,
        'insufficient_evidence',
        30,
        'عقد الأدلة لا يملك مصدرًا كافيًا للحكم على هذا البند.',
        item.evidenceMessageIds
      );
    }
    return item;
  });

  return { version: 'conversation-evaluation-core-v1', caseId: view.caseId, items };
}
