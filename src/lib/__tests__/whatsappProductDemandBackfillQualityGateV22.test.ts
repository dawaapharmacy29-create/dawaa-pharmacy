import { describe, expect, it } from 'vitest';
import {
  collectPriorCanonicalProductCodesV22,
  findDroppedPriorCanonicalCodesV22,
} from '@/lib/whatsappProductDemandBackfillQualityGateV22';

describe('WhatsApp Product Demand V22.1 quality gate', () => {
  it('keeps only previously canonical rows that have a product id', () => {
    const codes = collectPriorCanonicalProductCodesV22([
      { product_code: ' 4902 ', product_id: 'p1' },
      { product_code: '4902', product_id: 'p1-duplicate' },
      { product_code: '12820', product_id: 'p2' },
      { product_code: '170', product_id: null },
      { product_code: null, product_id: 'p3' },
    ]);

    expect(codes).toEqual(['4902', '12820']);
  });

  it('blocks only canonical codes that disappeared from the new analysis', () => {
    expect(
      findDroppedPriorCanonicalCodesV22(
        ['4902', '12820'],
        ['4902', '777']
      )
    ).toEqual(['12820']);
  });

  it('does not fail when all prior canonical codes are still present', () => {
    expect(
      findDroppedPriorCanonicalCodesV22(
        ['4902', '12820'],
        ['12820', '4902', '777']
      )
    ).toEqual([]);
  });

  it('normalizes whitespace and duplicate codes before comparison', () => {
    expect(
      findDroppedPriorCanonicalCodesV22(
        [' 4902 ', '4902', ' 12820'],
        ['4902', '12820 ']
      )
    ).toEqual([]);
  });

  it('does not treat newly discovered canonical products as regressions', () => {
    expect(
      findDroppedPriorCanonicalCodesV22(
        ['4902'],
        ['4902', '12820']
      )
    ).toEqual([]);
  });
});
