import { resolveIncentiveTier } from '@/lib/evaluations/incentiveTiers';

// Compliance factor (owner decision 2026-10-31: "الأداء بيكسب، والالتزام شرط").
// Performance sets the incentive tier; compliance only multiplies it. Points come from the violations the
// branch manager records (uniform/appearance 1, PConnect/instructions 2) and from missing punches above the
// agreed allowance (1 point each). Pure: no I/O.

export type ViolationCategory = 'uniform' | 'appearance' | 'pconnect' | 'instructions';

export const VIOLATION_POINTS: Record<ViolationCategory, number> = { uniform: 1, appearance: 1, pconnect: 2, instructions: 2 };

export const VIOLATION_LABELS: Record<ViolationCategory, string> = {
  uniform: 'الزي',
  appearance: 'المظهر',
  pconnect: 'الحساب الشخصي على بي كونكت',
  instructions: 'تجاهل تعليمات الشغل',
};

/** Points → factor. The first point is a warning only. */
export const COMPLIANCE_BANDS: Array<{ maxPoints: number; factor: number }> = [
  { maxPoints: 1, factor: 1 },
  { maxPoints: 3, factor: 0.9 },
  { maxPoints: 5, factor: 0.75 },
  { maxPoints: 7, factor: 0.5 },
  { maxPoints: Number.POSITIVE_INFINITY, factor: 0 },
];

export function complianceFactorFor(points: number) {
  return COMPLIANCE_BANDS.find((band) => points <= band.maxPoints)!.factor;
}

export interface ComplianceResult {
  points: number;
  recordedPoints: number;
  /** Missing punches above the allowance (1 point each). */
  punchOverPoints: number;
  factor: number;
  byCategory: Partial<Record<ViolationCategory, number>>;
  /** Tier payout of the score × factor; null when the score is not computed. */
  tierPayout: number | null;
  payout: number | null;
}

export function personCompliance(
  violations: Array<{ category: ViolationCategory; points: number }>,
  missingPunchDays: number,
  allowance: number,
  total: number | null,
): ComplianceResult {
  const byCategory: Partial<Record<ViolationCategory, number>> = {};
  for (const violation of violations) byCategory[violation.category] = (byCategory[violation.category] || 0) + 1;
  const recordedPoints = violations.reduce((sum, violation) => sum + violation.points, 0);
  const punchOverPoints = Math.max(0, missingPunchDays - allowance);
  const points = recordedPoints + punchOverPoints;
  const factor = complianceFactorFor(points);
  const tierPayout = total === null ? null : resolveIncentiveTier(total).payoutPercent;
  return {
    points, recordedPoints, punchOverPoints, factor, byCategory, tierPayout,
    payout: tierPayout === null ? null : Math.round(tierPayout * factor),
  };
}
