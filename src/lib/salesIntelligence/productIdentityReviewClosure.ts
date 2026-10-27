import type { CaseBasketItem } from './types';

/** Server-validated, immutable manager decision. This is case evidence, never a global alias. */
export interface VerifiedProductIdentityReview {
  reviewId: string;
  sourceId: string;
  caseId: string;
  basketItemId: string;
  sourceMessageId: string;
  rawPhrase: string;
  catalogProductId: string;
  catalogProductCode: string;
  quantity: number;
  invoiceId: string;
  invoiceItemId: string;
}

/** A review closes identity uncertainty only if EVERY currently unresolved active item is covered. */
export function evaluateAuditedProductIdentityClosure(input: {
  sourceId: string;
  caseId: string;
  invoiceId: string | null;
  saleProofState: string;
  activeItems: CaseBasketItem[];
  reviews: VerifiedProductIdentityReview[];
}): { resolved: boolean; reviewIds: string[] } {
  if (input.saleProofState !== 'proven' || !input.invoiceId || !input.activeItems.length) {
    return { resolved: false, reviewIds: [] };
  }
  const unresolved = input.activeItems.filter((item) => item.resolutionStatus !== 'proven' || !item.productId);
  if (!unresolved.length) return { resolved: false, reviewIds: [] };
  const used = new Set<string>();
  const accepted: string[] = [];
  for (const item of unresolved) {
    const matching = input.reviews.filter((review) =>
      review.sourceId === input.sourceId &&
      review.caseId === input.caseId &&
      review.invoiceId === input.invoiceId &&
      review.basketItemId === item.itemId &&
      review.sourceMessageId === item.sourceMessageId &&
      review.rawPhrase === item.productNameRaw &&
      review.catalogProductId === item.productId &&
      review.catalogProductCode === item.productCode &&
      item.quantity !== null && review.quantity === item.quantity &&
      !used.has(review.reviewId)
    );
    if (matching.length !== 1) return { resolved: false, reviewIds: [] };
    used.add(matching[0].reviewId);
    accepted.push(matching[0].reviewId);
  }
  return { resolved: true, reviewIds: accepted.sort() };
}
