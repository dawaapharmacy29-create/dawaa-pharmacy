// V32 Phase C.2 — shared semantic signal layer.
//
// FAILURE TAXONOMY (from reviewing V32.1's Golden Cases + the real Ibrahim Al-Sayyad
// conversation before writing a single new rule here, per the explicit "analyze before you
// regex" instruction for this phase). Each class below names which signal/rule in this file
// or in the criterion modules that consume it addresses it.
//
//  1. Greeting mistaken for customer request
//     -> fixed in V32.1 (GREETING_RX / isRequestCandidate below); still enforced here.
//  2. Media placeholder mistaken for meaningful content
//     -> fixed in V32.1 (NormalizedConversationMessageV32.isMediaPlaceholder).
//  3. Implicit confirmation not recognized ("من عنيا لحضرتك" etc. never counted as confirmation)
//     -> addressed by extractConfirmationSignals()'s strong_implicit tier.
//  4. Egyptian colloquial acceptance not recognized ("تمام"، "ماشي"، "ايوا" as acceptance)
//     -> addressed by extractAcceptanceSignals().
//  5. Employee clarification incorrectly counted as understanding regardless of relevance
//     -> addressed by clarificationRelevance in whatsappUnderstandingEvidenceV32.ts (V32.2),
//        which now checks the question actually targets the customer's stated need.
//  6. Customer correction not linked to the previous employee assumption it corrects
//     -> addressed by extractCorrectionSignals()'s relatedMessageIds (points at the specific
//        staff message being corrected, found by walking backward, not just "a correction exists").
//  7. Multiple request threads mixed together
//     -> partially addressed by segmentInteractions()'s semantic topic-shift cues (V32.2); a
//        full Case Lifecycle/multi-thread-within-one-interaction resolver is explicitly out of
//        scope for this phase (see the closing note in the interaction-segmentation section).
//  8. Address/quantity/value mentioned indirectly ("هات منه اتنين", "زي ده")
//     -> addressed by extractQuantitySignals()'s reference-aware pattern + resolveReference().
//  9. Pronoun/reference resolution failure ("ده", "منه", "التاني")
//     -> addressed by resolveReference() — deliberately simple, returns 'unknown' rather than
//        guessing when the nearest candidate is ambiguous.
// 10. Evidence message selected correctly but interpretation wrong
//     -> mitigated by keeping `fact` (what was read) and `interpretation` (what was concluded)
//        as two separate fields on every finding (already true since V32.1); V32.2 adds ruleId
//        so a wrong interpretation can be traced to the exact rule that produced it.
// 11. Correct interpretation but confidence too low/high
//     -> mitigated by confidenceFactors staying a fixed, inspectable formula (unchanged from
//        V32.1) rather than a free-floating number; V32.2 does not change the formula, only
//        feeds it more accurate evidenceCompleteness/evidenceClarity inputs.
// 12. External order evidence conflicting with conversation
//     -> V32.1 already handled this for phone/price; V32.2 generalizes conflict detection via
//        provenance (see CriterionFindingV32.provenance in whatsappCriterionEvidenceV32.ts).
//
// DESIGN RULE FOR THIS FILE: a signal is a fact/indicator, never a criterion's judgment. No
// function here returns a score, a pass/fail, or a "did the employee do well" verdict — that
// stays in the criterion modules that consume these signals.
import type { NormalizedConversationMessageV32 } from './whatsappConversationUnderstandingV32';

export type SemanticSignalType =
  | 'greeting'
  | 'request'
  | 'clarification_question'
  | 'confirmation'
  | 'acceptance'
  | 'rejection'
  | 'correction'
  | 'quantity'
  | 'product_reference'
  | 'address'
  | 'phone'
  | 'price'
  | 'delivery'
  | 'promise';

export interface ConversationSemanticSignalV32 {
  type: SemanticSignalType;
  messageId: string;
  confidence: number;
  extractedValue?: string | null;
  relatedMessageIds?: string[];
  ruleId: string;
}

export type ConfirmationStrength = 'explicit' | 'strong_implicit' | 'weak_implicit' | 'none';

