import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));

import {
  commitmentRate,
  scoreBranchDoctors,
  SCORE_WEIGHTS,
  type ScoreInput,
} from '../doctorCompetitionScorecard';

const doctor = (over: Partial<ScoreInput>): ScoreInput => ({
  key: 'x',
  sales: 0,
  invoices: 0,
  sellingDays: 0,
  listIncentive: 0,
  followupRequests: 0,
  customerRequests: 0,
  attendance: null,
  ...over,
});
const attendance = (shiftDays: number, lateDays = 0, earlyLeaveDays = 0, absenceDays = 0) => ({
  shiftDays,
  onTimeDays: shiftDays - lateDays,
  lateDays,
  lateMinutes: lateDays * 30,
  earlyLeaveDays,
  absenceDays,
  underReviewDays: 0,
});

describe('scoreBranchDoctors', () => {
  it('weighs to 100', () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((total, weight) => total + weight, 0)).toBe(100);
  });

  it('gives the best doctor on every criterion the full 100', () => {
    const [best, other] = scoreBranchDoctors(
      [
        doctor({
          key: 'a',
          sales: 100000,
          invoices: 300,
          sellingDays: 15,
          listIncentive: 900,
          followupRequests: 80,
          customerRequests: 9,
          attendance: attendance(15),
        }),
        doctor({
          key: 'b',
          sales: 50000,
          invoices: 300,
          sellingDays: 15,
          listIncentive: 300,
          followupRequests: 20,
          customerRequests: 3,
          attendance: attendance(15, 6),
        }),
      ],
      null
    );
    expect(best.total).toBe(100);
    expect(other.total).toBeLessThan(best.total);
  });

  it('leaves out a criterion with no source and scales the rest back to 100', () => {
    const [result] = scoreBranchDoctors(
      [
        doctor({
          key: 'a',
          sales: 10,
          invoices: 40,
          sellingDays: 5,
          listIncentive: null,
          followupRequests: 1,
          customerRequests: 1,
        }),
      ],
      null
    );
    expect(result.parts.list).toBeNull();
    expect(result.parts.attendance).toBeNull();
    expect(result.total).toBe(100);
  });

  it('does not let two big invoices win the average-invoice points', () => {
    const [few, many] = scoreBranchDoctors(
      [
        doctor({ key: 'few', sales: 2000, invoices: 2, sellingDays: 1 }),
        doctor({ key: 'many', sales: 30000, invoices: 100, sellingDays: 10 }),
      ],
      null
    );
    expect(few.parts.average).toBeLessThan(1);
    expect(many.parts.average).toBe(SCORE_WEIGHTS.average);
  });

  it("measures follow-ups against each doctor's share of the branch target by working days", () => {
    const [full, half] = scoreBranchDoctors(
      [
        doctor({ key: 'full', sellingDays: 10, followupRequests: 100 }),
        doctor({ key: 'half', sellingDays: 10, followupRequests: 50 }),
      ],
      200
    );
    expect(full.followupTarget).toBe(100);
    expect(full.parts.followups).toBe(SCORE_WEIGHTS.followups);
    expect(half.parts.followups).toBe(SCORE_WEIGHTS.followups / 2);
  });

  it('uses the larger of approved shifts and selling days for the daily average', () => {
    const [pending, idle] = scoreBranchDoctors(
      [
        // 5 approved shifts, the rest still under review: the 10 selling days count.
        doctor({ key: 'a', sales: 10000, sellingDays: 10, attendance: attendance(5) }),
        // 8 shifts, 4 of them without a sale: the 8 shifts count.
        doctor({ key: 'b', sales: 8000, sellingDays: 4, attendance: attendance(8) }),
      ],
      null
    );
    expect(pending.workingDays).toBe(10);
    expect(pending.dailyAverage).toBe(1000);
    expect(idle.workingDays).toBe(8);
    expect(idle.dailyAverage).toBe(1000);
  });
});

describe('commitmentRate', () => {
  it('counts a late or early-leave day as half and an absence as a whole missed day', () => {
    expect(commitmentRate(attendance(10))).toBe(1);
    expect(commitmentRate(attendance(10, 4))).toBe(0.8);
    expect(commitmentRate(attendance(10, 0, 2))).toBe(0.9);
    expect(commitmentRate(attendance(8, 0, 0, 2))).toBe(0.8);
  });
  it('is unknown without attendance', () => {
    expect(commitmentRate(null)).toBeNull();
    expect(commitmentRate(attendance(0))).toBeNull();
  });
});
