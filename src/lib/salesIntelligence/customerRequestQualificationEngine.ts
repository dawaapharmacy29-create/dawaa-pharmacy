// Canonical Customer Request Qualification — analytical owner of whether an unresolved product
// need qualifies for operational registration. It consumes canonical Need / Unavailable Demand /
// Sale / Lost outputs only and never parses chat text or reads legacy V6 request state.
import type {
  CanonicalSalesOutcomeAssessment,
  CustomerNeedModel,
  LostOpportunityAssessment,
  UnavailableDemand,
} from './types';

export type CustomerRequestQualificationStatus = 'qualified' | 'review_required' | 'suppressed';
export type CustomerRequestSuppressionReason =
  | 'availability_check_pending'
  | 'alternative_accepted'
  | 'customer_final_decline'
  | 'bought_elsewhere'
  | 'sale_proven_for_same_product'
  | 'weak_evidence';

export interface CanonicalCustomerRequestOpportunity {
  requestKey: string;
  caseId: string;
  customerId: string | null;
  status: CustomerRequestQualificationStatus;
  productKey: string;
  productId: string | null;
  productRaw: string;
  quantity: number | null;
  demandKey: string;
  priority: 'high' | 'medium';
  reason: 'confirmed_unavailable_product';
  blockers: string[];
  suppressedBy: CustomerRequestSuppressionReason | null;
  evidenceMessageIds: string[];
  confidence: UnavailableDemand['confidence'];
}

export interface CanonicalCustomerRequestAssessment {
  version: 'canonical-customer-request-v1';
  caseId: string;
  decision: 'qualified' | 'review_required' | 'not_needed';
  requests: CanonicalCustomerRequestOpportunity[];
}

function sameProductLoss(lost: LostOpportunityAssessment, demand: UnavailableDemand) {
  return lost.productLosses.find((row) => row.productKey === demand.productKey) ?? null;
}

export function deriveCanonicalCustomerRequestAssessment(input: {
  caseId: string;
  customerNeed: CustomerNeedModel;
  unavailableDemand: readonly UnavailableDemand[];
  salesOutcome: CanonicalSalesOutcomeAssessment;
  lostOpportunity: LostOpportunityAssessment;
}): CanonicalCustomerRequestAssessment {
  const productByKey = new Map(input.customerNeed.products.map((product) => [product.key, product]));
  const requests: CanonicalCustomerRequestOpportunity[] = input.unavailableDemand.map((demand) => {
    const product = productByKey.get(demand.productKey) ?? null;
    const productLoss = sameProductLoss(input.lostOpportunity, demand);
    const blockers: string[] = [];
    let suppressedBy: CustomerRequestSuppressionReason | null = null;

    if (demand.availabilityState === 'check_pending') {
      suppressedBy = 'availability_check_pending';
    } else if (input.customerNeed.needDeclined || productLoss?.reason === 'customer_declined') {
      suppressedBy = 'customer_final_decline';
    } else if (demand.alternativeResponse === 'accepted' || productLoss?.outcome === 'replaced_by_alternative') {
      suppressedBy = 'alternative_accepted';
    } else if (productLoss?.reason === 'competitor') {
      suppressedBy = 'bought_elsewhere';
    } else if (
      input.salesOutcome.outcome === 'sale_proven' &&
      product?.roles.includes('final_basket')
    ) {
      suppressedBy = 'sale_proven_for_same_product';
    } else if (demand.confidence.level === 'weakly_inferred' || demand.confidence.level === 'unknown') {
      suppressedBy = 'weak_evidence';
    }

    if (!suppressedBy) {
      if (demand.customerIdentityStatus !== 'resolved' || !demand.customerId) blockers.push('customer_identity_unresolved');
      if (!demand.branchNameRaw) blockers.push('branch_unknown');
      if (!demand.resolvedProductId) blockers.push('product_identity_unresolved');
      if (demand.blockers.includes('quantity_conflict')) blockers.push('quantity_conflict');
    }

    const status: CustomerRequestQualificationStatus = suppressedBy
      ? 'suppressed'
      : blockers.length
        ? 'review_required'
        : 'qualified';

    return {
      requestKey: `cr1|${demand.demandKey}`,
      caseId: input.caseId,
      customerId: demand.customerId,
      status,
      productKey: demand.productKey,
      productId: demand.resolvedProductId,
      productRaw: demand.requestedProductRaw,
      quantity: demand.quantityRequested,
      demandKey: demand.demandKey,
      priority: input.lostOpportunity.state === 'recoverable' ? 'high' : 'medium',
      reason: 'confirmed_unavailable_product',
      blockers,
      suppressedBy,
      evidenceMessageIds: [...demand.evidenceMessageIds],
      confidence: demand.confidence,
    };
  });

  const decision = requests.some((request) => request.status === 'qualified')
    ? 'qualified'
    : requests.some((request) => request.status === 'review_required')
      ? 'review_required'
      : 'not_needed';

  return {
    version: 'canonical-customer-request-v1',
    caseId: input.caseId,
    decision,
    requests,
  };
}
