// Canonical Conversion (one definition for the whole app).
//
//   sales conversion = eligible sales cases whose canonical outcome is `sale_proven`
//                      / eligible sales cases whose invoice evidence could be checked
//
// - Unit: one Sales Intelligence case (customer need), counted once by caseId — never messages,
//   never repeat messages for the same request.
// - Eligible: commercial cases only (`sales_opportunity` / `mixed`). Information-only, complaint,
//   follow-up-only and unknown cases are excluded from the denominator.
// - Numerator: Sale Proof only (`outcome === 'sale_proven'`, which itself requires the canonical
//   proof state `proven`). Time-only, conversation-only or statistical invoice evidence never counts.
// - A case whose invoice evidence is unavailable (no resolved customer identity) is reported as
//   pending, not as a failed conversion. With no checkable case the rate is null, never 0.
//
// Legacy screens that show a different ratio (follow-up reply -> purchase, stage acceptance) use
// ratioPercent below so every percentage in the app shares one arithmetic contract.
import type { CanonicalSalesOutcome, CaseType } from './types';

export const CONVERSION_ELIGIBLE_CASE_TYPES: ReadonlySet<CaseType> = new Set<CaseType>(['sales_opportunity', 'mixed']);

export interface ConversionCaseInput {
  caseId: string;
  caseType: CaseType;
  outcome: CanonicalSalesOutcome;
  /** False when invoice evidence could not be checked (e.g. customer identity unresolved). */
  invoiceEvidenceAvailable: boolean;
}

export interface CanonicalSalesConversion {
  eligibleCases: number;
  provenSales: number;
  /** Eligible cases left out of the denominator because their invoice evidence is unavailable. */
  pendingEvidenceCases: number;
  /** Rounded percent, or null when no eligible case had checkable evidence. */
  conversionRatePercent: number | null;
}

/** Percent of numerator over denominator; null when the denominator is 0 (no data is not 0%). */
export function ratioPercent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

/** Wrapper for legacy displays whose output shape is a plain number: same arithmetic, 0 when empty. */
export function ratioPercentOrZero(numerator: number, denominator: number): number {
  return ratioPercent(numerator, denominator) ?? 0;
}

export function deriveCanonicalSalesConversion(cases: ConversionCaseInput[]): CanonicalSalesConversion {
  const byCase = new Map<string, ConversionCaseInput>();
  for (const item of cases) {
    if (!item.caseId) continue;
    const previous = byCase.get(item.caseId);
    // One case, one count. If the same case arrives twice, a proven outcome wins deterministically.
    if (!previous || (previous.outcome !== 'sale_proven' && item.outcome === 'sale_proven')) byCase.set(item.caseId, item);
  }

  let eligibleCases = 0;
  let provenSales = 0;
  let pendingEvidenceCases = 0;
  for (const item of byCase.values()) {
    if (!CONVERSION_ELIGIBLE_CASE_TYPES.has(item.caseType) || item.outcome === 'information_only') continue;
    if (item.outcome === 'sale_proven') {
      eligibleCases += 1;
      provenSales += 1;
    } else if (!item.invoiceEvidenceAvailable) {
      pendingEvidenceCases += 1;
    } else {
      eligibleCases += 1;
    }
  }

  return {
    eligibleCases,
    provenSales,
    pendingEvidenceCases,
    conversionRatePercent: ratioPercent(provenSales, eligibleCases),
  };
}
