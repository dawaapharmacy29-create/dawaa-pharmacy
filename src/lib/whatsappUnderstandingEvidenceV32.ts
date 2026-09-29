// V32 Phase C.2 — Understanding Customer Request criterion, evidence-contract implementation.
// V32.2: built on top of the shared semantic signal layer (whatsappSemanticSignalsV32.ts)
// instead of ad hoc regex, and distinguishes HOW understanding was reached (direct vs. a good
// clarification process vs. a bad one) rather than only whether the final score was good.
// When the signals available are insufficient to support a judgment, this module reports
// status 'unknown' rather than inventing correct/incorrect — per the explicit anti-hallucination
// requirement for this phase.
import {
  computeConfidenceV32,
  messagesInScopeV32,
  notApplicableResultV32,
  type CriterionEvaluationInputV32,
  type CriterionEvidenceContractV32,
  type CriterionEvidenceResultV32,
  type CriterionFindingV32,
} from './whatsappCriterionEvidenceV32';
import {
  extractConfirmationSignals,
  isBareAcknowledgementOnly,
  isGreetingOnly,
  isRequestCandidate,
  isSubstantiveConfirmationSignal,
  resolveReference,
} from './whatsappSemanticSignalsV32';
import type { NormalizedConversationMessageV32 } from './whatsappConversationUnderstandingV32';

const VERSION = 'understanding-evidence-v32.2';
const MAX_POINTS = 10;

// Reuses the exact point values already live in REVIEW_CRITERIA['understanding'] — this phase
// only refines HOW a classification is reached and evidenced, never the point scale itself.
const BAND_POINTS: Record<string, number> = {
  strong: 10,
  adequate: 7,
  weak: 2,
  wrong: 0,
};

// direct_correct/clarified_correctly/partial/incorrect map onto the existing 4 score bands —
// see the mapping comment above evaluateUnderstandingV32(). unresolved/unknown never get a
// band: that is the point of the distinction (no invented judgment without evidence).
export type UnderstandingClassification =
  | 'direct_correct'
  | 'clarified_correctly'
  | 'partial'
  | 'incorrect'
  | 'unresolved'
  | 'unknown';

const CLASSIFICATION_TO_BAND: Record<UnderstandingClassification, keyof typeof BAND_POINTS | null> = {
  direct_correct: 'strong',
  clarified_correctly: 'adequate',
  partial: 'weak',
  incorrect: 'wrong',
  unresolved: null,
  unknown: null,
};

const VAGUE_OPENER_RX = /^(?:محتاج|عايز|عاوز|ممكن)\s*(?:حاجه|حاجة|استشاره|استشارة|مساعده|مساعدة)\s*[؟?]?$/i;
const QUESTION_RX = /[؟?]/;
// A staff message that jumps straight to answering/selling rather than asking about the need.
const DIRECT_OFFER_RX = /متوفر|عندنا|يوجد|متاح|سعره|السعر|هيبقى\s*معاك/i;
const CORRECTION_RX =
  /لا\s*قصدي|مش\s*ده(?:\s*اللي)?|ده\s*مش(?:\s*اللي)?|أنا\s*(?:أ|ا)قصد|لا\s*التاني\b|مش\s*كده|لا\s*حضرتك\s*فهمتني\s*غلط|أنا\s*قلت|فهمت\s*غلط/i;
// A clarification question that is ONLY about logistics (location), not the customer's actual need.
const LOCATION_ONLY_CLARIFICATION_RX = /^(?:حضرتك\s*)?(?:منين|فين|من\s*أي\s*محافظ[ةه])\s*[؟?]*$/i;
// The branded self-introduction ("أهلًا وسهلًا... مع حضرتك د X... خدمة التوصيل متاحة على مدار ٢٤
// ساعة") is auto-sent as the very first staff reply in almost every real conversation, often
// BEFORE the staff has actually answered the customer's question. It must never be mistaken for
// "the staff's substantive response" just because it happens to be the first staff message.
const STAFF_SELF_INTRO_RX = /مع\s*حضرتك\s*د(?:كتور[ةه]?)?\.?\s|أهل[اًٍ]?\s*و?\s*سهل[اًٍ]?\s*ب?حضرتك|نورتنا\s*في\s*صيدليات\s*دواء/i;

function isStaffIntroOnly(text: string): boolean {
  return STAFF_SELF_INTRO_RX.test(text) && !DIRECT_OFFER_RX.test(text) && !QUESTION_RX.test(text);
}
const DETAIL_MARKER_RX = /سن|عمر|كام|ناشف|بلغم|نوع|درج[ةه]\s*الحرار[ةه]|الأعراض|من\s*امتى|بيحصل\s*إمتى/i;
const STOPWORDS = new Set([
  'حضرتك', 'عايز', 'عاوز', 'محتاج', 'ممكن', 'من', 'في', 'و', 'ال', 'يا', 'فندم', 'لو', 'سمحت', 'انا', 'أنا', 'دي', 'ده',
]);

