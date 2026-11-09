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
const build = (input: { facts?: PackFacts; metrics?: PackMetricsInput | null; eligible?: string[] } = {}) =>
  buildDesignPack({
    mode: 'day',
    windows: designPackWindows('day', '2026-11-08'),
    facts: input.facts ?? facts(),
    metrics: input.metrics === undefined ? metrics() : input.metrics,
    eligibleStaffIds: new Set(input.eligible ?? ['s1', 's2']),
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
  it('ranks doctors and gives each their change and share', () => {
    const [first, second] = build().branches[0].doctors;
    expect(first).toMatchObject({ rank: 1, name: 'د اميرة', sales_change_percent: 100, share_of_branch_percent: 66.7, list_units: 6, review_average: 90 });
    expect(second).toMatchObject({ rank: 2, name: 'د عمر', sales_change_percent: null, customer_requests: 3, requests_fulfilled: 1 });
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
  it('gives no follow-up star when no follow-ups exist', () => {
    const result = build().branches[0];
    expect(result.stars.map((s) => s.title)).not.toContain('بطل المتابعات');
    expect(result.notes.join(' ')).toContain('مفيش متابعات');
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
    expect(message).not.toContain('بطل المتابعات');
  });
});
