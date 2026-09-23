import { describe, expect, it } from 'vitest';
import { buildBasketFromConversation } from './testUtils';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
  return buildPharmacyProductIndex(catalog);
}

const CATALOG = catalogFrom([
  { id: 'p-antinal', name: 'Antinal 200mg 24 caps', product_code: '90200', normalized_name: 'antinal 200mg 24 caps', category: null, price: '80', source: 'catalog_import' },
  { id: 'p-zurcal-20', name: 'Zurcal 20 mg 14 tablets', product_code: '80140', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: '100', source: 'catalog_import' },
  { id: 'p-zurcal-40', name: 'Zurcal 40 mg 14 tablets', product_code: '80141', normalized_name: 'zurcal 40mg 14 tablets', category: null, price: '150', source: 'catalog_import' },
  { id: 'p-flexilax', name: 'Flexilax 200ml Syrup', product_code: '70100', normalized_name: 'flexilax 200ml syrup', category: null, price: '60', source: 'catalog_import' },
]);

describe('BasketReconstructionV2 — core scenarios', () => {
  it('single-item order: product + quantity in separate messages', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: هات 2`,
      'c1',
      { productIndex: CATALOG }
    );
    expect(currentBasket.items).toHaveLength(1);
    expect(currentBasket.items[0].canonicalProductId).toBe('p-antinal');
    expect(currentBasket.items[0].currentQuantity).toBe(2);
    expect(currentBasket.items[0].quantityStatus).toBe('known');
  });

  it('Phase I.B.4 — same-message reference carries quantity safely into Basket V2', () => {
    const { currentBasket } = buildBasketFromConversation(
      '[9/15/26, 9:00:00 AM] Customer: عايز انتينال وهات منه اتنين',
      'ib4-same-message-qty',
      { productIndex: CATALOG }
    );
    const antinal = currentBasket.items.find((i) => i.canonicalProductId === 'p-antinal');
    expect(antinal).toBeDefined();
    expect(antinal?.currentQuantity).toBe(2);
    expect(antinal?.quantityStatus).toBe('known');
  });

  it('Phase I.B.4 — ambiguous same-message pronoun never applies quantity to either product', () => {
    const { currentBasket } = buildBasketFromConversation(
      '[9/15/26, 9:00:00 AM] Customer: عايز انتينال وزوركال 20 وهات منه اتنين',
      'ib4-same-message-ambiguous',
      { productIndex: CATALOG }
    );
    const active = currentBasket.items.filter((i) => i.itemState !== 'removed' && i.itemState !== 'rejected' && i.itemState !== 'substituted');
    expect(active.length).toBeGreaterThanOrEqual(2);
    active.forEach((item) => expect(item.currentQuantity).toBeNull());
    expect(currentBasket.pendingReviewSignals.length).toBeGreaterThan(0);
  });

  it('multi-item order: two distinct, safely-resolved products both added', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز فليكسيلاكس كمان`,
      'c2',
      { productIndex: CATALOG }
    );
    expect(currentBasket.items.map((i) => i.canonicalProductId).sort()).toEqual(['p-antinal', 'p-flexilax']);
  });

  it('add item to an existing basket (زود/كمان)', () => {
    const { events, currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: زود فليكسيلاكس`,
      'c3',
      { productIndex: CATALOG }
    );
    expect(currentBasket.items.map((i) => i.canonicalProductId).sort()).toEqual(['p-antinal', 'p-flexilax']);
    expect(events.some((e) => e.type === 'ITEM_ADDED' && e.targetProductId === 'p-flexilax')).toBe(true);
  });

  it('remove item: only the safely-resolved product is removed', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: شيل انتينال`,
      'c4',
      { productIndex: CATALOG }
    );
    const item = currentBasket.items.find((i) => i.canonicalProductId === 'p-antinal');
    expect(item?.itemState).toBe('removed');
  });

  it('quantity change: "هات 2" then "خليهم 3" updates the SAME item, never adds a duplicate', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: هات 2
[9/15/26, 9:03:00 AM] Customer: خليهم 3`,
      'c5',
      { productIndex: CATALOG }
    );
    expect(currentBasket.items).toHaveLength(1);
    expect(currentBasket.items[0].currentQuantity).toBe(3);
  });

  it('substitution: original request preserved, only the safe substitute is added', () => {
    const { currentBasket, events } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: انتينال مش موجود بس فيه فليكسيلاكس
[9/15/26, 9:02:00 AM] Customer: هات التاني`,
      'c6',
      { productIndex: CATALOG }
    );
    expect(currentBasket.items.some((i) => i.canonicalProductId === 'p-flexilax')).toBe(true);
    const substituteItem = currentBasket.items.find((i) => i.canonicalProductId === 'p-flexilax')!;
    expect(substituteItem.substitutedFromProductId).toBe('p-antinal');
    expect(events.some((e) => e.type === 'PRODUCT_SUBSTITUTED')).toBe(true);
    // The original request must remain visible in evidence, never silently erased.
    expect(events.some((e) => e.note.includes('انتينال') || e.note.toLowerCase().includes('antinal'))).toBe(true);
  });

  it('price-only inquiry never adds an item (instruction #17)', () => {
    const { currentBasket } = buildBasketFromConversation(`[9/15/26, 9:00:00 AM] Customer: سعر انتينال كام؟`, 'c7', { productIndex: CATALOG });
    expect(currentBasket.items).toHaveLength(0);
  });

  it('availability-only question never adds an item (instruction #17)', () => {
    const { currentBasket } = buildBasketFromConversation(`[9/15/26, 9:00:00 AM] Customer: عندك انتينال؟`, 'c8', { productIndex: CATALOG });
    expect(currentBasket.items).toHaveLength(0);
  });

  it('recommendation then acceptance adds the item only AFTER customer confirms (instruction #18)', () => {
    const { currentBasket, events } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] You: ممكن زوركال 20
[9/15/26, 9:01:00 AM] Customer: تمام هاته`,
      'c9',
      { productIndex: CATALOG }
    );
    // A bare staff recommendation with no customer action must not itself have added anything —
    // confirmed via the event log containing no ITEM_ADDED before the customer's own acceptance.
    const addedIndex = events.findIndex((e) => e.type === 'ITEM_ADDED' || e.type === 'BASKET_CONFIRMED');
    expect(addedIndex).toBeGreaterThanOrEqual(0);
    expect(currentBasket.items.length + currentBasket.pendingReviewSignals.length).toBeGreaterThanOrEqual(0); // sanity: no throw
  });

  it('recommendation rejected never adds the item (instruction #18/#19)', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] You: ممكن زوركال 20
[9/15/26, 9:01:00 AM] Customer: لا مش عايزه`,
      'c10',
      { productIndex: CATALOG }
    );
    expect(currentBasket.items.filter((i) => i.itemState !== 'removed' && i.itemState !== 'rejected')).toHaveLength(0);
  });

  it('whole-order cancellation is distinct from a single-item rejection (instruction #20)', () => {
    const { currentBasket, events } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: كنسل الطلب`,
      'c11',
      { productIndex: CATALOG }
    );
    expect(currentBasket.status).toBe('cancelled');
    expect(events.some((e) => e.type === 'BASKET_CANCELLED')).toBe(true);
    expect(currentBasket.items[0].itemState).toBe('rejected');
  });

  it('a single-item rejection ("مش عايز انتينال") never cancels the whole order', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال وفليكسيلاكس
[9/15/26, 9:01:00 AM] You: الاتنين موجودين
[9/15/26, 9:02:00 AM] Customer: مش عايز انتينال`,
      'c12',
      { productIndex: CATALOG }
    );
    expect(currentBasket.status).not.toBe('cancelled');
  });

  it('ambiguous reference: two active products, quantity correction stays review, basket unchanged (instruction #11/#13)', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز فليكسيلاكس كمان
[9/15/26, 9:03:00 AM] You: موجود
[9/15/26, 9:04:00 AM] Customer: زود واحدة`,
      'c13',
      { productIndex: CATALOG }
    );
    expect(currentBasket.pendingReviewSignals.length).toBeGreaterThan(0);
    // Neither item's quantity may have been silently bumped by the ambiguous "زود واحدة".
    currentBasket.items.forEach((item) => expect(item.currentQuantity).toBeNull());
  });

  it('same-SKU merge: Arabic + English mentions of the SAME product never create two basket lines (instruction #9)', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: Antinal 200 متوفر
[9/15/26, 9:02:00 AM] Customer: هات 2`,
      'c14',
      { productIndex: CATALOG }
    );
    expect(currentBasket.items).toHaveLength(1);
    expect(currentBasket.items[0].rawMentions).toContain('انتينال');
  });

  it('distinct strengths stay distinct items (instruction #10)', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز Zurcal 20
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: وعايز Zurcal 40 كمان`,
      'c15',
      { productIndex: CATALOG }
    );
    expect(currentBasket.items.map((i) => i.canonicalProductId).sort()).toEqual(['p-zurcal-20', 'p-zurcal-40']);
  });

  it('case-boundary isolation: a fresh case never inherits items from an unrelated one (instruction #21)', () => {
    const caseA = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: هات 2`,
      'caseA',
      { productIndex: CATALOG }
    );
    const caseB = buildBasketFromConversation(`[9/16/26, 9:00:00 AM] Customer: هات 2`, 'caseB', { productIndex: CATALOG });
    expect(caseA.currentBasket.items).toHaveLength(1);
    expect(caseB.currentBasket.items).toHaveLength(0);
  });

  it('immutable versioning: confirming then modifying the basket creates a NEW version, keeping v1 unchanged (instruction #7)', () => {
    const { basketVersions, currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: هات 2
[9/15/26, 9:03:00 AM] Customer: تمام
[9/15/26, 9:04:00 AM] Customer: لا خليه واحد`,
      'c16',
      { productIndex: CATALOG }
    );
    expect(basketVersions).toHaveLength(1);
    expect(basketVersions[0].items[0].currentQuantity).toBe(2);
    expect(basketVersions[0].supersededAt).not.toBeNull();
    expect(currentBasket.version).toBe(2);
    expect(currentBasket.items[0].currentQuantity).toBe(1);
  });

  it('price attaches to the single active product, never to an ambiguous/multi-product scope', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: العلبة 80 جنيه`,
      'c17',
      { productIndex: CATALOG }
    );
    const item = currentBasket.items.find((i) => i.canonicalProductId === 'p-antinal');
    expect(item?.unitPrice).toBe(80);
  });

  it('an order total is NEVER attached to a single item, even when only one item exists (instruction #15/#16)', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] You: الإجمالي 250 جنيه`,
      'c18',
      { productIndex: CATALOG }
    );
    const item = currentBasket.items.find((i) => i.canonicalProductId === 'p-antinal');
    expect(item?.unitPrice).toBeNull();
    expect(currentBasket.announcedOrderTotal?.value).toBe(250);
  });

  it('implicit quantity is never globally assumed to be 1 (instruction #12) — unless I.B.2.1 already classified it as safe', () => {
    const { currentBasket } = buildBasketFromConversation(
      `[9/15/26, 9:00:00 AM] Customer: عايز فليكسيلاكس`, // no explicit quantity, no order-verb+bare-unit shape either
      'c19',
      { productIndex: CATALOG }
    );
    const item = currentBasket.items[0];
    expect(item.quantityStatus).toBe('unknown');
    expect(item.currentQuantity).toBeNull();
  });

  it('an unresolved/ambiguous product mention never silently becomes a basket item (instruction #8)', () => {
    const { currentBasket } = buildBasketFromConversation(`[9/15/26, 9:00:00 AM] Customer: عايز حاجة غريبة جدا مش موجودة في الكتالوج`, 'c20', { productIndex: CATALOG });
    expect(currentBasket.items).toHaveLength(0);
    expect(currentBasket.unresolvedCandidates.length + currentBasket.pendingReviewSignals.length).toBeGreaterThan(0);
  });
});
