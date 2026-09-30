/* eslint-disable no-misleading-character-class, no-useless-escape */
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
  | 'promise'
  | 'availability'
  | 'alternative_offer';

/** Stock state a STAFF statement asserts. A customer question can never produce one. */
export type AvailabilityStateV32 = 'available' | 'unavailable' | 'check_pending';

/** How the customer answered a staff offer/alternative. `null` = no classifiable answer. */
export type CustomerOfferResponseV32 = 'accepted' | 'rejected' | 'considering';

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

// ---- Product availability / alternatives (staff statements only) ----
// Evaluated per statement clause: a clause ending in "؟"/"?" is a question, never a stock fact,
// so "هو مش موجود؟" can never become `unavailable` even when a staff member types it.
const UNAVAILABLE_RX =
  /(?:مش|مو|غير)\s*(?:موجود|متوفر|متاح)[ةه]?|مفيش\s*(?:منه|منها|حاليا|حاليًا|عندنا)|مش\s*عندنا|(?:الصنف|المنتج|ده|دي|هو|هي)\s*(?:خلص|خلصان[ةه]?|نفذ|ناقص[ةه]?)|(?:خلص|نفذ|ناقص[ةه]?)\s*(?:من\s*(?:عندنا|السوق|الشركة)|حاليا|حاليًا)|ناقص\s*في\s*السوق/i;
const AVAILABLE_RX =
  /(?:^|[\s،,])(?:موجود|متوفر|متاح)[ةه]?(?:$|[\s،,!.])|عندنا\s*(?:منه|منها)|(?:اه|أه|آه|ايوه|أيوه|ايوا)\s*(?:موجود|متوفر)/i;
// "خدمة التوصيل متاحة" and similar service/payment statements are not product stock facts.
const NON_STOCK_AVAILABILITY_CONTEXT_RX =
  /(?:خدمة\s*)?(?:التوصيل|الدليفري|delivery)|(?:الدفع|التحويل|فودافون\s*كاش|انستا\s*باي|instapay|visa|فيزا|mastercard|ماستر\s*كارد)/i;
const CHECK_PENDING_RX =
  /(?:ثواني|ثانية|لحظ[ةه]|دقيق[ةه]|دقايق)\s*(?:و\s*)?(?:أ|ا)?(?:شوف|تأكد|اتأكد|سأل|راجع)|هشوف(?:لك|لحضرتك)?|هتأكد|هاتأكد|هسأل\s*(?:الفرع|المخزن|عن\s*(?:التوفر|توفره|توفرها))|هنشوف(?:ه|ها)?|(?:أ|ا)تأكد\s*من\s*(?:توفر|التوفر|المخزن)|هراجع\s*(?:المخزن|التوفر)/i;
// Explicit alternative markers always count; a generic offer phrase only counts right after a staff
// "unavailable" statement or a customer rejection (otherwise it is an ordinary offer, not a substitute).
const ALTERNATIVE_MARKER_RX =
  /بديل|بدل\s*(?:منه|منها|منهم|ده|دي|ال\S+)|المتاح\s*بدل|(?:فيه|في|عندنا)\s*نفس\s*(?:المادة|التركيب[ةه]?)|نفس\s*المادة\s*الفعال[ةه]|يقوم\s*بنفس|نبدل(?:ه|ها|هم)?\s/i;
const GENERIC_OFFER_RX =
  /(?:ممكن|ينفع|نقدر)\s*(?:نجيب|أجيب|اجيب|نديلك|أقدم|اقدم|نقدم|أقترح|اقترح|أرشح|ارشح)(?:لك|لحضرتك)?|(?:أرشح|ارشح|أقترح|اقترح)(?:لك|لحضرتك)/i;
