import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: false }));

import {
  buildBranchMessage,
  buildDesignPack,
  designPackWindows,
  type PackFacts,
  type PackMetricsInput,
} from '../doctorCompetitionDesignPack';
import type { DoctorCompetitionScore } from '../doctorCompetitionMetrics';
import type { ScorecardFacts } from '../doctorCompetitionScorecard';

const branch = 'فرع شكري';
const facts = (over: Partial<PackFacts> = {}): PackFacts => ({
  sales: [
    { day: '2026-11-08', branch, seller: 'د اميرة', staff_id: 's1', sales: 2000, invoices: 4 },
    { day: '2026-11-08', branch, seller: 'د عمر', staff_id: 's2', sales: 1000, invoices: 5 },
    { day: '2026-11-07', branch, seller: 'د اميرة', staff_id: 's1', sales: 1000, invoices: 2 },
  ],
  hours: [
    { day: '2026-11-08', branch, hour: 21, invoices: 7 },
    { day: '2026-11-08', branch, hour: 10, invoices: 2 },
    { day: '2026-11-07', branch, hour: 3, invoices: 90 },
  ],
  requests: [{ day: '2026-11-08', branch, staff_id: 's2', name: 'عمر', requests: 3, fulfilled: 1 }],
  last_sale_date: '2026-11-08',
  last_import_at: '2026-11-09T10:00:00Z',
  ...over,
});
const score = (over: Partial<DoctorCompetitionScore>) => over as DoctorCompetitionScore;
const metrics = (over: Partial<PackMetricsInput> = {}): PackMetricsInput => ({
  rows: [score({ name: 'د اميرة', branch, staffId: 's1', listItems: 6, stagnantItems: 2, reviewCount: 4, reviewTotal: 360, completedFollowups: 0, recoveredCustomers: 0, competitionPoints: 80 })],
  reviews: true,
  items: true,
  followups: false,
  ...over,
});
const build = (input: { facts?: PackFacts; metrics?: PackMetricsInput | null; eligible?: string[]; followup?: { staffId: string; branch: string; requests: number }[] | null } = {}) =>
  buildDesignPack({
    mode: 'day',
    windows: designPackWindows('day', '2026-11-08'),
    facts: input.facts ?? facts(),
    metrics: input.metrics === undefined ? metrics() : input.metrics,
    eligibleStaffIds: new Set(input.eligible ?? ['s1', 's2']),
    followupRequests: input.followup === undefined ? [{ staffId: 's2', branch, requests: 40 }, { staffId: 's1', branch, requests: 10 }] : input.followup,
    followupTargets: new Map([[branch, 1200]]),
    branches: [branch],
    generatedAt: '2026-11-09T12:00:00Z',
  });

describe('designPackWindows', () => {
  it('compares a day with the day before and draws seven days', () => {
    expect(designPackWindows('day', '2026-11-08')).toEqual({
      current: { start: '2026-11-08', end: '2026-11-08' },
      previous: { start: '2026-11-07', end: '2026-11-07' },
      series: { start: '2026-11-02', end: '2026-11-08' },
    });
  });
  it('compares a week with the seven days before it', () => {
    expect(designPackWindows('week', '2026-11-08').previous).toEqual({ start: '2026-10-26', end: '2026-11-01' });
  });
  it('compares a running cycle with the same number of days of the last cycle', () => {
    const windows = designPackWindows('cycle', '2026-11-08');
    expect(windows.current).toEqual({ start: '2026-10-26', end: '2026-11-08' });
    expect(windows.previous).toEqual({ start: '2026-09-26', end: '2026-10-09' });
  });
});

