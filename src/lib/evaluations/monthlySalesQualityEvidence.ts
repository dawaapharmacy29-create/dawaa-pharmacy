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

export type SalesQualityEvidenceSufficiency = {
  status: 'sufficient' | 'insufficient';
  sufficient: boolean;
  reasons: string[];
};

export function getSalesQualityEvidenceSufficiency(
  input: Pick<SalesQualityStrengthEvidenceInput, 'salesQuality'>
): SalesQualityEvidenceSufficiency {
  const salesQuality = input.salesQuality;
  const reasons: string[] = [];

  if (!salesQuality) {
    reasons.push('sales_quality_not_measured');
  } else if (salesQuality.samples < SALES_QUALITY_STRENGTH_MIN_SAMPLES) {
    reasons.push('insufficient_sales_quality_samples');
  }

  return {
    status: reasons.length ? 'insufficient' : 'sufficient',
    sufficient: reasons.length === 0,
    reasons,
  };
}

/**
 * Manager stars are not sales evidence by themselves.
 * Automatic sales-quality strengths require sufficient repeated conversation evidence
 * and no documented sales, invoice, or alternative-handling failures.
 */
export function hasStrongSalesQualityEvidence(input: SalesQualityStrengthEvidenceInput) {
  const sufficiency = getSalesQualityEvidenceSufficiency(input);
  if (!sufficiency.sufficient || !input.salesQuality) return false;
  if (Number(input.missedSales || 0) > 0) return false;
  if (Number(input.invoiceErrors || 0) > 0) return false;
  if (Number(input.badAlternativeCases || 0) > 0) return false;

  return input.salesQuality.average >= SALES_QUALITY_STRENGTH_MIN_AVERAGE;
}