// ---- Curated Egyptian-colloquial vocabulary (kept centralized so no criterion module grows
// its own duplicate word list — see "منع Regex Explosion" in this phase's instructions). ----

export const GREETING_ONLY_RX =
  /^(?:و)?(?:ال)?سلام\s*عليكم(?:\s*(?:و)?رحمة?\s*الله(?:\s*(?:و)?بركاته)?)?[!.، ]*$|^أهل[اً]?\s*(?:و\s*سهل[اً]?)?[!.، ]*$|^مرحب[اً]?[!.، ]*$|^ه?اي[!.، ]*$|^صباح\s*ال(?:خير|نور|فل|ورد)[!.، ]*$|^مساء\s*ال(?:خير|نور|فل|ورد)[!.، ]*$/i;

export const AUTOMATED_REPLY_RX =
  /رسال[ةه]\s*(آلي[ةه]|تلقائي[ةه])|رد\s*تلقائي|هذه\s*رساله\s*تلقائيه|out\s*of\s*office|automated\s*reply|بعيد[ًا]?\s*عن\s*مكتبي|خارج\s*مواعيد\s*العمل\s*الرسمي[ةه]?\s*نرد\s*عليك/i;

const REQUEST_VERB_RX = /محتاج|عايز|عاوز|ممكن\s+(?:اطلب|اخد|احصل)|هات(?:ي)?\s|ابعت(?:لي|يلي)/i;

const CLARIFICATION_MARK_RX = /[؟?]/;

// Explicit: the staff states in plain terms that the order/registration is done.
const EXPLICIT_CONFIRMATION_RX =
  /تم\s*تأكيد\s*الطلب|تم\s*تسجيل(?:\s*طلبك)?|تسجيل\s*طلبك|الأورد?ر\s*اتأكد|تم\s*الطلب|تمام\s*سجلت\s*لحضرتك|تم\s*ال[اإ]رسال/i;

// Strong implicit: a colloquial promise-to-fulfill phrase. On its own it is NOT proof of an
// order confirmation — see linkConfirmationToContext() below, which requires a nearby
// customer request/quantity signal before a strong-implicit phrase counts as confirming it.
// "عنيا" (colloquial "consider it done") is used both with and without the "من" prefix in real
// conversations ("من عنيا لحضرتك" and bare "عنيا حاضر" both occur).
const STRONG_IMPLICIT_CONFIRMATION_RX =
  /(?:من\s*)?عني?ا(؟)?\s*(?:حاضر|لحضرتك)?|حاضر\s*(?:هبعت(?:هم|ه)?|هيكون\s*عند\s*حضرتك)|تمام\s*هيتبعت|تمام\s*يا\s*فندم\s*جاري\s*(?:التجهيز|ال[اإ]رسال)|جاري\s*(?:التجهيز|ال[اإ]رسال)|هبعت(?:لك|له|لحضرتك|هم)/i;

// Weak implicit: a bare acknowledgement with no fulfillment promise attached — ambiguous alone.
const WEAK_IMPLICIT_RX = /^(?:تمام|حاضر|اوك|ok|ماشي|خلاص)[!.، ]*$/i;

const ACCEPTANCE_RX =
  /^(?:تمام|ماشي|ايوا|ايوه|اه|آه|موافق|تمام\s*كده|خلاص\s*ابعت(?:ه|هم|يه|يهم)?)[!.، ]*$|(?:تمام|ايوا|ايوه|اه|آه)[،, ]*\s*(?:هطلبه|ابعت(?:ه|هم|يه|يهم)?|يبقى\s*كده)/i;
const REJECTION_RX = /^(?:لا|لأ)[!.، ]*$|مش\s*عايز(?:ه)?|معلش\s*مش\s*هاخد(?:ه|ها)?|مش\s*محتاج(?:ه)?/i;
// Pure thanks/closing — carries no request content of its own, but (unlike a rejection) isn't a
// "no" either. Kept separate so isRequestCandidate() can exclude it without touching REJECTION_RX.
const THANKS_CLOSING_ONLY_RX =
  /^(?:شكرًا|شكرا)(?:\s*لحضرتك)?[!.، ]*$|^لا\s*شكرا[!.، ]*$|^تسلم(?:ي|لي)?[!.، ]*$|^الله\s*يسلم(?:ك|ي)?[!.، ]*$|^وصل(?:ني|تلي)?[!.، ]*$/i;

