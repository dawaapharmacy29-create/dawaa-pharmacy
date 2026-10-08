// Sales Intelligence — Canonical Operational Disposition Engine.
//
// Sole owner of "what is this case waiting on NOW, who owns the next move, and what is it?".
// Pure and deterministic. It consumes CANONICAL OUTPUTS ONLY — Lost Opportunity (commercial
// verdict incl. canonical sale proof + waitingOn), Follow-up (explicit/derived obligations with
// owner, staff, product, evidence, confidence) and Journey State — and never parses message text, so no
// regex family lives here. It runs last in the pipeline (after Follow-up), keeping the order
// acyclic: semantic facts -> need/availability/basket -> journey/sale/lost -> follow-up -> disposition.
//
// Rules (in precedence order — never "last message direction"):
//   1. An actionable/blocked follow-up obligation owned by the pharmacy (open request, pending stock
//      check, staff promise, customer-requested callback) -> action_required_pharmacy.
//   2. Delivery obligation -> awaiting_delivery; stock-bound need -> awaiting_stock.
//   3. Lost Opportunity waitingOn (staff/stock/invoice/customer) for open/recoverable interactions.
//   4. Customer-owned decisions (alternative, considering, prescription, silent customer) -> awaiting_customer.
//   5. Commercially terminal (won / closed order / lost / no opportunity) with no open obligation -> closed.
//   6. Otherwise open_unknown.
// A proven or closed sale never erases a real future obligation: the commercial verdict is kept in
// `commercialState` while the operational state still reports the obligation.
import type {
  CaseOperationalDisposition,
  CommercialJourneyStateAssessment,
  ConfidenceAssessment,
  FollowUpAssessment,
  FollowUpOpportunity,
  FollowUpReason,
  LostOpportunityAssessment,
  NextBestAction,
  OperationalActionOwner,
  OperationalDispositionState,
} from './types';

export const OPERATIONAL_DISPOSITION_VERSION = 'case-operational-disposition-v1' as const;

export interface DeriveOperationalDispositionInput {
  caseId: string;
  lostOpportunity: LostOpportunityAssessment;
  followUp: FollowUpAssessment;
  journeyState: CommercialJourneyStateAssessment;
}

type Bucket = 'pharmacy' | 'delivery' | 'stock' | 'invoice' | 'customer';

/** Owner of the next move for each canonical follow-up reason. */
const REASON_BUCKET: Record<FollowUpReason, Bucket> = {
  staff_no_response: 'pharmacy',
  stock_check_pending: 'pharmacy',
  staff_promised_check: 'pharmacy',
  callback_requested: 'pharmacy',
  delivery_unresolved: 'delivery',
  stock_unavailable: 'stock',
  customer_asked_to_wait: 'stock',
  alternative_open: 'customer',
  customer_considering: 'customer',
  price_objection: 'customer',
  prescription_incomplete: 'customer',
  customer_no_response: 'customer',
};

const BUCKET_RANK: Record<Bucket, number> = { pharmacy: 0, delivery: 1, stock: 2, invoice: 3, customer: 4 };
const PRIORITY_RANK: Record<FollowUpOpportunity['priority'], number> = { high: 0, medium: 1, low: 2 };

const STATE_BY_BUCKET: Record<Bucket, OperationalDispositionState> = {
  pharmacy: 'action_required_pharmacy',
  delivery: 'awaiting_delivery',
  stock: 'awaiting_stock',
  invoice: 'awaiting_invoice',
  customer: 'awaiting_customer',
};

const LOST_WAITING_BUCKET: Record<NonNullable<LostOpportunityAssessment['waitingOn']>, Bucket> = {
  staff: 'pharmacy',
  customer: 'customer',
  stock: 'stock',
  invoice: 'invoice',
};

/** Next action when the decision comes from Lost Opportunity rather than a follow-up opportunity. */
const LOST_WAITING_ACTION: Record<Bucket, NextBestAction | null> = {
  pharmacy: 'respond_to_customer_request',
  delivery: 'resolve_delivery_status',
  stock: 'contact_customer_when_product_available',
  invoice: null,
  customer: null,
};

const TERMINAL_COMMERCIAL = new Set<LostOpportunityAssessment['state']>([
  'won',
  'closed_order_unproven',
  'lost',
  'no_commercial_opportunity',
]);

interface Decision {
  bucket: Bucket | 'closed' | 'unknown';
  opportunity: FollowUpOpportunity | null;
  reasonCodes: string[];
  evidenceMessageIds: string[];
  confidence: ConfidenceAssessment;
  nextBestAction: NextBestAction | null;
}

