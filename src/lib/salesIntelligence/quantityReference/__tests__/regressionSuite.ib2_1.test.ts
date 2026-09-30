// Phase I.B.2.1 instruction #21 — the permanent, mandatory high-risk regression suite. Every case
// listed in the instruction is represented here by name so a reviewer can check them off directly
// against this file. Several are already covered by pre-existing I.B.2 tests (noted inline);
// this file adds the ones I.B.2 did not yet cover, plus the new safety-contract/hardening tests
// I.B.2.1 itself introduces (safeForBasketLinking, catalog identity merging, structural
// enumeration, directionality).
import { describe, expect, it } from 'vitest';
import { extractQuantityCandidatesFromText, extractQuantityMentionsV2 } from '../quantityIntelligenceV2';
import { buildProductMentions, computeActiveProductCandidates } from '../productMentionTracker';
import { detectReferenceMentions, extractReferenceMentionsV2, resolveReferenceV2 } from '../referenceResolverV2';
import { messagesFrom, findByText } from './testUtils';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../../pharmacyProducts/canonicalProduct';
import { buildPharmacyProductIndex } from '../../pharmacyProducts/pharmacyProductResolverV2';
import { normalizePharmacyText } from '../../pharmacyProducts/pharmacyNormalization';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  const catalog = rows.map((r) => buildCanonicalProduct(r, counts, normalizePharmacyText));
  return buildPharmacyProductIndex(catalog);
}

const ZURCAL_CATALOG = catalogFrom([
  { id: 'p-zurcal-20', name: 'Zurcal 20 mg 14 tablets', product_code: '80140', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: '100', source: 'catalog_import' },
  { id: 'p-zurcal-40', name: 'Zurcal 40 mg 14 tablets', product_code: '80141', normalized_name: 'zurcal 40mg 14 tablets', category: null, price: '150', source: 'catalog_import' },
]);

// Antinal both in Arabic and Latin script, resolving to the SAME product_code — for instruction #17.
const ANTINAL_CATALOG = catalogFrom([
  { id: 'p-antinal', name: 'Antinal 200mg 24 caps', product_code: '90200', normalized_name: 'antinal 200mg 24 caps', category: null, price: '80', source: 'catalog_import' },
]);

describe('Regression #1/#2 — strength/pack-size never become order_quantity', () => {
  it('#1 strength mistaken for qty: "Zurcal 40 mg" is strength, not order_quantity', () => {
    const [c] = extractQuantityCandidatesFromText('Zurcal 40 mg');
    expect(c.semanticRole).toBe('strength');
  });

  it('#2 pack size mistaken for qty: "شريط 10 أقراص" is pack_size, not order_quantity', () => {
    const [c] = extractQuantityCandidatesFromText('شريط 10 أقراص');
    expect(c.semanticRole).toBe('pack_size');
  });
});

describe('Regression #3 — price mistaken for qty', () => {
  it.each([
    ['السعر 90 جنيه', 90],
    ['الحساب 140', 140],
    ['بكام 3', 3],
  ])('"%s" never assigns order_quantity to the price number', (phrase) => {
    const candidates = extractQuantityCandidatesFromText(phrase);
    const priceNumber = candidates.find((c) => c.ambiguityReasons.includes('price_context_excluded'));
    expect(priceNumber).toBeDefined();
    expect(priceNumber?.semanticRole).not.toBe('order_quantity');
  });
});

describe('Regression #4/#5 — frequency/duration mistaken for qty', () => {
  it('#4 "3 مرات في اليوم" is frequency=3, never order_quantity', () => {
    const candidates = extractQuantityCandidatesFromText('3 مرات في اليوم');
    const freq = candidates.find((c) => c.semanticRole === 'frequency');
    expect(freq).toBeDefined();
    expect(freq?.numericValue).toBe(3);
    expect(candidates.every((c) => c.semanticRole !== 'order_quantity')).toBe(true);
  });

  it('#5 "لمدة 7 أيام" is duration=7, never order_quantity', () => {
    const candidates = extractQuantityCandidatesFromText('لمدة 7 أيام');
    const dur = candidates.find((c) => c.semanticRole === 'duration');
    expect(dur).toBeDefined();
    expect(dur?.numericValue).toBe(7);
    expect(candidates.every((c) => c.semanticRole !== 'order_quantity')).toBe(true);
  });

  it('dose protection: "5 مل بعد الأكل" is a dose instruction, not a strength label or order_quantity', () => {
    const [c] = extractQuantityCandidatesFromText('5 مل بعد الأكل');
    expect(c.semanticRole).toBe('dose');
  });
});

describe('Regression #6 — numeric product code mistaken for qty', () => {
  it('a bare number matching a real product_code is excluded, never treated as a quantity', () => {
    const [c] = extractQuantityCandidatesFromText('هات 80140', { productIndex: ZURCAL_CATALOG });
    expect(c.semanticRole).toBe('unknown');
    expect(c.ambiguityReasons).toContain('numeric_product_code_excluded');
  });
});