const CORRECTION_RX =
  /لا\s*قصدي|مش\s*ده(?:\s*اللي)?|ده\s*مش(?:\s*اللي)?|أنا\s*(?:أ|ا)قصد|لا\s*التاني\b|مش\s*كده|لا\s*حضرتك\s*فهمتني\s*غلط|أنا\s*قلت|فهمت\s*غلط/i;

// V32.2.1: the unit word is now MANDATORY. A naked number ("250") used to match this regex with
// its unit group left undefined, which meant a price ("هو بـ 250؟") or a phone number ("رقمي
// 01012345678") could satisfy isConfirmationContextuallyLinked()'s quantity check and wrongly
// link an unrelated implicit confirmation to it. Requiring a real unit word keeps quantity
// detection separate from price/phone/address numbers, without inventing a new regex family.
const QUANTITY_RX = /(\d+|واحد[ةه]?|اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?)\s*(علبة|علب|حبة|حبوب|شريط|عبوة|قطعة|كيس)/i;
// Reference-aware quantity: "هات منه اتنين" / "عايز اتنين منه" — the quantity word is attached
// to a pronoun reference rather than an explicit unit word.
const REFERENCE_QUANTITY_RX = /(?:منه|من\s*ده|من\s*دا)\s*(اتنين|تلات[ةه]?|أربع[ةه]?|خمس[ةه]?|\d+)|(\d+|اتنين|تلات[ةه]?)\s*منه/i;

const PHONE_RX = /01[0-2,5]\d{8}/;
const ADDRESS_RX = /العنوان\s*[:\-]?\s*\S+|عنوانك|هيوصل\s*ل(?:ـ|حضرتك)/i;
const PRICE_RX = /(\d+(?:\.\d+)?)\s*(جنيه|جنيها|ج\.?م\.?|le|egp)/i;
const DELIVERY_RX = /توصيل|دليفري|delivery/i;
const PROMISE_RX = /هبعت(?:لك|لحضرتك)?|هيوصل|هجهز(?:لك|لحضرتك)?|هوصلك/i;

// Product/offer reference pronouns — resolved against the nearest prior staff "offer" message
// (a meaningful staff message that isn't itself just an acknowledgement/confirmation).
// Uses \p{L}/\p{N} lookaround instead of \b: JS's \b is defined in terms of [A-Za-z0-9_], so it
// never matches adjacent to Arabic letters (both sides read as "non-word") — a plain \bده\b can
// never match anywhere in Arabic text. Discovered via Sales Intelligence Phase B dry-run (bare
// pronoun references like "هات منه" silently produced zero product-reference signals).
const PRODUCT_REFERENCE_RX =
  /(?<![\p{L}\p{N}])(?:ده|دي|دول|منه|منها)(?![\p{L}\p{N}])|واحد\s*من\s*(?:ده|دا)|الاتنين|نفس\s*اللي\s*فات|اللي\s*حضرتك\s*قولت?\s*عليه|البديل\s*ده|(?<![\p{L}\p{N}])التاني(?![\p{L}\p{N}])/iu;

// A reference such as "الغسول ده" must never resolve to a welcome/service-template message just
// because that message happened to be the nearest previous staff turn. These templates contain no
// product offer at all and previously caused false basket items such as the entire welcome text.
const STAFF_NON_PRODUCT_TEMPLATE_RX =
  /أهلا\s*وسهلا|نورت(?:نا|ينا)|صيدليات\s*دواء|خدمة\s*التوصيل|على\s*مدار\s*24\s*ساعة|مع\s*حضرتك|تحت\s*أمر\s*حضرتك|تشرفنا\s*بخدمت/i;

