// Phase I.B.4 completion pass — regression tests for the specific gaps closed while resolving
// R07 (image_antecedent), R09 (substitution), R15 (staff_recommendation_then_customer_acceptance)
// missed-review cases and the S02 event-sequence error. See the phase's final report for the full
// root-cause trace per case; this file only locks in the structural fixes so none of them silently
// regress.
import { describe, expect, it } from 'vitest';
import { buildBasketFromConversation, messagesFrom } from './testUtils';
import { classifyMessageActions } from '../actionIntentClassifierV2';
import { buildProductMentions } from '../../quantityReference/productMentionTracker';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  return buildPharmacyProductIndex(rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText)));
}

const COREGA_CATALOG = catalogFrom([
  { id: 'p-corega-small', name: 'Corega Cream 20 Gm', product_code: '68697', normalized_name: 'corega cream 20 gm', category: null, price: '140', source: 'catalog_import' },
  { id: 'p-corega-large', name: 'corega denture fixative cream 40gm', product_code: '64439', normalized_name: 'corega denture fixative cream 40gm', category: null, price: '250', source: 'catalog_import' },
]);

describe('I.B.4 completion — R07/R09: unresolved reference with NO real candidate surfaces a review signal', () => {
  it('(R07-shaped) a customer decision genuinely tied between two real catalog variants, never captured in text, is flagged for human review — never guesses either SKU', () => {
    const raw = `[12/22/25, 8:54:31 AM] Customer: كريم كوريغا متاح
[12/22/25, 8:57:44 AM] You: متاح
[12/22/25, 8:58:48 AM] Customer: اكيد الكريم
[12/22/25, 8:59:04 AM] Customer: صغيره ولا كبيره الحجم
[12/22/25, 9:00:17 AM] You: <image omitted>
[12/22/25, 9:00:40 AM] Customer: طب تمام
[12/22/25, 9:01:09 AM] You: ده الصغير يفندم
[12/22/25, 9:01:20 AM] Customer: والكبير متاح
[12/22/25, 9:01:24 AM] You: <image omitted>
[12/22/25, 9:01:25 AM] Customer: وبكام
[12/22/25, 9:03:32 AM] You: ١٤٠ يفندم
[12/22/25, 9:03:41 AM] You: الاتنين كريم حضرتك
[12/22/25, 9:03:47 AM] Customer: تمام
[12/22/25, 9:05:13 AM] You: متاح حالا يفندم ابعت لحضرتك اي واحد؟
[12/22/25, 9:05:34 AM] Customer: <voice message omitted>
[12/22/25, 9:14:09 AM] You: تمام يفندم تحت امر حضرتك`;
    const { currentBasket } = buildBasketFromConversation(raw, 'r07-shaped', { productIndex: COREGA_CATALOG });
    expect(currentBasket.items).toHaveLength(0);
    expect(currentBasket.pendingReviewSignals.length).toBeGreaterThan(0);
    expect(currentBasket.pendingReviewSignals.some((s) => s.reason === 'ambiguous_reference_no_safe_antecedent')).toBe(true);
  });

  it('(negative/S04-shaped) a collective reference over products that are ALREADY safely resolved via their own direct mention is never flagged — those items are correct independently of the reference', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز انتينال وفليكسيلاكس
[9/15/26, 9:01:00 AM] You: الاتنين موجودين
[9/15/26, 9:02:00 AM] Customer: مش عايز انتينال`;
    const ANTINAL_FLEXILAX = catalogFrom([
      { id: 'p-antinal', name: 'Antinal 24 cap', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
      { id: 'p-flexilax', name: 'Flexilax 30 tabs', product_code: '68114', normalized_name: 'flexilax 30 tabs', category: null, price: '84', source: 'catalog_import' },
    ]);
    const { currentBasket } = buildBasketFromConversation(raw, 's04-shaped', { productIndex: ANTINAL_FLEXILAX });
    const active = currentBasket.items.filter((i) => i.itemState === 'active');
    expect(active.map((i) => i.canonicalProductCode)).toEqual(['68114']);
    expect(currentBasket.pendingReviewSignals.some((s) => s.reason === 'ambiguous_reference_no_safe_antecedent')).toBe(false);
  });
});

describe('I.B.4 completion — R15: "ماشي تمام"-shaped double-acknowledgement is recognized as acceptance', () => {
  function messagesFromRaw(raw: string) {
    return messagesFrom(raw);
  }

  it('recognizes "ماشي تمام" as an acceptance action when no basket exists yet, same as bare "تمام"', () => {
    const messages = messagesFromRaw('[7/8/26, 8:30:12 AM] Customer: ماشي تمام');
    const actions = classifyMessageActions(messages[0], [], [], false);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe('add');
  });

  it('also recognizes the reverse order "تمام ماشي"', () => {
    const messages = messagesFromRaw('[7/8/26, 8:30:12 AM] Customer: تمام ماشي');
    const actions = classifyMessageActions(messages[0], [], [], false);
    expect(actions).toHaveLength(1);
    expect(actions[0].actionType).toBe('add');
  });

  it('(negative) a single bare acknowledgement word alone is NOT reclassified by this fix — unchanged behavior', () => {
    const messages = messagesFromRaw('[7/8/26, 8:30:12 AM] Customer: ماشي');
    const actions = classifyMessageActions(messages[0], [], [], false);
    // "ماشي" alone still only matches through whatsappSemanticSignalsV32's own WEAK_IMPLICIT_RX-style
    // acceptance handling (unchanged here) — this test only locks in that the double-word regex
    // requires two acknowledgement words, never a bare single one it wasn't designed for.
    expect(actions.every((a) => a.confidence !== 0.6)).toBe(true);
  });
});

describe('I.B.4 completion — staff bare product-name recommendation becomes a mention at proven/strongly_inferred confidence only', () => {
  const CATALOG = catalogFrom([
    { id: 'p-antinal', name: 'ANTINAL 24 CAP', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
  ]);

  it('a staff message that is ONLY a product name with no offer/availability marker still becomes a mention when it exact-matches the catalog', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] You: Antinal 24 Cap');
    const mentions = buildProductMentions(messages, { productIndex: CATALOG });
    expect(mentions.some((m) => m.resolvedProductId === 'p-antinal')).toBe(true);
  });

  it('(negative) a staff message with no offer marker that only WEAKLY/fuzzily matches the catalog is never turned into a mention by this fix', () => {
    // "انتي" shares no exact/strong match with any catalog entry here (far short of ANTINAL) and
    // carries no availability/offer marker — must stay unmentioned, never guessed at cross-script or
    // fuzzy confidence via this bare-name path.
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] You: انتي');
    const mentions = buildProductMentions(messages, { productIndex: CATALOG });
    expect(mentions.some((m) => m.resolvedProductId === 'p-antinal')).toBe(false);
  });
});

describe('I.B.4 completion — event sequence: a bare order-verb re-mention of an EXISTING item is QUANTITY_SET, never a second ITEM_ADDED', () => {
  const CATALOG = catalogFrom([
    { id: 'p-antinal', name: 'Antinal 24 cap', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
  ]);

  it('S02-shaped: عايز انتينال -> هات 2 -> خليهم 3 emits ITEM_ADDED then two QUANTITY_SET events, never a duplicate ITEM_ADDED', () => {
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: هات 2
[9/15/26, 9:03:00 AM] Customer: خليهم 3`;
    const { events, currentBasket } = buildBasketFromConversation(raw, 's02-shaped', { productIndex: CATALOG });
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'ITEM_ADDED')).toHaveLength(1);
    expect(types).toContain('QUANTITY_SET');
    const item = currentBasket.items.find((i) => i.canonicalProductCode === '56822');
    expect(item?.currentQuantity).toBe(3);
  });

  it('(negative) two DIFFERENT products in separate add actions each still get their own ITEM_ADDED — this fix only affects a re-mention of the SAME already-present item', () => {
    const TWO_PRODUCT_CATALOG = catalogFrom([
      { id: 'p-antinal', name: 'Antinal 24 cap', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: '52', source: 'catalog_import' },
      { id: 'p-flexilax', name: 'Flexilax 30 tabs', product_code: '68114', normalized_name: 'flexilax 30 tabs', category: null, price: '84', source: 'catalog_import' },
    ]);
    const raw = `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز فليكسيلاكس كمان`;
    const { events } = buildBasketFromConversation(raw, 'two-products', { productIndex: TWO_PRODUCT_CATALOG });
    expect(events.filter((e) => e.type === 'ITEM_ADDED')).toHaveLength(2);
  });
});
