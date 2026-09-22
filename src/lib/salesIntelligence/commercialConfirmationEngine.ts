// Sales Intelligence Phase C — Commercial Confirmation State.
//
// Pure derivation layer only — takes the ALREADY-COMPUTED output of buildCaseBaskets()
// (caseBasketEngine.ts) and combines it into one canonical "is this case's current basket
// commercially settled inside the conversation" answer. Deliberately does NOT re-scan messages:
// every fact used here (basket status/confirmedAt/confirmedByCustomerAt/announcedTotal, and the
// three Phase C event arrays) was already derived once, during the SAME walk, by
// buildCaseBaskets() — re-deriving it here would create a second, competing source of truth.
//
// `commercial_confirmation_complete` is never "sold" — see CommercialConfirmationState in
// types.ts. A sale is only ever confirmed later by order/invoice evidence (a future phase).
import type {
  CaseBasket,
  CaseType,
  CommercialConfirmationAssessment,
  CommercialConfirmationState,
  ConfidenceAssessment,
  CustomerConfirmationEvent,
  EvidenceRef,
  FinalBasketSummaryEvent,
  OrderConfirmationProtocolApplicability,
  OrderConfirmationProtocolAssessment,
  StaffFinalConfirmationEvent,
} from './types';

function assessment(
  level: ConfidenceAssessment['level'],
  score: number,
  ruleIds: string[],
  evidence: EvidenceRef[]
): ConfidenceAssessment {
  return { level, score, ruleIds, evidence };
}

/**
 * Assesses the CURRENT (latest, never-superseded) basket version of a case. A version that was
 * confirmed and later superseded by a customer edit stays historically true on its own row —
 * `modificationAfterConfirmation` records that fact, but the new version must independently earn
 * its own summary/confirmation/staff-confirmation to read `commercial_confirmation_complete`.
 */
