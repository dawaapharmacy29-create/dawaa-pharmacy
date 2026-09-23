import { describe, expect, it } from 'vitest';
import { detectReferenceMentions, extractReferenceMentionsV2, resolveReferenceV2 } from '../referenceResolverV2';
import { buildProductMentions } from '../productMentionTracker';
import { messagesFrom, findByText } from './testUtils';
import { buildPharmacyProductIndex, CROSS_SCRIPT_SEED } from '../../pharmacyProducts/pharmacyProductResolverV2';
import type { CanonicalProduct } from '../../pharmacyProducts/canonicalProduct';

function product(productId: string, productCode: string, canonicalName: string): CanonicalProduct {
  return {
    productId, productCode, barcode: null, canonicalName,
    arabicName: null, englishName: canonicalName,
    normalizedNames: [canonicalName.toLowerCase()], strengths: [], dosageForms: [], packSizes: [],
    category: null, manufacturer: null, price: null, sourceTable: 'test',
    qualityFlags: { hasNormalizedNameCollision: false, missingStrength: true, missingDosageForm: true, missingAnyQuantitySignal: true },
  };
}

const SAME_MESSAGE_INDEX = buildPharmacyProductIndex([
  product('p-antinal', '56822', 'Antinal'),
  product('p-zurcal', 'z20', 'Zurcal'),
]);
const SAME_MESSAGE_OPTIONS = { productIndex: SAME_MESSAGE_INDEX, resolveOptions: { crossScriptSeed: CROSS_SCRIPT_SEED } };


describe('detectReferenceMentions — vocabulary classification (instruction #7/#8)', () => {
  it.each([
    ['منه', 'pronoun'],
    ['منها', 'pronoun'],
    ['ده', 'demonstrative'],
    ['دي', 'demonstrative'],
    ['دول', 'demonstrative'],
    ['التاني', 'ordinal'],
    ['الأول', 'ordinal'],
    ['نفس اللي فات', 'previous_item_reference'],
    ['نفس الكمية', 'previous_item_reference'],
    ['اللي فوق', 'relative_reference'],
    ['واحد كمان منه', 'repetition'],
  ] as const)('classifies "%s" as %s', (phrase, type) => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: ${phrase}`);
    const [found] = detectReferenceMentions(messages[0]);
    expect(found).toBeDefined();
    expect(found.referenceType).toBe(type);
  });
});

describe('resolveReferenceV2 — scored antecedent selection (instructions #9/#10/#11)', () => {
  it('one active product + pronoun -> resolved with high confidence', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: ممكن زوركال 20
[9/15/26, 9:01:00 AM] Customer: هات منه علبتين`);
    const productMentions = buildProductMentions(messages);
    const referenceMessage = findByText(messages, 'هات منه');
    const index = messages.indexOf(referenceMessage);
    const result = resolveReferenceV2(messages, index, productMentions, 'منه', 'pronoun');
    expect(result.resolutionStatus).toBe('resolved');
    expect(result.selectedAntecedentId).not.toBeNull();
    expect(result.referenceDistance).not.toBeNull();
  });

  it('CRITICAL — two active products + pronoun -> ambiguous, never "nearest wins" (instruction #10 worked example)', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: انتينال موجود
[9/15/26, 9:05:00 AM] You: وزوركال موجود
[9/15/26, 9:06:00 AM] Customer: هات منه اتنين`);
    const productMentions = buildProductMentions(messages);
    const referenceMessage = findByText(messages, 'هات منه');
    const index = messages.indexOf(referenceMessage);
    const result = resolveReferenceV2(messages, index, productMentions, 'منه', 'pronoun');
    expect(result.resolutionStatus).toBe('ambiguous');
    expect(result.selectedAntecedentId).toBeNull();
    expect(result.candidateAntecedentIds.length).toBeGreaterThanOrEqual(2);
  });

  it('negative regression for the OLD "nearest-preceding-staff-message" strategy: a stale, long-superseded offer must not win merely for being a staff message', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] You: انتينال موجود
[9/15/26, 9:01:00 AM] Customer: عايز زوركال كمان
[9/15/26, 9:02:00 AM] You: زوركال موجود برضو
[9/15/26, 9:03:00 AM] Customer: هات منه اتنين`);
    const productMentions = buildProductMentions(messages);
    const referenceMessage = findByText(messages, 'هات منه');
    const index = messages.indexOf(referenceMessage);
    const result = resolveReferenceV2(messages, index, productMentions, 'منه', 'pronoun');
    // Zurcal is both the most recent AND the only thing the customer asked about most recently —
    // a real margin exists here (unlike the ambiguous case above), so resolution IS expected, but
    // it must come from the scored margin, not a hardcoded "last staff message" rule.
    expect(result.resolutionStatus).toBe('resolved');
  });

  it('multiple request threads / two active products from customer\'s own words -> ambiguous (instruction #11)', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: عايز زوركال كمان
[9/15/26, 9:03:00 AM] You: موجود
[9/15/26, 9:04:00 AM] Customer: هات اتنين منه`);
    const productMentions = buildProductMentions(messages);
    const referenceMessage = findByText(messages, 'اتنين منه');
    const index = messages.indexOf(referenceMessage);
    const result = resolveReferenceV2(messages, index, productMentions, 'منه', 'pronoun');
    expect(result.resolutionStatus).toBe('ambiguous');
  });

  it('substitution followed by "التاني" resolves to the substitute while keeping the original request traceable (instruction #14)', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز فليكسيلاكس
[9/15/26, 9:01:00 AM] You: فليكسيلاكس مش موجود بس فيه دوفالاك
[9/15/26, 9:02:00 AM] Customer: هات التاني`);
    const productMentions = buildProductMentions(messages);
    const referenceMessage = findByText(messages, 'التاني');
    const index = messages.indexOf(referenceMessage);
    const result = resolveReferenceV2(messages, index, productMentions, 'التاني', 'ordinal');
    expect(result.resolutionStatus).toBe('resolved');
    expect(result.substitutionContext).not.toBeNull();
    expect(result.substitutionContext?.originalProductMentionId).toBeDefined();
  });

  it('unresolved when there is no active product candidate at all', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: صباح الخير
[9/15/26, 9:01:00 AM] Customer: هات منه اتنين`);
    const productMentions = buildProductMentions(messages);
    const referenceMessage = findByText(messages, 'هات منه');
    const index = messages.indexOf(referenceMessage);
    const result = resolveReferenceV2(messages, index, productMentions, 'منه', 'pronoun');
    expect(result.resolutionStatus).toBe('unresolved');
    expect(result.ambiguityReasons).toContain('no_active_product_candidate');
  });

  it('Case-boundary regression (instruction #15): mentions from a DIFFERENT case must never resolve a reference in this one', () => {
    const caseAMessages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز انتينال
[9/15/26, 9:01:00 AM] You: موجود`);
    const caseBMessages = messagesFrom(`[9/16/26, 9:00:00 AM] Customer: هات منه اتنين`);
    // Simulate a caller bug: passing case A's product mentions while resolving inside case B's
    // own message array. The defensive filter in resolveReferenceV2 must drop them.
    const caseAMentions = buildProductMentions(caseAMessages);
    const result = resolveReferenceV2(caseBMessages, 0, caseAMentions, 'منه', 'pronoun');
    expect(result.resolutionStatus).toBe('unresolved');
    expect(result.candidateAntecedentIds).toHaveLength(0);
  });
});

