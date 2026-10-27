import { describe, expect, it } from 'vitest';
import { fetchVerifiedProductIdentityReviews } from '../persistence/productIdentityReviewEvidenceRepository';

const review = {
  id: 'review-1', source_id: 'source-1', source_hash: 'hash-1', case_id: 'case-1', basket_item_id: 'item-1',
  source_message_id: 'message-1', raw_phrase: 'لبن هيرو بيبي 2', catalog_product_id: 'product-1',
  catalog_product_code: '47797', invoice_id: 'invoice-1', invoice_item_id: 'line-1', quantity: 1, decision: 'identity_confirmed', is_current: true,
};
const source = { id: 'source-1', source_hash: 'hash-1', invoice_link_confirmed: true, invoice_link_confirmed_invoice_id: 'invoice-1' };
const line = { id: 'line-1', invoice_id: 'invoice-1', product_id: 'product-1', product_code: '47797', quantity: 1, raw_data: { returned: 0 } };

function fakeClient(overrides: {
  review?: Partial<typeof review>;
  source?: Partial<typeof source>;
  line?: Partial<typeof line>;
  extraLine?: Partial<typeof line>;
} = {}) {
  const rows: Record<string, unknown[]> = {
    whatsapp_product_identity_manager_reviews_v1: [{ ...review, ...overrides.review }],
    whatsapp_review_sources: [{ ...source, ...overrides.source }],
    sales_invoice_items_v21: [
      { ...line, ...overrides.line },
      ...(overrides.extraLine ? [{ ...line, id: 'line-2', ...overrides.extraLine }] : []),
    ],
  };
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() { return this; },
            in() {
              return {
                limit: async () => ({ data: rows[table], error: null }),
                then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows[table], error: null }).then(resolve),
              };
            },
          };
        },
      };
    },
  };
}

describe('server-side product identity decisions are independently revalidated', () => {
  it('returns only an unmodified source+invoice matching proof', async () => {
    const rows = await fetchVerifiedProductIdentityReviews(fakeClient(), ['source-1']);
    expect(rows['source-1']).toHaveLength(1);
    expect(rows['source-1'][0].invoiceItemId).toBe('line-1');
  });
  it.each([
    ['source text changed', { source: { source_hash: 'different-hash' } }],
    ['invoice link revoked', { source: { invoice_link_confirmed: false } }],
    ['invoice changed', { source: { invoice_link_confirmed_invoice_id: 'other-invoice' } }],
    ['line changed invoice', { line: { invoice_id: 'other-invoice' } }],
    ['line changed product', { line: { product_id: 'other-product' } }],
    ['line changed code', { line: { product_code: 'other-code' } }],
    ['quantity returned', { line: { raw_data: { returned: 1 } } }],
    ['line quantity changed', { line: { quantity: 2 } }],
    ['duplicate invoice product imported later', { extraLine: { id: 'line-2' } }],
    ['superseded decision', { review: { is_current: false } }],
    ['unapproved row', { review: { decision: 'rejected' } }],
  ] as const)('discards stale/contradicted decision: %s', async (_label, changes) => {
    expect(await fetchVerifiedProductIdentityReviews(fakeClient(changes), ['source-1'])).toEqual({});
  });
});