function isPlausibleStaffProductOffer(message: NormalizedConversationMessageV32): boolean {
  if (message.role !== 'staff' || !message.isMeaningful) return false;
  const text = message.text.trim();
  if (!text || STAFF_NON_PRODUCT_TEMPLATE_RX.test(text)) return false;
  if (WEAK_IMPLICIT_RX.test(text) || classifyConfirmationStrength(text) !== 'none') return false;

  // Structural product/offer evidence only. When this is absent, unresolved is safer than binding
  // a pronoun to arbitrary staff prose.
  return (
    PRICE_RX.test(text) ||
    /متوفر|موجود|بديل|ترشيح|أنسب|افضل|أفضل|سعر|عبوة|علبة|شريط|كبسول|قرص|جل|كريم|شامبو|غسول|سيرم|لوشن|spray|cream|gel|shampoo|serum|lotion/i.test(text) ||
    /[A-Za-z]{3,}/.test(text)
  );
}

export function isGreetingOnly(text: string): boolean {
  return GREETING_ONLY_RX.test((text || '').trim());
}

/** A bare "تمام"/"حاضر"/"ok" with nothing else — carries no content of its own about what was understood or offered. */
export function isBareAcknowledgementOnly(text: string): boolean {
  return WEAK_IMPLICIT_RX.test((text || '').trim());
}

/** A confirmation signal strong enough to count as evidence at all (excludes bare, unlinked/demoted phrases). */
export function isSubstantiveConfirmationSignal(signal: ConversationSemanticSignalV32): boolean {
  return signal.confidence >= 0.5;
}

/** Same matching semantics as extractAcceptanceSignals() — a message that is essentially just "yes"/"go ahead". */
export function isAcceptanceOnly(text: string): boolean {
  return ACCEPTANCE_RX.test((text || '').trim());
}

/** Same matching semantics as extractRejectionSignals() — a message that is essentially just "no". */
export function isRejectionOnly(text: string): boolean {
  return REJECTION_RX.test((text || '').trim());
}

/** "شكرا"/"تسلم"/"وصل"/"لا شكرا" — a closing pleasantry, not a new request. */
export function isThanksOrClosingOnly(text: string): boolean {
  return THANKS_CLOSING_ONLY_RX.test((text || '').trim());
}

/**
 * V32.2.1: narrowed. A customer message only counts as a real request candidate — the thing an
 * Understanding/Response-Speed trigger can point at — when it isn't just a greeting, a bare
 * acknowledgement ("تمام"/"خلاص"), a pure acceptance ("ايوا"/"خلاص ابعته"), a pure rejection
 * ("لا"/"مش عايز"), or a closing pleasantry ("شكرا"/"تسلم"/"وصل"). Anything else meaningful —
 * an explicit request, a price/availability question, a symptom/need statement, a delivery
 * action request, or any other substantive question — still qualifies, including sentences that
 * never use an explicit request verb like "عايز" (e.g. "ابني عنده كحة وحرارة").
 */
export function isRequestCandidate(message: NormalizedConversationMessageV32): boolean {
  if (message.role !== 'customer' || !message.isMeaningful) return false;
  const text = message.text;
  if (isGreetingOnly(text)) return false;
  if (isBareAcknowledgementOnly(text)) return false;
  if (isAcceptanceOnly(text)) return false;
  if (isRejectionOnly(text)) return false;
  if (isThanksOrClosingOnly(text)) return false;
  return true;
}

/** Small helper: the N meaningful messages before `index`, plus `after` meaningful messages following it. */
export function contextWindowV32(
  messages: NormalizedConversationMessageV32[],
  index: number,
  before = 3,
  after = 1
) {
  const meaningfulIndices: number[] = [];
  messages.forEach((m, i) => {
    if (m.isMeaningful) meaningfulIndices.push(i);
  });
  const pos = meaningfulIndices.indexOf(index);
  if (pos === -1) return { before: [], after: [] };
  return {
    before: meaningfulIndices.slice(Math.max(0, pos - before), pos).map((i) => messages[i]),
    after: meaningfulIndices.slice(pos + 1, pos + 1 + after).map((i) => messages[i]),
  };
}

function classifyConfirmationStrength(text: string): ConfirmationStrength {
  if (EXPLICIT_CONFIRMATION_RX.test(text)) return 'explicit';
  if (STRONG_IMPLICIT_CONFIRMATION_RX.test(text)) return 'strong_implicit';
  if (WEAK_IMPLICIT_RX.test(text.trim())) return 'weak_implicit';
  return 'none';
}

