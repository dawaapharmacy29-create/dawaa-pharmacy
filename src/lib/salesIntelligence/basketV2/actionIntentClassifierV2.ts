// Phase I.B.3 — Action + Intent classification (instruction #2's ActionNode/IntentNode).
//
// A genuinely NEW capability (no prior phase classified a message's ACTION type) — but explicitly
// built to REUSE, never re-derive, the product/quantity/reference logic I.B.1/I.B.2/I.B.2.1 already
// built: quantity mutation actions (set_quantity/increment_quantity/decrement_quantity) are read
// directly off an already-computed QuantityMentionV2.correctionKind, and the substitute action is
// read directly off an already-resolved ReferenceMentionV2.substitutionContext — this file never
// re-parses "خليهم"/"بدل" itself to decide correction/substitution semantics; it only decides which
// ActionType label the message-level ACT belongs to. Where this file DOES introduce its own new
// vocabulary (request/add/remove/ask/confirm/reject/send_order/cancel_order), it is a small,
// curated, documented set in the same spirit as every other phrase list in this codebase.
import type { NormalizedConversationMessageV32 } from '../../whatsappConversationUnderstandingV32';
import { extractAcceptanceSignals, extractConfirmationSignals, extractRejectionSignals, isSubstantiveConfirmationSignal } from '../../whatsappSemanticSignalsV32';
import type { QuantityMentionV2, ReferenceMentionV2 } from '../quantityReference/quantityReferenceTypes';
import type { ActionType, IntentType } from './basketV2Types';

const INTERROGATIVE_RX = /[؟?]/;
const AVAILABILITY_QUESTION_RX = /موجود|متوفر|متاح|عندك|عندكم|فيه/i;
const PRICE_QUESTION_RX = /بكام|كام(?:\s*كده)?|السعر|سعر/i;

const ORDER_VERB_RX = /هات[ي]?|عايز[ةه]?|عاوز[ةه]?|محتاج[ةه]?|ابعت(?:لي|يلي)?/i;

// Adds ANOTHER item to an already-building order — distinct from the FIRST request_product for a
// case (see classifyMessageActions' own ordering: 'add' only fires once a basket already has
// content, decided by the caller, not this pure per-message classifier).
const ADD_MARKER_RX = /زود(?:ي)?|ضيف(?:ي)?|كمان\s*عايز|كمان\s*حاجة|نسيت/i;
const REMOVE_MARKER_RX = /شيل(?:ي)?|الغ[يى](?:ي)?(?!\s*الطلب|\s*كل)/i;

// Whole-order cancellation — deliberately a DIFFERENT, stronger pattern than a single-item
// rejection (instruction #20: "مش عايز زوركال" must never be confused with cancelling the order).
const CANCEL_ORDER_RX = /مش\s*عايز\s*(?:ده|حاجه|أي\s*حاجه|الطلب)(?:\s*خالص)?|الغ[يى]\s*(?:كل\s*حاجة|الطلب)|كنسل\s*الطلب/i;

const SEND_ORDER_RX = /تم\s*تأكيد\s*الطلب|تم\s*تسجيل(?:\s*طلبك)?|تسجيل\s*طلبك|جاري\s*(?:التجهيز|الإرسال|الارسال)|الطلب\s*اتأكد/i;

const RECOMMEND_REQUEST_RX = /ترشح(?:ي)?\s*لي|ممكن\s*ترشح|عايز[ةه]?\s*حاجة\s*(?:كويسة|كويسه)|محتاج[ةه]?\s*حاجة\s*(?:كويسة|كويسه|ل)/i;

// I.B.3-owned, narrowly-scoped addition — never a modification to whatsappSemanticSignalsV32.ts's
// own ACCEPTANCE_RX (reused as-is above), which is tuned for a different purpose (confirming a
// STAFF fulfillment promise, "تمام هطلبه") and doesn't recognize the shorter "تمام + give-it-to-me"
// phrasing a customer uses to accept a just-offered/recommended product ("تمام هاته"/"تمام ابعته").
// Used ONLY below, gated to the no-existing-basket-content case (instruction #18's own example).
const RECOMMENDATION_ACCEPTANCE_RX = /^تمام\s*(?:هات(?:ه|ها|يه|يها|هم)?|ابعت(?:ه|ها|يه|يها|هم|لي|لحضرتك)?)[!.، ]*$/i;