export function deriveCommercialConfirmationState(
  caseId: string,
  baskets: CaseBasket[],
  summaryEvents: FinalBasketSummaryEvent[],
  customerConfirmationEvents: CustomerConfirmationEvent[],
  staffFinalConfirmationEvents: StaffFinalConfirmationEvent[]
): CommercialConfirmationAssessment {
  if (baskets.length === 0) {
    return {
      caseId,
      basketId: '',
      basketVersion: 0,
      summaryPresented: false,
      customerConfirmed: false,
      staffConfirmed: false,
      announcedTotalPresent: false,
      modificationAfterConfirmation: false,
      currentState: 'unknown',
      primaryMessageIds: [],
      ruleIds: ['commercial.state.no_basket'],
      confidence: assessment('unknown', 0.2, ['commercial.state.no_basket'], []),
      needsHumanReview: true,
      humanReviewReasons: ['no_basket_state_for_case'],
    };
  }

  const latest = baskets[baskets.length - 1];
  const latestSummaryEvent = summaryEvents.filter((e) => e.basketVersion === latest.version).pop() ?? null;
  const latestConfirmationEvent =
    customerConfirmationEvents.filter((e) => e.basketVersion === latest.version).pop() ?? null;
  const latestStaffConfirmationEvent =
    staffFinalConfirmationEvents.filter((e) => e.basketVersion === latest.version).pop() ?? null;

  const summaryPresented = latestSummaryEvent !== null;
  const customerConfirmed = latest.confirmedByCustomerAt !== null || latest.status === 'confirmed';
  const staffConfirmed = latest.confirmedAt !== null;
  const announcedTotalPresent = latest.announcedTotal !== null;
  // Was an EARLIER version of this same case customer-confirmed before being superseded? That is
  // the fact this flag records — never re-used as permission for the CURRENT version.
  const modificationAfterConfirmation = baskets.some(
    (b, i) => i < baskets.length - 1 && b.confirmedByCustomerAt !== null
  );

  const ruleIds: string[] = [];
  const humanReviewReasons: string[] = [];

  // Exhaustive over latest.status ('superseded' never applies to the LAST basket — see the
  // supersede-wiring loop in caseBasketEngine.ts): 'cancelled' -> rejected; 'confirmed' always
  // implies customerConfirmed=true -> complete or customer_confirmed; 'awaiting_confirmation'
  // always implies summaryPresented=true and customerConfirmed=false (confirming flips status to
  // 'confirmed', so the two can never coexist) -> the summaryPresented branch; 'draft' falls
  // through to modification-in-progress or a fresh basket_in_progress.
  let currentState: CommercialConfirmationState;
  if (latest.status === 'cancelled') {
    // WHOLE_BASKET_REJECTION_RX is the only path that produces this today — a customer-initiated
    // rejection of the presented basket.
    currentState = 'rejected';
    ruleIds.push('commercial.state.rejected_whole_basket');
  } else if (staffConfirmed && customerConfirmed && summaryPresented) {
    currentState = 'commercial_confirmation_complete';
    ruleIds.push('commercial.state.complete');
  } else if (customerConfirmed && !staffConfirmed) {
    currentState = 'customer_confirmed';
    ruleIds.push('commercial.state.customer_confirmed_awaiting_staff');
  } else if (summaryPresented && !customerConfirmed) {
    // Checked BEFORE modificationAfterConfirmation: once the CURRENT version has its own fresh
    // summary, the case has genuinely moved past the modification into a new confirmation cycle
    // — 'awaiting_customer_confirmation' is the accurate, forward-looking state. A case that was
    // modified but has NOT yet received a new summary for the current version falls through to
    // 'modified_after_confirmation' below instead.
    currentState = 'awaiting_customer_confirmation';
    ruleIds.push('commercial.state.awaiting_customer_confirmation');
  } else if (modificationAfterConfirmation && !customerConfirmed) {
    currentState = 'modified_after_confirmation';
    ruleIds.push('commercial.state.modified_after_confirmation');
  } else if (latest.status === 'draft') {
    currentState = 'basket_in_progress';
    ruleIds.push('commercial.state.basket_in_progress');
  } else {
    // Not structurally reachable given the invariants above, kept only as a defensive fallback —
    // 'unknown' is genuinely reached via the zero-basket guard at the top of this function.
    currentState = 'unknown';
    ruleIds.push('commercial.state.unresolved');
    humanReviewReasons.push('commercial_confirmation_state_unresolved');
  }
  const needsHumanReview = humanReviewReasons.length > 0;

  const primaryMessageIds = Array.from(
    new Set(
      [
        latestSummaryEvent?.messageId,
        latestConfirmationEvent?.messageId,
        latestStaffConfirmationEvent?.messageId,
      ].filter((id): id is string => Boolean(id))
    )
  );
  if (primaryMessageIds.length === 0) primaryMessageIds.push(...latest.sourceMessageIds);

  const evidence: EvidenceRef[] = [
    ...(latestSummaryEvent ? latestSummaryEvent.evidence : []),
    ...(latestConfirmationEvent ? latestConfirmationEvent.evidence : []),
    ...(latestStaffConfirmationEvent ? latestStaffConfirmationEvent.evidence : []),
  ];

  const level: ConfidenceAssessment['level'] =
    currentState === 'unknown'
      ? 'unknown'
      : currentState === 'commercial_confirmation_complete'
        ? 'strongly_inferred'
        : 'weakly_inferred';
  const score =
    currentState === 'unknown' ? 0.3 : currentState === 'commercial_confirmation_complete' ? 0.85 : 0.55;

  return {
    caseId,
    basketId: latest.basketId,
    basketVersion: latest.version,
    summaryPresented,
    customerConfirmed,
    staffConfirmed,
    announcedTotalPresent,
    modificationAfterConfirmation,
    currentState,
    primaryMessageIds,
    ruleIds,
    confidence: assessment(level, score, ruleIds, evidence),
    needsHumanReview,
    humanReviewReasons,
  };
}

/**
 * The stricter OPERATIONAL lens, kept fully separate from commercial truth (see
 * OrderConfirmationProtocolAssessment in types.ts): a case can be
 * `commercial_confirmation_complete` while failing protocol compliance (e.g. a real
 * summary/acceptance/staff-confirmation with no total ever announced aloud). This never feeds
 * back into `deriveCommercialConfirmationState` — it is a read-only report on top of it, for
 * measuring staff adherence to the full 4-step protocol without corrupting the sale classifier.
 */
