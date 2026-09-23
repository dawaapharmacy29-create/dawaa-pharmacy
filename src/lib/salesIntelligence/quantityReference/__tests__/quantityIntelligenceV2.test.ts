import { describe, expect, it } from 'vitest';
import { extractQuantityCandidatesFromText, extractQuantityMentionsV2 } from '../quantityIntelligenceV2';
import { buildProductMentions } from '../productMentionTracker';
import { messagesFrom } from './testUtils';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex, CROSS_SCRIPT_SEED } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { extractReferenceMentionsV2 } from '../referenceResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
  return buildPharmacyProductIndex(catalog);
}

const SAME_MESSAGE_CATALOG = catalogFrom([
  { id: 'p-antinal', name: 'Antinal', product_code: '56822', normalized_name: 'antinal', category: null, price: '80', source: 'catalog_import' },
  { id: 'p-zurcal', name: 'Zurcal', product_code: 'z20', normalized_name: 'zurcal', category: null, price: '100', source: 'catalog_import' },
]);

const ZURCAL_CATALOG = catalogFrom([
  { id: 'p-zurcal-20', name: 'Zurcal 20 mg 14 tablets', product_code: 'z20', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: '100', source: 'catalog_import' },
  { id: 'p-zurcal-40', name: 'Zurcal 40 mg 14 tablets', product_code: 'z40', normalized_name: 'zurcal 40mg 14 tablets', category: null, price: '150', source: 'catalog_import' },
]);

