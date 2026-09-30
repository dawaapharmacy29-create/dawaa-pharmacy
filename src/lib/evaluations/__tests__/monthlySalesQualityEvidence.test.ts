import { describe, expect, it } from 'vitest';
import {
  SALES_QUALITY_STRENGTH_MIN_AVERAGE,
  SALES_QUALITY_STRENGTH_MIN_SAMPLES,
  hasStrongSalesQualityEvidence,
} from '@/lib/evaluations/monthlySalesQualityEvidence';

describe('monthly sales-quality strength evidence gate', () => {
  it('does not allow acceptable-only sales quality to become a strength', () => {
    expect(hasStrongSalesQualityEvidence({
      salesQuality: { average: 8.4, samples: 6 },
      missedSales: 0,
      invoiceErrors: 0,
      badAlternativeCases: 0,
    })).toBe(false);
  });

  it('requires a sufficient repeated sample', () => {
    expect(hasStrongSalesQualityEvidence({
      salesQuality: { average: 9.1, samples: SALES_QUALITY_STRENGTH_MIN_SAMPLES - 1 },
      missedSales: 0,
      invoiceErrors: 0,
      badAlternativeCases: 0,
    })).toBe(false);
  });

  it('blocks strength when a missed sale, invoice error, or bad alternative is documented', () => {
    const strong = { average: 9.2, samples: 5 };

    expect(hasStrongSalesQualityEvidence({
      salesQuality: strong,
      missedSales: 1,
      invoiceErrors: 0,
      badAlternativeCases: 0,
    })).toBe(false);

    expect(hasStrongSalesQualityEvidence({
      salesQuality: strong,
      missedSales: 0,
      invoiceErrors: 1,
      badAlternativeCases: 0,
    })).toBe(false);

    expect(hasStrongSalesQualityEvidence({
      salesQuality: strong,
      missedSales: 0,
      invoiceErrors: 0,
      badAlternativeCases: 1,
    })).toBe(false);
  });

  it('allows strength only for strong repeated clean sales evidence', () => {
    expect(hasStrongSalesQualityEvidence({
      salesQuality: {
        average: SALES_QUALITY_STRENGTH_MIN_AVERAGE,
        samples: SALES_QUALITY_STRENGTH_MIN_SAMPLES,
      },
      missedSales: 0,
      invoiceErrors: 0,
      badAlternativeCases: 0,
    })).toBe(true);
  });
});