export function assessOrderConfirmationProtocol(
  commercial: CommercialConfirmationAssessment
): OrderConfirmationProtocolAssessment {
  const summaryCompliant = commercial.summaryPresented;
  const announcedTotalCompliant = commercial.announcedTotalPresent;
  const customerConfirmationCompliant = commercial.customerConfirmed;
  const staffFinalConfirmationCompliant = commercial.staffConfirmed;

  const missingProtocolSteps: string[] = [];
  if (!summaryCompliant) missingProtocolSteps.push('final_basket_summary');
  if (!announcedTotalCompliant) missingProtocolSteps.push('announced_total');
  if (!customerConfirmationCompliant) missingProtocolSteps.push('customer_final_confirmation');
  if (!staffFinalConfirmationCompliant) missingProtocolSteps.push('staff_final_confirmation');

  return {
    caseId: commercial.caseId,
    basketId: commercial.basketId,
    basketVersion: commercial.basketVersion,
    summaryCompliant,
    announcedTotalCompliant,
    customerConfirmationCompliant,
    staffFinalConfirmationCompliant,
    protocolCompliant: missingProtocolSteps.length === 0,
    missingProtocolSteps,
  };
}

/**
 * Phase G.1 — whether the 4-step Dawaa protocol is even meaningful to evaluate for this case. A
 * real Phase G shadow-validation finding drove this: feeding every case (including price-only
 * inquiries and bare "شكرا" exchanges) through protocol compliance produced 55/55 real cases
 * flagged for a "missing final total" that was never a genuine staff omission — the conversation
 * simply never reached an order-closing stage in the first place. See
 * OrderConfirmationProtocolApplicability's own doc comment in types.ts for what each value means.
 *
 * Exhaustive over CommercialConfirmationState's reachable values (mirrors the reachability
 * discipline already used throughout this engine suite — see deriveCommercialConfirmationState's
 * own comment). The `caseType === 'information_only' && !hasMeaningfulBasketItems` guard above
 * is deliberately the ONLY place `not_applicable` is decided by item-presence — a real-data
 * regression found that a price-quote-only exchange ("سعره كام" -> "170ج") never gets a captured
 * basket item (no quantity+unit phrase, no resolvable pronoun — see caseBasketEngine.ts's own
 * extraction rules), which would otherwise wrongly read as "not an order flow at all" even though
 * Phase B's own caseType classification already confirms a real request/commercial signal existed:
 *   - 'unknown' (zero baskets at all): not structurally reachable here in practice — it requires
 *     zero meaningful customer messages, which itself requires caseType === 'information_only'
 *     (any request signal implies at least one meaningful customer message, which
 *     buildCaseBaskets always opens a basket for) — already excluded above. Kept as a defensive
 *     `not_applicable` fallback only.
 *   - 'basket_in_progress' (a draft basket, no final summary yet) -> always not_reached: reaching
 *     this branch already means the top-level information_only-with-no-items case was excluded,
 *     so either a real commercial/request signal was confirmed by Phase B (sales_opportunity) or
 *     real items exist regardless of caseType — either way a genuine commercial opportunity
 *     existed but never reached a closing stage.
 *   - 'awaiting_customer_confirmation' / 'customer_confirmed' / 'modified_after_confirmation' /
 *     'commercial_confirmation_complete' / 'rejected' -> applicable: a final summary was
 *     genuinely presented (or the case progressed past that point) in every one of these states.
 */
export function deriveOrderConfirmationProtocolApplicability(params: {
  caseType: CaseType;
  commercial: CommercialConfirmationAssessment;
  hasMeaningfulBasketItems: boolean;
}): OrderConfirmationProtocolApplicability {
  const { caseType, commercial, hasMeaningfulBasketItems } = params;

  if (caseType === 'complaint' || caseType === 'follow_up') return 'not_applicable';
  if (caseType === 'information_only' && !hasMeaningfulBasketItems) return 'not_applicable';

  switch (commercial.currentState) {
    case 'unknown':
      return 'not_applicable';
    case 'basket_in_progress':
      return 'not_reached';
    case 'awaiting_customer_confirmation':
    case 'customer_confirmed':
    case 'modified_after_confirmation':
    case 'commercial_confirmation_complete':
    case 'rejected':
      return 'applicable';
    default:
      return 'unknown';
  }
}