describe('extractQuantityCandidatesFromText — role classification (instruction #2/#6)', () => {
  it('dual retail-unit form ("علبتين") is order_quantity=2, never strength or pack_size', () => {
    const [c] = extractQuantityCandidatesFromText('عايز علبتين انتينال');
    expect(c.semanticRole).toBe('order_quantity');
    expect(c.numericValue).toBe(2);
    expect(c.normalizedUnit).toBe('box');
  });

  it('"شريطين منها" — dual form still resolves to order_quantity=2 regardless of trailing pronoun', () => {
    const [c] = extractQuantityCandidatesFromText('شريطين منها');
    expect(c.semanticRole).toBe('order_quantity');
    expect(c.numericValue).toBe(2);
    expect(c.unit).toBe('شريط');
  });

  it('"علبتين منه" — dual form (instruction #21 difficult case #3)', () => {
    const [c] = extractQuantityCandidatesFromText('علبتين منه');
    expect(c.semanticRole).toBe('order_quantity');
    expect(c.numericValue).toBe(2);
    expect(c.unit).toBe('علبة');
  });

  it('Arabic-Indic digit ("هات ٢") is understood as a bare order-quantity number', () => {
    const [c] = extractQuantityCandidatesFromText('هات ٢');
    expect(c.numericValue).toBe(2);
    expect(c.semanticRole).toBe('order_quantity');
    expect(c.ruleIds).toContain('quantity.order.bare_number_after_order_context');
  });

  it('"هات اتنين" — Arabic number word after order verb, no unit', () => {
    const [c] = extractQuantityCandidatesFromText('هات اتنين');
    expect(c.numericValue).toBe(2);
    expect(c.semanticRole).toBe('order_quantity');
  });

  it('"هات واحد كمان" is a bare order-quantity of 1 (repetition phrasing handled at the reference layer, not duplicated here)', () => {
    const [c] = extractQuantityCandidatesFromText('هات واحد كمان');
    expect(c.numericValue).toBe(1);
    expect(c.semanticRole).toBe('order_quantity');
  });

  describe('strength vs quantity disambiguation (instruction #6)', () => {
    it.each([
      ['20 mg', 20, 'mg'],
      ['40 mg', 40, 'mg'],
      ['500 mg', 500, 'mg'],
      ['5 ml', 5, 'ml'],
      ['100 ml', 100, 'ml'],
    ])('"%s" is classified as strength, never order_quantity', (phrase, value) => {
      const [c] = extractQuantityCandidatesFromText(phrase);
      expect(c.semanticRole).toBe('strength');
      expect(c.numericValue).toBe(value);
    });

    it('"30 tablets" (pack-size-like number with an explicit dose unit, no retail-pack context) is order_quantity with a documented ambiguity, never silently strength', () => {
      const [c] = extractQuantityCandidatesFromText('30 tablets');
      expect(c.semanticRole).toBe('order_quantity');
      expect(c.ambiguityReasons).toContain('dose_unit_retail_pack_ambiguous');
    });

    it('"هات 2 Zurcal 40" — 2 is order quantity, 40 is strength (catalog-confirmed)', () => {
      const candidates = extractQuantityCandidatesFromText('هات 2 Zurcal 40', { productIndex: ZURCAL_CATALOG });
      const two = candidates.find((c) => c.numericValue === 2)!;
      const forty = candidates.find((c) => c.numericValue === 40)!;
      expect(two.semanticRole).toBe('order_quantity');
      expect(forty.semanticRole).toBe('strength');
      expect(forty.ruleIds).toContain('quantity.strength.brand_number_catalog_confirmed');
    });

    it('without a catalog, a bare number next to a brand-like token is never guessed as order_quantity', () => {
      const [forty] = extractQuantityCandidatesFromText('Zurcal 40');
      expect(forty.semanticRole).not.toBe('order_quantity');
      expect(forty.ambiguityReasons.length).toBeGreaterThan(0);
    });
  });

  describe('pack-size vs order quantity (instruction #4/#18)', () => {
    it('"شريط 10 أقراص" — 10 is pack_size (describes the strip\'s own contents), not what the customer ordered', () => {
      const [c] = extractQuantityCandidatesFromText('شريط 10 أقراص');
      expect(c.semanticRole).toBe('pack_size');
    });

    it('real conversation: "العبوه ٦٠ كبسوله" — 60 is pack_size', () => {
      const [c] = extractQuantityCandidatesFromText('العبوه ٦٠ كبسوله ب ١٢٠٠');
      expect(c.semanticRole).toBe('pack_size');
      expect(c.numericValue).toBe(60);
    });

    it('negative: "عايز 2 علبة" is order_quantity, never pack_size, even though علبة also appears in pack-size contexts elsewhere', () => {
      const [c] = extractQuantityCandidatesFromText('عايز 2 علبة');
      expect(c.semanticRole).toBe('order_quantity');
    });
  });

  it('negative: a bare price number never becomes a quantity signal of any role that implies an order', () => {
    const [c] = extractQuantityCandidatesFromText('السعر 90 جنيه');
    expect(c.semanticRole).toBe('unknown');
  });

  describe('frequency / duration (light-touch, instruction #2)', () => {
    it('"قرص مرتين في اليوم" detects a frequency mention', () => {
      const candidates = extractQuantityCandidatesFromText('قرص مرتين في اليوم');
      expect(candidates.some((c) => c.semanticRole === 'frequency')).toBe(true);
    });

    it('"لمدة 5 أيام" detects a duration mention', () => {
      const candidates = extractQuantityCandidatesFromText('لمدة 5 أيام');
      expect(candidates.some((c) => c.semanticRole === 'duration' && c.numericValue === 5)).toBe(true);
    });
  });
});

