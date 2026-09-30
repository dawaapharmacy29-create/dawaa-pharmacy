// Sales Intelligence — Canonical Follow-up Opportunity + Next Best Action Engine.
//
// Sole owner of "does this interaction need a follow-up, why, for which product, when, by whom,
// with what goal and which next best action?". Follow-up != every No Sale: a follow-up exists only
// with a reason + evidence + goal. Inputs are canonical outputs only (Customer Need lifecycle,
// Unavailable Demand, Lost Opportunity, Journey State, Canonical Sales Outcome) plus V32 facts
// (staff promises, customer callback/timing, prescription requests, customer intent). It never
// reads V6 followupPlan, V7/V22 nextAction, whatsapp_conversation_actions or the legacy auto
// follow-up detector, and it writes nothing: this is the analytical decision, not the task.
// Deterministic: dueAt derives only from the interaction's own timestamps, never a wall clock.
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';
import {
  classifyCustomerIntentStatementV32,
  classifyCustomerTimingRequestV32,
  isPrescriptionRequestV32,
  isStaffFollowUpPromiseV32,
  mentionsPrescriptionV32,
} from '../whatsappSemanticSignalsV32';
import { normalizeProductKey } from './caseBasketEngine';
import { buildFollowupIdentity, followupCustomerAnchor } from '../whatsappFollowupIdentity';
import type {
  CanonicalSalesOutcomeAssessment,
  ConfidenceAssessment,
  ConfidenceLevel,
  ConversationCase,
  CustomerNeedModel,
  FollowUpAssessment,
  FollowUpAssignedRole,
  FollowUpDuePolicy,
  FollowUpOpportunity,
  FollowUpReason,
  FollowUpSuppression,
  LostOpportunityAssessment,
  NextBestAction,
  UnavailableDemand,
} from './types';

export interface DeriveFollowUpInput {
  conversationCase: ConversationCase;
  messages: NormalizedConversationMessageV32[];
  customerNeed: CustomerNeedModel;
  unavailableDemand: UnavailableDemand[];
  lostOpportunity: LostOpportunityAssessment;
  salesOutcome: CanonicalSalesOutcomeAssessment;
  customerIdentityStatus?: 'resolved' | 'unresolved' | 'ambiguous' | 'contradicted';
  /** Canonical sender -> staff.id map; used only for the staff member who made an explicit promise. */
  staffIdBySender?: Record<string, string>;
}

interface ReasonProfile {
  priority: FollowUpOpportunity['priority'];
  duePolicy: FollowUpDuePolicy;
  role: FollowUpAssignedRole;
  nextBestAction: NextBestAction;
  goal: string;
  /** False for in-thread obligations the pharmacy owes right now (reply / finish the promised check). */
  needsCustomerIdentity: boolean;
}