/**
 * Confirmation is a context-dependent judgment, not a keyword match: "من عنيا لحضرتك" only
 * means "order confirmed" when it follows a customer request/quantity in the last few
 * meaningful messages. Answering a price question with the same phrase is not a confirmation.
 */
function isConfirmationContextuallyLinked(
  messages: NormalizedConversationMessageV32[],
  index: number
): { linked: boolean; relatedMessageIds: string[] } {
  const { before } = contextWindowV32(messages, index, 3, 0);
  // Search from most recent backward — the closest qualifying customer message is the one being
  // confirmed, not the first one in the window. An acceptance ("اه ابعته"/"خلاص ابعته") counts
  // just as much as an explicit request/quantity/reference — in real conversations it is in fact
  // the single most common thing a confirmation phrase directly follows.
  const requestOrQuantity = before
    .filter((m) => m.role === 'customer')
    .reverse()
    .find(
      (m) =>
        REQUEST_VERB_RX.test(m.text) ||
        QUANTITY_RX.test(m.text) ||
        REFERENCE_QUANTITY_RX.test(m.text) ||
        PRODUCT_REFERENCE_RX.test(m.text) ||
        ACCEPTANCE_RX.test(m.text)
    );
  if (!requestOrQuantity) return { linked: false, relatedMessageIds: [] };
  return { linked: true, relatedMessageIds: [requestOrQuantity.id] };
}

export function extractGreetingSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  return messages
    .filter((m) => m.isMeaningful && isGreetingOnly(m.text))
    .map((m) => ({ type: 'greeting', messageId: m.id, confidence: 0.95, ruleId: 'greeting.detected' }));
}

export function extractRequestSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  return messages
    .filter((m) => isRequestCandidate(m))
    .map((m) => ({
      type: 'request',
      messageId: m.id,
      confidence: REQUEST_VERB_RX.test(m.text) ? 0.85 : 0.6,
      ruleId: REQUEST_VERB_RX.test(m.text) ? 'request.explicit_verb' : 'request.implicit_meaningful_message',
    }));
}

export function extractClarificationQuestionSignals(
  messages: NormalizedConversationMessageV32[]
): ConversationSemanticSignalV32[] {
  return messages
    .filter((m) => m.role === 'staff' && m.isMeaningful && CLARIFICATION_MARK_RX.test(m.text))
    .map((m) => ({
      type: 'clarification_question',
      messageId: m.id,
      confidence: 0.8,
      ruleId: 'clarification_question.question_mark',
    }));
}

export function extractConfirmationSignals(
  messages: NormalizedConversationMessageV32[]
): ConversationSemanticSignalV32[] {
  const signals: ConversationSemanticSignalV32[] = [];
  messages.forEach((m, index) => {
    if (m.role !== 'staff' || !m.isMeaningful) return;
    const strength = classifyConfirmationStrength(m.text);
    if (strength === 'none') return;
    if (strength === 'explicit') {
      signals.push({
        type: 'confirmation',
        messageId: m.id,
        confidence: 0.95,
        extractedValue: 'explicit',
        ruleId: 'confirmation.explicit',
      });
      return;
    }
    if (strength === 'strong_implicit') {
      const { linked, relatedMessageIds } = isConfirmationContextuallyLinked(messages, index);
      signals.push({
        type: 'confirmation',
        messageId: m.id,
        confidence: linked ? 0.75 : 0.3,
        extractedValue: linked ? 'strong_implicit' : 'weak_implicit',
        relatedMessageIds: linked ? relatedMessageIds : [],
        ruleId: linked ? 'confirmation.strong_implicit.after_request_context' : 'confirmation.weak_implicit.no_context',
      });
      return;
    }
    // weak_implicit ("تمام"/"حاضر" alone): only a signal at all if it follows a request in context.
    const { linked, relatedMessageIds } = isConfirmationContextuallyLinked(messages, index);
    if (linked) {
      signals.push({
        type: 'confirmation',
        messageId: m.id,
        confidence: 0.4,
        extractedValue: 'weak_implicit',
        relatedMessageIds,
        ruleId: 'confirmation.weak_implicit.after_request_context',
      });
    }
  });
  return signals;
}