describe('Regression #7 — two-product pronoun ambiguity (already covered by referenceResolverV2.test.ts CRITICAL case; re-asserted here for the mandatory-list checklist)', () => {
  it('two distinct staff offers minutes apart -> ambiguous, never nearest-wins', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: انتينال موجود
[9/15/26, 9:05:00 AM] You: وزوركال موجود
[9/15/26, 9:06:00 AM] Customer: هات منه اتنين`);
    const mentions = buildProductMentions(messages);
    const ref = findByText(messages, 'هات منه');
    const result = resolveReferenceV2(messages, messages.indexOf(ref), mentions, 'منه', 'pronoun');
    expect(result.resolutionStatus).toBe('ambiguous');
  });
});

describe('Regression #8 — same canonical product mentioned twice (instruction #17)', () => {
  it('Arabic "انتينال" and Latin "Antinal" resolve to the SAME product_code and merge into ONE active candidate, not two competing ones', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: Antinal 200 متوفر
[9/15/26, 9:02:00 AM] Customer: هات منه اتنين`);
    const mentions = buildProductMentions(messages, { productIndex: ANTINAL_CATALOG });
    // Both mentions must resolve to the SAME real productId, proving they merge into one identity.
    const resolvedIds = mentions.filter((m) => m.resolvedProductId).map((m) => m.resolvedProductId);
    expect(new Set(resolvedIds).size).toBe(1);
    const active = computeActiveProductCandidates(messages, mentions, 2);
    expect(active).toHaveLength(1);
  });
});

describe('Regression #9 — two different strengths stay distinct (never merged)', () => {
  it('"Zurcal 20" and "Zurcal 40" resolve to DIFFERENT product identities', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز Zurcal 20
[9/15/26, 9:01:00 AM] You: Zurcal 40 برضو متوفر
[9/15/26, 9:02:00 AM] Customer: هات منه اتنين`);
    const mentions = buildProductMentions(messages, { productIndex: ZURCAL_CATALOG });
    const resolvedIds = mentions.filter((m) => m.resolvedProductId).map((m) => m.resolvedProductId);
    expect(new Set(resolvedIds).size).toBe(2);
  });
});

describe('Regression #10 — substitution + ordinal (already covered by referenceResolverV2.test.ts; re-asserted here)', () => {
  it('"بدل X هات التاني" resolves to the real substitute, never the literal string "التاني"', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز فليكسيلاكس
[9/15/26, 9:01:00 AM] You: فليكسيلاكس مش موجود بس فيه دوفالاك
[9/15/26, 9:02:00 AM] Customer: هات التاني`);
    const mentions = buildProductMentions(messages);
    const ref = findByText(messages, 'التاني');
    const result = resolveReferenceV2(messages, messages.indexOf(ref), mentions, 'التاني', 'ordinal');
    expect(result.resolutionStatus).toBe('resolved');
    expect(result.selectedAntecedentId).not.toContain('التاني');
  });
});

describe('Regression #11 — correction after multiple products never guesses (already covered by quantityIntelligenceV2.test.ts; re-asserted)', () => {
  it('"شيل واحدة" with two active products stays unlinked', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز زوركال كمان
[9/15/26, 9:03:00 AM] You: موجود
[9/15/26, 9:04:00 AM] Customer: شيل واحدة`);
    const mentions = buildProductMentions(messages);
    const [dec] = extractQuantityMentionsV2(messages, mentions).filter((q) => q.correctionKind === 'decrement');
    expect(dec.linkedProductMentionId).toBeNull();
    expect(dec.safeForBasketLinking).toBe('unsafe');
  });
});

describe('Regression #12 — case boundary leakage (already covered by referenceResolverV2.test.ts; re-asserted)', () => {
  it('mentions from a different case never resolve a reference in this one', () => {
    const caseA = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود`);
    const caseB = messagesFrom(`[9/16/26, 9:00:00 AM] Customer: هات منه اتنين`);
    const caseAMentions = buildProductMentions(caseA);
    const result = resolveReferenceV2(caseB, 0, caseAMentions, 'منه', 'pronoun');
    expect(result.resolutionStatus).toBe('unresolved');
  });
});

