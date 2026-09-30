// Sales Intelligence — Canonical Unavailable Demand Engine.
//
// Sole owner of "did a customer ask for a product the pharmacy did not have?". Pure projection over
// the Customer Need product lifecycle (which already carries availability, alternatives and
// per-message staff attribution). It never re-reads message text, never extracts products or
// quantities, never reads legacy V6/V7/V17 rows, watcher actions or filenames, and never writes.
// Sale Proof/outcome are read-only: a proven sale never erases the demand for the original product.
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';
import type {
  ConfidenceAssessment,
  ConversationCase,
  CustomerNeedAlternative,
  CustomerNeedAvailabilityEvidence,
  CustomerNeedModel,
  CustomerNeedProductLifecycle,
  UnavailableDemand,
  UnavailableDemandBlocker,
  UnavailableDemandFollowUpReason,
  UnavailableDemandFollowUpSuppression,
} from './types';

export interface DeriveUnavailableDemandInput {
  conversationCase: ConversationCase;
  customerNeed: CustomerNeedModel;
  /** The interaction's own messages — used only to timestamp evidence ids, never re-parsed. */
  messages: NormalizedConversationMessageV32[];
  /** Canonical customer identity status from the pipeline input; omitted = 'not_provided' (fail closed). */
  customerIdentityStatus?: 'resolved' | 'unresolved' | 'ambiguous' | 'contradicted';
}

const DEMAND_STATES = new Set(['unavailable', 'check_pending']);

function demandKeyFor(caseId: string, product: CustomerNeedProductLifecycle): string {
  return product.productId
    ? `${caseId}:demand:product:${product.productId}`
    : `${caseId}:demand:raw:${product.key}`;
}

/** The latest staff statement that put the product in its current demand state. */
function statingFact(product: CustomerNeedProductLifecycle, order: Map<string, number>): CustomerNeedAvailabilityEvidence | null {
  return (
    product.availabilityEvidence
      .filter((fact) => fact.state === product.availability)
      .sort((a, b) => (order.get(a.messageId) ?? 0) - (order.get(b.messageId) ?? 0))
      .pop() ?? null
  );
}

/** An accepted alternative settles the need; otherwise the most recent offer is the current one. */
function decisiveAlternative(alternatives: CustomerNeedAlternative[], order: Map<string, number>): CustomerNeedAlternative | null {
  if (alternatives.length === 0) return null;
  const accepted = alternatives.find((alternative) => alternative.response === 'accepted');
  if (accepted) return accepted;
  return alternatives
    .slice()
    .sort((a, b) => (order.get(a.offerMessageId) ?? 0) - (order.get(b.offerMessageId) ?? 0))
    .pop()!;
}

function lowerConfidence(a: ConfidenceAssessment, b: ConfidenceAssessment, ruleIds: string[]): ConfidenceAssessment {
  const rank = { proven: 4, strongly_inferred: 3, weakly_inferred: 2, unknown: 1 } as const;
  const weaker = rank[b.level] < rank[a.level] || (rank[b.level] === rank[a.level] && b.score < a.score) ? b : a;
  return {
    level: weaker.level,
    score: Math.min(a.score, b.score),
    ruleIds: [...new Set([...a.ruleIds, ...ruleIds])],
    evidence: a.evidence,
  };
}

function followUpDecision(
  state: UnavailableDemand['availabilityState'],
  alternative: CustomerNeedAlternative | null,
  declinedNeed: boolean
): { candidate: boolean; reason: UnavailableDemandFollowUpReason | null; suppressedBy: UnavailableDemandFollowUpSuppression | null } {
  if (alternative?.response === 'accepted') return { candidate: false, reason: null, suppressedBy: 'alternative_accepted' };
  if (declinedNeed) return { candidate: false, reason: null, suppressedBy: 'customer_declined_need' };
  if (state === 'check_pending') return { candidate: true, reason: 'availability_check_pending', suppressedBy: null };
  if (!alternative) return { candidate: true, reason: 'original_unavailable_no_alternative', suppressedBy: null };
  if (alternative.response === 'rejected') return { candidate: true, reason: 'alternative_rejected', suppressedBy: null };
  return { candidate: true, reason: 'alternative_undecided', suppressedBy: null };
}

