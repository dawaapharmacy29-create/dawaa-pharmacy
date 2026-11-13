import { describe, expect, it } from 'vitest';
import { LAB_AXES_BY_VERSION, LAB_CURRENT_VERSION, LAB_PUBLISHED_VERSION } from '../catalog';
import { attendanceCounts, earnedDoctorAxes, earnedIncentive, isCompleteRequest, type EarnedDoctorInput } from '../earnedIncentive';
import { buildCycleScores, type LabEvidence } from '../buildCycleScores';

const base: EarnedDoctorInput = {
  branch: 'فرع شكري', cycleShare: 1, trial: false, workedDays: 20, branchDoctorDays: 100,
  followups: 200, branchFollowupTarget: 1000, completeRequests: 20,
  attendance: { late: 0, early: 0, resolvedDays: 20, minDays: 8 },
  invoices: { count: 380, net: 380 * 390, coded: 380, minInvoices: 30, minDays: 5 },
  reviews: Array.from({ length: 10 }, () => 92), minReviews: 3, violations: 0,
};
const score = (input: Partial<EarnedDoctorInput>, key: string) => earnedDoctorAxes({ ...base, ...input }).find((a) => a.key === key);

describe('v6.9 catalog', () => {
  it('doctor weights are 28/16/16/12/10/10/8 and sum to 100; the dashboard stays on the published version', () => {
    const doctor = LAB_AXES_BY_VERSION['v6.9'].doctor;
    expect(doctor.filter((a) => a.weight > 0).map((a) => [a.key, a.weight])).toEqual([
      ['followup_requests', 28], ['punctuality', 16], ['conversation_quality', 16], ['complete_requests', 12],
      ['avg_invoice_target', 10], ['invoices_per_day', 10], ['uniform_compliance', 8],
    ]);
    expect(doctor.reduce((s, a) => s + a.weight, 0)).toBe(100);
    expect(LAB_CURRENT_VERSION).toBe('v6.9');
    expect(LAB_PUBLISHED_VERSION).toBe('v6.8');
  });
});

describe('earned incentive', () => {
  it('under 60 earns nothing, not even the branch bonus', () => {
    const e = earnedIncentive(59.9, 100, 0);
    expect([e.performance, e.bonus, e.total]).toEqual([0, 0, 0]);
    expect(e.next).toEqual({ min: 60, percent: 40, points: 0.1 });
  });
  it('tier × branch factor, plus the bonus at 60+', () => {
    expect(earnedIncentive(71, 91.7, 0)).toMatchObject({ tierPercent: 65, branchFactor: 0.8, performance: 1300, bonus: 450, total: 1750 });
    expect(earnedIncentive(95, 100, 0)).toMatchObject({ performance: 2500, bonus: 600, total: 3100, next: null });
    expect(earnedIncentive(80, 84, 0)).toMatchObject({ branchFactor: 0.4, performance: 850, bonus: 0 });
  });
  it('unexcused absence cuts the whole incentive', () => {
    expect(earnedIncentive(90, 100, 3)).toMatchObject({ absenceCut: 0.1, performance: 2250, bonus: 540 });
    expect(earnedIncentive(90, 100, 8)).toMatchObject({ absenceCut: 0.6, performance: 1000, bonus: 240 });
  });
  it('no score means no incentive', () => {
    expect(earnedIncentive(null, 100, 0)).toMatchObject({ total: 0, next: null });
  });
});