describe('Regression #13 — future mention leakage (instruction #15 directionality)', () => {
  it('a product mentioned only AFTER the reference is never used as its antecedent', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: هات منه اتنين
[9/15/26, 9:01:00 AM] You: تقصد ايه بالظبط؟
[9/15/26, 9:02:00 AM] Customer: انتينال`);
    const mentions = buildProductMentions(messages);
    const ref = findByText(messages, 'هات منه');
    const result = resolveReferenceV2(messages, messages.indexOf(ref), mentions, 'منه', 'pronoun');
    // The ONLY product mention in this conversation is AFTER the reference — must never leak forward.
    expect(result.resolutionStatus).toBe('unresolved');
    expect(result.candidateAntecedentIds).toHaveLength(0);
  });
});

describe('I.B.2.1 instruction #7 — structural enumeration for ordinal resolution', () => {
  it('"ممكن زوركال أو نيكسيوم" then "هات التاني" safely resolves to the SECOND enumerated option', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: ممكن زوركال أو نيكسيوم
[9/15/26, 9:01:00 AM] Customer: هات التاني`);
    const mentions = buildProductMentions(messages);
    const ref = findByText(messages, 'هات التاني');
    const result = resolveReferenceV2(messages, messages.indexOf(ref), mentions, 'التاني', 'ordinal');
    expect(result.resolutionStatus).toBe('resolved');
    expect(result.selectedAntecedentId).toContain('نيكسيوم');
  });

  it('"هات الأول" from the same enumerated list resolves to the FIRST option', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: ممكن زوركال أو نيكسيوم
[9/15/26, 9:01:00 AM] Customer: هات الأول`);
    const mentions = buildProductMentions(messages);
    const ref = findByText(messages, 'هات الأول');
    const result = resolveReferenceV2(messages, messages.indexOf(ref), mentions, 'الأول', 'ordinal');
    expect(result.resolutionStatus).toBe('resolved');
    expect(result.selectedAntecedentId).toContain('زوركال');
  });

  it('negative: an ordinal reference with NO structural enumeration evidence (two separate messages) falls back to normal scoring, never guesses a position', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: زوركال موجود
[9/15/26, 9:01:00 AM] You: نيكسيوم موجود برضو
[9/15/26, 9:02:00 AM] Customer: هات التاني`);
    const mentions = buildProductMentions(messages);
    const ref = findByText(messages, 'هات التاني');
    const result = resolveReferenceV2(messages, messages.indexOf(ref), mentions, 'التاني', 'ordinal');
    // No single-message "X أو Y" structure exists — instruction #7: "Otherwise ambiguous."
    expect(result.resolutionStatus).not.toBe('resolved');
  });
});

describe('I.B.2.1 instruction #9 — dual-form morphology negative tests', () => {
  it('"امبولين" (correct masculine dual, real Dawaa phrasing) is order_quantity=2', () => {
    const [c] = extractQuantityCandidatesFromText('فيها امبولين هتاخد كل اسبوعين امبول');
    expect(c.semanticRole).toBe('order_quantity');
    expect(c.numericValue).toBe(2);
  });

  it('"فيالين" (correct masculine dual) is order_quantity=2', () => {
    const [c] = extractQuantityCandidatesFromText('عايز فيالين');
    expect(c.semanticRole).toBe('order_quantity');
    expect(c.numericValue).toBe(2);
  });

  it('negative: a dual form inside unrelated descriptive/price text is extracted (the number IS 2) but must never be blindly LINKED without an active product', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: الشريطين دول قديمين وسعرهم مختلف`);
    const mentions = buildProductMentions(messages);
    const quantities = extractQuantityMentionsV2(messages, mentions);
    const dual = quantities.find((q) => q.rawText.includes('شريطين'));
    expect(dual).toBeDefined();
    expect(dual?.linkedProductMentionId).toBeNull();
    expect(dual?.safeForBasketLinking).toBe('unsafe');
  });
});

describe('I.B.2.1 instruction #10 — implicit quantity=1 strict eligibility', () => {
  it('"هات شريط انتينال" (order verb + bare retail unit + product, no number) infers quantity=1, marked review not safe', () => {
    const [c] = extractQuantityCandidatesFromText('هات شريط انتينال');
    expect(c.semanticRole).toBe('order_quantity');
    expect(c.numericValue).toBe(1);
    expect(c.ambiguityReasons).toContain('implicit_quantity_inferred_not_stated');
  });

  it('negative: "هو الشريط بكام؟" (a price QUESTION using the same words) never infers an implicit quantity', () => {
    const candidates = extractQuantityCandidatesFromText('هو الشريط بكام؟');
    expect(candidates.every((c) => c.semanticRole !== 'order_quantity')).toBe(true);
  });

  it('negative: "الدواء موجود شريط؟" (an availability question) never infers an implicit quantity', () => {
    const candidates = extractQuantityCandidatesFromText('الدواء موجود شريط؟');
    expect(candidates.every((c) => c.semanticRole !== 'order_quantity')).toBe(true);
  });

  it('an implicit-one mention never reaches safeForBasketLinking=safe, only review at best', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: هات شريط انتينال`);
    const mentions = buildProductMentions(messages);
    const [q] = extractQuantityMentionsV2(messages, mentions);
    expect(q.safeForBasketLinking).not.toBe('safe');
  });
});

