import { describe, expect, it } from 'vitest';
import { deriveCanonicalSalesOutcome } from '@/lib/salesIntelligence/canonicalSalesOutcomeEngine';

function proof(state: any, needsHumanReview = false): any {
  return {
    caseId: 'case-1',
    state,
    confidence: { level: state === 'proven' ? 'proven' : 'unknown', score: state === 'proven' ? 1 : 0, ruleIds: [], evidence: [] },
    evidence: [],
    contradictions: state === 'contradicted' ? ['test'] : [],
    ruleIds: [],
    proofSource: state === 'proven' ? 'trusted_invoice' : 'none',
    trustedInvoiceId: state === 'proven' ? 'inv-1' : null,
    selectedInvoiceId: state === 'unknown' ? null : 'inv-1',
    selectedInvoiceNumber: null,
    invoiceEvidenceScope: 'header_only',
    itemEvidenceReady: false,
    quantityEvidenceReady: false,
    needsHumanReview,
  };
}

describe('Canonical sales outcome engine', () => {
  it('counts a sale only when canonical SaleProof is proven', () => {
    const result = deriveCanonicalSalesOutcome({
      caseId: 'case-1',
      caseType: 'sales_opportunity',
      commercialConfirmation: { currentState: 'commercial_confirmation_complete', customerConfirmed: true },
      saleProof: proof('proven'),
      hasMeaningfulBasketItems: true,
      needsHumanReview: false,
    });
    expect(result.outcome).toBe('sale_proven');
    expect(result.isSaleCountable).toBe(true);
    expect(result.isRevenueCountable).toBe(true);
  });

  it('never converts a confirmed chat order with statistical support into a proven sale', () => {
    const result = deriveCanonicalSalesOutcome({
      caseId: 'case-1',
      caseType: 'sales_opportunity',
      commercialConfirmation: { currentState: 'commercial_confirmation_complete', customerConfirmed: true },
      saleProof: proof('strongly_supported'),
      hasMeaningfulBasketItems: true,
      needsHumanReview: false,
    });
    expect(result.outcome).toBe('order_confirmed_unproven');
    expect(result.isSaleCountable).toBe(false);
    expect(result.isRevenueCountable).toBe(false);
    expect(result.isOrderConfirmed).toBe(true);
  });

  it('keeps customer acceptance separate from final order confirmation and sale proof', () => {
    const result = deriveCanonicalSalesOutcome({
      caseId: 'case-1',
      caseType: 'sales_opportunity',
      commercialConfirmation: { currentState: 'customer_confirmed', customerConfirmed: true },
      saleProof: proof('unknown'),
      hasMeaningfulBasketItems: true,
      needsHumanReview: false,
    });
    expect(result.outcome).toBe('customer_confirmed_unproven');
    expect(result.isSaleCountable).toBe(false);
    expect(result.isOrderConfirmed).toBe(false);
  });

  it('surfaces contradictory sale evidence as human review rather than sold', () => {
    const result = deriveCanonicalSalesOutcome({
      caseId: 'case-1',
      caseType: 'sales_opportunity',
      commercialConfirmation: { currentState: 'commercial_confirmation_complete', customerConfirmed: true },
      saleProof: proof('contradicted', true),
      hasMeaningfulBasketItems: true,
      needsHumanReview: true,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.isSaleCountable).toBe(false);
    expect(result.needsHumanReview).toBe(true);
  });

  it('keeps true information-only conversations outside the sales funnel', () => {
    const result = deriveCanonicalSalesOutcome({
      caseId: 'case-1',
      caseType: 'information_only',
      commercialConfirmation: { currentState: 'unknown', customerConfirmed: false },
      saleProof: proof('unknown'),
      hasMeaningfulBasketItems: false,
      needsHumanReview: false,
    });
    expect(result.outcome).toBe('information_only');
    expect(result.isSaleCountable).toBe(false);
  });
});