describe('v6.9 doctor items', () => {
  it('a doctor who meets every target scores 100 on each item', () => {
    for (const axis of earnedDoctorAxes(base)) expect(axis.score).toBe(100);
  });
  it('follow-ups are the doctor\'s share of the branch target by working days', () => {
    expect(score({ followups: 100 }, 'followup_requests')?.score).toBe(50);
    // Half the cycle gone: 100 so far projects to 200 = the full share.
    expect(score({ followups: 100, cycleShare: 0.5 }, 'followup_requests')?.score).toBe(100);
    expect(score({ followups: null }, 'followup_requests')?.status).toBe('not_measurable');
  });
  it('two late days are allowed, each after costs an eighth, ten lose it all', () => {
    expect(score({ attendance: { ...base.attendance, late: 2 } }, 'punctuality')?.score).toBe(100);
    expect(score({ attendance: { ...base.attendance, late: 3, early: 1 } }, 'punctuality')?.score).toBe(75);
    expect(score({ attendance: { ...base.attendance, late: 10 } }, 'punctuality')?.score).toBe(0);
  });
  it('average invoice and invoices per day start at 80% / 70% of the branch target; coding under 95% halves them', () => {
    expect(score({ invoices: { ...base.invoices, net: 380 * 351 } }, 'avg_invoice_target')?.score).toBe(50);
    expect(score({ invoices: { ...base.invoices, count: 323, net: 323 * 390, coded: 323 } }, 'invoices_per_day')?.score).toBe(50);
    expect(score({ invoices: { ...base.invoices, coded: 350 } }, 'avg_invoice_target')?.score).toBe(50);
    expect(score({ branch: 'فرع تاني' }, 'avg_invoice_target')?.status).toBe('not_measurable');
  });
  it('conversations: 90+ full, 80 half; uniform: each violation removes 3 of 8 points', () => {
    expect(score({ reviews: [80, 80, 80] }, 'conversation_quality')?.score).toBe(50);
    expect(score({ violations: 1 }, 'uniform_compliance')?.score).toBe(62.5);
    expect(score({ violations: 3 }, 'uniform_compliance')?.score).toBe(0);
  });
  it('in the trial cycle conversations and uniform are shown, not counted', () => {
    expect(score({ trial: true }, 'conversation_quality')?.status).toBe('not_measurable');
    expect(score({ trial: true }, 'uniform_compliance')?.status).toBe('not_measurable');
  });
  it('complete requests need the customer number and an item, and must not be cancelled', () => {
    expect(isCompleteRequest({ customerPhone: '01012345678', medicineName: 'x' })).toBe(true);
    expect(isCompleteRequest({ customerCode: '1234', productCode: '55' })).toBe(true);
    expect(isCompleteRequest({ medicineName: 'x' })).toBe(false);
    expect(isCompleteRequest({ customerPhone: '01012345678', medicineName: 'x', status: 'cancelled' })).toBe(false);
    expect(score({ completeRequests: 10 }, 'complete_requests')?.score).toBe(50);
  });
  it('only approved attendance days count; pending reviews are never punished', () => {
    const day = (status: string, approved: boolean, late = 0, hasFirstIn = true) => ({ status, approved, late, lateMinutes: late, hasFirstIn, scheduled: true });
    expect(attendanceCounts([
      day('late', true, 30), day('very_late', true, 90), day('on_time', true, 10), day('early_leave_review', true),
      day('early_leave_review', false), day('absence_review', true, 0, false), day('absence_review', false, 0, false),
      day('approved_time_off', true, 0, false),
    ])).toEqual({ late: 2, early: 1, absent: 1 });
  });
});

describe('buildCycleScores v6.9', () => {
  const doctors = ['d1', 'd2'];
  const dates = Array.from({ length: 20 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
  const evidence: LabEvidence = {
    staff: [
      { id: 'd1', name: 'د أ', role: 'صيدلاني', branch: 'فرع شكري' },
      { id: 'd2', name: 'د ب', role: 'صيدلاني', branch: 'فرع شكري' },
    ],
    invoices: doctors.flatMap((id) => dates.flatMap((date) => Array.from({ length: 19 }, () => ({ staffId: id, net: 390, date, coded: true, branch: 'فرع شكري', deliveryStaffId: null })))),
    reviews: [],
    attendance: doctors.flatMap((staffId) => dates.map((date) => ({ staffId, date, status: 'on_time', approved: true, hasFirstIn: true, scheduled: true, lateMinutes: 0 }))),
    requests: [],
    purchases: [],
    targets: [{ branch: 'فرع شكري', targetAmount: 2 * 20 * 19 * 390 }],
    dormantSources: [],
    cycle: { start: '2026-10-26', endExclusive: '2026-11-26' },
    followupRequests: [{ staffId: 'd1', requests: 500 }, { staffId: 'd2', requests: 100 }],
    followupTargets: [{ branch: 'فرع شكري', target: 1000 }],
    violations: [],
  };
  it('scores the earned model and attaches the incentive; the trial cycle drops conversations and uniform', () => {
    const scores = buildCycleScores(evidence, 'v6.9');
    const d1 = scores.find((p) => p.staffId === 'd1')!;
    const d2 = scores.find((p) => p.staffId === 'd2')!;
    expect(d1.axes.find((a) => a.key === 'conversation_quality')?.status).toBe('not_measurable');
    expect(d1.axes.find((a) => a.key === 'uniform_compliance')?.status).toBe('not_measurable');
    // d1: everything met except no complete requests (12 of 76 weight).
    expect(d1.total).toBeCloseTo(84.2, 1);
    expect(d1.earned).toMatchObject({ tierPercent: 85, branchAchievement: 100, branchFactor: 1, bonus: 600 });
    // d2: 100 of a 500 share = 20% of the follow-up item.
    expect(d2.axes.find((a) => a.key === 'followup_requests')?.score).toBe(20);
    expect(d2.earned?.total).toBe(0);
  });
  it('the previous version is unchanged and has no earned incentive', () => {
    expect(buildCycleScores(evidence, 'v6.8').every((p) => p.earned === undefined)).toBe(true);
  });
});