// Leading filler tokens between the offer marker and the alternative's name. Whole tokens only, so
// a product name that merely starts with the same letters (e.g. "بانادول") is never truncated.
const ALTERNATIVE_PHRASE_FILLER_RX =
  /^(?:(?:ممكن|ينفع|نقدر|نجيب|أجيب|اجيب|هنجيب|هجيب|نديلك|نديك|نقدم|أقدم|اقدم|أرشح|ارشح|نرشح|لحضرتك|ليك|لك|له|لها|منه|منها|هو|هي|وهو|اسمه|اسمها|يا\s*فندم|بـ)(?=\s|$)|[\s:\-،])+/i;
const ACCEPT_OFFER_RX = /(?:تمام|ماشي|اوك|ok|خلاص|ايوه|ايوا|اه|آه)?\s*(?:هاته|هاتها|هاتهم|هاتيه|ابعته|ابعتها|ابعتهم|خليه|خليها|هاخده|هاخدها|موافق)/i;
const CONSIDERING_RX = /هفكر|أفكر|افكر|هشوف\s*و?\s*(?:أرد|ارد|أقولك|اقولك)|هرد\s*عليك|هقولك|هبلغك|هستشير|هسأل\s*(?:الدكتور|دكتور)|بعدين\s*(?:أقولك|اقولك|أرد|ارد)/i;

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
    /متوفر|موجود|عندنا|بديل|ترشيح|أنسب|افضل|أفضل|سعر|عبوة|علبة|شريط|كبسول|قرص|جل|كريم|شامبو|غسول|سيرم|سيروم|لوشن|spray|cream|gel|shampoo|serum|lotion/i.test(text) ||
    /[A-Za-z]{3,}/.test(text)
  );
}

