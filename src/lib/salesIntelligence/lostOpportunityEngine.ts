// Sales Intelligence — Canonical Lost Opportunity Engine.
//
// Sole owner of "was this interaction's commercial opportunity won, is it still open/recoverable,
// or was it really lost — why, at which stage, and is it recoverable?". It composes existing
// canonical outputs only (Customer Need lifecycle, Unavailable Demand, Commercial Confirmation,
// Journey State, Canonical Sales Outcome) plus V32 customer-intent statements. It never reads
// legacy V7 leakage / V23 / V22 lost reasons / leakage views / watcher actions, never proves a
// sale, and never uses a wall clock: without explicit end evidence the opportunity stays open or
// recoverable (No Sale != Lost). Deterministic for identical input.
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';
import {
  classifyCustomerIntentStatementV32,
  extractAcceptanceSignals,
  extractAlternativeOfferSignals,
  extractClarificationQuestionSignals,
  isRequestCandidate,
  type CustomerIntentStatementV32,
} from '../whatsappSemanticSignalsV32';
import type {
  CanonicalSalesOutcomeAssessment,
  CommercialConfirmationAssessment,
  CommercialJourneyStateAssessment,
  ConfidenceAssessment,
  ConfidenceLevel,
  CustomerNeedModel,
  CustomerNeedObjectionCategory,
  LostOpportunityAssessment,
  LostOpportunityReason,
  LostOpportunityRecoverability,
  LostOpportunityResponsibility,
  LostOpportunityStaffFact,
  LostOpportunityStage,
  LostOpportunityState,
  ProductLossEvidence,
  UnavailableDemand,
} from './types';

export interface DeriveLostOpportunityInput {
  caseId: string;
  messages: NormalizedConversationMessageV32[];
  customerNeed: CustomerNeedModel;
  unavailableDemand: UnavailableDemand[];
  commercialConfirmation: CommercialConfirmationAssessment;
  journeyState: CommercialJourneyStateAssessment;
  salesOutcome: CanonicalSalesOutcomeAssessment;
}

interface Verdict {
  state: LostOpportunityState;
  waitingOn: LostOpportunityAssessment['waitingOn'];
  reason: LostOpportunityReason | null;
  stage: LostOpportunityStage;
  responsibility: LostOpportunityResponsibility;
  recoverability: LostOpportunityRecoverability;
  level: ConfidenceLevel;
  score: number;
  explanation: string;
  evidence: string[];
}

const REASON_PROFILE: Record<LostOpportunityReason, { stage: LostOpportunityStage; responsibility: LostOpportunityResponsibility }> = {
  stock_unavailable: { stage: 'availability', responsibility: 'inventory' },
  alternative_rejected: { stage: 'availability', responsibility: 'inventory' },
  price: { stage: 'price', responsibility: 'customer' },
  customer_no_response: { stage: 'response', responsibility: 'customer' },
  staff_no_response: { stage: 'response', responsibility: 'staff' },
  slow_response: { stage: 'response', responsibility: 'staff' },
  delivery_issue: { stage: 'fulfillment', responsibility: 'delivery' },
  product_not_suitable: { stage: 'offer', responsibility: 'customer' },
  prescription_unclear: { stage: 'need', responsibility: 'unknown' },
  customer_declined: { stage: 'closing', responsibility: 'customer' },
  competitor: { stage: 'closing', responsibility: 'customer' },
  unknown: { stage: 'unknown', responsibility: 'unknown' },
};

const OBJECTION_REASON: Partial<Record<CustomerNeedObjectionCategory, LostOpportunityReason>> = {
  price: 'price',
  delivery: 'delivery_issue',
  product_fit: 'product_not_suitable',
};

function verdict(
  state: LostOpportunityState,
  reason: LostOpportunityReason | null,
  recoverability: LostOpportunityRecoverability,
  waitingOn: LostOpportunityAssessment['waitingOn'],
  level: ConfidenceLevel,
  score: number,
  explanation: string,
  evidence: string[]
): Verdict {
  const profile = reason ? REASON_PROFILE[reason] : null;
  return {
    state,
    waitingOn,
    reason,
    stage: profile?.stage ?? 'unknown',
    responsibility: profile?.responsibility ?? 'unknown',
    recoverability,
    level,
    score,
    explanation,
    evidence,
  };
}