function tokenize(text: string): string[] {
  return text
    .replace(/[؟?.,،]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

type ClarificationRelevance = 'relevant' | 'partially_relevant' | 'irrelevant' | 'unknown';

function computeClarificationRelevance(triggerText: string, clarificationText: string): ClarificationRelevance {
  if (LOCATION_ONLY_CLARIFICATION_RX.test(clarificationText.trim())) return 'irrelevant';
  const triggerTokens = new Set(tokenize(triggerText));
  const overlap = tokenize(clarificationText).some((w) => triggerTokens.has(w));
  if (overlap) return 'relevant';
  if (DETAIL_MARKER_RX.test(clarificationText)) return 'partially_relevant';
  return 'unknown';
}

/**
 * V32.2.1: a staff message occurring after a customer correction only counts as resolving it
 * when its content actually relates back to the correction — repeating a word from the
 * correction (e.g. the corrected item/type), or asking a real clarifying question about it. A
 * bare "تمام"/"حاضر"/"ماشي" or a message about something else entirely (e.g. a delivery-hours
 * remark) is never enough on its own — see the "resolutionAfterCorrection" hardening.
 */
function isSubstantiveCorrectionResponse(correctionText: string, staffText: string): boolean {
  if (isBareAcknowledgementOnly(staffText)) return false;
  const correctionTokens = new Set(tokenize(correctionText));
  const hasOverlap = tokenize(staffText).some((w) => correctionTokens.has(w));
  if (hasOverlap) return true;
  return QUESTION_RX.test(staffText);
}

/**
 * needClarity treats a request as 'clear' either because it names something specific directly,
 * or because a pronoun reference ("محتاجه واحد من دا") resolves unambiguously to a single prior
 * staff offer (image/product mention). An unresolved/ambiguous reference stays 'unclear' rather
 * than being guessed at.
 */
function computeNeedClarity(
  trigger: NormalizedConversationMessageV32,
  allMessages: NormalizedConversationMessageV32[],
  triggerIndex: number
): 'clear' | 'unclear' | 'unknown' {
  const text = trigger.text.trim();
  if (VAGUE_OPENER_RX.test(text)) return 'unclear';
  if (text.length >= 8) return 'clear';
  const resolved = resolveReference(allMessages, triggerIndex);
  if (resolved) return 'clear';
  return 'unknown';
}

interface UnderstandingSignals {
  needClarity: 'clear' | 'unclear' | 'unknown';
  clarificationNeeded: boolean;
  clarificationAsked: boolean;
  clarificationRelevance: ClarificationRelevance | null;
  assumptionDetected: boolean;
  correctionDetected: boolean;
  resolutionAfterCorrection: 'resolved' | 'unresolved' | 'unknown';
  /** First meaningful staff reply after the trigger carried some actual content (an offer, or
   *  overlapping wording), as opposed to a bare "تمام"/"حاضر" that proves nothing on its own. */
  staffRespondedSubstantively: boolean;
  firstStaffReplyId: string | null;
  requestMessageIds: string[];
  clarificationMessageIds: string[];
  correctionMessageIds: string[];
  correctedMessageIds: string[];
  offerMessageIds: string[];
}

function computeSignals(
  trigger: NormalizedConversationMessageV32,
  triggerIndex: number,
  allMessages: NormalizedConversationMessageV32[],
  after: NormalizedConversationMessageV32[]
): UnderstandingSignals {
  const needClarity = computeNeedClarity(trigger, allMessages, triggerIndex);
  const clarificationNeeded = needClarity === 'unclear';

  const staffAfter = after.filter((m) => m.role === 'staff' && m.isMeaningful);
  const clarificationMessages = staffAfter.filter((m) => QUESTION_RX.test(m.text) && !DIRECT_OFFER_RX.test(m.text));
  const offerMessages = staffAfter.filter((m) => DIRECT_OFFER_RX.test(m.text));
  const firstClarification = clarificationMessages[0];
  const firstOffer = offerMessages[0];
  const clarificationAsked =
    Boolean(firstClarification) && (!firstOffer || firstClarification.timestamp.getTime() <= firstOffer.timestamp.getTime());
  const clarificationRelevance = firstClarification
    ? computeClarificationRelevance(trigger.text, firstClarification.text)
    : null;

  const customerAfter = after.filter((m) => m.role === 'customer' && m.isMeaningful);
  const corrections = customerAfter.filter((m) => CORRECTION_RX.test(m.text));
  const firstCorrection = corrections[0];
  let correctedMessageIds: string[] = [];
  let resolutionAfterCorrection: UnderstandingSignals['resolutionAfterCorrection'] = 'unknown';
  if (firstCorrection) {
    const priorStaff = allMessages
      .filter((m) => m.role === 'staff' && m.isMeaningful && m.timestamp.getTime() < firstCorrection.timestamp.getTime())
      .pop();
    correctedMessageIds = priorStaff ? [priorStaff.id] : [];
    const staffMessagesAfterCorrection = allMessages.filter(
      (m) => m.role === 'staff' && m.isMeaningful && m.timestamp.getTime() > firstCorrection.timestamp.getTime()
    );
    const substantiveReply = staffMessagesAfterCorrection.find((m) =>
      isSubstantiveCorrectionResponse(firstCorrection.text, m.text)
    );
    // A staff reply that exists but never actually engages with the correction (a bare "تمام" or
    // an unrelated remark) is treated the same as no reply at all — 'resolved' must be earned.
    resolutionAfterCorrection = substantiveReply ? 'resolved' : 'unresolved';
  }

  const assumptionDetected = clarificationNeeded && !clarificationAsked && offerMessages.length > 0;

  // Skip a branded self-introduction that precedes the real answer; fall back to it only if the
  // staff never sent anything else (still better than reporting no reply at all).
  const firstStaffReply = staffAfter.find((m) => !isStaffIntroOnly(m.text)) || staffAfter[0] || null;
  const triggerTokens = new Set(tokenize(trigger.text));
  // A strong-implicit confirmation ("من عنيا لحضرتك") that the shared signal layer has already
  // linked to this specific customer message also counts as a substantive response — it shows
  // the staff is acting on this exact request, even without repeating its wording back.
  const linkedConfirmationToTrigger = extractConfirmationSignals(allMessages).some(
    (signal) =>
      signal.messageId === firstStaffReply?.id &&
      isSubstantiveConfirmationSignal(signal) &&
      (signal.relatedMessageIds || []).includes(trigger.id)
  );
  const staffRespondedSubstantively = Boolean(
    firstStaffReply &&
      !isBareAcknowledgementOnly(firstStaffReply.text) &&
      (DIRECT_OFFER_RX.test(firstStaffReply.text) ||
        QUESTION_RX.test(firstStaffReply.text) ||
        tokenize(firstStaffReply.text).some((w) => triggerTokens.has(w)) ||
        linkedConfirmationToTrigger)
  );

  return {
    needClarity,
    clarificationNeeded,
    clarificationAsked,
    clarificationRelevance,
    assumptionDetected,
    correctionDetected: corrections.length > 0,
    resolutionAfterCorrection,
    staffRespondedSubstantively,
    firstStaffReplyId: firstStaffReply?.id || null,
    requestMessageIds: [trigger.id],
    clarificationMessageIds: firstClarification ? [firstClarification.id] : [],
    correctionMessageIds: corrections.map((m) => m.id),
    correctedMessageIds,
    offerMessageIds: firstOffer ? [firstOffer.id] : [],
  };
}

function classify(signals: UnderstandingSignals): UnderstandingClassification {
  if (signals.correctionDetected) return 'incorrect';
  if (signals.needClarity === 'clear' && !signals.clarificationNeeded) {
    // A generic acknowledgement ("تمام"/"حاضر") never counts as proof of understanding by
    // itself — see success criterion "Generic acknowledgements لا تتحول لفهم ناجح تلقائيًا".
    return signals.staffRespondedSubstantively ? 'direct_correct' : 'unresolved';
  }
  if (
    signals.clarificationNeeded &&
    signals.clarificationAsked &&
    signals.clarificationRelevance !== 'irrelevant' &&
    signals.clarificationRelevance !== null
  ) {
    return 'clarified_correctly';
  }
  if (signals.clarificationNeeded && signals.clarificationAsked && signals.clarificationRelevance === 'irrelevant') {
    return 'partial'; // asked *a* question, but not one that actually targets the stated need
  }
  if (signals.assumptionDetected) return 'partial';
  if (signals.needClarity === 'unknown') return 'unknown';
  return 'unresolved';
}

export function evaluateUnderstandingV32(input: CriterionEvaluationInputV32): CriterionEvidenceResultV32 {
  const scoped = messagesInScopeV32(input);
  const triggerIndex = scoped.findIndex((m) => isRequestCandidate(m));
  const trigger = triggerIndex === -1 ? null : scoped[triggerIndex];
  if (!trigger) {
    return notApplicableResultV32(
      'understanding',
      VERSION,
      MAX_POINTS,
      'لا توجد رسالة طلب من العميل في نطاق هذا التفاعل (بخلاف تحية فقط).'
    );
  }

  const after = scoped.filter((m) => m.timestamp.getTime() >= trigger.timestamp.getTime());
  const signals = computeSignals(trigger, triggerIndex, scoped, after);
  const classification = classify(signals);
  const band = CLASSIFICATION_TO_BAND[classification];

  const findings: CriterionFindingV32[] = [
    {
      key: 'need_clarity',
      status: signals.needClarity === 'unknown' ? 'unknown' : 'proven',
      fact: `رسالة طلب العميل: "${trigger.text.slice(0, 100)}".`,
      interpretation:
        signals.needClarity === 'clear'
          ? 'الطلب يحتوي تفاصيل كافية لتحديد الاحتياج، أو تم حل مرجع الضمير فيه لعرض سابق واحد بلا لبس.'
          : signals.needClarity === 'unclear'
            ? 'الطلب عام ولا يحدد احتياجًا واضحًا.'
            : 'لا يوجد دليل كافٍ للحكم على وضوح الطلب (مرجع غامض أو نص قصير جدًا).',
      source: 'conversation',
      provenance: 'customer_statement',
      evidenceMessageIds: [trigger.id],
      ruleId: isGreetingOnly(trigger.text) ? 'need_clarity.fallback_greeting_only' : 'need_clarity.trigger_text_or_resolved_reference',
    },
  ];

  if (signals.clarificationMessageIds.length) {
    findings.push({
      key: 'clarification_asked',
      status: 'proven',
      fact: `الموظف طرح سؤالًا توضيحيًا: "${(after.find((m) => signals.clarificationMessageIds.includes(m.id))?.text || '').slice(0, 80)}".`,
      interpretation: `صلة السؤال بالاحتياج المذكور: ${signals.clarificationRelevance}.`,
      source: 'conversation',
      provenance: 'staff_confirmation',
      evidenceMessageIds: signals.clarificationMessageIds,
      ruleId: `clarification_quality.${signals.clarificationRelevance}`,
    });
  } else if (signals.clarificationNeeded) {
    findings.push({
      key: 'clarification_asked',
      status: 'missing',
      fact: 'الطلب كان عامًا ولم يُعثر على سؤال توضيحي من الموظف قبل أي عرض.',
      interpretation: null,
      source: 'conversation',
      evidenceMessageIds: [],
      ruleId: 'clarification_asked.missing',
    });
  }

  if (signals.correctionDetected) {
    findings.push({
      key: 'customer_correction',
      status: 'contradicted',
      fact: 'العميل صحّح فهم الموظف صراحة بعد رد سابق من الموظف.',
      interpretation: `${signals.resolutionAfterCorrection === 'resolved' ? 'أرسل الموظف رسالة أخرى بعد التصحيح' : signals.resolutionAfterCorrection === 'unresolved' ? 'لم يُعثر على رد من الموظف بعد التصحيح ضمن هذا النطاق' : 'غير معروف ما إذا تم الرد على التصحيح'} (هذا لا يغيّر تصنيف الفهم نفسه، فقط يوثّق ما حدث بعده).`,
      source: 'conversation',
      provenance: 'customer_statement',
      evidenceMessageIds: [...signals.correctedMessageIds, ...signals.correctionMessageIds],
      ruleId: 'customer_correction.linked_to_prior_staff_message',
    });
  }

  const positiveIds = [...signals.requestMessageIds, ...signals.clarificationMessageIds];
  const negativeIds = signals.assumptionDetected ? signals.offerMessageIds : [];
  const primaryMessageIds = [
    ...signals.requestMessageIds,
    ...(signals.clarificationMessageIds.length ? signals.clarificationMessageIds : []),
    ...(signals.correctionDetected ? [...signals.correctedMessageIds, ...signals.correctionMessageIds] : []),
  ];

  const needsHumanReview = classification === 'unresolved' || classification === 'unknown';
  const humanReviewReasons = needsHumanReview ? ['insufficient_understanding_signals'] : [];

  const understandingConfidenceFactors = {
    evidenceCompleteness: band ? 1 : 0.3,
    evidenceClarity: signals.needClarity === 'unknown' ? 0.4 : signals.clarificationRelevance === 'unknown' ? 0.6 : 0.85,
    contradictions: signals.correctionDetected ? 0.5 : 1,
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
    contradictionMessageIds: signals.correctionMessageIds,
    primaryMessageIds,
    scoreBand: band,
    pointsEarned: band ? BAND_POINTS[band] : null,
    scoreReasoning: band
      ? `التصنيف "${classification}" (يقابل "${band}") بناءً على وضوح الطلب (${signals.needClarity})، الحاجة لتوضيح (${signals.clarificationNeeded})، هل طُلب التوضيح فعليًا (${signals.clarificationAsked})، وصلة التوضيح بالاحتياج (${signals.clarificationRelevance ?? 'لا ينطبق'}).`
      : `التصنيف "${classification}": الأدلة المتاحة غير كافية لتصنيف فهم الموظف للطلب دون افتراض.`,
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
