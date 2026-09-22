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
  HistoricalCommercialClosureAssessment,
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
 * Phase G.2 CALIBRATION — a second real-data finding: Phase G.1's own applicability logic was
 * still too dependent on the FORMAL Phase C state machine (`commercial.currentState`), which can
 * only ever progress past `basket_in_progress` once a formal FinalBasketSummaryEvent was
 * presented. On the real Phase G sample, EVERY case with strong organic evidence of a genuine
 * closing moment (a clear customer acceptance + a clear staff fulfillment-intent reply — see
 * historicalCommercialClosureEngine.ts) still stayed `basket_in_progress` (no formal summary was
 * ever presented) and was therefore always read as `not_reached` — wrongly, since the order-closing
 * moment DID happen, just never through the formal script. A formal summary is a COMPLIANCE step
 * (see assessOrderConfirmationProtocol above), never an applicability prerequisite.
 *
 * The three questions stay permanently separate, per the recommended one-way data flow:
 *   conversation/case facts -> historical closure -> applicability -> (+ policy date) -> compliance.
 * This function is the "-> applicability" step; it consumes `historicalClosure` as one evidence
 * source but never writes back into it, and compliance (salesIntegrityEngine.ts) never feeds back
 * into applicability either.
 *
 * Decision order:
 *   1. `complaint`/`follow_up` caseTypes are always not_applicable (forward-compat only — these
 *      values are not produced by the current conversationCaseEngine.ts).
 *   2. If the FORMAL Phase C state machine already reached a real order-closing stage
 *      (`awaiting_customer_confirmation`/`customer_confirmed`/`modified_after_confirmation`/
 *      `commercial_confirmation_complete`/`rejected` — all of which require a summary to have been
 *      presented), that alone is sufficient for `applicable`. Formal evidence is never REQUIRED,
 *      but when present it's always enough.
 *   3. Otherwise (no formal summary ever presented — `commercial.currentState` stayed
 *      `basket_in_progress` or `unknown`), fall back to `historicalClosure.closureLevel`, per the
 *      explicit non-blind mapping in the Phase G.2 report:
 *        - `explicit`: not structurally reachable here (it implies step 2 above already fired) —
 *          kept for defensive completeness.
 *        - `strongly_inferred`: applicable, UNLESS the closure engine itself flagged a
 *          contradiction (`needsHumanReview`, e.g. an ambiguous multi-product acceptance — which,
 *          by that engine's own construction, already downgrades to weakly_inferred in practice) ->
 *          `unknown` in that defensive case.
 *        - `weakly_inferred`: never automatically applicable. A reconstructable basket (real
 *          product/quantity evidence) PLUS at least one of acceptance/fulfillment-intent is close
 *          enough to a real closing moment to flag for human review (`unknown`) rather than
 *          dismissed outright; otherwise it's still a real, unresolved commercial opportunity
 *          (`not_reached`) or, with no commercial signal evidence at all, `not_applicable`.
 *        - `not_closed` / `unknown`: no closure evidence exists — `not_reached` when SOME real
 *          commercial signal exists (a meaningful basket item, or the closure engine's own
 *          `purchaseIntentDetected`), else `not_applicable`.
 */
export function deriveOrderConfirmationProtocolApplicability(params: {
  caseType: CaseType;
  commercial: CommercialConfirmationAssessment;
  hasMeaningfulBasketItems: boolean;
  historicalClosure: HistoricalCommercialClosureAssessment;
}): OrderConfirmationProtocolApplicability {
  const { caseType, commercial, hasMeaningfulBasketItems, historicalClosure } = params;

  if (caseType === 'complaint' || caseType === 'follow_up') return 'not_applicable';

  const formalOrderClosingReached =
    commercial.currentState === 'awaiting_customer_confirmation' ||
    commercial.currentState === 'customer_confirmed' ||
    commercial.currentState === 'modified_after_confirmation' ||
    commercial.currentState === 'commercial_confirmation_complete' ||
    commercial.currentState === 'rejected';
  if (formalOrderClosingReached) return 'applicable';

  const hasRealCommercialSignal = hasMeaningfulBasketItems || historicalClosure.purchaseIntentDetected;

  switch (historicalClosure.closureLevel) {
    case 'explicit':
      return 'applicable';
    case 'strongly_inferred':
      return historicalClosure.needsHumanReview ? 'unknown' : 'applicable';
    case 'weakly_inferred':
      if (historicalClosure.basketReconstructable && (historicalClosure.customerAcceptanceDetected || historicalClosure.staffFulfillmentIntentDetected)) {
        return 'unknown';
      }
      return hasRealCommercialSignal ? 'not_reached' : 'not_applicable';
    case 'not_closed':
    case 'unknown':
    default:
      return hasRealCommercialSignal ? 'not_reached' : 'not_applicable';
  }
}
