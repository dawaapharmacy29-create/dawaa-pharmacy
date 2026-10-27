/** Read-only evidence gate for a future audited product identity decision.
 * A matched invoice is not proof that the customer ordered this product; the
 * decision must still be explicitly made by an authorized reviewer.
 */
export interface IdentityReviewBasketItem {
  itemId: string;
  productNameRaw: string;
  productId: string | null;
  productCode?: string | null;
  quantity: number | null;
  resolutionStatus: string;
}

export interface IdentityReviewInvoiceLine {
  id: string;
  invoiceId: string | null;
  productId: string | null;
  productCode: string | null;
  productName: string;
  quantity: number | null;
  effectiveQuantity: number | null;
}

export type IdentityReviewBlocker =
  | 'invoice_not_confirmed'
  | 'source_not_canonical'
  | 'catalog_identity_missing'
  | 'basket_quantity_missing'
  | 'invoice_line_missing'
  | 'invoice_line_ambiguous'
  | 'product_identity_conflict'
  | 'quantity_conflict';

export interface IdentityReviewReadiness {
  itemId: string;
  blockers: IdentityReviewBlocker[];
  supportingLine: IdentityReviewInvoiceLine | null;
  /** Evidence is ready for a decision, NOT an approval or a persisted override. */
  evidenceReady: boolean;
}

export function assessProductIdentityReview(input: {
  basketItem: IdentityReviewBasketItem;
  invoiceId: string | null;
  invoiceConfirmed: boolean;
  sourceCanonical: boolean;
  invoiceLines: IdentityReviewInvoiceLine[];
}): IdentityReviewReadiness {
  const { basketItem: item, invoiceId, invoiceLines } = input;
  const blockers: IdentityReviewBlocker[] = [];
  if (!input.sourceCanonical) blockers.push('source_not_canonical');
  if (!input.invoiceConfirmed || !invoiceId) blockers.push('invoice_not_confirmed');
  if (!item.productId || !item.productCode) blockers.push('catalog_identity_missing');
  if (item.quantity == null || !Number.isFinite(item.quantity) || item.quantity <= 0) blockers.push('basket_quantity_missing');

  // Never read invoice lines from a different invoice or a stale candidate.
  const sameInvoice = invoiceId ? invoiceLines.filter((line) => line.invoiceId === invoiceId) : [];
  const matching = sameInvoice.filter((line) =>
    (item.productId && line.productId === item.productId) ||
    (item.productCode && line.productCode === item.productCode)
  );
  if (!matching.length) blockers.push('invoice_line_missing');
  if (matching.length > 1) blockers.push('invoice_line_ambiguous');
  const line = matching.length === 1 ? matching[0] : null;
  if (line && (
    (item.productId && line.productId && item.productId !== line.productId) ||
    (item.productCode && line.productCode && item.productCode !== line.productCode) ||
    !line.productId || !line.productCode
  )) blockers.push('product_identity_conflict');
  if (line && (line.effectiveQuantity == null || !Number.isFinite(line.effectiveQuantity) ||
    line.effectiveQuantity !== item.quantity)) blockers.push('quantity_conflict');

  return { itemId: item.itemId, blockers, supportingLine: line, evidenceReady: blockers.length === 0 };
}

export const identityReviewBlockerLabels: Record<IdentityReviewBlocker, string> = {
  invoice_not_confirmed: 'رابط الفاتورة غير معتمد لهذه الحالة',
  source_not_canonical: 'المحادثة ليست المصدر القياسي الحالي',
  catalog_identity_missing: 'هوية الصنف أو كوده غير محددين',
  basket_quantity_missing: 'كمية الطلب غير محددة أو غير صحيحة',
  invoice_line_missing: 'لا يوجد سطر صنف مطابق في الفاتورة المعتمدة',
  invoice_line_ambiguous: 'يوجد أكثر من سطر محتمل لنفس الصنف',
  product_identity_conflict: 'كود الصنف أو هويته يتعارضان مع الفاتورة',
  quantity_conflict: 'كمية الفاتورة الصافية تختلف عن كمية الطلب',
};
