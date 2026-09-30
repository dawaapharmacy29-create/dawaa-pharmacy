export const SALES_QUALITY_STRENGTH_MIN_AVERAGE = 8.5;
export const SALES_QUALITY_STRENGTH_MIN_SAMPLES = 3;

type SalesQualityEvidenceDimension = {
  average: number;
  samples: number;
} | null | undefined;

export type SalesQualityStrengthEvidenceInput = {
  salesQuality: SalesQualityEvidenceDimension;
  missedSales?: number | null;
  invoiceErrors?: number | null;
  badAlternativeCases?: number | null;
};

/**
 * Manager stars are not sales evidence by themselves.
 * Automatic sales-quality strengths require repeated strong conversation evidence
 * and no documented sales, invoice, or alternative-handling failures.
 */
export function hasStrongSalesQualityEvidence(input: SalesQualityStrengthEvidenceInput) {
  const salesQuality = input.salesQuality;

  if (!salesQuality) return false;
  if (Number(input.missedSales || 0) > 0) return false;
  if (Number(input.invoiceErrors || 0) > 0) return false;
  if (Number(input.badAlternativeCases || 0) > 0) return false;

  return (
    salesQuality.samples >= SALES_QUALITY_STRENGTH_MIN_SAMPLES
    && salesQuality.average >= SALES_QUALITY_STRENGTH_MIN_AVERAGE
  );
}