// I.B.3-owned, narrowly-scoped exception — NEVER modifies quantityIntelligenceV2.ts. Its
// DECREMENT_RX/INCREMENT_RX capture a quantity word (واحدة/اتنين/N) OPTIONALLY, so "شيل انتينال"
// and "زود فليكسيلاكس" (a bare-verb REMOVE/ADD naming a PRODUCT, not a quantity) still match with
// an empty capture, and parseCorrectionNumber(undefined) defaults to 1 — producing a
// correctionKind='decrement'/'increment' QuantityMentionV2 with numericValue 1 that looks
// identical, from this file's perspective, to a genuine "شيل واحدة"/"زود واحدة" correction. A real
// correction's own rawText always includes the captured quantity word/number; a bare-verb match's
// rawText is nothing but the verb itself. This regex recognizes that degenerate, quantity-word-less
// case so the classifier falls through to the remove/add marker branches instead of misreading a
// named-product remove/add as a quantity correction.
const BARE_OPERATION_VERB_RX = /^(?:لا\s*)?(?:خلي(?:ه|ها|هم)?|زود(?:ي)?|شيل(?:ي)?)\s*(?:يبقو[او]|يبقى)?$/i;

export interface ClassifiedAction {
  actionType: ActionType;
  confidence: number;
  ruleIds: string[];
}

/**
 * Classifies the action(s) a single message performs. `quantityForMessage`/`referenceForMessage`
 * are this SAME message's own already-computed I.B.2/I.B.2.1 outputs (never re-derived here).
 * `hasExistingBasketContent` tells the classifier whether a prior item already exists in this
 * case, which is what distinguishes an initial 'request_product' from a later 'add'.
 */