export function extractAcceptanceSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  const signals: ConversationSemanticSignalV32[] = [];
  messages.forEach((m, index) => {
    if (m.role !== 'customer' || !m.isMeaningful) return;
    if (!ACCEPTANCE_RX.test(m.text)) return;
    const { before } = contextWindowV32(messages, index, 2, 0);
    const offer = before.filter((prev) => prev.role === 'staff').pop();
    signals.push({
      type: 'acceptance',
      messageId: m.id,
      confidence: offer ? 0.85 : 0.5,
      relatedMessageIds: offer ? [offer.id] : [],
      ruleId: offer ? 'acceptance.after_staff_offer' : 'acceptance.no_prior_offer',
    });
  });
  return signals;
}

export function extractRejectionSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  return messages
    .filter((m) => m.role === 'customer' && m.isMeaningful && REJECTION_RX.test(m.text))
    .map((m) => ({ type: 'rejection', messageId: m.id, confidence: 0.8, ruleId: 'rejection.explicit' }));
}

/** Walks backward from the correction to the nearest preceding staff message — the thing being corrected. */
export function extractCorrectionSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  const signals: ConversationSemanticSignalV32[] = [];
  messages.forEach((m, index) => {
    if (m.role !== 'customer' || !m.isMeaningful) return;
    if (!CORRECTION_RX.test(m.text)) return;
    const { before } = contextWindowV32(messages, index, 3, 0);
    const correctedMessage = before.filter((prev) => prev.role === 'staff').pop();
    signals.push({
      type: 'correction',
      messageId: m.id,
      confidence: correctedMessage ? 0.9 : 0.6,
      relatedMessageIds: correctedMessage ? [correctedMessage.id] : [],
      ruleId: correctedMessage ? 'correction.explicit.linked_to_prior_staff_message' : 'correction.explicit.no_prior_staff_message',
    });
  });
  return signals;
}

export function extractQuantitySignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  const signals: ConversationSemanticSignalV32[] = [];
  messages.forEach((m) => {
    if (!m.isMeaningful) return;
    const directMatch = m.text.match(QUANTITY_RX);
    if (directMatch && directMatch[2]) {
      signals.push({
        type: 'quantity',
        messageId: m.id,
        confidence: 0.85,
        extractedValue: directMatch[0].trim(),
        ruleId: 'quantity.digit_or_word_plus_unit',
      });
      return;
    }
    const referenceMatch = m.text.match(REFERENCE_QUANTITY_RX);
    if (referenceMatch) {
      signals.push({
        type: 'quantity',
        messageId: m.id,
        confidence: 0.65,
        extractedValue: referenceMatch[0].trim(),
        ruleId: 'quantity.reference_attached_no_unit',
      });
    }
  });
  return signals;
}

export function extractProductReferenceSignals(
  messages: NormalizedConversationMessageV32[]
): ConversationSemanticSignalV32[] {
  const signals: ConversationSemanticSignalV32[] = [];
  messages.forEach((m, index) => {
    if (!m.isMeaningful || !PRODUCT_REFERENCE_RX.test(m.text)) return;
    const resolved = resolveReference(messages, index);
    signals.push({
      type: 'product_reference',
      messageId: m.id,
      confidence: resolved ? 0.7 : 0.3,
      extractedValue: resolved ? resolved.id : 'unknown',
      relatedMessageIds: resolved ? [resolved.id] : [],
      ruleId: resolved ? 'reference.resolved_to_prior_offer' : 'reference.unknown',
    });
  });
  return signals;
}

/**
 * Deliberately simple reference resolution: a pronoun ("ده"/"دي"/"منه"/"التاني"...) resolves to
 * the nearest preceding staff message that isn't itself a pure acknowledgement/confirmation —
 * i.e. the most recent thing the staff actually offered or described. If more than one distinct
 * offer sits in the immediate window (ambiguous), this returns null rather than guessing.
 */
