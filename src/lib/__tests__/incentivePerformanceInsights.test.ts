import { describe, expect, it } from 'vitest';
import {
  buildPerformanceInsights,
  compareHistory,
  type IncentiveHistoryPoint,
} from '@/lib/incentives/incentivePerformanceInsights';

const point = (overrides: Partial<IncentiveHistoryPoint> = {}): IncentiveHistoryPoint => ({
  id: '1',
  cycleId: 'c1',
  staffId: 's1',
  staffName: 'د/ أحمد',
  branch: 'شكري',
  role: 'pharmacist',
  performanceScore: 80,
  approvedWeeks: 3,
  dataCoveragePercent: 90,
  performanceIncentive: 1000,
  targetAmount: 100000,
  salesAmount: 95000,
  targetAchievementPercent: 95,
  targetBonus: 450,
  otherIncentives: 0,
  deductions: 0,
  totalIncentive: 1450,
  eligible: true,
  eligibilityReasons: [],
  sourceSnapshot: {},
  cycleStart: '2026-07-26',
  cycleEnd: '2026-08-25',
  cycleStatus: 'approved',
  ...overrides,
});

describe('incentive performance insights', () => {
  it('compares the current cycle without rounding away meaningful differences', () => {
    expect(
      compareHistory([
        point(),
        point({ performanceScore: 85, dataCoveragePercent: 95, salesAmount: 90000 }),
      ])
    ).toMatchObject({ score: -5, coverage: -5, sales: 5000 });
  });

  it('reports missing coverage instead of treating it as zero performance', () => {
    const insights = buildPerformanceInsights([point({ dataCoveragePercent: null })]);
    expect(insights.some((item) => item.title === 'مصادر الأداء غير مكتملة')).toBe(true);
    expect(insights.some((item) => item.detail.includes('0%'))).toBe(false);
  });

  it('detects incomplete weeks, low coverage and score regression', () => {
    const insights = buildPerformanceInsights([
      point({ approvedWeeks: 2, dataCoveragePercent: 75, performanceScore: 70 }),
      point({ performanceScore: 80 }),
    ]);
    expect(insights.map((item) => item.title)).toEqual(
      expect.arrayContaining([
        'التقييم الأسبوعي غير مكتمل',
        'تغطية البيانات أقل من الحد',
        'تراجع ملحوظ في الأداء',
      ])
    );
  });
});
