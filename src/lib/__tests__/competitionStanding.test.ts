import { describe, expect, it } from 'vitest';
import { competitionStanding } from '@/lib/competitionStanding';
import type { PackDoctor } from '@/lib/doctorCompetitionDesignPack';
import { SCORE_WEIGHTS, type ScoreCriterion } from '@/lib/doctorCompetitionScorecard';

const parts = (values: Partial<Record<ScoreCriterion, number | null>>) =>
  ({
    sales: 0,
    daily: 0,
    invoices: 0,
    average: 0,
    list: 0,
    followups: 0,
    requests: 0,
    attendance: 0,
    ...values,
  }) as Record<ScoreCriterion, number | null>;

function doctor(name: string, values: Partial<PackDoctor>): PackDoctor {
  return {
    rank: 0,
    sales_rank: 0,
    staff_id: name,
    name,
    sales: 0,
    invoices: 0,
    average_invoice: 0,
    share_of_branch_percent: 0,
    sales_change_percent: null,
    previous_sales: null,
    selling_days: 10,
    working_days: 10,
    daily_average: 0,
    list_units: 0,
    list_value: 0,
    list_incentive: 0,
    list_products: 0,
    stagnant_units: 0,
    stagnant_value: 0,
    followup_target: null,
    attendance: null,
    commitment_percent: null,
    score_parts: parts({}),
    review_average: null,
    review_count: null,
    customer_requests: 0,
    requests_fulfilled: 0,
    followups_completed: null,
    recovered_customers: null,
    competition_points: 0,
    followup_requests: 0,
    ...values,
  };
}

describe('competitionStanding', () => {
  const leader = doctor('a', {
    competition_points: 80,
    sales: 100000,
    followup_requests: 100,
    score_parts: parts({ sales: 25, followups: 15 }),
  });
  const chaser = doctor('b', {
    competition_points: 70,
    sales: 80000,
    followup_requests: 40,
    score_parts: parts({ sales: 20, followups: 6 }),
  });
  const last = doctor('c', {
    competition_points: 69,
    sales: 10000,
    score_parts: parts({ sales: 2.5 }),
  });
  const branch = [last, chaser, leader];

  it('places the doctor and the gaps around them', () => {
    const standing = competitionStanding(chaser, branch, 10)!;
    expect(standing.rank).toBe(2);
    expect(standing.of).toBe(3);
    expect(standing.ahead).toEqual({ name: 'a', points: 80, gap: 10 });
    expect(standing.behind).toEqual({ name: 'c', points: 69, gap: 1 });
  });

  it('works out how many follow-ups pass the doctor ahead, and per day', () => {
    const standing = competitionStanding(chaser, branch, 10)!;
    const followups = standing.steps.find((step) => step.criterion === 'followups')!;
    // 15 points for 100 requests: 0.15 a request; 9 points of headroom cannot cover a 10.1 gap.
    expect(followups.passesNext).toBe(false);
    expect(followups.points).toBe(9);
    expect(followups.action).toBe(`اعمل ${(60).toLocaleString('ar-EG')} طلب متابعة زيادة`);
    expect(followups.perDay).toBe(`${(6).toLocaleString('ar-EG')} طلب في اليوم`);
  });

  it('puts the moves that alone pass the doctor ahead first', () => {
    const standing = competitionStanding(last, branch, 10)!;
    expect(standing.steps[0].passesNext).toBe(true);
    expect(standing.steps[0].criterion).toBe('sales');
    expect(standing.steps.length).toBeLessThanOrEqual(3);
  });

  it("scales a doctor's points to 100 when a criterion is left out", () => {
    const noAttendance = doctor('d', {
      competition_points: 50,
      sales: 50000,
      score_parts: parts({ sales: 12.5, attendance: null }),
    });
    const standing = competitionStanding(noAttendance, [leader, noAttendance], 0)!;
    const sales = standing.steps.find((step) => step.criterion === 'sales')!;
    // 12.5 of 25 left, scaled by 100/90.
    expect(sales.points).toBeCloseTo(13.9, 1);
    expect(sales.perDay).toBeNull();
    expect(standing.parts.find((part) => part.criterion === 'attendance')?.points).toBeNull();
    expect(standing.parts.reduce((total, part) => total + part.weight, 0)).toBe(
      Object.values(SCORE_WEIGHTS).reduce((total, weight) => total + weight, 0)
    );
  });

  it('shows the leader how to widen the lead', () => {
    const standing = competitionStanding(leader, branch, 10)!;
    expect(standing.rank).toBe(1);
    expect(standing.ahead).toBeNull();
    expect(standing.steps.every((step) => !step.passesNext)).toBe(true);
  });

  it('returns null for a doctor without points', () => {
    expect(
      competitionStanding(doctor('x', { competition_points: null, score_parts: null }), branch, 10)
    ).toBeNull();
  });
});
