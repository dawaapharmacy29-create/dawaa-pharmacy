import { describe, expect, it } from 'vitest';
import {
  SALES_QUALITY_STRENGTH_MIN_AVERAGE,
  SALES_QUALITY_STRENGTH_MIN_SAMPLES,
  hasStrongSalesQualityEvidence,
  getSalesQualityEvidenceSufficiency,
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

describe('monthly sales-quality evidence sufficiency', () => {
  it('treats missing sales-quality measurement as insufficient evidence, not poor performance', () => {
    expect(getSalesQualityEvidenceSufficiency({ salesQuality: null })).toEqual({
      status: 'insufficient',
      sufficient: false,
      reasons: ['sales_quality_not_measured'],
    });
  });

  it('requires repeated samples before a sales-quality judgment is evidence-supported', () => {
    const result = getSalesQualityEvidenceSufficiency({
      salesQuality: { average: 10, samples: SALES_QUALITY_STRENGTH_MIN_SAMPLES - 1 },
    });
    expect(result.sufficient).toBe(false);
    expect(result.reasons).toContain('insufficient_sales_quality_samples');
  });

  it('separates evidence sufficiency from whether performance is strong', () => {
    expect(getSalesQualityEvidenceSufficiency({
      salesQuality: { average: 7.5, samples: SALES_QUALITY_STRENGTH_MIN_SAMPLES },
    }).sufficient).toBe(true);
    expect(hasStrongSalesQualityEvidence({
      salesQuality: { average: 7.5, samples: SALES_QUALITY_STRENGTH_MIN_SAMPLES },
    })).toBe(false);
  });
});
