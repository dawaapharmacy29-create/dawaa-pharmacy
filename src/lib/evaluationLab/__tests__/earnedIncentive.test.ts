import { describe, expect, it } from 'vitest';
import { LAB_AXES_BY_VERSION, LAB_CURRENT_VERSION, LAB_PUBLISHED_VERSION } from '../catalog';
import { attendanceCounts, credibleAverage, earnedDoctorAxes, earnedIncentive, hoursFactorFor, isCompleteRequest, type EarnedDoctorInput } from '../earnedIncentive';
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
  it('doctor weights are 28/16/16/12/10/10/8 and sum to 100', () => {
    const doctor = LAB_AXES_BY_VERSION['v6.9'].doctor;
    expect(doctor.filter((a) => a.weight > 0).map((a) => [a.key, a.weight])).toEqual([
      ['followup_requests', 28], ['punctuality', 16], ['conversation_quality', 16], ['complete_requests', 12],
      ['avg_invoice_target', 10], ['invoices_per_day', 10], ['uniform_compliance', 8],
    ]);
    expect(doctor.reduce((s, a) => s + a.weight, 0)).toBe(100);
  });

  it('v7.0 doctor weights are follow-ups 35, conversations 35, requests 15, average invoice 15, and it stays published', () => {
    const doctor = LAB_AXES_BY_VERSION['v7.0'].doctor;
    expect(doctor.filter((a) => a.weight > 0).map((a) => [a.key, a.weight])).toEqual([
      ['followup_requests', 35], ['conversation_quality', 35], ['complete_requests', 15], ['avg_invoice_target', 15],
    ]);
    expect(LAB_CURRENT_VERSION).toBe('v7.1');
    expect(LAB_PUBLISHED_VERSION).toBe('v7.0');
  });

  it('v7.1 doctor weights are follow-ups 30, conversations 25, invoice camera review 15, requests 15, average invoice 15', () => {
    const doctor = LAB_AXES_BY_VERSION['v7.1'].doctor;
    expect(doctor.filter((a) => a.weight > 0).map((a) => [a.key, a.weight])).toEqual([
      ['followup_requests', 30], ['conversation_quality', 25], ['invoice_review', 15], ['complete_requests', 15], ['avg_invoice_target', 15],
    ]);
    expect(doctor.reduce((s, a) => s + a.weight, 0)).toBe(100);
  });
});