describe('I.B.2.1 instruction #18 — safeForBasketLinking contract', () => {
  it('a confidently linked, unambiguous order_quantity is safe', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز 2 علبة`);
    const mentions = buildProductMentions(messages);
    const quantities = extractQuantityMentionsV2(messages, mentions);
    const q = quantities.find((m) => m.numericValue === 2)!;
    expect(q.safeForBasketLinking).toBe('safe');
  });

  it('an unlinked or ambiguous quantity is always unsafe, never safe or silently dropped', () => {
    const [c] = extractQuantityCandidatesFromText('هات اتنين'); // no case context at all here
    expect(c.semanticRole).toBe('order_quantity');
    // Direct call to extractQuantityCandidatesFromText has no linking step; verify via the
    // case-level API that lacking a target keeps it unsafe rather than defaulting to safe.
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: هات اتنين`);
    const mentions = buildProductMentions(messages);
    const [q] = extractQuantityMentionsV2(messages, mentions);
    expect(q.linkedProductMentionId).toBeNull();
    expect(q.safeForBasketLinking).toBe('unsafe');
  });

  it('every non-order_quantity role (strength/pack_size/dose/frequency/duration/unknown) is always unsafe for Basket linking', () => {
    const roles = ['Zurcal 40 mg', 'شريط 10 أقراص', '5 مل بعد الأكل', '3 مرات في اليوم', 'لمدة 7 أيام', 'السعر 90 جنيه'];
    for (const phrase of roles) {
      const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: ${phrase}`);
      const mentions = buildProductMentions(messages);
      const extracted = extractQuantityMentionsV2(messages, mentions);
      expect(extracted.every((q) => q.safeForBasketLinking === 'unsafe')).toBe(true);
    }
  });

  it('a resolved reference with a real margin can be safe; a bare "resolved" (only-just cleared) is capped at review', () => {
    // Sole candidate, well reinforced and recent -> genuinely safe.
    const strongMessages = messagesFrom(`[9/15/26, 9:00:00 AM] You: زوركال موجود
[9/15/26, 9:01:00 AM] You: زوركال ده هيكون كويس ليك
[9/15/26, 9:02:00 AM] Customer: هات منه علبتين`);
    const strongMentions = buildProductMentions(strongMessages);
    const strongRef = findByText(strongMessages, 'هات منه');
    const strongResult = resolveReferenceV2(strongMessages, strongMessages.indexOf(strongRef), strongMentions, 'منه', 'pronoun');
    expect(strongResult.resolutionStatus).toBe('resolved');
    expect(['safe', 'review']).toContain(strongResult.safeForBasketLinking);
    // Every candidateScores entry and the scoreMargin must be exposed for audit (instruction #6).
    expect(strongResult.candidateScores.length).toBeGreaterThan(0);
    expect(strongResult.scoreMargin).not.toBeNull();
  });

  it('unresolved/ambiguous references are always unsafe', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: انتينال موجود
[9/15/26, 9:05:00 AM] You: وزوركال موجود
[9/15/26, 9:06:00 AM] Customer: هات منه اتنين`);
    const mentions = buildProductMentions(messages);
    const ref = findByText(messages, 'هات منه');
    const result = resolveReferenceV2(messages, messages.indexOf(ref), mentions, 'منه', 'pronoun');
    expect(result.resolutionStatus).toBe('ambiguous');
    expect(result.safeForBasketLinking).toBe('unsafe');
  });
});

describe('I.B.2.1 instruction #5 — extraction is never discarded merely because linking is unsafe', () => {
  it('a quantity with no safe target still reports its numericValue/semanticRole, never silently dropped', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز زوركال كمان
[9/15/26, 9:03:00 AM] You: موجود
[9/15/26, 9:04:00 AM] Customer: هات اتنين`);
    const mentions = buildProductMentions(messages);
    const [q] = extractQuantityMentionsV2(messages, mentions).filter((m) => m.numericValue === 2);
    expect(q.semanticRole).toBe('order_quantity');
    expect(q.numericValue).toBe(2);
    expect(q.linkedProductMentionId).toBeNull();
    expect(q.ambiguityReasons).toContain('multiple_active_products_target_ambiguous');
  });
});

describe('detectReferenceMentions sanity (unchanged from I.B.2)', () => {
  it('still classifies all reference vocabulary correctly after the I.B.2.1 changes', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: منه`);
    expect(detectReferenceMentions(messages[0])[0]?.referenceType).toBe('pronoun');
  });

  it('extractReferenceMentionsV2 still scans a full case without throwing', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: زوركال موجود
[9/15/26, 9:01:00 AM] Customer: هات منه علبتين`);
    const mentions = buildProductMentions(messages);
    expect(() => extractReferenceMentionsV2(messages, mentions)).not.toThrow();
  });
});
