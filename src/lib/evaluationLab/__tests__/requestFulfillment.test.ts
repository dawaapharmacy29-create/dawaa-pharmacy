import { describe, expect, it } from 'vitest';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '@/lib/salesIntelligence/pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '@/lib/salesIntelligence/pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '@/lib/salesIntelligence/pharmacyProducts/pharmacyProductResolverV2';
import {
  consonantSkeleton, matchRequestFulfillment, splitRequestedProducts, summarizeFulfillment,
  type FulfillmentItem, type FulfillmentRequest,
} from '../requestFulfillment';

const ROWS: RawProductRow[] = [
  { id: 'aug', name: 'AUGMENTIN 1GM TAB', product_code: '1001', normalized_name: 'augmentin 1gm tab', category: null, price: '100', source: 'catalog_import' },
  { id: 'she', name: 'sheport 30 cap', product_code: '1002', normalized_name: 'sheport 30 cap', category: null, price: '100', source: 'catalog_import' },
  { id: 'ora', name: 'oratrypsin 30 caps', product_code: '1003', normalized_name: 'oratrypsin 30 caps', category: null, price: '100', source: 'catalog_import' },
  { id: 'amb', name: 'AMBISOME VIAL', product_code: '1004', normalized_name: 'ambisome vial', category: null, price: '100', source: 'catalog_import' },
  { id: 'amr', name: 'AMBISOM CREAM', product_code: '1005', normalized_name: 'ambisom cream', category: null, price: '100', source: 'catalog_import' },
];
const counts = countNormalizedNames(ROWS);
const index = buildPharmacyProductIndex(ROWS.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText)));

const request = (overrides: Partial<FulfillmentRequest> = {}): FulfillmentRequest => ({
  id: 'r1', customerCode: '17', medicineName: 'اوجمنتين', productCode: null, quantity: 1,
  createdAt: '2026-10-05T10:00:00Z', status: 'new', ...overrides,
});
const item = (productId: string, productName: string, invoiceAt = '2026-10-06T12:00:00Z', overrides: Partial<FulfillmentItem> = {}): FulfillmentItem => ({
  customerCode: '17', invoiceAt, invoiceId: 'i1', productId, productCode: null, productName, quantity: 1, ...overrides,
});
const asOf = new Date('2026-11-05T00:00:00Z');
const one = (req: FulfillmentRequest, items: FulfillmentItem[], at = asOf) => matchRequestFulfillment([req], items, index, at)[0];

describe('request fulfillment', () => {
  it('splits a free-text line naming several products', () => {
    expect(splitRequestedProducts('sheport 30 cap ....... oratrypsin tab')).toEqual(['sheport 30 cap', 'oratrypsin tab']);
    expect(splitRequestedProducts('2 كيدمن وامينوسبيريت اكياس')).toEqual(['2 كيدمن', 'امينوسبيريت اكياس']);
    expect(consonantSkeleton('اوجمنتين')).toBe(consonantSkeleton('AUGMENTIN'));
    expect(consonantSkeleton('امبيزوم')).toBe(consonantSkeleton('AMBISOME'));
  });

  it('an Arabic request matches the Latin product the same customer bought after it', () => {
    expect(one(request(), [item('aug', 'AUGMENTIN 1GM TAB')])).toMatchObject({ state: 'fulfilled', basis: 'transliteration_in_customer_purchases' });
  });

  it('the request product code wins when present', () => {
    expect(one(request({ medicineName: 'أي اسم', productCode: '1001' }), [item('aug', 'AUGMENTIN 1GM TAB')])).toMatchObject({ state: 'fulfilled', basis: 'request_product_code' });
  });

  it('a multi-product line is partial until every product was bought', () => {
    const req = request({ medicineName: 'sheport 30 cap ....... oratrypsin tab' });
    expect(one(req, [item('she', 'sheport 30 cap')]).state).toBe('partial');
    expect(one(req, [item('she', 'sheport 30 cap'), item('ora', 'oratrypsin 30 caps')]).state).toBe('fulfilled');
  });

  it('quantity below the requested amount is partial', () => {
    expect(one(request({ quantity: 3 }), [item('aug', 'AUGMENTIN 1GM TAB', undefined, { quantity: 2 })])).toMatchObject({ state: 'partial', matchedQuantity: 2 });
  });

  it('only the same customer, after the request, within 14 days', () => {
    expect(one(request(), [item('aug', 'AUGMENTIN 1GM TAB', undefined, { customerCode: '99' })]).state).toBe('not_found');
    expect(one(request(), [item('aug', 'AUGMENTIN 1GM TAB', '2026-10-01T10:00:00Z')]).state).toBe('not_found');
    expect(one(request(), [item('aug', 'AUGMENTIN 1GM TAB', '2026-10-25T10:00:00Z')]).state).toBe('not_found');
    // Window still open and nothing yet: not judged.
    expect(one(request(), [], new Date('2026-10-08T00:00:00Z')).state).toBe('window_open');
  });

  it('two bought products with the same sound never guess', () => {
    expect(one(request({ medicineName: 'امبيزوم' }), [item('amb', 'AMBISOME VIAL'), item('amr', 'AMBISOM CREAM')]).state).not.toBe('fulfilled');
  });

  it('requests without a customer or cancelled are not judged; the share counts partial as half', () => {
    const results = matchRequestFulfillment([
      request({ id: 'a' }),
      request({ id: 'b', customerCode: null }),
      request({ id: 'c', status: 'cancelled' }),
      request({ id: 'd', quantity: 2 }),
      request({ id: 'e', customerCode: '55' }),
    ], [item('aug', 'AUGMENTIN 1GM TAB')], index, asOf);
    expect(results.map((r) => r.state)).toEqual(['fulfilled', 'no_customer', 'invalid', 'partial', 'not_found']);
    expect(summarizeFulfillment(results)).toMatchObject({ judged: 3, fulfilled: 1, partial: 1, notFound: 1, noCustomer: 1, share: 0.5 });
  });
});
