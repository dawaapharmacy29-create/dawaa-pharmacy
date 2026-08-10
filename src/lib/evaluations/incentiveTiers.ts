/**
 * نظام شرائح الحافز (Tiered Incentive) — بديل العلاقة الخطية البسيطة.
 * كل شريحة درجة بتقابلها نسبة من سقف الحافز الشهري، مش نسبة الدرجة نفسها.
 * مثال: درجة 92/100 بتاخد 100% من السقف مش 92% منه — تشجيع للتميز فوق حد معيّن،
 * وعقاب أوضح تحت 60 (صفر حافز).
 */
export type IncentiveTier = {
  minScore: number;
  maxScore: number;
  payoutPercent: number;
  label: string;
};

export const INCENTIVE_TIERS: IncentiveTier[] = [
  { minScore: 0, maxScore: 59.99, payoutPercent: 0, label: 'أقل من 60' },
  { minScore: 60, maxScore: 69.99, payoutPercent: 40, label: '60–69' },
  { minScore: 70, maxScore: 79.99, payoutPercent: 70, label: '70–79' },
  { minScore: 80, maxScore: 89.99, payoutPercent: 90, label: '80–89' },
  { minScore: 90, maxScore: 94.99, payoutPercent: 100, label: '90–94' },
  { minScore: 95, maxScore: 100, payoutPercent: 110, label: '95–100' },
];

export function resolveIncentiveTier(score: number): IncentiveTier {
  const clamped = Math.max(0, Math.min(100, score));
  return (
    INCENTIVE_TIERS.find((tier) => clamped >= tier.minScore && clamped <= tier.maxScore) ||
    INCENTIVE_TIERS[0]
  );
}

/**
 * Critical Gates: مخالفات حرجة بتحط سقف على نسبة الحافز حتى لو الدرجة عالية.
 * القيمة المخزّنة هي أقل سقف مسموح — لو فيه أكتر من مخالفة فعّالة، ياخد أقلهم.
 */
export type CriticalGateType =
  | 'unexplained_cash_shortage'
  | 'data_manipulation'
  | 'ignored_serious_complaint'
  | 'unescalated_critical_issue'
  | 'repeated_negligence';

export const CRITICAL_GATE_CAPS: Record<CriticalGateType, { capPercent: number; label: string; blocksFully: boolean }> = {
  unexplained_cash_shortage: { capPercent: 0, label: 'عجز كاش غير مبرر', blocksFully: true },
  data_manipulation: { capPercent: 0, label: 'تلاعب أو حذف/تزوير بيانات', blocksFully: true },
  ignored_serious_complaint: { capPercent: 40, label: 'شكوى جسيمة تم تجاهلها', blocksFully: false },
  unescalated_critical_issue: { capPercent: 60, label: 'مشكلة تشغيلية حرجة بدون تصعيد', blocksFully: false },
  repeated_negligence: { capPercent: 70, label: 'إهمال متكرر', blocksFully: false },
};

export function applyIncentiveGates(basePayoutPercent: number, activeGates: CriticalGateType[]): number {
  if (!activeGates.length) return basePayoutPercent;
  const caps = activeGates.map((gate) => CRITICAL_GATE_CAPS[gate].capPercent);
  return Math.min(basePayoutPercent, ...caps);
}

export function calculateTieredIncentiveValue(
  score: number,
  maxIncentiveEgp: number,
  activeGates: CriticalGateType[] = []
): { tier: IncentiveTier; payoutPercent: number; incentiveValue: number } {
  const tier = resolveIncentiveTier(score);
  const payoutPercent = applyIncentiveGates(tier.payoutPercent, activeGates);
  const incentiveValue = Math.round((maxIncentiveEgp * payoutPercent) / 100);
  return { tier, payoutPercent, incentiveValue };
}