const PROFILE: Record<FollowUpReason, ReasonProfile> = {
  staff_no_response: { priority: 'high', duePolicy: 'immediate', role: 'branch_staff', nextBestAction: 'respond_to_customer_request', goal: 'answer_open_customer_request', needsCustomerIdentity: false },
  stock_check_pending: { priority: 'high', duePolicy: 'same_shift', role: 'branch_staff', nextBestAction: 'complete_stock_check_and_reply', goal: 'tell_customer_availability_result', needsCustomerIdentity: false },
  staff_promised_check: { priority: 'high', duePolicy: 'same_shift', role: 'pharmacist', nextBestAction: 'complete_promised_check', goal: 'complete_promised_check', needsCustomerIdentity: false },
  delivery_unresolved: { priority: 'high', duePolicy: 'same_shift', role: 'delivery_team', nextBestAction: 'resolve_delivery_status', goal: 'resolve_delivery_and_confirm_with_customer', needsCustomerIdentity: true },
  callback_requested: { priority: 'high', duePolicy: 'customer_requested_time', role: 'customer_service', nextBestAction: 'contact_customer_at_requested_time', goal: 'honour_customer_callback_request', needsCustomerIdentity: true },
  customer_asked_to_wait: { priority: 'medium', duePolicy: 'when_in_stock', role: 'branch_staff', nextBestAction: 'contact_customer_when_product_available', goal: 'notify_customer_when_product_available', needsCustomerIdentity: true },
  stock_unavailable: { priority: 'medium', duePolicy: 'when_in_stock', role: 'branch_staff', nextBestAction: 'contact_customer_when_product_available', goal: 'offer_original_product_when_available', needsCustomerIdentity: true },
  alternative_open: { priority: 'medium', duePolicy: 'next_day', role: 'pharmacist', nextBestAction: 'confirm_alternative_decision', goal: 'get_decision_on_offered_alternative', needsCustomerIdentity: true },
  customer_considering: { priority: 'medium', duePolicy: 'next_day', role: 'pharmacist', nextBestAction: 'check_customer_decision', goal: 'get_customer_decision', needsCustomerIdentity: true },
  price_objection: { priority: 'medium', duePolicy: 'next_day', role: 'pharmacist', nextBestAction: 'follow_up_with_value_or_allowed_offer', goal: 'address_price_objection', needsCustomerIdentity: true },
  prescription_incomplete: { priority: 'medium', duePolicy: 'next_day', role: 'pharmacist', nextBestAction: 'request_missing_prescription_details', goal: 'complete_prescription_details', needsCustomerIdentity: true },
  customer_no_response: { priority: 'low', duePolicy: 'next_day', role: 'customer_service', nextBestAction: 'send_single_recovery_followup', goal: 'single_recovery_attempt', needsCustomerIdentity: true },
};

/** Reasons that come from an explicit future obligation and therefore survive a proven sale. */
const EXPLICIT_OBLIGATIONS = new Set<FollowUpReason>(['customer_asked_to_wait', 'callback_requested', 'staff_promised_check', 'delivery_unresolved']);