export function resolveReference(
  messages: NormalizedConversationMessageV32[],
  index: number
): NormalizedConversationMessageV32 | null {
  const { before } = contextWindowV32(messages, index, 4, 0);
  const candidateOffers = before.filter(isPlausibleStaffProductOffer);
  if (candidateOffers.length === 0) return null;
  // Ambiguous only when two DIFFERENT offers both sit right at the edge of the window with no
  // customer message between them narrowing it down further.
  if (candidateOffers.length >= 2) {
    const last = candidateOffers[candidateOffers.length - 1];
    const secondLast = candidateOffers[candidateOffers.length - 2];
    const gapMs = last.timestamp.getTime() - secondLast.timestamp.getTime();
    if (gapMs < 2 * 60 * 1000) return null; // two offers within 2 minutes of each other: ambiguous, report unknown
  }
  return candidateOffers[candidateOffers.length - 1];
}

export function extractPhoneSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  return messages
    .filter((m) => m.isMeaningful && PHONE_RX.test(m.text))
    .map((m) => ({
      type: 'phone',
      messageId: m.id,
      confidence: 0.95,
      extractedValue: m.text.match(PHONE_RX)?.[0] || null,
      ruleId: 'phone.egyptian_mobile_pattern',
    }));
}

export function extractAddressSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  return messages
    .filter((m) => m.isMeaningful && ADDRESS_RX.test(m.text))
    .map((m) => ({ type: 'address', messageId: m.id, confidence: 0.7, ruleId: 'address.marker_phrase' }));
}

export function extractPriceSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  return messages
    .filter((m) => m.isMeaningful && PRICE_RX.test(m.text))
    .map((m) => ({
      type: 'price',
      messageId: m.id,
      confidence: 0.8,
      extractedValue: m.text.match(PRICE_RX)?.[1] || null,
      ruleId: 'price.currency_pattern',
    }));
}

export function extractDeliverySignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  return messages
    .filter((m) => m.isMeaningful && DELIVERY_RX.test(m.text))
    .map((m) => ({ type: 'delivery', messageId: m.id, confidence: 0.8, ruleId: 'delivery.keyword' }));
}

export function extractPromiseSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  return messages
    .filter((m) => m.role === 'staff' && m.isMeaningful && PROMISE_RX.test(m.text))
    .map((m) => ({ type: 'promise', messageId: m.id, confidence: 0.6, ruleId: 'promise.future_fulfillment_phrase' }));
}

export function buildSemanticSignalsV32(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  return [
    ...extractGreetingSignals(messages),
    ...extractRequestSignals(messages),
    ...extractClarificationQuestionSignals(messages),
    ...extractConfirmationSignals(messages),
    ...extractAcceptanceSignals(messages),
    ...extractRejectionSignals(messages),
    ...extractCorrectionSignals(messages),
    ...extractQuantitySignals(messages),
    ...extractProductReferenceSignals(messages),
    ...extractPhoneSignals(messages),
    ...extractAddressSignals(messages),
    ...extractPriceSignals(messages),
    ...extractDeliverySignals(messages),
    ...extractPromiseSignals(messages),
  ];
}

/** Two-or-more consecutive meaningful messages from the same customer, each within `gapMs` of the last, before any staff reply. */
export function computeRequestBurstIds(messages: NormalizedConversationMessageV32[], gapMs = 3 * 60 * 1000): Map<string, string> {
  const burstIdByMessageId = new Map<string, string>();
  let burstIndex = 0;
  let currentBurst: NormalizedConversationMessageV32[] = [];

  const flush = () => {
    if (currentBurst.length >= 2) {
      const id = `burst:${burstIndex}`;
      currentBurst.forEach((m) => burstIdByMessageId.set(m.id, id));
      burstIndex += 1;
    }
    currentBurst = [];
  };

  messages.forEach((m) => {
    if (m.role !== 'customer' || !m.isMeaningful) {
      if (m.role === 'staff' && m.isMeaningful) flush();
      return;
    }
    const last = currentBurst[currentBurst.length - 1];
    if (last && m.timestamp.getTime() - last.timestamp.getTime() > gapMs) flush();
    currentBurst.push(m);
  });
  flush();
  return burstIdByMessageId;
}
