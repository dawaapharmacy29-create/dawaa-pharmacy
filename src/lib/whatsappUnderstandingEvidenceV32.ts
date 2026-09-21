// V32 Phase C.2 — Understanding Customer Request criterion, evidence-contract implementation.
// Deliberately built as small named signals (not one large regex) so each can be tested and
// read independently. When the signals available are insufficient to support a judgment,
// this module reports status 'unknown' rather than inventing correct/incorrect — per the
// explicit anti-hallucination requirement for this phase.
import {
  computeConfidenceV32,
  messagesInScopeV32,
  notApplicableResultV32,
  type CriterionEvaluationInputV32,
  type CriterionEvidenceContractV32,
  type CriterionEvidenceResultV32,
  type CriterionFindingV32,
} from './whatsappCriterionEvidenceV32';
import type { NormalizedConversationMessageV32 } from './whatsappConversationUnderstandingV32';

const VERSION = 'understanding-evidence-v32';
const MAX_POINTS = 10;

// Reuses the exact point values already live in REVIEW_CRITERIA['understanding'].
const BAND_POINTS: Record<string, number> = {
  strong: 10,
  adequate: 7,
  weak: 2,
  wrong: 0,
};

// A short, curated list of openers that carry no identifiable product/symptom — a genuinely
// vague need. Anything not matching this is treated as potentially specific (signal, not proof).
const VAGUE_OPENER_RX = /^(?:محتاج|عايز|عاوز|ممكن)\s*(?:حاجه|حاجة|استشاره|استشارة|مساعده|مساعدة)\s*[؟?]?$/i;

// A pure greeting carries no request at all — it must never be mistaken for "the customer's
// need" just because it happens to be the first meaningful inbound message. Response Speed is
// allowed to treat a greeting as the thing being replied to; Understanding is not.
const GREETING_ONLY_RX =
  /^(?:و)?(?:ال)?سلام\s*عليكم(?:\s*(?:و)?رحمة?\s*الله(?:\s*(?:و)?بركاته)?)?[!.، ]*$|^أهل[اً]?\s*(?:و\s*سهل[اً]?)?[!.، ]*$|^مرحب[اً]?[!.، ]*$|^ه?اي[!.، ]*$|^صباح\s*ال(?:خير|نور)[!.، ]*$|^مساء\s*ال(?:خير|نور)[!.، ]*$/i;
const QUESTION_RX = /[؟?]/;
const CORRECTION_RX =
  /مش\s*ده\s*(?:اللي|الي)?\s*(?:طلبته|قصدته|عايزه|عاوزه)|ده\s*مش\s*اللي\s*طلبته|فهمت\s*غلط|(?:لا،?\s*)?غلط\s*فهمت/i;
const DIRECT_OFFER_RX = /متوفر|عندنا|يوجد|متاح|سعره|السعر|هيبقى\s*معاك/i;

interface UnderstandingSignals {
  needClarity: 'clear' | 'unclear' | 'unknown';
  clarificationNeeded: boolean;
  clarificationAsked: boolean;
  assumptionDetected: boolean;
  contradictionDetected: boolean;
  requestMessageIds: string[];
  clarificationMessageIds: string[];
  contradictionMessageIds: string[];
  offerMessageIds: string[];
}

function computeSignals(trigger: NormalizedConversationMessageV32, after: NormalizedConversationMessageV32[]): UnderstandingSignals {
  const text = trigger.text.trim();
  const needClarity: UnderstandingSignals['needClarity'] = VAGUE_OPENER_RX.test(text)
    ? 'unclear'
    : text.length >= 8
      ? 'clear'
      : 'unknown';

  const staffAfter = after.filter((m) => m.role === 'staff' && m.isMeaningful);
  const clarificationMessages = staffAfter.filter((m) => QUESTION_RX.test(m.text) && !DIRECT_OFFER_RX.test(m.text));
  const offerMessages = staffAfter.filter((m) => DIRECT_OFFER_RX.test(m.text));
  const firstClarification = clarificationMessages[0];
  const firstOffer = offerMessages[0];
  const clarificationAsked =
    Boolean(firstClarification) && (!firstOffer || firstClarification.timestamp.getTime() <= firstOffer.timestamp.getTime());

  const clarificationNeeded = needClarity === 'unclear';

  const customerAfter = after.filter((m) => m.role === 'customer' && m.isMeaningful);
  const contradictions = customerAfter.filter((m) => CORRECTION_RX.test(m.text));

  const assumptionDetected = clarificationNeeded && !clarificationAsked && offerMessages.length > 0;

  return {
    needClarity,
    clarificationNeeded,
    clarificationAsked,
    assumptionDetected,
    contradictionDetected: contradictions.length > 0,
    requestMessageIds: [trigger.id],
    clarificationMessageIds: firstClarification ? [firstClarification.id] : [],
    contradictionMessageIds: contradictions.map((m) => m.id),
    offerMessageIds: firstOffer ? [firstOffer.id] : [],
  };
}