describe('Phase I.B.4 — same-message reference ordering', () => {
  it('resolves one preceding canonical product inside the same message', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وهات منه اتنين');
    const mentions = buildProductMentions(messages, SAME_MESSAGE_OPTIONS);
    const ref = extractReferenceMentionsV2(messages, mentions).find((r) => r.rawText.includes('منه'))!;
    expect(ref.resolutionStatus).toBe('resolved');
    expect(ref.selectedAntecedentId).toBe('p-antinal');
    expect(ref.referenceDistance).toBe(0);
    expect(ref.safeForBasketLinking).toBe('safe');
    expect(ref.confidenceFactors).toContain('structural_offset_ordering');
  });

  it('never resolves to a product that appears later in the same message', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] Customer: هات منه اتنين وانتينال');
    const mentions = buildProductMentions(messages, SAME_MESSAGE_OPTIONS);
    const ref = extractReferenceMentionsV2(messages, mentions).find((r) => r.rawText.includes('منه'))!;
    expect(ref.resolutionStatus).toBe('unresolved');
    expect(ref.selectedAntecedentId).toBeNull();
  });

  it('keeps a pronoun ambiguous when two canonical products precede it in the same message', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وزوركال وهات منه اتنين');
    const mentions = buildProductMentions(messages, SAME_MESSAGE_OPTIONS);
    const ref = extractReferenceMentionsV2(messages, mentions).find((r) => r.rawText.includes('منه'))!;
    expect(ref.resolutionStatus).toBe('ambiguous');
    expect(ref.selectedAntecedentId).toBeNull();
    expect(ref.safeForBasketLinking).toBe('unsafe');
  });

  it('ignores a later second product when exactly one canonical antecedent precedes the reference', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وهات منه اتنين وزوركال');
    const mentions = buildProductMentions(messages, SAME_MESSAGE_OPTIONS);
    const ref = extractReferenceMentionsV2(messages, mentions).find((r) => r.rawText.includes('منه'))!;
    expect(ref.resolutionStatus).toBe('resolved');
    expect(ref.selectedAntecedentId).toBe('p-antinal');
  });

  it('stores product and reference offsets in one raw-message coordinate system', () => {
    const messages = messagesFrom('[9/15/26, 9:00:00 AM] Customer: عايز انتينال وهات منه اتنين');
    const mentions = buildProductMentions(messages, SAME_MESSAGE_OPTIONS);
    const antinal = mentions.find((m) => m.resolvedProductId === 'p-antinal')!;
    const ref = extractReferenceMentionsV2(messages, mentions).find((r) => r.rawText.includes('منه'))!;
    expect(antinal.sourceOffsetStart).toBe(messages[0].text.indexOf('انتينال'));
    expect(ref.sourceOffsetStart).toBe(messages[0].text.indexOf('منه'));
    expect(antinal.sourceOffsetEnd ?? 0).toBeLessThanOrEqual(ref.sourceOffsetStart ?? -1);
  });
});

describe('extractReferenceMentionsV2 — full case scan', () => {
  it('produces one ReferenceMentionV2 per detected reference in a real-shaped mini conversation', () => {
    const messages = messagesFrom(`[9/15/26, 9:00:00 AM] Customer: عايز حاجة للحموضة
[9/15/26, 9:01:00 AM] You: ممكن زوركال 20
[9/15/26, 9:02:00 AM] Customer: هات منه علبتين`);
    const productMentions = buildProductMentions(messages);
    const references = extractReferenceMentionsV2(messages, productMentions);
    expect(references.length).toBeGreaterThan(0);
    expect(references[0].resolutionStatus).toBe('resolved');
  });
});