describe('v7.1 fair targets and weekly samples', () => {
  it('follow-ups and requests are read against the doctor own targets from the customers in his hours', () => {
    expect(score({ followups: 120, followupTarget: 240 }, 'followup_requests')?.score).toBe(50);
    expect(score({ followups: 120, followupTarget: 0 }, 'followup_requests')?.status).toBe('not_measurable');
    expect(score({ completeRequests: 15, requestsTarget: 30 }, 'complete_requests')?.score).toBe(50);
    // Without a branch target the request target stays 20.
    expect(score({ completeRequests: 10 }, 'complete_requests')?.score).toBe(50);
  });
  it('the average invoice is read against his hours target', () => {
    // 351 of a 351 target is full; the branch's fixed 390 would have given 50.
    expect(score({ invoices: { ...base.invoices, net: 380 * 351 }, avgInvoiceTarget: 351 }, 'avg_invoice_target')?.score).toBe(100);
  });
  it('conversations come from the weekly sample, a chat never uploaded counts 0', () => {
    expect(score({ sampledConversations: { reviewed: 6, missing: 0, average: 80 } }, 'conversation_quality')?.score).toBe(50);
    expect(score({ sampledConversations: { reviewed: 3, missing: 2, average: 90 } }, 'conversation_quality')?.status).toBe('not_measurable');
    expect(score({ sampledConversations: null }, 'conversation_quality')?.status).toBe('not_measurable');
  });
  it('the invoice camera review maps 50 → 0 and 90+ → full, and needs 6 reviews', () => {
    expect(score({ invoiceReview: { reviewed: 6, average: 70 } }, 'invoice_review')?.score).toBe(50);
    expect(score({ invoiceReview: { reviewed: 6, average: 95 } }, 'invoice_review')?.score).toBe(100);
    expect(score({ invoiceReview: { reviewed: 5, average: 95 } }, 'invoice_review')?.status).toBe('not_measurable');
    expect(earnedDoctorAxes(base).some((a) => a.key === 'invoice_review')).toBe(false);
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
  it('v7.0: the branch manager races for the star with the doctors, sharing the follow-up target', () => {
    const withManager: LabEvidence = {
      ...evidence,
      staff: [...evidence.staff, { id: 'm1', name: 'د مدير', role: 'branch_manager', branch: 'فرع شكري' }],
      attendance: [...evidence.attendance, ...dates.map((date) => ({ staffId: 'm1', date, status: 'on_time', approved: true, hasFirstIn: true, scheduled: true, lateMinutes: 0 }))],
      followupRequests: [...(evidence.followupRequests || []), { staffId: 'm1', requests: 400 }],
    };
    const scores = buildCycleScores(withManager, 'v7.0');
    const m1 = scores.find((p) => p.staffId === 'm1')!;
    expect(m1.family).toBe('branch_manager');
    expect(m1.star).toBeDefined();
    // 1000 shared over three people with 20 days each: 400 of a 333 share = 120%.
    expect(m1.star!.parts.followups).toBeCloseTo(120, 5);
    const d1 = scores.find((p) => p.staffId === 'd1')!;
    expect(d1.star!.parts.followups).toBe(150);
    // Average invoice against the branch target (390 of 390); the manager sold nothing here, so the part moves to the rest.
    expect(d1.star!.parts.avgInvoice).toBeCloseTo(100, 5);
    expect(m1.star!.parts.avgInvoice).toBeNull();
    // The doctors' own follow-up item still shares the target among the doctors only.
    expect(scores.find((p) => p.staffId === 'd2')!.axes.find((a) => a.key === 'followup_requests')?.score).toBe(20);
  });
});

describe('owner exceptions scored with the doctors', () => {
  it('an assistant on the exception list is scored as a doctor and races for the star', () => {
    const huda = 'd40cb3d7-9548-46eb-b001-2754ab692e97';
    const dates = Array.from({ length: 20 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);
    const evidence: LabEvidence = {
      staff: [{ id: huda, name: 'د هدي', role: 'مساعد صيدلي', branch: 'فرع الشامي' }, { id: 'a1', name: 'مساعد', role: 'مساعد صيدلي', branch: 'فرع الشامي' }],
      invoices: dates.flatMap((date) => Array.from({ length: 21 }, () => ({ staffId: huda, net: 285, date, coded: true, branch: 'فرع الشامي', deliveryStaffId: null }))),
      reviews: [],
      attendance: dates.map((date) => ({ staffId: huda, date, status: 'on_time', approved: true, hasFirstIn: true, scheduled: true, lateMinutes: 0 })),
      requests: [],
      purchases: [],
      targets: [{ branch: 'فرع الشامي', targetAmount: 20 * 21 * 285 }],
      dormantSources: [],
      cycle: { start: '2026-10-26', endExclusive: '2026-11-26' },
      followupRequests: [{ staffId: huda, requests: 300 }],
      violations: [],
    };
    const scores = buildCycleScores(evidence, 'v7.0');
    const person = scores.find((p) => p.staffId === huda)!;
    expect(person.family).toBe('doctor');
    expect(person.axes.find((a) => a.key === 'avg_invoice_target')?.status).toBe('measured');
    expect(person.star).toBeDefined();
    expect(scores.find((p) => p.staffId === 'a1')?.family).toBe('assistant');
  });
});

describe('v7.1 hours factor and credible average', () => {
  it('pays a few days of work only their share', () => {
    expect(hoursFactorFor(40, 0).factor).toBe(0.21);
    expect(hoursFactorFor(200, 0).factor).toBe(1);
    expect(hoursFactorFor(165, 3).factor).toBe(1);
    const part = earnedIncentive(95, 100, 0, hoursFactorFor(40, 0));
    const full = earnedIncentive(95, 100, 0, hoursFactorFor(200, 0));
    expect(full.total).toBe(3100);
    expect(part.total).toBe(Math.round(2500 * 0.21) + Math.round(600 * 0.21));
  });

  it('pulls a handful of invoices toward the hours average', () => {
    // 15 invoices averaging 700 in hours that average 300 → about 380, not 700.
    expect(Math.round(credibleAverage(15 * 700, 15, 300))).toBe(380);
    // 600 invoices: his own average stays almost as is.
    expect(Math.round(credibleAverage(600 * 420, 600, 300))).toBe(409);
    expect(credibleAverage(1000, 4, null)).toBe(250);
  });
});
