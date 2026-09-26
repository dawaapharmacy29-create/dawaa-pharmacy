export type PricingExecutionStatus =
  | 'no_discount_observed'
  | 'authorized_offer_match'
  | 'offer_price_mismatch_review'
  | 'discount_needs_review'
  | 'invoice_discount_review'
  | 'insufficient_data';

export interface InvoiceItemPricingObservation {
  quantity: number | null;
  returnedQuantity?: number | null;
  effectiveQuantity?: number | null;
  unitPrice: number | null;
  itemDiscountAmount: number | null;
  itemDiscountPercent: number | null;
  grossLineAmount: number | null;
  netLineAmount: number | null;
  invoiceDiscountAmount: number | null;
  allocatedInvoiceDiscountAmount?: number | null;
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
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function derivePricingExecutionAssessment(
  observation: InvoiceItemPricingObservation,
  offers: OfferPricingReference[]
): PricingExecutionAssessment {
  const quantity = numeric(observation.quantity);
  const returnedQuantity = Math.max(0, numeric(observation.returnedQuantity) ?? 0);
  const effectiveQuantity =
    numeric(observation.effectiveQuantity) ??
    (quantity != null ? Math.max(0, quantity - returnedQuantity) : null);
  const unitPrice = numeric(observation.unitPrice);
  const gross = numeric(observation.grossLineAmount) ??
    (quantity != null && unitPrice != null ? quantity * unitPrice : null);
  const itemDiscountAmount = Math.max(0, numeric(observation.itemDiscountAmount) ?? 0);
  const itemDiscountPercent = numeric(observation.itemDiscountPercent);
  const declaredInvoiceDiscountAmount = Math.max(0, numeric(observation.invoiceDiscountAmount) ?? 0);
  const allocatedInvoiceDiscountAmount = Math.max(
    0,
    numeric(observation.allocatedInvoiceDiscountAmount) ?? 0
  );
  const net = numeric(observation.netLineAmount);
  const effectiveUnitPrice =
    effectiveQuantity != null && effectiveQuantity > 0
      ? (
          net != null
            ? net / effectiveQuantity
            : gross != null && quantity != null && quantity > 0
              ? (gross / quantity)
              : unitPrice
        )
      : effectiveQuantity === 0
        ? null
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
  const actualInvoiceDiscountObserved = allocatedInvoiceDiscountAmount > 0.009;
  if (offers.length > 0 && (itemDiscountObserved || effectiveUnitPrice != null)) {
    return { status: 'offer_price_mismatch_review', effectiveUnitPrice, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: true };
  }
  if (itemDiscountObserved) {
    return { status: 'discount_needs_review', effectiveUnitPrice, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: true };
  }
  if (actualInvoiceDiscountObserved) {
    return { status: 'invoice_discount_review', effectiveUnitPrice, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: true };
  }
  // B-Connect can carry a non-zero declared "خصم قيمة" even when the invoice net proves that
  // no extra discount was actually applied. Do not flag that informational field by itself.
  void declaredInvoiceDiscountAmount;
  if (unitPrice != null) {
    return { status: 'no_discount_observed', effectiveUnitPrice, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: false };
  }
  return { status: 'insufficient_data', effectiveUnitPrice: null, matchedOfferId: null, matchedOfferTitle: null, needsHumanReview: true };
}


export type QuotedPriceMatchStatus =
  | 'exact'
  | 'near_match'
  | 'mismatch_review'
  | 'not_quoted'
  | 'insufficient_data';

export interface QuotedPriceMatchAssessment {
  status: QuotedPriceMatchStatus;
  quotedUnitPrice: number | null;
  actualUnitPrice: number | null;
  absoluteDifference: number | null;
  relativeDifferencePercent: number | null;
  needsHumanReview: boolean;
}

export function compareQuotedAndActualUnitPrice(
  quotedUnitPrice: number | null | undefined,
  actualUnitPrice: number | null | undefined
): QuotedPriceMatchAssessment {
  const quoted = numeric(quotedUnitPrice);
  const actual = numeric(actualUnitPrice);

  if (quoted == null) {
    return {
      status: 'not_quoted',
      quotedUnitPrice: null,
      actualUnitPrice: actual,
      absoluteDifference: null,
      relativeDifferencePercent: null,
      needsHumanReview: false,
    };
  }
  if (actual == null) {
    return {
      status: 'insufficient_data',
      quotedUnitPrice: quoted,
      actualUnitPrice: null,
      absoluteDifference: null,
      relativeDifferencePercent: null,
      needsHumanReview: true,
    };
  }

  const absoluteDifference = Math.abs(actual - quoted);
  const relativeDifferencePercent = quoted === 0 ? null : (absoluteDifference / Math.abs(quoted)) * 100;

  if (absoluteDifference <= 0.5) {
    return {
      status: 'exact',
      quotedUnitPrice: quoted,
      actualUnitPrice: actual,
      absoluteDifference,
      relativeDifferencePercent,
      needsHumanReview: false,
    };
  }

  if (absoluteDifference <= 2 || (relativeDifferencePercent != null && relativeDifferencePercent <= 0.5)) {
    return {
      status: 'near_match',
      quotedUnitPrice: quoted,
      actualUnitPrice: actual,
      absoluteDifference,
      relativeDifferencePercent,
      needsHumanReview: false,
    };
  }

  return {
    status: 'mismatch_review',
    quotedUnitPrice: quoted,
    actualUnitPrice: actual,
    absoluteDifference,
    relativeDifferencePercent,
    needsHumanReview: true,
  };
}
