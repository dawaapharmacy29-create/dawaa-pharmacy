import { describe, expect, it } from 'vitest';
import { derivePricingExecutionAssessment } from '@/lib/salesIntelligence/salesPricingExecutionV1';

describe('salesPricingExecutionV1', () => {
  it('recognizes an active offer when the effective unit price matches the final offer price', () => {
    const result = derivePricingExecutionAssessment(
      {
        quantity: 1,
        unitPrice: 675,
        itemDiscountAmount: 75,
        itemDiscountPercent: null,
        grossLineAmount: 675,
        netLineAmount: 600,
        invoiceDiscountAmount: 0,
      },
      [{ id: 'offer-1', title: 'offer', finalPrice: 600 }]
    );
    expect(result.status).toBe('authorized_offer_match');
    expect(result.effectiveUnitPrice).toBe(600);
    expect(result.needsHumanReview).toBe(false);
  });

  it('keeps a discount without a matching offer as review-required, not an automatic violation', () => {
    const result = derivePricingExecutionAssessment(
      {
        quantity: 1,
        unitPrice: 675,
        itemDiscountAmount: 25,
        itemDiscountPercent: null,
        grossLineAmount: 675,
        netLineAmount: 650,
        invoiceDiscountAmount: 0,
      },
      []
    );
    expect(result.status).toBe('discount_needs_review');
    expect(result.needsHumanReview).toBe(true);
  });

  it('keeps a no-discount line neutral', () => {
    const result = derivePricingExecutionAssessment(
      {
        quantity: 1,
        unitPrice: 675,
        itemDiscountAmount: 0,
        itemDiscountPercent: 0,
        grossLineAmount: 675,
        netLineAmount: 675,
        invoiceDiscountAmount: 0,
      },
      []
    );
    expect(result.status).toBe('no_discount_observed');
    expect(result.needsHumanReview).toBe(false);
  });
});
