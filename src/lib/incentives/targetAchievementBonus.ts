export type TargetBonusRole = 'manager' | 'doctor' | 'not_eligible';

export type TargetAchievementBonus = {
  achievementPercent: number | null;
  amountEgp: number | null;
  tierLabel: string;
  isCalculable: boolean;
};

const AMOUNTS = {
  manager: { full: 1000, near: 750 },
  doctor: { full: 600, near: 450 },
} as const;

/** حافز مستقل عن حافز الأداء، ولا يُحسب إذا لم يوجد تارجت فعلي مسجل. */
export function calculateTargetAchievementBonus(
  salesAmount: number,
  targetAmount: number,
  role: TargetBonusRole
): TargetAchievementBonus {
  if (role === 'not_eligible') {
    return { achievementPercent: null, amountEgp: 0, tierLabel: 'غير مطبق على الوظيفة', isCalculable: false };
  }
  if (!Number.isFinite(targetAmount) || targetAmount <= 0 || !Number.isFinite(salesAmount) || salesAmount < 0) {
    return { achievementPercent: null, amountEgp: null, tierLabel: 'غير قابل للحساب', isCalculable: false };
  }
  const rawAchievementPercent = (salesAmount / targetAmount) * 100;
  const achievementPercent = Math.round(rawAchievementPercent * 100) / 100;
  const amounts = AMOUNTS[role];
  // The financial boundary must use the unrounded ratio: 99.99% is not 100%.
  if (rawAchievementPercent >= 100) {
    return { achievementPercent, amountEgp: amounts.full, tierLabel: 'تحقيق 100% فأكثر', isCalculable: true };
  }
  if (rawAchievementPercent >= 90) {
    return { achievementPercent, amountEgp: amounts.near, tierLabel: 'تحقيق من 90% إلى أقل من 100%', isCalculable: true };
  }
  return { achievementPercent, amountEgp: 0, tierLabel: 'أقل من 90%', isCalculable: true };
}
