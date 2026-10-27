import { describe, expect, it } from 'vitest';
import { assessProductIdentityReview } from '../productIdentityReviewReadiness';

const item = { itemId: 'basket-1', productNameRaw: 'لبن هيرو بيبي 2', productId: 'catalog-47797', productCode: '47797', quantity: 1, resolutionStatus: 'partially_proven' };
const line = { id: 'line-1', invoiceId: 'invoice-74857', productId: 'catalog-47797', productCode: '47797', productName: 'HERO BABY MILK 2', quantity: 1, effectiveQuantity: 1 };
const good = { basketItem: item, invoiceId: 'invoice-74857', invoiceConfirmed: true, sourceCanonical: true, invoiceLines: [line] };

describe('product identity human review evidence gate', () => {
  it('reports matching cross-script evidence without pretending the product was approved', () => {
    expect(assessProductIdentityReview(good)).toEqual({ itemId: 'basket-1', blockers: [], supportingLine: line, evidenceReady: true });
  });
  it('fails closed before invoice confirmation', () => {
    expect(assessProductIdentityReview({ ...good, invoiceConfirmed: false }).blockers).toContain('invoice_not_confirmed');
  });
  it('rejects noncanonical snapshots', () => {
    expect(assessProductIdentityReview({ ...good, sourceCanonical: false }).blockers).toContain('source_not_canonical');
  });
  it('cannot borrow a line from another invoice', () => {
    expect(assessProductIdentityReview({ ...good, invoiceId: 'different' }).blockers).toContain('invoice_line_missing');
  });
  it('rejects mismatched product id even when its code matches', () => {
    expect(assessProductIdentityReview({ ...good, invoiceLines: [{ ...line, productId: 'another-id' }] }).blockers).toContain('product_identity_conflict');
  });
  it('rejects mismatched product code even when id matches', () => {
    expect(assessProductIdentityReview({ ...good, invoiceLines: [{ ...line, productCode: 'wrong' }] }).blockers).toContain('product_identity_conflict');
  });
  it('rejects unknown and mismatched quantities', () => {
    expect(assessProductIdentityReview({ ...good, basketItem: { ...item, quantity: null } }).blockers).toContain('basket_quantity_missing');
    expect(assessProductIdentityReview({ ...good, invoiceLines: [{ ...line, effectiveQuantity: 2 }] }).blockers).toContain('quantity_conflict');
  });
  it('rejects repeated invoice lines even if both match', () => {
    expect(assessProductIdentityReview({ ...good, invoiceLines: [line, { ...line, id: 'line-2' }] }).blockers).toContain('invoice_line_ambiguous');
  });
  it('does not accept missing catalog identifiers', () => {
    expect(assessProductIdentityReview({ ...good, basketItem: { ...item, productId: null } }).blockers).toContain('catalog_identity_missing');
    expect(assessProductIdentityReview({ ...good, invoiceLines: [{ ...line, productId: null }] }).blockers).toContain('product_identity_conflict');
  });
});