export function deriveLostOpportunity(input: DeriveLostOpportunityInput): LostOpportunityAssessment {
  const { customerNeed, unavailableDemand, salesOutcome, commercialConfirmation, journeyState } = input;
  const messages = input.messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const meaningful = messages.filter((m) => m.isMeaningful && (m.role === 'customer' || m.role === 'staff'));
  const last = meaningful[meaningful.length - 1] ?? null;

  // Customer-intent statements (V32 vocabulary), in order.
  const intents: Array<{ intent: CustomerIntentStatementV32; messageId: string }> = [];
  for (const m of meaningful) {
    if (m.role !== 'customer') continue;
    const intent = classifyCustomerIntentStatementV32(m.text);
    if (intent) intents.push({ intent, messageId: m.id });
  }
  const has = (intent: CustomerIntentStatementV32) => intents.filter((row) => row.intent === intent);

  // Need decline is owned by the Customer Need model (a "no" to an alternative is not a need decline).
  const alternatives = customerNeed.products.flatMap((p) => p.alternatives);
  const objectionOf = (category: CustomerNeedObjectionCategory) =>
    customerNeed.objections.filter((o) => o.category === category);
  const blockingDemand = unavailableDemand.filter((d) => d.alternativeResponse !== 'accepted');
  const rejectedAlternativeDemand = blockingDemand.filter((d) => d.alternativeResponse === 'rejected');

  const staffFacts: LostOpportunityStaffFact[] = [];
  for (const demand of unavailableDemand) {
    staffFacts.push({
      fact: demand.availabilityState === 'unavailable' ? 'stated_unavailable' : 'stated_check_pending',
      messageId: demand.availabilityMessageId,
      staffSender: demand.statedByStaffName,
      staffId: demand.statedByStaffId,
    });
  }
  for (const alternative of alternatives) {
    staffFacts.push({
      fact: 'offered_alternative',
      messageId: alternative.offerMessageId,
      staffSender: alternative.offeredByStaffSender,
      staffId: alternative.offeredByStaffId,
    });
  }

  const hasCommercialNeed =
    salesOutcome.outcome !== 'information_only' &&
    journeyState.currentState !== 'information_only' &&
    (customerNeed.products.length > 0 || customerNeed.primaryNeedMessageId !== null);

  let v: Verdict;
  if (salesOutcome.outcome === 'sale_proven') {
    // Rule 1: Sale Proof is the only route to `won`; product-level losses are still reported below.
    v = verdict('won', null, 'none', null, 'proven', 1, 'won.canonical_sale_proven', []);
  } else if (
    salesOutcome.outcome === 'order_confirmed_unproven' &&
    (journeyState.currentState === 'financially_settled' || journeyState.currentState === 'invoiced_unproven')
  ) {
    // The order is operationally closed by either exact invoice-backed payment settlement OR a
    // clean official invoice whose amount exactly matches the completed confirmed order. This is
    // NOT `won`: official sale/revenue counting still belongs exclusively to canonical Sale Proof.
    v = verdict(
      'closed_order_unproven',
      null,
      'none',
      null,
      'strongly_inferred',
      0.95,
      journeyState.currentState === 'financially_settled'
        ? 'closed.financial_settlement_sale_proof_pending'
        : 'closed.invoice_backed_order_sale_proof_pending',
      journeyState.evidenceMessageIds
    );
  } else if (!hasCommercialNeed) {
    v = verdict('no_commercial_opportunity', null, 'none', null, 'strongly_inferred', 0.85, 'no_commercial_opportunity.no_customer_need', []);
  } else if (has('bought_elsewhere').length) {
    const ids = has('bought_elsewhere').map((r) => r.messageId);
    v = verdict('lost', 'competitor', 'none', null, 'strongly_inferred', 0.9, 'lost.customer_bought_elsewhere', ids);
  } else if (customerNeed.needDeclined || salesOutcome.outcome === 'customer_rejected') {
    // Rule: lost only on an explicit customer end. The root cause is the evidenced blocker, if any.
    const ids = customerNeed.needDeclineMessageIds;
    let reason: LostOpportunityReason = 'customer_declined';
    if (objectionOf('price').length) reason = 'price';
    else if (rejectedAlternativeDemand.length) reason = 'alternative_rejected';
    else if (blockingDemand.some((d) => d.availabilityState === 'unavailable')) reason = 'stock_unavailable';
    else if (objectionOf('product_fit').length) reason = 'product_not_suitable';
    else if (objectionOf('delivery').length) reason = 'delivery_issue';
    else if (has('delay_complaint').length) reason = 'slow_response';
    const causeIds =
      reason === 'price' ? objectionOf('price').map((o) => o.messageId)
      : reason === 'product_not_suitable' ? objectionOf('product_fit').map((o) => o.messageId)
      : reason === 'delivery_issue' ? objectionOf('delivery').map((o) => o.messageId)
      : reason === 'slow_response' ? has('delay_complaint').map((r) => r.messageId)
      : blockingDemand.flatMap((d) => [d.availabilityMessageId]);
    v = verdict('lost', reason, 'none', null, 'strongly_inferred', 0.85, `lost.explicit_customer_decline.${reason}`, [...causeIds, ...ids]);
  } else if (
    commercialConfirmation.currentState === 'commercial_confirmation_complete' ||
    journeyState.currentState === 'awaiting_invoice'
  ) {
    v = verdict('open', null, 'high', 'invoice', 'strongly_inferred', 0.85, 'open.order_confirmed_awaiting_invoice', commercialConfirmation.primaryMessageIds);
  } else if (blockingDemand.length) {
    const pending = blockingDemand.find((d) => d.availabilityState === 'check_pending');
    const rejected = rejectedAlternativeDemand[0];
    const undecided = blockingDemand.find((d) => d.alternativeOffered && d.alternativeResponse !== 'rejected');
    if (pending) {
      v = verdict('open', null, 'high', 'staff', 'strongly_inferred', 0.75, 'open.staff_checking_availability', [pending.availabilityMessageId]);
    } else if (rejected) {
      v = verdict('recoverable', 'alternative_rejected', 'low', 'stock', 'strongly_inferred', 0.75, 'recoverable.alternative_rejected_need_remains', rejected.evidenceMessageIds);
    } else if (undecided) {
      v = verdict('recoverable', 'stock_unavailable', 'high', 'customer', 'strongly_inferred', 0.75, 'recoverable.alternative_open', undecided.evidenceMessageIds);
    } else {
      const demand = blockingDemand[0];
      v = verdict('recoverable', 'stock_unavailable', 'high', 'stock', 'strongly_inferred', 0.8, 'recoverable.stock_unavailable_need_remains', [
        ...demand.evidenceMessageIds,
        ...has('will_wait').map((r) => r.messageId),
      ]);
    }
  } else if (objectionOf('price').length || objectionOf('delivery').length || objectionOf('product_fit').length) {
    const category = objectionOf('price').length ? 'price' : objectionOf('delivery').length ? 'delivery' : 'product_fit';
    const reason = OBJECTION_REASON[category]!;
    const recoverability: LostOpportunityRecoverability = category === 'delivery' ? 'high' : 'medium';
    v = verdict('recoverable', reason, recoverability, 'customer', 'strongly_inferred', 0.75, `recoverable.open_objection.${reason}`, [
      ...objectionOf(category).map((o) => o.messageId),
      ...has('considering').map((r) => r.messageId),
    ]);
  } else if (
    last &&
    last.role === 'customer' &&
    (alternatives.some((a) => a.response === 'accepted' && a.responseMessageId === last.id) ||
      extractAcceptanceSignals(messages).some((signal) => signal.messageId === last.id))
  ) {
    // The customer accepted an offer/alternative last: the next move is the staff's confirmation.
    // That is an open opportunity waiting on staff, not a loss signal.
    v = verdict('open', null, 'high', 'staff', 'strongly_inferred', 0.75, 'open.customer_accepted_awaiting_staff', [last.id]);
  } else if (last && last.role === 'customer' && isRequestCandidate(last) && customerNeed.primaryNeedMessageId) {
    // Staff no response: a real customer need is the last meaningful message and no staff reply follows.
    v = verdict('recoverable', 'staff_no_response', 'high', 'staff', 'weakly_inferred', 0.6, 'recoverable.customer_request_unanswered', [last.id]);
  } else if (last && last.role === 'staff' && staffAwaitsReply(last, messages, commercialConfirmation)) {
    // Customer no response: only after a staff message that genuinely needs an answer.
    staffFacts.push({ fact: 'awaiting_customer_reply', messageId: last.id, staffSender: last.sender, staffId: null });
    v = verdict('recoverable', 'customer_no_response', 'medium', 'customer', 'weakly_inferred', 0.55, 'recoverable.customer_silent_after_real_offer', [last.id]);
  } else if (has('considering').length || objectionOf('timing').length) {
    v = verdict('open', null, 'medium', 'customer', 'strongly_inferred', 0.7, 'open.customer_considering', [
      ...has('considering').map((r) => r.messageId),
      ...objectionOf('timing').map((o) => o.messageId),
    ]);
  } else if (journeyState.currentState !== 'unknown') {
    v = verdict('open', null, 'unknown', null, 'weakly_inferred', 0.5, `open.journey_${journeyState.currentState}`, journeyState.evidenceMessageIds);
  } else {
    v = verdict('unknown', null, 'unknown', null, 'unknown', 0.2, 'unknown.insufficient_evidence', []);
  }

  const productLosses = deriveProductLosses(customerNeed, unavailableDemand, v.state);
  const evidenceMessageIds = [...new Set([...v.evidence, ...productLosses.flatMap((p) => p.evidenceMessageIds)])];
  const confidence: ConfidenceAssessment = {
    level: v.level,
    score: v.score,
    ruleIds: [v.explanation],
    evidence: v.evidence.length
      ? [{ sourceTable: 'whatsapp_review_sources', sourceId: '', messageIds: [...new Set(v.evidence)], description: v.explanation }]
      : [],
  };

  return {
    caseId: input.caseId,
    state: v.state,
    waitingOn: v.state === 'open' || v.state === 'recoverable' ? v.waitingOn : null,
    reason: v.reason,
    stage: v.stage,
    responsibility: v.responsibility,
    recoverability: v.recoverability,
    productKeys: customerNeed.products.filter((p) => p.roles.includes('requested')).map((p) => p.key),
    productLosses,
    staffFacts,
    evidenceMessageIds,
    confidence,
    explanation: v.explanation,
  };
}

