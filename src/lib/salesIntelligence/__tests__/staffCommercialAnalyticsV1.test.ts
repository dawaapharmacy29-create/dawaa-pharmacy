import { describe, expect, it } from 'vitest';
import { summarizeStaffCommercialPerformanceV1 } from '@/lib/salesIntelligence/staffCommercialAnalyticsV1';

describe('staffCommercialAnalyticsV1', () => {
  it('aggregates sales, offers, discounts, returns, and quoted-price accuracy by staff', () => {
    const result = summarizeStaffCommercialPerformanceV1([
      {
        invoiceId: 'inv-1',
        invoiceNumber: '73006',
        staffId: 'staff-1',
        staffName: 'د وائل',
        quantity: 1,
        grossLineAmount: 675,
        netLineAmount: 675,
        itemDiscountAmount: 0,
        returnedQuantity: 0,
        pricingStatus: 'no_discount_observed',
        quotedUnitPrice: 675,
        quotedPriceStatus: 'exact',
      },
      {
        invoiceId: 'inv-2',
        invoiceNumber: '73007',
        staffId: 'staff-1',
        staffName: 'د وائل',
        quantity: 2,
        grossLineAmount: 1200,
        netLineAmount: 1100,
        itemDiscountAmount: 100,
        returnedQuantity: 1,
        pricingStatus: 'authorized_offer_match',
        quotedUnitPrice: 550,
        quotedPriceStatus: 'exact',
      },
      {
        invoiceId: 'inv-3',
        invoiceNumber: '73008',
        staffId: 'staff-2',
        staffName: 'د أحمد',
        quantity: 1,
        grossLineAmount: 500,
        netLineAmount: 475,
        itemDiscountAmount: 25,
        returnedQuantity: 0,
        pricingStatus: 'discount_needs_review',
        quotedUnitPrice: 450,
        quotedPriceStatus: 'mismatch_review',
      },
    ]);

    expect(result).toHaveLength(2);
    const wael = result.find((row) => row.staffName === 'د وائل');
    expect(wael?.invoiceCount).toBe(2);
    expect(wael?.netSales).toBe(1775);
    expect(wael?.offerExecutedLineCount).toBe(1);
    expect(wael?.returnedQuantity).toBe(1);
    expect(wael?.quotedPriceAccuracyPercent).toBe(100);

    const ahmed = result.find((row) => row.staffName === 'د أحمد');
    expect(ahmed?.discountReviewLineCount).toBe(1);
    expect(ahmed?.quotedPriceMismatchLineCount).toBe(1);
    expect(ahmed?.quotedPriceAccuracyPercent).toBe(0);
  });
});