describe('buildDesignPack', () => {
  it('totals the branch and compares it with the previous day', () => {
    expect(build().branches[0].totals).toMatchObject({ sales: 3000, invoices: 9, average_invoice: 333.33, sales_change_percent: 200 });
  });
  it('gives each doctor their sales place, change and share', () => {
    const doctors = build().branches[0].doctors;
    const amira = doctors.find((d) => d.name === 'د اميرة');
    const omar = doctors.find((d) => d.name === 'د عمر');
    expect(amira).toMatchObject({ sales_rank: 1, sales_change_percent: 100, share_of_branch_percent: 66.7, list_units: 6, review_average: 90 });
    expect(omar).toMatchObject({ sales_rank: 2, sales_change_percent: null, customer_requests: 3, requests_fulfilled: 1 });
  });
  it('ranks the competition by points, not by sales alone', () => {
    // Omar sells half of Amira but brings four times the follow-up requests and all the customer requests.
    const doctors = build().branches[0].doctors;
    expect(doctors.map((d) => d.name)).toEqual(['د عمر', 'د اميرة']);
    expect(doctors[0].rank).toBe(1);
    expect(doctors[0].score_parts).toMatchObject({ followups: 15, requests: 5, list: null, attendance: null });
  });
  it('takes the peak hour from the chosen period only', () => {
    expect(build().branches[0].peak_hour).toMatchObject({ hour: 21, invoices: 7 });
  });
  it('drops a linked seller who is not an eligible doctor', () => {
    expect(build({ eligible: ['s1'] }).branches[0].doctors.map((d) => d.name)).toEqual(['د اميرة']);
  });
  it('joins invoices of the same seller with and without a link', () => {
    const data = facts({ sales: [
      { day: '2026-11-08', branch, seller: 'د اميرة', staff_id: 's1', sales: 100, invoices: 1 },
      { day: '2026-11-08', branch, seller: 'د اميرة', staff_id: null, sales: 50, invoices: 1 },
    ] });
    expect(build({ facts: data }).branches[0].doctors).toMatchObject([{ sales: 150, invoices: 2 }]);
  });
  it('reports a failed source instead of a zero', () => {
    const result = build({ metrics: null }).branches[0];
    expect(result.doctors[0]).toMatchObject({ list_units: null, review_average: null, followups_completed: null });
    expect(result.stars.map((s) => s.title)).not.toContain('بطل اللستة');
    expect(result.notes.join(' ')).toContain('تعذر تحميل');
  });
  it('crowns the doctor with the most follow-up requests against the branch target', () => {
    const result = build().branches[0];
    expect(result.totals).toMatchObject({ followup_requests: 50, followup_requests_target: 1200 });
    expect(result.stars.find((s) => s.title === 'بطل طلبات المتابعة')).toMatchObject({ name: 'د عمر' });
  });
  it('reports failed follow-up requests instead of a zero', () => {
    const result = build({ followup: null }).branches[0];
    expect(result.totals.followup_requests).toBeNull();
    expect(result.doctors[0].followup_requests).toBeNull();
    expect(result.stars.map((s) => s.title)).not.toContain('بطل طلبات المتابعة');
    expect(result.notes.join(' ')).toContain('طلبات المتابعة');
  });
  it('needs five invoices for the average-invoice star', () => {
    expect(build().branches[0].stars.find((s) => s.title === 'أعلى متوسط فاتورة')?.name).toBe('د عمر');
  });
  it('writes a message with the figures and the day comparison', () => {
    const pack = build();
    const message = buildBranchMessage(pack, pack.branches[0]);
    expect(message).toContain('نجم اليوم');
    expect(message).toContain('د اميرة');
    expect(message).toContain('المقارنة اليومية');
    expect(message).toContain('طلبات المتابعة في اليوم: ٥٠');
    expect(message).not.toContain('من ١٬٢٠٠');
  });
  it('measures follow-up requests against the target in the cycle view only', () => {
    const pack = buildDesignPack({
      mode: 'cycle',
      windows: designPackWindows('cycle', '2026-11-08'),
      facts: facts(),
      metrics: metrics(),
      eligibleStaffIds: new Set(['s1', 's2']),
      followupRequests: [{ staffId: 's1', branch, requests: 10 }],
      followupTargets: new Map([[branch, 1200]]),
      branches: [branch],
      generatedAt: '2026-11-09T12:00:00Z',
    });
    expect(buildBranchMessage(pack, pack.branches[0])).toContain('طلبات المتابعة في الدورة: ١٠ من ١٬٢٠٠');
  });
  it('counts a doctor\'s follow-up requests in their home branch only', () => {
    const other = 'فرع الشامي';
    const sale = (b: string, staff: string, seller: string) => ({ day: '2026-11-08', branch: b, seller, staff_id: staff, sales: 500, invoices: 2 });
    const pack = buildDesignPack({
      mode: 'day',
      windows: designPackWindows('day', '2026-11-08'),
      facts: facts({ sales: [sale(branch, 's1', 'د اميرة'), sale(branch, 's2', 'د عمر'), sale(other, 's2', 'د عمر')] }),
      metrics: metrics(),
      eligibleStaffIds: new Set(['s1', 's2']),
      followupRequests: [{ staffId: 's2', branch: other, requests: 60 }, { staffId: 's1', branch, requests: 10 }],
      followupTargets: new Map(),
      branches: [branch, other],
      generatedAt: '2026-11-09T12:00:00Z',
    });
    const [shokry, shamy] = pack.branches;
    expect(shokry.doctors.find((d) => d.name === 'د عمر')?.followup_requests).toBe(0);
    expect(shamy.doctors.find((d) => d.name === 'د عمر')?.followup_requests).toBe(60);
    // The branch total now equals the sum of its doctors.
    expect(shokry.totals.followup_requests).toBe(10);
    expect(shamy.totals.followup_requests).toBe(60);
  });
  it('shows one name for a doctor typed differently on different invoices', () => {
    const data = facts({ sales: [
      { day: '2026-11-08', branch, seller: 'د دنيا', staff_id: 's1', sales: 900, invoices: 3 },
      { day: '2026-11-07', branch, seller: 'د دنيا الخولي', staff_id: 's1', sales: 100, invoices: 1 },
    ] });
    const result = build({ facts: data }).branches[0];
    expect(result.doctors[0].name).toBe('د دنيا الخولي');
    expect(result.daily.find((day) => day.date === '2026-11-08')?.top_doctor).toBe('د دنيا الخولي');
  });
  it('uses the scorecard facts: list value, day-branch follow-ups, recorded requests and attendance', () => {
    const scorecard: ScorecardFacts = {
      list: [
        { staffId: 's1', branch, listUnits: 24.75, listValue: 287, listIncentive: 116.5, listProducts: 8, stagnantUnits: 0, stagnantValue: 0, stagnantIncentive: 0 },
        { staffId: 's2', branch, listUnits: 6, listValue: 1245, listIncentive: 67, listProducts: 5, stagnantUnits: 0, stagnantValue: 0, stagnantIncentive: 0 },
      ],
      followups: [{ staffId: 's2', branch, requests: 7, days: 1 }],
      requests: [{ staffId: 's1', branch, requests: 2, fulfilled: 1 }, { staffId: 'other', branch, requests: 4, fulfilled: 0 }],
      attendance: [
        { staffId: 's1', shiftDays: 10, onTimeDays: 10, lateDays: 0, lateMinutes: 0, earlyLeaveDays: 0, absenceDays: 0, underReviewDays: 1 },
        { staffId: 's2', shiftDays: 10, onTimeDays: 6, lateDays: 4, lateMinutes: 200, earlyLeaveDays: 0, absenceDays: 0, underReviewDays: 0 },
      ],
    };
    const pack = buildDesignPack({
      mode: 'day',
      windows: designPackWindows('day', '2026-11-08'),
      facts: facts(),
      metrics: metrics(),
      scorecard,
      eligibleStaffIds: new Set(['s1', 's2']),
      followupRequests: [{ staffId: 's2', branch, requests: 999 }],
      followupTargets: new Map(),
      branches: [branch],
      generatedAt: '2026-11-09T12:00:00Z',
    });
    const result = pack.branches[0];
    const amira = result.doctors.find((d) => d.name === 'د اميرة');
    const omar = result.doctors.find((d) => d.name === 'د عمر');
    expect(amira).toMatchObject({ list_value: 287, list_units: 24.75, customer_requests: 2, followup_requests: 0, commitment_percent: 100 });
    expect(omar).toMatchObject({ list_value: 1245, followup_requests: 7, customer_requests: 0, commitment_percent: 80 });
    // The list is won on money, not units; the scorecard replaces the older follow-up and request sources.
    expect(result.stars.find((s) => s.title === 'بطل اللستة')?.name).toBe('د عمر');
    expect(result.stars.find((s) => s.title === 'الأكتر التزامًا بالحضور')?.name).toBe('د اميرة');
    expect(result.totals).toMatchObject({ customer_requests: 6, requests_fulfilled: 1, followup_requests: 7, list_value: 1532, late_days: 4 });
    expect(result.notes.join(' ')).toContain('تحت المراجعة');
    const message = buildBranchMessage(pack, result);
    expect(message).toContain('مبيعات اللستة');
    expect(message).toContain('التزام');
    expect(message).toContain('🧮 النقط');
  });
  it('says so when the scorecard facts are unavailable', () => {
    expect(build().branches[0].notes.join(' ')).toContain('تفاصيل المسابقة الجديدة');
  });
  it('skips the biggest-jump star for a doctor who barely sold last period', () => {
    const data = facts({ sales: [
      { day: '2026-11-08', branch, seller: 'د اميرة', staff_id: 's1', sales: 2000, invoices: 4 },
      { day: '2026-11-07', branch, seller: 'د اميرة', staff_id: 's1', sales: 1900, invoices: 4 },
      { day: '2026-11-08', branch, seller: 'د عمر', staff_id: 's2', sales: 1000, invoices: 5 },
      { day: '2026-11-07', branch, seller: 'د عمر', staff_id: 's2', sales: 50, invoices: 1 },
    ] });
    const result = build({ facts: data }).branches[0];
    expect(result.doctors.find((d) => d.name === 'د عمر')?.sales_change_percent).toBe(1900);
    expect(result.stars.find((s) => s.title === 'أكبر قفزة')?.name).toBe('د اميرة');
  });
});
