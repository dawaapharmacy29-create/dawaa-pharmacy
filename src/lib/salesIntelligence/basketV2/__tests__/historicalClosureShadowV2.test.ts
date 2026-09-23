import { describe, expect, it } from 'vitest';
import { buildBasketFromConversation, messagesFrom } from './testUtils';
import { deriveHistoricalClosureShadowFromBasketV2 } from '../historicalClosureShadowV2';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';
import type { CommercialConfirmationAssessment } from '../../types';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  return buildPharmacyProductIndex(rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText)));
}

const CATALOG = catalogFrom([
  { id: 'p-antinal', name: 'Antinal 200mg 24 caps', product_code: '90200', normalized_name: 'antinal 200mg 24 caps', category: null, price: '80', source: 'catalog_import' },
]);

function commercial(caseId: string, basketId: string, basketVersion: number): CommercialConfirmationAssessment {
  return {
    caseId,
    basketId,
    basketVersion,
    summaryPresented: false,
    customerConfirmed: false,
    staffConfirmed: false,
    announcedTotalPresent: false,
    modificationAfterConfirmation: false,
    currentState: 'basket_in_progress',
    primaryMessageIds: [],
    ruleIds: ['test.shadow_only'],
    confidence: { level: 'unknown', score: 0.2, ruleIds: ['test.shadow_only'], evidence: [] },
    needsHumanReview: false,
    humanReviewReasons: [],
  };
}

describe('Phase I.B.4 — Historical Closure shadow using Basket V2 evidence', () => {
  it('can recover reconstructable basket evidence without changing the closure engine itself', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: تمام ابعته
[9/15/26, 9:03:00 AM] You: جاري الارسال`;
    const messages = messagesFrom(raw);
    const result = buildBasketFromConversation(raw, 'shadow-case', { productIndex: CATALOG });
    const shadow = deriveHistoricalClosureShadowFromBasketV2(
      'shadow-case',
      messages,
      commercial('shadow-case', result.currentBasket.basketId, result.currentBasket.version),
      result.currentBasket
    );

    expect(shadow.basketReconstructable).toBe(true);
    expect(['strongly_inferred', 'explicit']).toContain(shadow.closureLevel);
  });

  it('does not hallucinate closure from a price-only mention', () => {
    const raw = '[9/15/26, 9:00:00 AM] Customer: سعر انتينال كام؟';
    const messages = messagesFrom(raw);
    const result = buildBasketFromConversation(raw, 'shadow-price', { productIndex: CATALOG });
    const shadow = deriveHistoricalClosureShadowFromBasketV2(
      'shadow-price',
      messages,
      commercial('shadow-price', result.currentBasket.basketId, result.currentBasket.version),
      result.currentBasket
    );

    expect(shadow.closureLevel).not.toBe('strongly_inferred');
    expect(shadow.closureLevel).not.toBe('explicit');
  });
});