export function classifyMessageActions(
  message: NormalizedConversationMessageV32,
  quantityForMessage: QuantityMentionV2[],
  referenceForMessage: ReferenceMentionV2[],
  hasExistingBasketContent: boolean
): ClassifiedAction[] {
  const text = message.text;
  const actions: ClassifiedAction[] = [];

  // Substitution acceptance takes priority — it is the most specific fact known about this message.
  const substitutionRef = referenceForMessage.find((r) => r.substitutionContext);
  if (substitutionRef) {
    actions.push({ actionType: 'substitute', confidence: substitutionRef.confidence, ruleIds: ['action.substitute.from_reference_substitution_context'] });
    return actions;
  }

  if (message.role === 'staff' && SEND_ORDER_RX.test(text)) {
    actions.push({ actionType: 'send_order', confidence: 0.9, ruleIds: ['action.send_order.staff_fulfillment_phrase'] });
    return actions;
  }

  if (message.role === 'customer') {
    if (CANCEL_ORDER_RX.test(text)) {
      actions.push({ actionType: 'cancel_order', confidence: 0.85, ruleIds: ['action.cancel_order.whole_order_phrase'] });
      return actions;
    }

    const correction = quantityForMessage.find((q) => q.correctionKind && !BARE_OPERATION_VERB_RX.test(q.rawText.trim()));
    if (correction?.correctionKind === 'replace') {
      actions.push({ actionType: 'set_quantity', confidence: correction.confidence, ruleIds: ['action.set_quantity.from_quantity_correction'] });
      return actions;
    }
    if (correction?.correctionKind === 'increment') {
      actions.push({ actionType: 'increment_quantity', confidence: correction.confidence, ruleIds: ['action.increment_quantity.from_quantity_correction'] });
      return actions;
    }
    if (correction?.correctionKind === 'decrement') {
      actions.push({ actionType: 'decrement_quantity', confidence: correction.confidence, ruleIds: ['action.decrement_quantity.from_quantity_correction'] });
      return actions;
    }

    const rejectionSignal = extractRejectionSignals([message])[0];
    if (rejectionSignal) {
      actions.push({ actionType: 'reject', confidence: rejectionSignal.confidence, ruleIds: ['action.reject.explicit_rejection_signal'] });
      return actions;
    }

    const acceptanceSignal = extractAcceptanceSignals([message])[0];
    const confirmationSignal = extractConfirmationSignals([message])[0];
    const recommendationAcceptance = !hasExistingBasketContent && RECOMMENDATION_ACCEPTANCE_RX.test(text.trim());
    if (acceptanceSignal || recommendationAcceptance || (confirmationSignal && isSubstantiveConfirmationSignal(confirmationSignal))) {
      const confidence = Math.max(acceptanceSignal?.confidence ?? 0, confirmationSignal?.confidence ?? 0, recommendationAcceptance ? 0.6 : 0);
      // Instruction #18's own worked example: staff recommends ("ممكن زوركال 20"), customer accepts
      // ("تمام هاته") — there is nothing yet IN the basket for a bare acceptance to "confirm"
      // (staff mentioning/recommending never itself adds an item). With no existing basket content,
      // the only sensible reading of an acceptance signal is that the customer is now REQUESTING
      // whatever was just offered — never an inference invented here beyond that: the graph's own
      // target-resolution step below still requires a concrete, structurally-identifiable target
      // (the sole currently-active product) before anything is added.
      actions.push({
        actionType: hasExistingBasketContent ? 'confirm' : 'add',
        confidence,
        ruleIds: [hasExistingBasketContent ? 'action.confirm.acceptance_or_confirmation_signal' : 'action.add.acceptance_of_recommendation_no_existing_basket'],
      });
      return actions;
    }

    const isQuestion = INTERROGATIVE_RX.test(text);
    if (isQuestion && AVAILABILITY_QUESTION_RX.test(text)) {
      actions.push({ actionType: 'ask_availability', confidence: 0.8, ruleIds: ['action.ask_availability.question_marker'] });
      return actions;
    }
    if (isQuestion && PRICE_QUESTION_RX.test(text)) {
      actions.push({ actionType: 'ask_price', confidence: 0.8, ruleIds: ['action.ask_price.question_marker'] });
      return actions;
    }

    if (REMOVE_MARKER_RX.test(text)) {
      actions.push({ actionType: 'remove', confidence: 0.75, ruleIds: ['action.remove.marker_phrase'] });
      return actions;
    }
    if (ADD_MARKER_RX.test(text)) {
      actions.push({ actionType: 'add', confidence: 0.75, ruleIds: ['action.add.marker_phrase'] });
      return actions;
    }
    if (ORDER_VERB_RX.test(text) && !isQuestion) {
      actions.push({
        actionType: hasExistingBasketContent ? 'add' : 'request_product',
        confidence: 0.75,
        ruleIds: [hasExistingBasketContent ? 'action.add.order_verb_with_existing_basket' : 'action.request_product.order_verb'],
      });
      return actions;
    }
  }

  return actions;
}

export function classifyMessageIntent(message: NormalizedConversationMessageV32, actions: ClassifiedAction[]): { intentType: IntentType; confidence: number } | null {
  if (actions.length === 0) {
    if (message.role === 'customer' && RECOMMEND_REQUEST_RX.test(message.text)) {
      return { intentType: 'recommendation_request', confidence: 0.6 };
    }
    return null;
  }
  const primary = actions[0].actionType;
  if (primary === 'send_order') return { intentType: 'fulfillment_intent', confidence: actions[0].confidence };
  if (primary === 'cancel_order' || primary === 'reject') return { intentType: 'rejection', confidence: actions[0].confidence };
  if (primary === 'ask_availability') return { intentType: 'availability_only', confidence: actions[0].confidence };
  if (primary === 'ask_price') return { intentType: 'information_only', confidence: actions[0].confidence };
  return { intentType: 'purchase_intent', confidence: actions[0].confidence };
}