export function evaluateUnderstandingV32(input: CriterionEvaluationInputV32): CriterionEvidenceResultV32 {
  const scoped = messagesInScopeV32(input);
  const trigger = scoped.find(
    (m) => m.role === 'customer' && m.isMeaningful && !GREETING_ONLY_RX.test(m.text.trim())
  );
  if (!trigger) {
    return notApplicableResultV32(
      'understanding',
      VERSION,
      MAX_POINTS,
      'لا توجد رسالة طلب من العميل في نطاق هذا التفاعل.'
    );
  }

  const after = scoped.filter((m) => m.timestamp.getTime() >= trigger.timestamp.getTime());
  const signals = computeSignals(trigger, after);

  const findings: CriterionFindingV32[] = [
    {
      key: 'need_clarity',
      status: signals.needClarity === 'unknown' ? 'unknown' : 'proven',
      fact: `رسالة طلب العميل: "${trigger.text.slice(0, 100)}".`,
      interpretation:
        signals.needClarity === 'clear'
          ? 'الطلب يحتوي تفاصيل كافية لتحديد الاحتياج مبدئيًا.'
          : signals.needClarity === 'unclear'
            ? 'الطلب عام ولا يحدد احتياجًا واضحًا.'
            : 'لا يوجد دليل كافٍ للحكم على وضوح الطلب.',
      source: 'conversation',
      evidenceMessageIds: [trigger.id],
    },
  ];

  if (signals.clarificationMessageIds.length) {
    findings.push({
      key: 'clarification_asked',
      status: 'proven',
      fact: 'الموظف طرح سؤالًا توضيحيًا قبل تقديم أي عرض أو منتج.',
      interpretation: null,
      source: 'conversation',
      evidenceMessageIds: signals.clarificationMessageIds,
    });
  } else if (signals.clarificationNeeded) {
    findings.push({
      key: 'clarification_asked',
      status: 'missing',
      fact: 'الطلب كان عامًا ولم يُعثر على سؤال توضيحي من الموظف قبل أي عرض.',
      interpretation: null,
      source: 'conversation',
      evidenceMessageIds: [],
    });
  }

  if (signals.contradictionDetected) {
    findings.push({
      key: 'customer_correction',
      status: 'contradicted',
      fact: 'العميل صحّح فهم الموظف صراحة بعد رد الموظف.',
      interpretation: null,
      source: 'conversation',
      evidenceMessageIds: signals.contradictionMessageIds,
    });
  }

  let band: 'strong' | 'adequate' | 'weak' | 'wrong' | null = null;
  let needsHumanReview = false;
  const humanReviewReasons: string[] = [];

  if (signals.contradictionDetected) {
    band = 'wrong';
  } else if (signals.needClarity === 'clear' && (!signals.clarificationNeeded || signals.clarificationAsked)) {
    band = 'strong';
  } else if (signals.clarificationNeeded && signals.clarificationAsked) {
    band = 'adequate';
  } else if (signals.assumptionDetected) {
    band = 'weak';
  } else {
    needsHumanReview = true;
    humanReviewReasons.push('insufficient_understanding_signals');
  }

  const positiveIds = [...signals.requestMessageIds, ...signals.clarificationMessageIds];
  const negativeIds = signals.assumptionDetected ? signals.offerMessageIds : [];
  const understandingConfidenceFactors = {
    evidenceCompleteness: band ? 1 : 0.3,
    evidenceClarity: signals.needClarity === 'unknown' ? 0.4 : 0.8,
    contradictions: signals.contradictionDetected ? 0.5 : 1,
    sourceReliability: 0.75,
  };

  return {
    criterionKey: 'understanding',
    version: VERSION,
    maxPoints: MAX_POINTS,
    applicable: true,
    applicabilityReason: 'توجد رسالة طلب من العميل في نطاق هذا التفاعل.',
    findings,
    positiveEvidenceMessageIds: positiveIds,
    negativeEvidenceMessageIds: negativeIds,
    contradictionMessageIds: signals.contradictionMessageIds,
    scoreBand: band,
    pointsEarned: band ? BAND_POINTS[band] : null,
    scoreReasoning: band
      ? `التصنيف "${band}" بناءً على وضوح الطلب (${signals.needClarity})، الحاجة لتوضيح (${signals.clarificationNeeded})، وهل طُلب التوضيح فعليًا (${signals.clarificationAsked}).`
      : 'الأدلة المتاحة غير كافية لتصنيف فهم الموظف للطلب دون افتراض.',
    confidence: computeConfidenceV32(understandingConfidenceFactors),
    confidenceFactors: understandingConfidenceFactors,
    needsHumanReview,
    humanReviewReasons,
  };
}

export const UnderstandingEvidenceContractV32: CriterionEvidenceContractV32 = {
  criterionKey: 'understanding',
  version: VERSION,
  maxPoints: MAX_POINTS,
  evaluate: evaluateUnderstandingV32,
};
