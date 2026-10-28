import { describe, expect, it } from 'vitest';
import { runSalesIntelligencePipeline } from '../salesIntelligencePipeline';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from '../pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from '../pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import type { VerifiedProductIdentityReview } from '../productIdentityReviewClosure';

const catalogRow: RawProductRow = {
  id: 'hero-catalog-id', product_code: '47797', name: 'HERO BABY MILK 2',
  normalized_name: 'hero baby milk 2', category: null, price: 280, source: 'test',
};
const catalog = buildPharmacyProductIndex([
  buildCanonicalProduct(catalogRow, countNormalizedNames([catalogRow]), normalizePharmacyText),
]);
const raw = `[9/27/26, 6:10:00 PM] حنان حمدي: السلام عليكم عايزه علبه لبن هيرو بيبي 2
[9/27/26, 6:11:00 PM] You: تحت أمر حضرتك`;

function run(reviews: VerifiedProductIdentityReview[] = []) {
  return runSalesIntelligencePipeline({
    conversationId: 'source-hero', rawWhatsAppExportText: raw,
    trustedConversationStartedAt: '2026-09-27T15:10:00.000Z',
    customerIdHint: 'customer-7661', customerCodeHint: '7661', customerNameHint: 'حنان حمدي',
    customerIdentityStatus: 'resolved', trustedInvoiceId: 'invoice-74857', trustedInvoiceNumber: '74857',
    productIndex: catalog,
    resolveInvoiceCandidates: () => [{
      id: 'invoice-74857', invoice_number: '74857', customer_id: 'customer-7661',
      customer_code: '7661', invoice_datetime: '2026-09-27T15:18:00.000Z', net_amount: 290,
    }],
    verifiedProductIdentityReviews: reviews,
  }).caseAnalyses[0];
}

describe('case-scoped hero baby product identity manager decision', () => {
  it('preserves invoice sale and staff attribution while resolving only identity review', () => {
    const original = run();
    const active = original.activeBasket
      ? original.itemsByBasketId[original.activeBasket.basketId] ?? []
      : [];
    expect(active.length).toBe(1);
    expect(active[0].resolutionStatus).toBe('partially_proven');
    expect(original.humanReviewReasons).toContain('product_identity_unresolved');
    expect(original.salesOutcome.saleProofState).toBe('proven');
    const review: VerifiedProductIdentityReview = {
      reviewId: 'review-hero-1', sourceId: original.conversationId, caseId: original.caseId,
      basketItemId: active[0].itemId, sourceMessageId: active[0].sourceMessageId,
      rawPhrase: active[0].productNameRaw, catalogProductId: active[0].productId!,
      catalogProductCode: active[0].productCode!, quantity: active[0].quantity!,
      invoiceId: 'invoice-74857', invoiceItemId: 'line-hero-1',
    };
    const approved = run([review]);
    expect(approved.humanReviewReasons).not.toContain('product_identity_unresolved');
    expect(approved.failureReasons).not.toContain('product_identity_unresolved');
    expect(approved.managerProductIdentityReviewIds).toEqual(['review-hero-1']);
    expect(approved.salesOutcome.saleProofState).toBe(original.salesOutcome.saleProofState);
    expect(approved.salesOutcome.isSaleCountable).toBe(original.salesOutcome.isSaleCountable);
    expect(approved.salesOutcome.isRevenueCountable).toBe(original.salesOutcome.isRevenueCountable);
    expect(approved.attribution.isOfficialForStaffEvaluation).toBe(original.attribution.isOfficialForStaffEvaluation);
    expect(approved.caseIntelligence.review.reasons.map((r) => r.code)).not.toContain('product_identity_unresolved');
    const stale = run([{ ...review, invoiceId: 'wrong' }]);
    expect(stale.humanReviewReasons).toContain('product_identity_unresolved');
  });
});
