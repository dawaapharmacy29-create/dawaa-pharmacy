import { describe, expect, it } from 'vitest';
import { calculateTargetAchievementBonus } from '@/lib/incentives/targetAchievementBonus';

describe('target achievement bonus', () => {
  it('applies manager tiers at the exact boundaries', () => {
    expect(calculateTargetAchievementBonus(1000, 1000, 'manager').amountEgp).toBe(1000);
    expect(calculateTargetAchievementBonus(900, 1000, 'manager').amountEgp).toBe(750);
    expect(calculateTargetAchievementBonus(899, 1000, 'manager').amountEgp).toBe(0);
  });

  it('applies doctor tiers at the exact boundaries', () => {
    expect(calculateTargetAchievementBonus(1000, 1000, 'doctor').amountEgp).toBe(600);
    expect(calculateTargetAchievementBonus(999, 1000, 'doctor').amountEgp).toBe(450);
    expect(calculateTargetAchievementBonus(899, 1000, 'doctor').amountEgp).toBe(0);
  });

  it('does not invent a bonus when the target is missing', () => {
    const result = calculateTargetAchievementBonus(1000, 0, 'doctor');
    expect(result.amountEgp).toBeNull();
    expect(result.isCalculable).toBe(false);
  });
});
