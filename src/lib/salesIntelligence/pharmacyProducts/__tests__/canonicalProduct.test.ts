import { describe, it, expect } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../canonicalProduct';
import { normalizePharmacyText } from '../pharmacyNormalization';

const ROWS: RawProductRow[] = [
  { id: 'p1', name: 'Zurcal 20 mg 14 tablets', product_code: '67186', normalized_name: 'zurcal 20mg 14 tablets', category: null, price: '100', source: 'catalog_import' },
  { id: 'p2', name: 'مشط خشب', product_code: '54490', normalized_name: 'مشط خشب', category: null, price: '10', source: 'catalog_import' },
  { id: 'p3', name: 'مشط خشب', product_code: '51443', normalized_name: 'مشط خشب', category: null, price: '10', source: 'catalog_import' },
];

describe('buildCanonicalProduct', () => {
  const counts = countNormalizedNames(ROWS);

  it('splits a pure-English name into englishName, leaving arabicName null', () => {
    const product = buildCanonicalProduct(ROWS[0], counts, normalizePharmacyText);
    expect(product.englishName).toBe('Zurcal 20 mg 14 tablets');
    expect(product.arabicName).toBeNull();
  });

  it('splits a pure-Arabic name into arabicName, leaving englishName null', () => {
    const product = buildCanonicalProduct(ROWS[1], counts, normalizePharmacyText);
    expect(product.arabicName).toBe('مشط خشب');
    expect(product.englishName).toBeNull();
  });

  it('extracts strength/dosageForm/packSize from the name, never inventing missing facts', () => {
    const product = buildCanonicalProduct(ROWS[0], counts, normalizePharmacyText);
    expect(product.strengths).toEqual([{ value: 20, unit: 'mg' }]);
    expect(product.dosageForms).toEqual(['tablet']);
    expect(product.category).toBeNull();
    expect(product.manufacturer).toBeNull();
    expect(product.barcode).toBeNull();
  });

  it('flags a normalized-name collision honestly (real catalog has 11 such pairs)', () => {
    const dup = buildCanonicalProduct(ROWS[1], counts, normalizePharmacyText);
    expect(dup.qualityFlags.hasNormalizedNameCollision).toBe(true);
    const unique = buildCanonicalProduct(ROWS[0], counts, normalizePharmacyText);
    expect(unique.qualityFlags.hasNormalizedNameCollision).toBe(false);
  });

  it('flags missing strength/quantity signal honestly', () => {
    const product = buildCanonicalProduct(ROWS[1], counts, normalizePharmacyText);
    expect(product.qualityFlags.missingStrength).toBe(true);
    expect(product.qualityFlags.missingAnyQuantitySignal).toBe(true);
  });
});
