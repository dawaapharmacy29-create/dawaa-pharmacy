import type { IncentiveImpactType } from '@/lib/incentives/incentiveRulesEngine';

export function formatRuleImpact(args: {
  impact_type?: string | null;
  points_delta?: number | null;
  money_delta?: number | null;
}): string {
  const impact = String(args.impact_type || '') as IncentiveImpactType | '';
  const points = Number(args.points_delta ?? 0);
  const money = Number(args.money_delta ?? 0);

  if (
    impact === 'warning_only' ||
    (points === 0 &&
      money === 0 &&
      impact !== 'quarterly_money_deduction' &&
      impact !== 'quarterly_money_reward')
  ) {
    return 'بدون خصم';
  }
  if (impact === 'quarterly_money_reward' || impact === 'quarterly_money_deduction') {
    const value = Math.abs(money || points);
    if (!Number.isFinite(value) || value === 0) return 'بدون خصم';
    const sign = impact === 'quarterly_money_reward' ? '+' : '-';
    return `${sign}${value.toLocaleString('ar-EG')} ج`;
  }
  if (!Number.isFinite(points)) return 'بدون خصم';
  if (points === 0) return 'بدون خصم';
  return points > 0 ? `+${points} نقطة` : `${points} نقطة`;
}
