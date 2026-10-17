// Regression for benchmark R16: an order list continued with "و" + a pack noun is a requested
// item. A product on such a line that the catalog cannot resolve must surface for human review —
// it may never silently vanish, and it is never guessed into the basket.
import { describe, expect, it } from 'vitest';
import { buildBasketFromConversation, messagesFrom } from './testUtils';
import { classifyMessageActions } from '../actionIntentClassifierV2';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  return buildPharmacyProductIndex(rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText)));
}

const CATALOG = catalogFrom([
  { id: 'p-solo', name: 'Solofresh eye drops', product_code: '66682', normalized_name: 'solofresh eye drops', category: null, price: '67', source: 'catalog_import' },
  { id: 'p-hy', name: 'HYFRESH DROPS', product_code: '28532', normalized_name: 'hyfresh drops', category: null, price: '75', source: 'catalog_import' },
]);

const R16_SHAPE = `[9/14/26, 5:21:40 PM] Customer: لو سمحت عاوزة قطرة سولو فريش
[9/14/26, 5:21:44 PM] Customer: وقطرة هاى فريش
[9/14/26, 5:21:51 PM] Customer: وعلبة سويتال شبه دى
[9/14/26, 5:22:01 PM] Customer: <image omitted>
[9/14/26, 5:22:10 PM] Customer: وشريط كيوتابكس
[9/14/26, 5:22:21 PM] You: تركيز ايه ي فندم؟
[9/14/26, 5:30:23 PM] Customer: تمام ياريت بس تبعت الاوردر بسرعة
[9/14/26, 5:31:27 PM] You: جاري الارسال`;

describe('basket V2 — order list continuation', () => {
  it('unresolved products on continuation lines surface for review; canonical aliases resolve while unknown products stay in review', () => {
    const result = buildBasketFromConversation(R16_SHAPE, 'r16', { productIndex: CATALOG });
    const codes = result.currentBasket.items.map((item) => item.canonicalProductCode);
    expect(codes).toEqual(['66682', '28532']);
    const reviewed = result.currentBasket.pendingReviewSignals.map((signal) => signal.rawText);
    expect(reviewed).toEqual(expect.arrayContaining(['وعلبة سويتال شبه دى', 'وشريط كيوتابكس']));
    expect(result.currentBasket.unresolvedCandidates.length).toBeGreaterThanOrEqual(2);
  });

  it('a continuation line is an add only when a basket already exists', () => {
    const [message] = messagesFrom('[9/14/26, 5:21:44 PM] Customer: وقطرة هاى فريش');
    expect(classifyMessageActions(message, [], [], true).map((action) => action.actionType)).toEqual(['add']);
    expect(classifyMessageActions(message, [], [], false)).toEqual([]);
  });

  it('ordinary "و…" chatter and questions are never turned into an add', () => {
    for (const text of ['وانا جاية بكرة', 'والله تمام', 'وقطرة دي بكام؟']) {
      const [message] = messagesFrom(`[9/14/26, 5:21:44 PM] Customer: ${text}`);
      expect(classifyMessageActions(message, [], [], true).some((action) => action.ruleIds.includes('action.add.list_continuation_with_existing_basket'))).toBe(false);
    }
  });
});
