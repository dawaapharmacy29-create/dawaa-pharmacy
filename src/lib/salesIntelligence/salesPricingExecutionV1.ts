export type PricingExecutionStatus =
  | 'no_discount_observed'
  | 'authorized_offer_match'
  | 'offer_price_mismatch_review'
  | 'discount_needs_review'
  | 'invoice_discount_review'
  | 'insufficient_data';

export interface InvoiceItemPricingObservation {
  quantity: number | null;
  unitPrice: number | null;
  itemDiscountAmount: number | null;
  itemDiscountPercent: number | null;
  grossLineAmount: number | null;
  netLineAmount: number | null;
  invoiceDiscountAmount: number | null;
}

export interface OfferPricingReference {
  id: string;
  title: string | null;
  finalPrice: number | null;
}

export interface PricingExecutionAssessment {
  status: PricingExecutionStatus;
  effectiveUnitPrice: number | null;
  matchedOfferId: string | null;
  matchedOfferTitle: string | null;
  needsHumanReview: boolean;
}

const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function derivePricingExecutionAssessment(
  observation: InvoiceItemPricingObservation,
  offers: OfferPricingReference[]
): PricingExecutionAssessment {
  const quantity = numeric(observation.quantity);
  const unitPrice = numeric(observation.unitPrice);
  const gross = numeric(observation.grossLineAmount) ??
    (quantity != null && unitPrice != null ? quantity * unitPrice : null);
  const itemDiscountAmount = Math.max(0, numeric(observation.itemDiscountAmount) ?? 0);
  const itemDiscountPercent = numeric(observation.itemDiscountPercent);
  const invoiceDiscountAmount = Math.max(0, numeric(observation.invoiceDiscountAmount) ?? 0);
  const net = numeric(observation.netLineAmount);
  const effectiveUnitPrice =
    quantity != null && quantity > 0
      ? (net != null ? net / quantity : gross != null ? (gross - itemDiscountAmount) / quantity : unitPrice)
      : unitPrice;

  const matchingOffer = offers.find((offer) =>
    effectiveUnitPrice != null &&
    numeric(offer.finalPrice) != null &&
    Math.abs(effectiveUnitPrice - Number(offer.finalPrice)) <= 0.5
  );
  if (matchingOffer) {
    return { status: 'authorized_offer_match', effectiveUnitPrice, matchedOfferId: matchingOffer.id, matchedOfferTitle: matchingOffer.title, needsHumanReview: false };
  }

  const itemDiscountObserved = itemDiscountAmount > 0.009 || (itemDiscountPercent != null && itemDiscountPercent > 0.009);
  if (offers.length > 0 && (itemDiscountObserved || effectiveUnitPrice != null)) {
    return { status: 'offer_price_mismatch_review', effectiveUnitPrice, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: true };
  }
  if (itemDiscountObserved) {
    return { status: 'discount_needs_review', effectiveUnitPrice, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: true };
  }
  if (invoiceDiscountAmount > 0.009) {
    return { status: 'invoice_discount_review', effectiveUnitPrice, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: true };
  }
  if (unitPrice != null) {
    return { status: 'no_discount_observed', effectiveUnitPrice, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: false };
  }
  return { status: 'insufficient_data', effectiveUnitPrice: null, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: true };
}
