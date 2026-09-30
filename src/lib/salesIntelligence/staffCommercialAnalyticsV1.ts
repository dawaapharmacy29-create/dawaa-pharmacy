export interface StaffCommercialLineFactV1 {
  invoiceId: string | null;
  invoiceNumber: string;
  staffId: string | null;
  staffName: string | null;
  quantity: number | null;
  grossLineAmount: number | null;
  netLineAmount: number | null;
  itemDiscountAmount: number | null;
  returnedQuantity: number | null;
  pricingStatus: string;
  quotedUnitPrice: number | null;
  quotedPriceStatus: string;
}

export interface StaffCommercialSummaryV1 {
  staffId: string | null;
  staffName: string;
  invoiceCount: number;
  lineCount: number;
  grossSales: number;
  netSales: number;
  discountAmount: number;
  discountedLineCount: number;
  offerExecutedLineCount: number;
  offerPriceReviewLineCount: number;
  discountReviewLineCount: number;
  returnedQuantity: number;
  quotedPriceLineCount: number;
  quotedPriceMatchedLineCount: number;
  quotedPriceMismatchLineCount: number;
  quotedPriceAccuracyPercent: number | null;
}

const numberValue = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function summarizeStaffCommercialPerformanceV1(
  rows: StaffCommercialLineFactV1[]
): StaffCommercialSummaryV1[] {
  const groups = new Map<string, {
    staffId: string | null;
    staffName: string;
    invoiceIds: Set<string>;
    lineCount: number;
    grossSales: number;
    netSales: number;
    discountAmount: number;
    discountedLineCount: number;
    offerExecutedLineCount: number;
    offerPriceReviewLineCount: number;
    discountReviewLineCount: number;
    returnedQuantity: number;
    quotedPriceLineCount: number;
    quotedPriceMatchedLineCount: number;
    quotedPriceMismatchLineCount: number;
  }>();

  for (const row of rows) {
    const staffName = String(row.staffName || 'موظف غير محدد').trim() || 'موظف غير محدد';
    const key = row.staffId ? `id:${row.staffId}` : `name:${staffName}`;
    const current = groups.get(key) ?? {
      staffId: row.staffId,
      staffName,
      invoiceIds: new Set<string>(),
      lineCount: 0,
      grossSales: 0,
      netSales: 0,
      discountAmount: 0,
      discountedLineCount: 0,
      offerExecutedLineCount: 0,
      offerPriceReviewLineCount: 0,
      discountReviewLineCount: 0,
      returnedQuantity: 0,
      quotedPriceLineCount: 0,
      quotedPriceMatchedLineCount: 0,
      quotedPriceMismatchLineCount: 0,
    };

    const invoiceKey = row.invoiceId || row.invoiceNumber;
    if (invoiceKey) current.invoiceIds.add(invoiceKey);
    current.lineCount += 1;
    current.grossSales += numberValue(row.grossLineAmount);
    current.netSales += numberValue(row.netLineAmount);
    current.discountAmount += Math.max(0, numberValue(row.itemDiscountAmount));
    if (numberValue(row.itemDiscountAmount) > 0) current.discountedLineCount += 1;
    current.returnedQuantity += Math.max(0, numberValue(row.returnedQuantity));

    if (row.pricingStatus === 'authorized_offer_match') current.offerExecutedLineCount += 1;
    if (row.pricingStatus === 'offer_price_mismatch_review') current.offerPriceReviewLineCount += 1;
    if (row.pricingStatus === 'discount_needs_review' || row.pricingStatus === 'invoice_discount_review') {
      current.discountReviewLineCount += 1;
    }

    if (row.quotedUnitPrice != null) {
      current.quotedPriceLineCount += 1;
      if (row.quotedPriceStatus === 'exact' || row.quotedPriceStatus === 'near_match') {
        current.quotedPriceMatchedLineCount += 1;
      } else if (row.quotedPriceStatus === 'mismatch_review') {
        current.quotedPriceMismatchLineCount += 1;
      }
    }

    groups.set(key, current);
  }

  return Array.from(groups.values())
    .map((group) => ({
      staffId: group.staffId,
      staffName: group.staffName,
      invoiceCount: group.invoiceIds.size,
      lineCount: group.lineCount,
      grossSales: group.grossSales,
      netSales: group.netSales,
      discountAmount: group.discountAmount,
      discountedLineCount: group.discountedLineCount,
      offerExecutedLineCount: group.offerExecutedLineCount,
      offerPriceReviewLineCount: group.offerPriceReviewLineCount,
      discountReviewLineCount: group.discountReviewLineCount,
      returnedQuantity: group.returnedQuantity,
      quotedPriceLineCount: group.quotedPriceLineCount,
      quotedPriceMatchedLineCount: group.quotedPriceMatchedLineCount,
      quotedPriceMismatchLineCount: group.quotedPriceMismatchLineCount,
      quotedPriceAccuracyPercent: group.quotedPriceLineCount
        ? Math.round((group.quotedPriceMatchedLineCount / group.quotedPriceLineCount) * 100)
        : null,
    }))
    .sort((a, b) => b.netSales - a.netSales || a.staffName.localeCompare(b.staffName, 'ar'));
}