describe('extractQuantityMentionsV2 — cross-message correction + linking (instruction #5/#12)', () => {
  it('"هات 2" then later "لا خليهم 3" — correction links to the same sole active product, old value preserved on the original mention', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: هات 2
[9/15/26, 9:03:00 AM] Customer: لا خليهم 3`);
    const productMentions = buildProductMentions(messages);
    const quantities = extractQuantityMentionsV2(messages, productMentions);
    const two = quantities.find((q) => q.numericValue === 2 && q.semanticRole === 'order_quantity')!;
    const three = quantities.find((q) => q.numericValue === 3)!;
    expect(two.linkedProductMentionId).not.toBeNull();
    expect(three.correctionKind).toBe('replace');
    expect(three.linkedProductMentionId).toBe(two.linkedProductMentionId);
    expect(three.correctionOfMentionId).toBe(two.mentionId);
  });

  it('"زود واحدة" increments only when a single product is active', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: زود واحدة`);
    const productMentions = buildProductMentions(messages);
    const [inc] = extractQuantityMentionsV2(messages, productMentions).filter((q) => q.correctionKind === 'increment');
    expect(inc.correctionKind).toBe('increment');
    expect(inc.linkedProductMentionId).not.toBeNull();
  });

  it('"شيل واحدة" with TWO active products never guesses a target — ambiguity is reported, not silently attached', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز زوركال كمان
[9/15/26, 9:03:00 AM] You: موجود
[9/15/26, 9:04:00 AM] Customer: شيل واحدة`);
    const productMentions = buildProductMentions(messages);
    const [dec] = extractQuantityMentionsV2(messages, productMentions).filter((q) => q.correctionKind === 'decrement');
    expect(dec.linkedProductMentionId).toBeNull();
    expect(dec.ambiguityReasons).toContain('multiple_active_products_no_safe_target');
  });

  it('"خليهم 3" (no "بدل" pair) alone is still recognized as a correction — the old MODIFICATION_QTY_CHANGE_RX pattern required "بدل X" and missed this', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: خليهم 3`);
    const productMentions = buildProductMentions(messages);
    const [correction] = extractQuantityMentionsV2(messages, productMentions).filter((q) => q.correctionKind === 'replace');
    expect(correction.numericValue).toBe(3);
  });

  it('"لا خليهم 2" (instruction #21 difficult case #9 — exact phrasing with the leading "لا")', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: هات 3
[9/15/26, 9:03:00 AM] Customer: لا خليهم 2`);
    const productMentions = buildProductMentions(messages);
    const [correction] = extractQuantityMentionsV2(messages, productMentions).filter((q) => q.correctionKind === 'replace');
    expect(correction.numericValue).toBe(2);
    expect(correction.linkedProductMentionId).not.toBeNull();
  });
});

describe('Phase I.B.4 — quantity targeting via safe same-message references', () => {
  const mentionOptions = { productIndex: SAME_MESSAGE_CATALOG, resolveOptions: { crossScriptSeed: CROSS_SCRIPT_SEED } };
  const quantityOptions = { productIndex: SAME_MESSAGE_CATALOG, resolveOptions: { crossScriptSeed: CROSS_SCRIPT_SEED } };

  it('links "اتنين" to Antinal through the safe "منه" edge in the same message', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وهات منه اتنين');
    const products = buildProductMentions(messages, mentionOptions);
    const refs = extractReferenceMentionsV2(messages, products);
    const quantities = extractQuantityMentionsV2(messages, products, quantityOptions, refs);
    const two = quantities.find((q) => q.numericValue === 2 && q.semanticRole === 'order_quantity')!;
    expect(two.linkedProductMentionId).toBe('p-antinal');
    expect(two.ambiguityReasons).not.toContain('multiple_active_products_target_ambiguous');
  });

  it('does not link quantity when the same-message reference is ambiguous', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وزوركال وهات منه اتنين');
    const products = buildProductMentions(messages, mentionOptions);
    const refs = extractReferenceMentionsV2(messages, products);
    const quantities = extractQuantityMentionsV2(messages, products, quantityOptions, refs);
    const two = quantities.find((q) => q.numericValue === 2 && q.semanticRole === 'order_quantity')!;
    expect(two.linkedProductMentionId).toBeNull();
  });

  it('never lets a future reference target or future product link an earlier quantity', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] Customer: هات اتنين ومنه انتينال');
    const products = buildProductMentions(messages, mentionOptions);
    const refs = extractReferenceMentionsV2(messages, products);
    const quantities = extractQuantityMentionsV2(messages, products, quantityOptions, refs);
    const two = quantities.find((q) => q.numericValue === 2 && q.semanticRole === 'order_quantity')!;
    expect(two.linkedProductMentionId).toBeNull();
  });
});