interface Candidate {
  reason: FollowUpReason;
  explicit: boolean;
  demand: UnavailableDemand | null;
  priority?: FollowUpOpportunity['priority'];
  duePolicy?: FollowUpDuePolicy;
  requestedDelayDays?: number | null;
  assignedStaffName?: string | null;
  assignedStaffId?: string | null;
  evidence: string[];
  level: ConfidenceLevel;
  score: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function deriveFollowUpOpportunities(input: DeriveFollowUpInput): FollowUpAssessment {
  const { conversationCase, customerNeed, unavailableDemand, lostOpportunity, salesOutcome } = input;
  const caseId = conversationCase.caseId;
  const messages = input.messages.slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const meaningful = messages.filter((m) => m.isMeaningful && (m.role === 'customer' || m.role === 'staff'));
  const lastAt = meaningful.length ? meaningful[meaningful.length - 1].timestamp : new Date(conversationCase.endedAt ?? conversationCase.startedAt);
  const identityResolved = input.customerIdentityStatus === 'resolved' && Boolean(conversationCase.customerId);
  const customerId = identityResolved ? conversationCase.customerId : null;

  // Interaction-level "nothing to follow up" outcomes.
  if (salesOutcome.outcome === 'information_only' || lostOpportunity.state === 'no_commercial_opportunity') {
    return {
      caseId,
      decision: 'not_needed',
      opportunities: [],
      notNeededReason: salesOutcome.outcome === 'information_only' ? 'information_only' : 'no_customer_need',
    };
  }

  const candidates: Candidate[] = [];
  const indexOf = new Map(messages.map((m, i) => [m.id, i]));
  const laterStaffReply = (message: NormalizedConversationMessageV32) =>
    meaningful.some((m) => m.role === 'staff' && (indexOf.get(m.id) ?? 0) > (indexOf.get(message.id) ?? 0));

  // --- Explicit customer timing / wait requests (V32) ---
  const customerMessages = meaningful.filter((m) => m.role === 'customer');
  const waitRequests: Array<{ message: NormalizedConversationMessageV32; whenInStock: boolean; days: number | null; sameDay: boolean }> = [];
  for (const message of customerMessages) {
    const timing = classifyCustomerTimingRequestV32(message.text);
    const willWait = classifyCustomerIntentStatementV32(message.text) === 'will_wait';
    if (!timing && !willWait) continue;
    waitRequests.push({
      message,
      whenInStock: willWait || timing?.when === 'when_in_stock',
      days: timing?.when === 'days' ? timing.days : null,
      sameDay: timing?.when === 'same_day',
    });
  }
  const demandForWait = (text: string): UnavailableDemand[] => {
    const textKey = normalizeProductKey(text);
    const named = unavailableDemand.filter((d) => d.productKey.length >= 3 && textKey.includes(d.productKey));
    if (named.length) return named;
    return unavailableDemand.length === 1 ? unavailableDemand : [];
  };

  // --- Unavailable Demand (product-scoped) ---
  const explicitlyWaitedDemandKeys = new Set<string>();
  for (const request of waitRequests.filter((r) => r.whenInStock)) {
    for (const demand of demandForWait(request.message.text)) {
      explicitlyWaitedDemandKeys.add(demand.demandKey);
      candidates.push({
        reason: 'customer_asked_to_wait',
        explicit: true,
        demand,
        evidence: [...demand.evidenceMessageIds, request.message.id],
        level: 'strongly_inferred',
        score: 0.85,
      });
    }
  }
  for (const demand of unavailableDemand) {
    if (explicitlyWaitedDemandKeys.has(demand.demandKey)) continue;
    // A declined need still leaves a (suppressed) record for the Customer Story; an accepted
    // alternative settled the need and leaves none.
    if (!demand.followUpCandidate && demand.followUpSuppressedBy !== 'customer_declined_need') continue;
    if (demand.availabilityState === 'check_pending') {
      candidates.push({
        reason: 'stock_check_pending',
        explicit: true,
        demand,
        assignedStaffName: demand.statedByStaffName,
        assignedStaffId: demand.statedByStaffId,
        evidence: demand.evidenceMessageIds,
        level: demand.confidence.level,
        score: demand.confidence.score,
      });
    } else if (demand.alternativeOffered && demand.alternativeResponse !== 'rejected') {
      candidates.push({ reason: 'alternative_open', explicit: false, demand, evidence: demand.evidenceMessageIds, level: demand.confidence.level, score: demand.confidence.score });
    } else {
      candidates.push({
        reason: 'stock_unavailable',
        explicit: false,
        demand,
        priority: demand.alternativeResponse === 'rejected' ? 'low' : undefined,
        evidence: demand.evidenceMessageIds,
        level: demand.confidence.level,
        score: demand.confidence.score,
      });
    }
  }

  // --- Explicit callback requests (not "when in stock", which is product-scoped above) ---
  for (const request of waitRequests.filter((r) => !r.whenInStock)) {
    candidates.push({
      reason: 'callback_requested',
      explicit: true,
      demand: null,
      duePolicy: request.days != null || request.sameDay ? 'customer_requested_time' : 'manual_schedule',
      requestedDelayDays: request.sameDay ? 0 : request.days,
      evidence: [request.message.id],
      level: 'strongly_inferred',
      score: 0.85,
    });
  }

  // --- Staff promises with no later staff reply in this interaction ---
  const checkPendingIds = new Set(unavailableDemand.filter((d) => d.availabilityState === 'check_pending').map((d) => d.availabilityMessageId));
  for (const message of meaningful) {
    if (message.role !== 'staff' || !isStaffFollowUpPromiseV32(message.text)) continue;
    if (checkPendingIds.has(message.id) || laterStaffReply(message)) continue;
    candidates.push({
      reason: 'staff_promised_check',
      explicit: true,
      demand: null,
      assignedStaffName: message.sender,
      assignedStaffId: input.staffIdBySender?.[message.sender] ?? null,
      evidence: [message.id],
      level: 'strongly_inferred',
      score: 0.85,
    });
  }

  // --- Prescription requested and never provided ---
  for (const message of meaningful) {
    if (message.role !== 'staff' || !isPrescriptionRequestV32(message.text)) continue;
    const provided = messages.some(
      (m) => m.role === 'customer' && (indexOf.get(m.id) ?? 0) > (indexOf.get(message.id) ?? 0) && (m.isMediaPlaceholder || mentionsPrescriptionV32(m.text))
    );
    if (!provided) {
      candidates.push({ reason: 'prescription_incomplete', explicit: false, demand: null, evidence: [message.id], level: 'strongly_inferred', score: 0.75 });
    }
  }

  // --- Lost Opportunity driven (interaction-scoped) ---
  const lostEvidence = lostOpportunity.evidenceMessageIds;
  if (lostOpportunity.reason === 'staff_no_response') {
    candidates.push({ reason: 'staff_no_response', explicit: false, demand: null, evidence: lostEvidence, level: lostOpportunity.confidence.level, score: lostOpportunity.confidence.score });
  } else if (lostOpportunity.state === 'recoverable' && lostOpportunity.reason === 'price') {
    candidates.push({ reason: 'price_objection', explicit: false, demand: null, evidence: lostEvidence, level: lostOpportunity.confidence.level, score: lostOpportunity.confidence.score });
  } else if (lostOpportunity.state === 'recoverable' && lostOpportunity.reason === 'customer_no_response') {
    candidates.push({ reason: 'customer_no_response', explicit: false, demand: null, evidence: lostEvidence, level: lostOpportunity.confidence.level, score: lostOpportunity.confidence.score });
  }
  // Delivery/fulfilment complaint (Need owner's delivery objection) with no later staff reply: an
  // operational obligation that survives a proven sale — it never undoes the sale.
  for (const objection of customerNeed.objections.filter((o) => o.category === 'delivery')) {
    const message = messages.find((m) => m.id === objection.messageId);
    if (!message || laterStaffReply(message)) continue;
    candidates.push({ reason: 'delivery_unresolved', explicit: true, demand: null, evidence: [objection.messageId], level: objection.confidence.level, score: objection.confidence.score });
  }
  const considering = customerMessages.filter((m) => classifyCustomerIntentStatementV32(m.text) === 'considering');
  if (considering.length && lostOpportunity.reason !== 'price' && !candidates.some((c) => c.reason === 'alternative_open')) {
    candidates.push({ reason: 'customer_considering', explicit: false, demand: null, evidence: considering.map((m) => m.id), level: 'strongly_inferred', score: 0.75 });
  }

  // --- Suppression, blockers, identity, dedupe ---
  const interactionSuppression: FollowUpSuppression | null =
    lostOpportunity.state === 'lost' && lostOpportunity.recoverability === 'none'
      ? lostOpportunity.reason === 'competitor' ? 'bought_elsewhere' : 'customer_final_decline'
      : null;
  const saleProven = salesOutcome.outcome === 'sale_proven';
  const anchor = followupCustomerAnchor(
    { status: identityResolved ? 'resolved' : 'unresolved', customerId, normalizedPhone: null, customerCode: null },
    caseId
  );

  const byKey = new Map<string, FollowUpOpportunity>();
  for (const candidate of candidates) {
    const profile = PROFILE[candidate.reason];
    const demand = candidate.demand;
    let suppressedBy: FollowUpSuppression | null = interactionSuppression;
    if (!suppressedBy && saleProven && !candidate.explicit) suppressedBy = 'sale_proven';
    if (!suppressedBy && (candidate.evidence.length === 0 || candidate.level === 'unknown')) suppressedBy = 'weak_evidence';
    const blocked = !suppressedBy && profile.needsCustomerIdentity && !customerId;
    const duePolicy = candidate.duePolicy ?? profile.duePolicy;
    const requestedDelayDays = candidate.requestedDelayDays ?? null;
    const productScopeKey = demand ? (demand.resolvedProductId ?? demand.productKey) : null;
    const followUpKey = buildFollowupIdentity({
      customerAnchor: anchor,
      episodeStartedAt: new Date(conversationCase.startedAt),
      followupType: candidate.reason,
      reasonKey: productScopeKey,
    });
    const opportunity: FollowUpOpportunity = {
      followUpKey,
      caseId,
      customerId,
      status: suppressedBy ? 'suppressed' : blocked ? 'blocked' : 'actionable',
      reason: candidate.reason,
      priority: candidate.priority ?? profile.priority,
      productKey: demand?.productKey ?? null,
      productId: demand?.resolvedProductId ?? null,
      productRaw: demand?.requestedProductRaw ?? null,
      quantity: demand?.quantityRequested ?? null,
      demandKey: demand?.demandKey ?? null,
      duePolicy,
      requestedDelayDays,
      dueAt: dueAtFor(duePolicy, requestedDelayDays, lastAt),
      assignedRole: profile.role,
      assignedStaffId: candidate.assignedStaffId ?? null,
      assignedStaffName: candidate.assignedStaffName ?? null,
      goal: profile.goal,
      nextBestAction: profile.nextBestAction,
      blocker: blocked ? 'customer_identity_unresolved' : null,
      suppressedBy,
      evidenceMessageIds: [...new Set(candidate.evidence)],
      confidence: confidence(candidate, profile),
    };
    const existing = byKey.get(followUpKey);
    if (existing) {
      existing.evidenceMessageIds = [...new Set([...existing.evidenceMessageIds, ...opportunity.evidenceMessageIds])];
      continue;
    }
    byKey.set(followUpKey, opportunity);
  }

  // Anti-spam: a generic customer_no_response recovery is dropped when a specific follow-up exists.
  const opportunities = [...byKey.values()];
  const specificActive = opportunities.some((o) => o.reason !== 'customer_no_response' && o.status !== 'suppressed');
  for (const opportunity of opportunities) {
    if (opportunity.reason === 'customer_no_response' && specificActive && opportunity.status !== 'suppressed') {
      opportunity.status = 'suppressed';
      opportunity.blocker = null;
      opportunity.suppressedBy = 'covered_by_specific_follow_up';
    }
  }

  // An unresolved need that the canonical Need owner itself says requires human review must never
  // be presented as "no follow-up needed" merely because no specific follow-up reason could yet be
  // proven. This is not an operational follow-up task; it is a decision gate: review the evidence
  // (for example a missing image/voice product context or a trusted invoice) first, then decide.
  const evidenceReviewRequired =
    opportunities.length === 0 &&
    customerNeed.unresolvedNeed &&
    customerNeed.needsHumanReview &&
    lostOpportunity.state === 'open' &&
    salesOutcome.outcome === 'open_opportunity';

  const decision: FollowUpAssessment['decision'] = opportunities.some((o) => o.status === 'actionable')
    ? 'actionable'
    : opportunities.some((o) => o.status === 'blocked')
      ? 'blocked'
      : opportunities.length
        ? 'suppressed'
        : evidenceReviewRequired
          ? 'review_required'
          : 'not_needed';
  return {
    caseId,
    decision,
    opportunities,
    notNeededReason: decision === 'not_needed' ? (saleProven ? 'sale_proven' : interactionSuppression) : null,
  };
}

function dueAtFor(policy: FollowUpDuePolicy, days: number | null, lastAt: Date): string | null {
  switch (policy) {
    case 'immediate':
    case 'same_shift':
      return lastAt.toISOString();
    case 'next_day':
      return new Date(lastAt.getTime() + DAY_MS).toISOString();
    case 'customer_requested_time':
      return days == null ? null : new Date(lastAt.getTime() + days * DAY_MS).toISOString();
    default:
      return null; // when_in_stock / manual_schedule: never invent a date
  }
}

function confidence(candidate: Candidate, profile: ReasonProfile): ConfidenceAssessment {
  return {
    level: candidate.level,
    score: candidate.score,
    ruleIds: [`follow_up.${candidate.reason}`, `next_best_action.${profile.nextBestAction}`],
    evidence: candidate.evidence.length
      ? [{ sourceTable: 'whatsapp_review_sources', sourceId: '', messageIds: [...new Set(candidate.evidence)], description: `follow_up.${candidate.reason}` }]
      : [],
  };
}
