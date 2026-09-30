import { describe, expect, it } from 'vitest';
import { summarizeStaffRecommendationsV1 } from '@/lib/salesIntelligence/staffRecommendationAnalyticsV1';

describe('staffRecommendationAnalyticsV1', () => {
  it('separates chat acceptance from official invoice conversion', () => {
    const rows = summarizeStaffRecommendationsV1([
      {
        productId: 'p1',
        productCode: 'X1',
        productName: 'X',
        recommenderName: 'د هبة',
        recommendationMessageIds: ['m1'],
        acceptedInChat: true,
        rejectedInChat: false,
        invoiceEvidenceLevel: 'official',
        invoiceContainsProduct: true,
        officialSaleFromRecommendation: true,
        soldQuantity: 1,
        soldNetValue: 500,
        invoiceStaffName: 'د وائل',
        conversionStatus: 'official_sale',
        needsHumanReview: false,
      },
      {
        productId: 'p2',
        productCode: 'X2',
        productName: 'Y',
        recommenderName: 'د هبة',
        recommendationMessageIds: ['m2'],
        acceptedInChat: true,
        rejectedInChat: false,
        invoiceEvidenceLevel: 'candidate',
        invoiceContainsProduct: true,
        officialSaleFromRecommendation: false,
        soldQuantity: 1,
        soldNetValue: 300,
        invoiceStaffName: 'د وائل',
        conversionStatus: 'candidate_invoice_match',
        needsHumanReview: true,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].recommendationCount).toBe(2);
    expect(rows[0].acceptedRecommendationCount).toBe(2);
    expect(rows[0].officialRecommendationSaleCount).toBe(1);
    expect(rows[0].candidateInvoiceMatchCount).toBe(1);
    expect(rows[0].officialRecommendationRevenue).toBe(500);
    expect(rows[0].acceptanceRatePercent).toBe(100);
    expect(rows[0].officialConversionRatePercent).toBe(50);
  });
});