/** A staff message that genuinely needs a customer answer — not a courtesy close like "تحت أمر حضرتك". */
function staffAwaitsReply(
  message: NormalizedConversationMessageV32,
  messages: NormalizedConversationMessageV32[],
  confirmation: CommercialConfirmationAssessment
): boolean {
  if (extractClarificationQuestionSignals([message]).length) return true;
  if (extractAlternativeOfferSignals(messages).some((s) => s.messageId === message.id)) return true;
  return confirmation.currentState === 'awaiting_customer_confirmation' && confirmation.primaryMessageIds.includes(message.id);
}

/**
 * Rule for mixed interactions: the interaction verdict follows the canonical sale truth (a proven
 * sale is `won`), while every requested product that did not reach the final basket keeps its own
 * product-level evidence here — so a sold A never erases an unavailable/lost B.
 */
function deriveProductLosses(
  customerNeed: CustomerNeedModel,
  demands: UnavailableDemand[],
  state: LostOpportunityState
): ProductLossEvidence[] {
  const losses: ProductLossEvidence[] = [];
  for (const product of customerNeed.products) {
    if (!product.roles.includes('requested')) continue;
    const demand = demands.find((d) => d.productKey === product.key) ?? null;
    // A product in the active basket is not a loss — unless staff said it is unavailable and no
    // alternative was accepted (a draft basket can still hold the customer's original request line).
    if (product.roles.includes('final_basket') && !(demand && demand.alternativeResponse !== 'accepted')) continue;
    let outcome: ProductLossEvidence['outcome'] = 'unknown';
    let reason: LostOpportunityReason | null = null;
    if (demand) {
      if (demand.alternativeResponse === 'accepted') {
        outcome = 'replaced_by_alternative';
        reason = 'stock_unavailable';
      } else {
        reason = demand.alternativeResponse === 'rejected' ? 'alternative_rejected' : 'stock_unavailable';
        outcome = state === 'lost' ? 'lost' : 'recoverable';
      }
    } else if (product.roles.includes('rejected')) {
      outcome = 'lost';
      reason = 'customer_declined';
    } else {
      continue; // requested but no evidence of why it is absent — not reported as a loss
    }
    losses.push({
      productKey: product.key,
      requestedProductRaw: product.productNameRaw,
      productId: product.productId,
      outcome,
      reason,
      demandKey: demand?.demandKey ?? null,
      evidenceMessageIds: demand?.evidenceMessageIds ?? product.evidenceMessageIds,
    });
  }
  return losses;
}
