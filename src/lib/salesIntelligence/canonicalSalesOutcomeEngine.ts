import type {
  CanonicalSalesOutcomeAssessment,
  CaseType,
  CommercialConfirmationState,
} from './types';
import type { SaleProofAssessment } from './saleProofState';

export interface CanonicalSalesOutcomeInput {
  caseId: string;
  caseType: CaseType;
  commercialConfirmation: {
    currentState: CommercialConfirmationState;
    customerConfirmed: boolean;
  };
  saleProof: SaleProofAssessment;
  hasMeaningfulBasketItems: boolean;
  needsHumanReview: boolean;
}

/**
 * Canonical commercial OUTCOME projection.
 *
 * This never proves a sale from conversation language or a statistical invoice match.
 * Revenue/sale counters may only use outcome === 'sale_proven', which itself requires the
 * canonical SaleProof state to be 'proven'.
 */
export function deriveCanonicalSalesOutcome(
  input: CanonicalSalesOutcomeInput
): CanonicalSalesOutcomeAssessment {
  const {
    caseId,
    caseType,
    commercialConfirmation,
    saleProof,
    hasMeaningfulBasketItems,
    needsHumanReview,
  } = input;

  const base = {
    caseId,
    saleProofState: saleProof.state,
    needsHumanReview: needsHumanReview || saleProof.needsHumanReview,
  };

  if (caseType === 'information_only' && !hasMeaningfulBasketItems) {
    return {
      ...base,
      outcome: 'information_only',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ['outcome.information_only'],
    };
  }

  if (saleProof.state === 'proven') {
    return {
      ...base,
      outcome: 'sale_proven',
      isSaleCountable: true,
      isRevenueCountable: true,
      isOrderConfirmed:
        commercialConfirmation.currentState === 'commercial_confirmation_complete',
      reasonCodes: ['outcome.sale_proven.trusted_invoice'],
    };
  }

  if (saleProof.state === 'contradicted') {
    return {
      ...base,
      outcome: 'needs_review',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed:
        commercialConfirmation.currentState === 'commercial_confirmation_complete',
      reasonCodes: ['outcome.sale_evidence_contradicted'],
    };
  }

  if (commercialConfirmation.currentState === 'rejected') {
    return {
      ...base,
      outcome: 'customer_rejected',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ['outcome.customer_rejected'],
    };
  }

  if (commercialConfirmation.currentState === 'commercial_confirmation_complete') {
    return {
      ...base,
      outcome: 'order_confirmed_unproven',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: true,
      reasonCodes: ['outcome.order_confirmed_without_proven_sale'],
    };
  }

  if (commercialConfirmation.customerConfirmed) {
    return {
      ...base,
      outcome: 'customer_confirmed_unproven',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ['outcome.customer_confirmed_without_final_order_or_sale_proof'],
    };
  }

  if (hasMeaningfulBasketItems) {
    return {
      ...base,
      outcome: 'open_opportunity',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ['outcome.open_commercial_opportunity'],
    };
  }

  if (needsHumanReview) {
    return {
      ...base,
      outcome: 'needs_review',
      isSaleCountable: false,
      isRevenueCountable: false,
      isOrderConfirmed: false,
      reasonCodes: ['outcome.insufficient_or_conflicting_evidence'],
    };
  }

  return {
    ...base,
    outcome: 'unknown',
    isSaleCountable: false,
    isRevenueCountable: false,
    isOrderConfirmed: false,
    reasonCodes: ['outcome.unknown'],
  };
}