export function deriveUnavailableDemand(input: DeriveUnavailableDemandInput): UnavailableDemand[] {
  const { conversationCase, customerNeed } = input;
  const order = new Map(input.messages.map((message, index) => [message.id, index]));
  const byId = new Map(input.messages.map((message) => [message.id, message]));
  const identityStatus = input.customerIdentityStatus ?? 'not_provided';
  const customerId = identityStatus === 'resolved' ? conversationCase.customerId : null;

  // Canonical need decline is owned by the Customer Need model.
  const declinedNeed = customerNeed.needDeclined;

  const demands = new Map<string, UnavailableDemand>();
  for (const product of customerNeed.products) {
    if (!product.roles.includes('requested') || !DEMAND_STATES.has(product.availability)) continue;
    const fact = statingFact(product, order);
    if (!fact) continue;
    const state = product.availability as UnavailableDemand['availabilityState'];
    const alternative = decisiveAlternative(product.alternatives, order);
    const followUp = followUpDecision(state, alternative, declinedNeed);

    const customerRequestAt = product.evidenceMessageIds
      .map((id) => byId.get(id))
      .filter((message): message is NormalizedConversationMessageV32 => Boolean(message && message.role === 'customer'))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())[0];

    const blockers: UnavailableDemandBlocker[] = [];
    if (!customerId) blockers.push('customer_identity_unresolved');
    if (!conversationCase.branchId && !conversationCase.branchNameRaw) blockers.push('branch_unknown');
    if (!fact.staffId) blockers.push('staff_identity_unresolved');
    if (!product.productId) blockers.push('product_identity_unresolved');
    if (product.requestedQuantity == null) blockers.push('quantity_unknown');

    const demand: UnavailableDemand = {
      demandKey: demandKeyFor(conversationCase.caseId, product),
      caseId: conversationCase.caseId,
      conversationId: conversationCase.conversationId,
      sourceCaseIdV22: conversationCase.sourceCaseIdV22,
      customerId,
      customerIdentityStatus: identityStatus,
      branchId: conversationCase.branchId,
      branchNameRaw: conversationCase.branchNameRaw,
      requestedAt: customerRequestAt ? customerRequestAt.timestamp.toISOString() : null,
      productKey: product.key,
      requestedProductRaw: product.productNameRaw,
      resolvedProductId: product.productId,
      quantityRequested: product.requestedQuantity,
      availabilityState: state,
      availabilityMessageId: fact.messageId,
      statedByStaffName: fact.staffSender,
      statedByStaffId: fact.staffId,
      alternativeOffered: product.alternatives.length > 0,
      alternativeProductKey: alternative?.productKey ?? null,
      alternativeProductRaw: alternative?.productNameRaw ?? null,
      alternativeProductId: alternative?.productId ?? null,
      alternativeOfferedByStaffName: alternative?.offeredByStaffSender ?? null,
      alternativeOfferedByStaffId: alternative?.offeredByStaffId ?? null,
      alternativeResponse: alternative?.response ?? null,
      followUpCandidate: followUp.candidate,
      followUpReason: followUp.reason,
      followUpSuppressedBy: followUp.suppressedBy,
      evidenceMessageIds: [...product.evidenceMessageIds],
      confidence: lowerConfidence(fact.confidence, product.confidence, [
        `unavailable_demand.${state}`,
        ...(followUp.reason ? [`unavailable_demand.follow_up.${followUp.reason}`] : []),
        ...(followUp.suppressedBy ? [`unavailable_demand.no_follow_up.${followUp.suppressedBy}`] : []),
      ]),
      blockers,
    };

    // Two lifecycle entries resolving to the same catalog product inside ONE interaction are one
    // demand. Quantities that disagree become null + a blocker rather than a guess.
    const existing = demands.get(demand.demandKey);
    if (!existing) {
      demands.set(demand.demandKey, demand);
      continue;
    }
    existing.evidenceMessageIds = [...new Set([...existing.evidenceMessageIds, ...demand.evidenceMessageIds])];
    if (
      existing.quantityRequested != null &&
      demand.quantityRequested != null &&
      existing.quantityRequested !== demand.quantityRequested
    ) {
      existing.quantityRequested = null;
      existing.blockers = [...new Set([...existing.blockers.filter((b) => b !== 'quantity_unknown'), 'quantity_conflict' as const])];
    } else if (existing.quantityRequested == null && demand.quantityRequested != null && !existing.blockers.includes('quantity_conflict')) {
      existing.quantityRequested = demand.quantityRequested;
      existing.blockers = existing.blockers.filter((b) => b !== 'quantity_unknown');
    }
  }
  return [...demands.values()];
}
