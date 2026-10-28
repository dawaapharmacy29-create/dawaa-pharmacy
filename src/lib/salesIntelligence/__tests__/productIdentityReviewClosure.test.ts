import { describe, expect, it } from 'vitest';
import { evaluateAuditedProductIdentityClosure, type VerifiedProductIdentityReview } from '../productIdentityReviewClosure';
import { computeSemanticSourceHash } from '../persistence/hashing';

const item = {
  itemId: 'item-1', basketId: 'basket-1', productNameRaw: 'لبن هيرو بيبي 2',
  productId: 'hero-id', productCode: '47797', canonicalName: 'HERO BABY MILK 2', quantity: 1,
  unit: 'علبة', unitPrice: null, lineTotal: null, sourceMessageId: 'message-1',
  resolutionStatus: 'partially_proven' as const,
  confidence: { level: 'strongly_inferred' as const, score: 0.8, ruleIds: [], evidence: [] },
};
const review: VerifiedProductIdentityReview = {
  reviewId: 'review-1', sourceId: 'source-1', caseId: 'case-1', basketItemId: 'item-1',
  sourceMessageId: 'message-1', rawPhrase: 'لبن هيرو بيبي 2',
  catalogProductId: 'hero-id', catalogProductCode: '47797', quantity: 1,
  invoiceId: 'invoice-74857', invoiceItemId: 'line-1',
};
const base = {
  sourceId: 'source-1', caseId: 'case-1', invoiceId: 'invoice-74857',
  saleProofState: 'proven', activeItems: [item], reviews: [review],
};

describe('audited product identity closure is isolated from sale/employee evaluation', () => {
  it('closes the one unresolved basket item with an exact scoped proof', () => {
    expect(evaluateAuditedProductIdentityClosure(base)).toEqual({ resolved: true, reviewIds: ['review-1'] });
  });
  it.each([
    ['different case', { caseId: 'case-2' }],
    ['different source', { sourceId: 'source-2' }],
    ['different invoice', { invoiceId: 'invoice-other' }],
    ['unproven sale', { saleProofState: 'strongly_supported' }],
    ['no trusted invoice', { invoiceId: null }],
    ['quantity changed', { activeItems: [{ ...item, quantity: 2 }] }],
    ['product changed', { activeItems: [{ ...item, productCode: 'other' }] }],
    ['message changed', { activeItems: [{ ...item, sourceMessageId: 'message-2' }] }],
    ['raw phrase changed', { activeItems: [{ ...item, productNameRaw: 'لبن مختلف' }] }],
    ['catalog id changed', { activeItems: [{ ...item, productId: 'other-id' }] }],
    ['new second unresolved item', { activeItems: [item, { ...item, itemId: 'item-2' }] }],
    ['duplicate conflicting decisions', { reviews: [review, { ...review, reviewId: 'review-2' }] }],
  ] as const)('fails closed: %s', (_label, override) => {
    expect(evaluateAuditedProductIdentityClosure({ ...base, ...override }).resolved).toBe(false);
  });

  it('does not declare an already-proven basket as a manager-reviewed unresolved basket', () => {
    expect(evaluateAuditedProductIdentityClosure({ ...base, activeItems: [{ ...item, resolutionStatus: 'proven' }] }).resolved).toBe(false);
  });

  it('includes accepted review IDs in the persisted semantic hash, order independently', async () => {
    const input = { rawWhatsAppExportText: 'sample', branchIdentityMappingVersion: 'v1' };
    const before = await computeSemanticSourceHash(input);
    const approved = await computeSemanticSourceHash({ ...input, managerProductIdentityReviewIds: ['r2', 'r1'] });
    const replay = await computeSemanticSourceHash({ ...input, managerProductIdentityReviewIds: ['r1', 'r2'] });
    expect(approved).not.toBe(before);
    expect(replay).toBe(approved);
  });
});