function pickOpportunity(opportunities: FollowUpOpportunity[]): FollowUpOpportunity | null {
  return (
    opportunities
      .filter((o) => o.status === 'actionable' || o.status === 'blocked')
      .slice()
      .sort(
        (a, b) =>
          BUCKET_RANK[REASON_BUCKET[a.reason]] - BUCKET_RANK[REASON_BUCKET[b.reason]] ||
          (a.status === 'actionable' ? 0 : 1) - (b.status === 'actionable' ? 0 : 1) ||
          PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
          a.followUpKey.localeCompare(b.followUpKey)
      )[0] ?? null
  );
}

export function deriveCaseOperationalDisposition(input: DeriveOperationalDispositionInput): CaseOperationalDisposition {
  const { lostOpportunity, followUp, journeyState } = input;
  const opportunity = pickOpportunity(followUp.opportunities);
  const lostBucket =
    (lostOpportunity.state === 'open' || lostOpportunity.state === 'recoverable') && lostOpportunity.waitingOn
      ? LOST_WAITING_BUCKET[lostOpportunity.waitingOn]
      : journeyState.currentState === 'awaiting_invoice'
        ? 'invoice'
        : null;

  let decision: Decision;
  const fromOpportunity = (o: FollowUpOpportunity): Decision => ({
    bucket: REASON_BUCKET[o.reason],
    opportunity: o,
    reasonCodes: [
      `disposition.follow_up.${o.reason}`,
      ...(o.status === 'blocked' && o.blocker ? [`disposition.blocked.${o.blocker}`] : []),
    ],
    evidenceMessageIds: o.evidenceMessageIds,
    confidence: o.confidence,
    nextBestAction: o.nextBestAction,
  });

  if (opportunity && (!lostBucket || BUCKET_RANK[REASON_BUCKET[opportunity.reason]] <= BUCKET_RANK[lostBucket])) {
    decision = fromOpportunity(opportunity);
  } else if (lostBucket) {
    decision = {
      bucket: lostBucket,
      opportunity: null,
      reasonCodes: [`disposition.lost_opportunity.waiting_on_${lostOpportunity.waitingOn ?? 'invoice'}`, lostOpportunity.explanation],
      evidenceMessageIds: lostOpportunity.evidenceMessageIds,
      confidence: lostOpportunity.confidence,
      nextBestAction: LOST_WAITING_ACTION[lostBucket],
    };
  } else if (TERMINAL_COMMERCIAL.has(lostOpportunity.state)) {
    decision = {
      bucket: 'closed',
      opportunity: null,
      reasonCodes: [`disposition.closed.${lostOpportunity.state}`, lostOpportunity.explanation],
      evidenceMessageIds: lostOpportunity.evidenceMessageIds,
      confidence: lostOpportunity.confidence,
      nextBestAction: null,
    };
  } else {
    decision = {
      bucket: 'unknown',
      opportunity: null,
      reasonCodes: ['disposition.open_unknown', lostOpportunity.explanation],
      evidenceMessageIds: lostOpportunity.evidenceMessageIds,
      confidence: lostOpportunity.confidence,
      nextBestAction: null,
    };
  }

  const state: OperationalDispositionState =
    decision.bucket === 'closed' ? 'closed' : decision.bucket === 'unknown' ? 'open_unknown' : STATE_BY_BUCKET[decision.bucket];
  const actionOwner: OperationalActionOwner =
    decision.bucket === 'closed' ? 'none' : decision.bucket === 'unknown' ? 'unknown' : decision.bucket;
  const productScoped = decision.opportunity
    ? [decision.opportunity]
    : followUp.opportunities.filter((o) => o.status !== 'suppressed' && REASON_BUCKET[o.reason] === decision.bucket);

  return {
    version: OPERATIONAL_DISPOSITION_VERSION,
    caseId: input.caseId,
    state,
    waitingOn: actionOwner === 'none' || actionOwner === 'unknown' ? null : actionOwner,
    actionOwner,
    assignedRole: decision.opportunity?.assignedRole ?? null,
    assignedStaffId: decision.opportunity?.assignedStaffId ?? null,
    assignedStaffName: decision.opportunity?.assignedStaffName ?? null,
    nextBestAction: decision.nextBestAction,
    decisiveFollowUpKey: decision.opportunity?.followUpKey ?? null,
    decisiveFollowUpReason: decision.opportunity?.reason ?? null,
    productKeys: [...new Set(productScoped.map((o) => o.productKey).filter((v): v is string => Boolean(v)))],
    productIds: [...new Set(productScoped.map((o) => o.productId).filter((v): v is string => Boolean(v)))],
    commercialState: lostOpportunity.state,
    reasonCodes: [...new Set(decision.reasonCodes.filter(Boolean))],
    evidenceMessageIds: [...new Set(decision.evidenceMessageIds)],
    confidence: decision.confidence,
  };
}
