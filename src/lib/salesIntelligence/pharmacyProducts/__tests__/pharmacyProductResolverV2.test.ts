import { describe, it, expect } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../canonicalProduct';
import { normalizePharmacyText } from '../pharmacyNormalization';
import { buildPharmacyProductIndex, resolveProductMention, CROSS_SCRIPT_SEED } from '../pharmacyProductResolverV2';

function catalogFrom(rows: RawProductRow[]) {
  const counts = countNormalizedNames(rows);
  return rows.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText));
}

const ROWS: RawProductRow[] = [
  { id: 'p-zurcal20', name: 'Zurcal 20 mg 14 tablets', product_code: '67186', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: 100, source: 'catalog_import' },
  { id: 'p-zurcal40', name: 'Zurcal 40 mg 28 tab', product_code: '79311', normalized_name: 'zurcal 40mg 28 tab', category: null, price: 150, source: 'catalog_import' },
  { id: 'p-corega-small', name: 'Corega Cream 20 Gm', product_code: '68697', normalized_name: 'corega cream 20gm', category: null, price: 90, source: 'catalog_import' },
  { id: 'p-corega-large', name: 'corega denture fixative cream 40gm', product_code: '64439', normalized_name: 'corega denture fixative cream 40gm', category: null, price: 130, source: 'catalog_import' },
  { id: 'p-antinal-cap', name: 'ANTINAL 24 CAP', product_code: '56822', normalized_name: 'antinal 24 cap', category: null, price: 60, source: 'catalog_import' },
  { id: 'p-antinal-susp', name: 'ANTINAL SUSP', product_code: '4608', normalized_name: 'antinal susp', category: null, price: 45, source: 'catalog_import' },
  { id: 'p-flexilax', name: 'Flexilax 30 tabs', product_code: '68114', normalized_name: 'flexilax 30 tabs', category: null, price: 55, source: 'catalog_import' },
  { id: 'p-teenderm-sensitive', name: 'ISIS TEEN DERM GEL SENSITIVE 250ML', product_code: '70271', normalized_name: 'isis teen derm gel sensitive 250ml', category: null, price: 420, source: 'catalog_import' },
];

const CATALOG = catalogFrom(ROWS);
const INDEX = buildPharmacyProductIndex(CATALOG);

describe('resolveProductMention — match basis hierarchy', () => {
  it('1. resolves an exact product code with proven confidence', () => {
    const result = resolveProductMention('67186', INDEX);
    expect(result.selected?.product.productId).toBe('p-zurcal20');
    expect(result.selected?.basis).toBe('exact_code');
    expect(result.selected?.confidence).toBe('proven');
  });

  it('3. resolves an exact canonical normalized name with strongly_inferred confidence', () => {
    const result = resolveProductMention('Zurcal 40 mg 28 tab', INDEX);
    expect(result.selected?.product.productId).toBe('p-zurcal40');
    expect(result.selected?.basis).toBe('exact_canonical_name');
    expect(result.selected?.confidence).toBe('strongly_inferred');
  });

  it('4. resolves via an approved alias', () => {
    const approvedAliases = new Map([['فليكس لايكس', 'p-flexilax']]);
    const result = resolveProductMention('فليكس لايكس', INDEX, { approvedAliases });
    expect(result.selected?.product.productId).toBe('p-flexilax');
    expect(result.selected?.basis).toBe('approved_alias');
  });

  it('5. resolves via the cross-script seed table (Arabic -> Latin catalog token)', () => {
    const result = resolveProductMention('عايز فليكسيلاكس', INDEX);
    expect(result.candidates.some((c) => c.product.productId === 'p-flexilax' && c.basis === 'cross_script_equivalent')).toBe(true);
  });

  it('6. strongly resolves a joined brand spelling when the dominant catalog name is uniquely covered', () => {
    const result = resolveProductMention('Isis teenderm gel for sensitive skin', INDEX);
    expect(result.selected?.product.productId).toBe('p-teenderm-sensitive');
    expect(result.selected?.basis).toBe('dominant_name_token_match');
    expect(result.selected?.confidence).toBe('strongly_inferred');
  });

  it('8. reports unresolved for a phrase matching nothing in the catalog', () => {
    const result = resolveProductMention('ActivatedBlackseed spray', INDEX);
    expect(result.selected).toBeNull();
    expect(result.candidates).toHaveLength(0);
    expect(result.reasons.some((r) => r.startsWith('unresolved'))).toBe(true);
  });
});

describe('strength-aware identity (critical rule from the spec)', () => {
  it('never lets "Zurcal 20" resolve to the 40mg SKU', () => {
    const result = resolveProductMention('Zurcal 20', INDEX);
    expect(result.selected?.product.productId).toBe('p-zurcal20');
    expect(result.candidates.map((c) => c.product.productId)).not.toContain('p-zurcal40');
  });

  it('never lets "Zurcal 40" resolve to the 20mg SKU', () => {
    const result = resolveProductMention('Zurcal 40', INDEX);
    expect(result.selected?.product.productId).toBe('p-zurcal40');
    expect(result.candidates.map((c) => c.product.productId)).not.toContain('p-zurcal20');
  });

  it('reports ambiguous (not a guess) when strength is unstated and multiple sizes exist', () => {
    const result = resolveProductMention('كريم كوريغا', INDEX);
    expect(result.selected).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('never lets dosage form collapse capsule and suspension forms of the same brand', () => {
    const capResult = resolveProductMention('انتينال كبسول', INDEX);
    expect(capResult.selected?.product.productId).toBe('p-antinal-cap');
    const suspResult = resolveProductMention('انتينال شراب', INDEX);
    // "شراب" (syrup) isn't an exact form match for "susp" but must never resolve to the capsule SKU.
    expect(suspResult.candidates.map((c) => c.product.productId)).not.toContain('p-antinal-cap');
  });
});

describe('fuzzy-match confidence ceiling (hard rule from the spec)', () => {
  it('never reports a fuzzy-only match as proven or strongly_inferred', () => {
    // A near-miss spelling that shares tokens but isn't an exact/alias/code match.
    const result = resolveProductMention('zurcal20mg tabs', INDEX);
    for (const candidate of result.candidates) {
      if (candidate.basis === 'cautious_fuzzy') {
        expect(candidate.confidence).not.toBe('proven');
        expect(candidate.confidence).not.toBe('strongly_inferred');
      }
    }
  });
});

describe('knownCandidateProductIds restriction', () => {
  it('never returns a candidate outside the provided known-candidate set', () => {
    const result = resolveProductMention('Zurcal', INDEX, { knownCandidateProductIds: ['p-zurcal40'] });
    expect(result.candidates.every((c) => c.product.productId === 'p-zurcal40')).toBe(true);
  });
});

describe('CROSS_SCRIPT_SEED', () => {
  it('is a plain, inspectable map, not hidden logic', () => {
    expect(CROSS_SCRIPT_SEED.get('زوركال')).toBe('zurcal');
    expect(CROSS_SCRIPT_SEED.size).toBeGreaterThan(0);
  });
});
