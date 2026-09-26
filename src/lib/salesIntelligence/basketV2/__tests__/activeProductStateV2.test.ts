// Phase I.B.3.1 — Active Product State V2 tests, covering mandatory regression families #6-#10.
import { describe, expect, it } from 'vitest';
import { computeActiveProductStateV2, soleActiveOrderCandidate } from '../activeProductStateV2';
import { buildProductMentions } from '../../quantityReference/productMentionTracker';
import { messagesFrom } from './testUtils';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
  return buildPharmacyProductIndex(catalog);
}

const CATALOG = catalogFrom([
  { id: '8418f406-2c16-423e-8528-529d39e7d17b', name: 'ANTINAL 24 CAP', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
  { id: '5ab43fcb-385e-427e-bb14-b8dc0ec278eb', name: 'zurcal 20mg 14 tablets', product_code: '67186', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: '96', source: 'catalog_import' },
]);

function stateAt(raw: string) {
  const messages = messagesFrom(raw);
  const mentions = buildProductMentions(messages, { productIndex: CATALOG });
  return computeActiveProductStateV2(messages, mentions, messages.length);
}

describe('I.B.3.1 — mandatory family #6: staff recommendation only', () => {
  it('a bare staff recommendation with no customer response is recommendation_only, never order-eligible', () => {
    const states = stateAt('[9/15/26, 9:00:00 AM] You: ممكن زوركال');
    const zurcal = states.find((s) => s.canonicalProductId === '5ab43fcb-385e-427e-bb14-b8dc0ec278eb');
    expect(zurcal?.lastCommercialAction).toBe('recommendation_only');
    expect(zurcal?.active).toBe(false);
    expect(soleActiveOrderCandidate(states)).toBeNull();
  });
});

describe('I.B.3.1 — mandatory family #7: availability inquiry only', () => {
  it('a bare customer availability question is availability_only, never order-eligible', () => {
    const states = stateAt('[9/15/26, 9:00:00 AM] Customer: عندك انتينال؟');
    const antinal = states.find((s) => s.canonicalProductId === '8418f406-2c16-423e-8528-529d39e7d17b');
    expect(antinal?.lastCommercialAction).toBe('availability_only');
    expect(antinal?.active).toBe(false);
  });
});

describe('I.B.3.1 — mandatory family #8: availability inquiry then order', () => {
  it('a genuine order verb later in the SAME identity upgrades it to requested/order-eligible', () => {
    const states = stateAt(`[9/15/26, 9:00:00 AM] Customer: عندك انتينال؟
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز انتينال`);
    const antinal = states.find((s) => s.canonicalProductId === '8418f406-2c16-423e-8528-529d39e7d17b');
    expect(antinal?.lastCommercialAction).toBe('requested');
    expect(antinal?.active).toBe(true);
  });
});

describe('I.B.3.1 — mandatory family #9: recommendation then customer acceptance', () => {
  it('staff offers TWO recommendation candidates; only the one the customer names with an order verb becomes order-eligible', () => {
    const states = stateAt(`[9/15/26, 9:00:00 AM] You: ممكن انتينال أو زوركال
[9/15/26, 9:01:00 AM] Customer: هات الزوركال`);
    const zurcal = states.find((s) => s.canonicalProductId === '5ab43fcb-385e-427e-bb14-b8dc0ec278eb');
    const antinal = states.find((s) => s.canonicalProductId === '8418f406-2c16-423e-8528-529d39e7d17b');
    expect(zurcal?.lastCommercialAction).toBe('requested');
    expect(zurcal?.active).toBe(true);
    expect(antinal?.lastCommercialAction).toBe('recommendation_only');
    expect(antinal?.active).toBe(false);
    expect(soleActiveOrderCandidate(states)?.canonicalProductId).toBe('5ab43fcb-385e-427e-bb14-b8dc0ec278eb');
  });
});

describe('I.B.3.1 — mandatory family #10: product rejected then new product', () => {
  it('a rejected-then-abandoned product never resurfaces as an active candidate once a new one takes over', () => {
    const states = stateAt(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] Customer: لا مش عايز انتينال خالص
[9/15/26, 9:02:00 AM] Customer: عايز زوركال بدل منه`);
    expect(states.find((s) => s.canonicalProductId === '8418f406-2c16-423e-8528-529d39e7d17b')).toBeUndefined();
    const zurcal = states.find((s) => s.canonicalProductId === '5ab43fcb-385e-427e-bb14-b8dc0ec278eb');
    expect(zurcal?.active).toBe(true);
  });
});

describe('I.B.3.1 — decay factors exposed for QA (instruction #7)', () => {
  it('exposes messageDistance and topicShifted explicitly rather than one opaque score', () => {
    const states = stateAt(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: طيب عايز زوركال كمان`);
    const antinal = states.find((s) => s.canonicalProductId === '8418f406-2c16-423e-8528-529d39e7d17b');
    expect(antinal?.decayFactors.topicShifted).toBe(true);
    expect(typeof antinal?.decayFactors.messageDistance).toBe('number');
    expect(antinal?.decayFactors.messageDistance).toBeGreaterThan(0);
  });
});