// Customer exports often start with the product itself (sometimes as a forwarded English name),
// then the next message says "موجود عندكم الغسول ده؟". That is a real antecedent even though it
// was not written by staff. Keep this deliberately narrow: require an explicit product-like
// mention and reject generic request/reference-only wording so we never bind "ده" to arbitrary chat.
function isPlausibleCustomerProductMention(message: NormalizedConversationMessageV32): boolean {
  if (message.role !== 'customer' || !message.isMeaningful) return false;
  const text = message.text.trim();
  if (!text) return false;
  if (GREETING_ONLY_RX.test(text) || THANKS_CLOSING_ONLY_RX.test(text) || ACCEPTANCE_RX.test(text) || REJECTION_RX.test(text)) return false;

  const strippedForwarded = text.replace(/^\s*\[?forwarded\]?\s*/i, '').trim();
  if (!strippedForwarded) return false;

  // Reference-only/request wording is not an antecedent by itself.
  const withoutReference = strippedForwarded.replace(PRODUCT_REFERENCE_RX, '').trim();
  if (!withoutReference || /^(?:موجود|متوفر|عندكم|عايز|عاوز|محتاج|ابعت|هات)(?:\s|$)/iu.test(withoutReference)) return false;

  return (
    /[A-Za-z]{3,}/.test(strippedForwarded) ||
    /\b\d+(?:\.\d+)?\s*(?:mg|mcg|gm|g|ml|%)\b/i.test(strippedForwarded) ||
    /جل|كريم|شامبو|غسول|سيرم|سيروم|لوشن|بخاخ|قطره|قطرة|امبول|أمبول|كبسول|قرص|مرهم|spray|cream|gel|shampoo|serum|lotion|drops?|amp(?:oule)?/i.test(strippedForwarded)
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

// Commitment to an offer already on the table, addressed by pronoun/deixis only ("تمام هاته",
// "اه ابعته", "خلاص هات ده", "ماشي ابعته"). Anchored to the WHOLE message: any named product
// ("هات شامبو كمان") keeps it a real request, and "هات منه" stays a request because the basket owner
// resolves that reference into a basket line.
const COMMITMENT_ONLY_RX =
  /^(?:(?:تمام|ماشي|اوك|ok|خلاص|ايوه|ايوا|اه|آه|أه|طيب|حلو|موافق)[،,!.\s]*)*(?:هاته|هاتها|هاتهم|هاتيه|هاتيها|ابعته|ابعتها|ابعتهم|ابعتيه|ابعتيها|خليه|خليها|هاخده|هاخدها|هاخدهم|(?:هات|ابعت|ابعتلي|هاتلي)\s*(?:ده|دي|دا|دول|البديل))(?:[،,!.\s]*(?:لو\s*سمحت|من\s*فضلك|يا\s*(?:دكتور[ةه]?|فندم)|بسرعة|خلاص|تمام))*[!.،,\s]*$/i;

/** A pure commitment to the current offer — acceptance, never a new product request. */
export function isCommitmentOnly(text: string): boolean {
  return COMMITMENT_ONLY_RX.test((text || '').trim());
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
  if (isCommitmentOnly(text)) return false;
  if (isRejectionOnly(text)) return false;
  // "هفكر وأرد عليك" / "هستنى لما يوصل" / "كلمني بكرة" / "جبته من برا" state the customer's own
  // intent or timing, not a new product need — unless they also carry an explicit request verb.
  if (!REQUEST_VERB_RX.test(text) && (isNonRequestIntentStatement(text) || classifyCustomerTimingRequestV32(text))) {
    return false;
  }
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
    if (!ACCEPTANCE_RX.test(m.text) && !isCommitmentOnly(m.text)) return;
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
  const candidates = before.filter(
    (message) => isPlausibleStaffProductOffer(message) || isPlausibleCustomerProductMention(message)
  );
  if (candidates.length === 0) return null;

  // Prefer the nearest explicit/product-like antecedent regardless of speaker. This covers the
  // common export pattern: customer forwards a product name, then asks "موجود عندكم ... ده؟".
  // Stay conservative when two distinct product-like mentions are effectively simultaneous.
  if (candidates.length >= 2) {
    const last = candidates[candidates.length - 1];
    const secondLast = candidates[candidates.length - 2];
    const gapMs = last.timestamp.getTime() - secondLast.timestamp.getTime();
    const normalizedLast = last.text.trim().toLowerCase();
    const normalizedSecond = secondLast.text.trim().toLowerCase();
    if (gapMs < 2 * 60 * 1000 && normalizedLast !== normalizedSecond) return null;
  }
  return candidates[candidates.length - 1];
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

/** Statement clauses only — a clause that ends in a question mark is dropped. */
function statementClauses(text: string): string[] {
  return (text.match(/[^؟?.!\n،,]+[؟?]?/g) || [])
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && !/[؟?]$/.test(clause));
}

/** Stock state asserted by one clause, or null. Unavailable wins over available, which wins over check_pending. */
function clauseAvailabilityState(clause: string): AvailabilityStateV32 | null {
  if (NON_STOCK_AVAILABILITY_CONTEXT_RX.test(clause)) return null;
  if (UNAVAILABLE_RX.test(clause)) return 'unavailable';
  if (AVAILABLE_RX.test(clause)) return 'available';
  if (CHECK_PENDING_RX.test(clause)) return 'check_pending';
  return null;
}

/**
 * Per-clause stock statements inside one staff message ("كونجستال مش موجود، وفيتامين د موجود"),
 * so the need model can tie each state to the product named in the same clause. Questions dropped.
 */
export function availabilityStatementClausesV32(text: string): Array<{ clause: string; state: AvailabilityStateV32 }> {
  return statementClauses(text)
    .map((clause) => ({ clause, state: clauseAvailabilityState(clause) }))
    .filter((row): row is { clause: string; state: AvailabilityStateV32 } => row.state !== null);
}

/** Stock state asserted by one staff message, or null. Unavailable wins over available, which wins over check_pending. */
export function classifyAvailabilityStatementV32(text: string): AvailabilityStateV32 | null {
  const states = statementClauses(text)
    .map((clause) => clauseAvailabilityState(clause))
    .filter((state): state is AvailabilityStateV32 => state !== null);
  if (states.includes('unavailable')) return 'unavailable';
  if (states.includes('available')) return 'available';
  if (states.includes('check_pending')) return 'check_pending';
  return null;
}

/**
 * Availability facts: STAFF messages only. `extractedValue` is the asserted state. A customer
 * asking "هو مش موجود؟" (or any customer wording) never yields a signal.
 */
export function extractAvailabilitySignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  const signals: ConversationSemanticSignalV32[] = [];
  for (const m of messages) {
    if (m.role !== 'staff' || !m.isMeaningful) continue;
    const state = classifyAvailabilityStatementV32(m.text);
    if (!state) continue;
    signals.push({
      type: 'availability',
      messageId: m.id,
      confidence: state === 'unavailable' ? 0.85 : state === 'available' ? 0.8 : 0.75,
      extractedValue: state,
      ruleId: `availability.staff_statement.${state}`,
    });
  }
  return signals;
}

// Leading words before an alternative named BEFORE its marker ("فيه كومتركس بدل منه").
const ALTERNATIVE_LEAD_FILLER_RX =
  /^(?:(?:فيه|في|عندنا|ممكن|ينفع|نقدر|نجيب|أجيب|اجيب|نديلك|أقدم|اقدم|نقدم|أرشح|ارشح|لحضرتك|و)(?=\s|$)|[\s:\-،])+/i;

function alternativePhraseAfter(text: string, marker: RegExp): string | null {
  const match = text.match(marker);
  if (!match || match.index == null) return null;
  const tail = text
    .slice(match.index + match[0].length)
    .split(/[؟?\n.!،,]/)[0]
    .replace(ALTERNATIVE_PHRASE_FILLER_RX, '')
    .trim();
  if (tail.length >= 2) return tail.slice(0, 80);
  // Named before the marker, inside the same clause: "... فيه كومتركس بدل منه".
  const clauseStart = Math.max(...['،', ',', '.', '\n', '؟', '?'].map((sep) => text.lastIndexOf(sep, match.index! - 1)));
  const head = text
    .slice(clauseStart + 1, match.index)
    .replace(ALTERNATIVE_LEAD_FILLER_RX, '')
    .trim();
  return head.length >= 2 && head.split(/\s+/).length <= 4 ? head.slice(0, 80) : null;
}

/**
 * Alternative/substitute offers: STAFF messages only. `extractedValue` is the raw alternative phrase
 * when one follows the marker (null when the staff did not name it). `relatedMessageIds` holds the
 * nearest preceding staff "unavailable" statement or customer rejection that made it a substitute —
 * never a guessed product link.
 */
export function extractAlternativeOfferSignals(messages: NormalizedConversationMessageV32[]): ConversationSemanticSignalV32[] {
  const signals: ConversationSemanticSignalV32[] = [];
  messages.forEach((m, index) => {
    if (m.role !== 'staff' || !m.isMeaningful) return;
    const explicit = ALTERNATIVE_MARKER_RX.test(m.text);
    const generic = !explicit && GENERIC_OFFER_RX.test(m.text);
    if (!explicit && !generic) return;
    const { before } = contextWindowV32(messages, index, 4, 0);
    const trigger = before
      .filter(
        (prev) =>
          (prev.role === 'staff' && classifyAvailabilityStatementV32(prev.text) === 'unavailable') ||
          (prev.role === 'customer' && REJECTION_RX.test(prev.text))
      )
      .pop();
    const selfUnavailable = classifyAvailabilityStatementV32(m.text) === 'unavailable';
    if (generic && !trigger && !selfUnavailable) return;
    signals.push({
      type: 'alternative_offer',
      messageId: m.id,
      confidence: explicit ? (trigger || selfUnavailable ? 0.85 : 0.7) : 0.6,
      extractedValue: alternativePhraseAfter(m.text, explicit ? ALTERNATIVE_MARKER_RX : GENERIC_OFFER_RX),
      relatedMessageIds: trigger ? [trigger.id] : [],
      ruleId: explicit
        ? 'alternative_offer.explicit_marker'
        : 'alternative_offer.generic_offer_after_unavailable_or_rejection',
    });
  });
  return signals;
}

// ---- Customer commercial-intent statements (evidence for Lost Opportunity; never a verdict here) ----
const BOUGHT_ELSEWHERE_RX =
  /(?:جبت|اشتريت|خدت|لقيت|هجيب|هشتري|هاخد)(?:ه|ها|هم)?\s*(?:من\s*)?(?:مكان\s*تاني|صيدلي[ةه]\s*تاني[ةه]|برا|بره)|من\s*(?:صيدلي[ةه]\s*تاني[ةه]|مكان\s*تاني)/i;
const FINAL_DECLINE_RX =
  /مش\s*(?:عايز|عاوز|محتاج)[ةه]?\s*خلاص|خلاص\s*مش\s*(?:عايز|عاوز|محتاج)|^لا\s*خلاص|لا\s*خلاص\s*مش|خلاص\s*(?:بلاش|مش\s*لازم)|(?:ا|أ|إ)لغي\s*الطلب|كنسل\s*الطلب|مبقتش\s*(?:محتاج|عايز|عاوز)/i;
const DELAY_COMPLAINT_RX =
  /اتأخرت(?:وا)?|متأخرين|محدش\s*(?:رد|بيرد)|ليه\s*محدش|بقالي\s*(?:ساع[ةه]|كتير|فتر[ةه])|مستني\s*من\s*بدري/i;
const WILL_WAIT_RX =
  /هستنا(?:ه|ها)?|هستنى|(?:ابقى|ابقي)\s*(?:بلغني|كلمني|قولي|عرفني)|لما\s*(?:\S+\s+){0,3}?(?:يوصل|يتوفر|ييجي|ينزل)|بلغني\s*لما|عرفني\s*لما/i;

export type CustomerIntentStatementV32 =
  | 'bought_elsewhere'
  | 'final_decline'
  | 'delay_complaint'
  | 'will_wait'
  | 'considering';

function isNonRequestIntentStatement(text: string): boolean {
  const intent = classifyCustomerIntentStatementV32(text);
  return intent === 'considering' || intent === 'will_wait' || intent === 'final_decline' || intent === 'bought_elsewhere';
}

/** What a customer message states about their own commercial intent, strongest first; null = none. */
export function classifyCustomerIntentStatementV32(text: string): CustomerIntentStatementV32 | null {
  if (BOUGHT_ELSEWHERE_RX.test(text)) return 'bought_elsewhere';
  if (FINAL_DECLINE_RX.test(text)) return 'final_decline';
  if (DELAY_COMPLAINT_RX.test(text)) return 'delay_complaint';
  if (WILL_WAIT_RX.test(text)) return 'will_wait';
  if (CONSIDERING_RX.test(text)) return 'considering';
  return null;
}

// ---- Follow-up evidence (facts only; the Follow-up engine decides) ----
// Staff promising to come back to the customer ("هتابع مع حضرتك", "هبلغ حضرتك", "هشوفلك وأرد").
const STAFF_FOLLOWUP_PROMISE_RX =
  /هتابع|هنتابع|ه(?:ن)?كلم\s*(?:ك|حضرتك)|ه(?:ن)?رد\s*على\s*(?:حضرتك|ك)|ه(?:ن)?بلغ\s*(?:ك|حضرتك)|ه(?:ن)?عرف\s*(?:ك|حضرتك)|هقول\s*(?:لك|لحضرتك)|هشوف\s*(?:لك|لحضرتك)|هسأل\s*(?:لك|لحضرتك)|هراجع\s*و\s*(?:أرد|ارد|أكلم|اكلم|أبلغ|ابلغ)/i;
// Customer asking to be contacted / to wait, with optional timing.
const CUSTOMER_CALLBACK_RX =
  /كلمني|كلميني|كلمنى|اتصل(?:\s*(?:بي|بيا|عليا))?|رن\s*عليا|تابع\s*معايا|ابقى\s*(?:كلمني|تابع|بلغني|عرفني)|بلغني|عرفني|ابعتلي\s*لما/i;
const WHEN_IN_STOCK_RX = /لما\s*(?:\S+\s+){0,3}?(?:يوصل|يتوفر|ييجي|ينزل|تجيبه|تجيبوه|يبقى\s*موجود)/i;
const TOMORROW_RX = /بكر[ةه]|بكرا/i;
const AFTER_DAYS_RX = /بعد\s*(?:(يومين)|(\d+)\s*(?:يوم|أيام|ايام)|(اسبوع|أسبوع))/i;
const SAME_DAY_RX = /النهارد[ةه]|بالليل|كمان\s*ساع[ةه]|بعد\s*ساع[ةه]|آخر\s*النهار|اخر\s*النهار/i;
const PRESCRIPTION_REQUEST_RX =
  /(?:ابعت|ابعتي|ابعتلنا|محتاج(?:ين)?|لازم|ممكن)\s*(?:\S+\s*){0,2}(?:صور[ةه]\s*)?(?:ال)?(?:روشت[ةه]|وصف[ةه]\s*طبي[ةه])/i;

export interface CustomerTimingRequestV32 {
  /** 'when_in_stock' = when the product is available; 'days' = explicit day offset; 'same_day'; 'unspecified'. */
  when: 'when_in_stock' | 'days' | 'same_day' | 'unspecified';
  days: number | null;
}

/** Staff message promising to come back to the customer later. */
export function isStaffFollowUpPromiseV32(text: string): boolean {
  return STAFF_FOLLOWUP_PROMISE_RX.test(text);
}

/** A message that mentions the prescription itself (e.g. the customer sending/describing it). */
export function mentionsPrescriptionV32(text: string): boolean {
  return /روشت[ةه]|وصف[ةه]\s*طبي[ةه]/i.test(text);
}

/** Staff message asking the customer for a prescription. */
export function isPrescriptionRequestV32(text: string): boolean {
  return PRESCRIPTION_REQUEST_RX.test(text);
}

/**
 * A customer asking to be contacted later, with the timing they stated. Returns null when the
 * message is not a contact/wait request. Never invents a date: "لما يتوفر" is `when_in_stock`.
 */
export function classifyCustomerTimingRequestV32(text: string): CustomerTimingRequestV32 | null {
  const callback = CUSTOMER_CALLBACK_RX.test(text);
  const waitForStock = WHEN_IN_STOCK_RX.test(text);
  if (!callback && !waitForStock) return null;
  if (waitForStock) return { when: 'when_in_stock', days: null };
  const days = text.match(AFTER_DAYS_RX);
  if (days) return { when: 'days', days: days[1] ? 2 : days[2] ? Number(days[2]) : 7 };
  if (TOMORROW_RX.test(text)) return { when: 'days', days: 1 };
  if (SAME_DAY_RX.test(text)) return { when: 'same_day', days: 0 };
  return { when: 'unspecified', days: null };
}

// A reply that OPENS with an explicit "no" followed by more words ("لا، أنا عايز X نفسه",
// "لأ مش عايز البديل") rejects the offer on the table.
const LEADING_NO_RX = /^(?:لا|لأ)(?:\s*[،,.!]|\s+(?=\S))/;

/** Customer's answer to a staff offer. Rejection is checked first ("لا مش عايزه تمام" is still a no). */
export function classifyCustomerOfferResponseV32(text: string): CustomerOfferResponseV32 | null {
  if (REJECTION_RX.test(text) || (LEADING_NO_RX.test(text.trim()) && !THANKS_CLOSING_ONLY_RX.test(text.trim()))) return 'rejected';
  if (CONSIDERING_RX.test(text)) return 'considering';
  if (ACCEPTANCE_RX.test(text) || ACCEPT_OFFER_RX.test(text)) return 'accepted';
  return null;
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
    ...extractAvailabilitySignals(messages),
    ...extractAlternativeOfferSignals(messages),
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
