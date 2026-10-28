import { describe, expect, it } from 'vitest';
import { aggregate, deviationScore, disciplineScore, notMeasurable, measured, percentileAmong, shrunkMean, targetScore } from '../scoring';
import { buildCycleScores, type LabEvidence } from '../buildCycleScores';
import { closedCycles } from '../loadCycleEvidence';

const days = (staffId: string, n: number, status = 'on_time', late = 0) =>
  Array.from({ length: n }, (_, i) => ({ staffId, date: `2026-10-${String(i + 1).padStart(2, '0')}`, status, hasFirstIn: true, lateMinutes: late }));
const invoices = (staffId: string, n: number, net: number, coded = n) =>
  Array.from({ length: n }, (_, i) => ({ staffId, net, coded: i < coded, branch: 'فرع شكري', deliveryStaffId: null }));

function evidence(overrides: Partial<LabEvidence> = {}): LabEvidence {
  return {
    staff: [
      { id: 'd1', name: 'د أ', role: 'صيدلاني', branch: 'فرع شكري' },
      { id: 'd2', name: 'د ب', role: 'pharmacist', branch: 'فرع شكري' },
      { id: 'd3', name: 'د ج', role: 'صيدلاني', branch: 'فرع شكري' },
      { id: 'd4', name: 'د جديد', role: 'صيدلاني', branch: 'فرع شكري' },
      { id: 'm1', name: 'مدير', role: 'مدير فرع', branch: 'فرع شكري' },
      { id: 'h1', name: 'مديرة الفروع', role: 'مديرة الفروع', branch: 'كل الفروع' },
      { id: 'c1', name: 'دليفري', role: 'توصيل', branch: 'فرع شكري' },
    ],
    invoices: [...invoices('d1', 100, 500), ...invoices('d2', 100, 300, 90), ...invoices('d3', 60, 400, 60), ...invoices('d4', 2, 100)],
    reviews: [
      ...Array.from({ length: 40 }, () => ({ staffId: 'd1', score: 97 })),
      { staffId: 'd2', score: 100 }, { staffId: 'd2', score: 100 }, { staffId: 'd2', score: 100 },
      ...Array.from({ length: 10 }, () => ({ staffId: 'd3', score: 90 })),
    ],
    attendance: [...days('d1', 20), ...days('d2', 20, 'late', 30), ...days('d3', 10), ...days('d3', 6, 'missing_checkout'), ...days('d4', 3), ...days('m1', 20), ...days('c1', 20)],
    requests: [
      { recordedStaffId: 'd1', branch: 'فرع شكري', createdAt: '2026-10-01T08:00:00Z', closedAt: '2026-10-02T08:00:00Z' },
      { recordedStaffId: 'd2', branch: 'فرع شكري', createdAt: '2026-10-01T08:00:00Z', closedAt: null },
    ],
    purchases: [],
    targets: [{ branch: 'فرع شكري', targetAmount: 100000 }],
    dormantSources: ['followups'],
    ...overrides,
  };
}

describe('evaluation lab scoring primitives', () => {
  it('percentile needs three peers and uses mid-ranks', () => {
    expect(percentileAmong(5, [5, 6])).toBeNull();
    expect(percentileAmong(1, [1, 2, 3])).toBe(0);
    expect(percentileAmong(3, [1, 2, 3])).toBe(100);
    expect(percentileAmong(2, [2, 2, 2])).toBe(50);
  });

  it('shrinks small samples toward the population and scores saturated rates by deviation', () => {
    // Shrinkage narrows the gap a tiny sample creates (raw gap 3 points) without inventing a reversal.
    expect(shrunkMean(100, 3, 95)).toBeLessThan(100);
    expect(shrunkMean(100, 3, 95) - shrunkMean(97, 40, 95)).toBeLessThan(1);
    expect(deviationScore(0.96, 0.96)).toBe(50);
    expect(deviationScore(0.97, 0.96)).toBeCloseTo(60);
    expect(targetScore(1.2)).toBe(100);
    expect(targetScore(0.6)).toBe(50);
    expect(disciplineScore(1, 0)).toBe(100);
  });

  it('missing data is never a zero: weights are redistributed and coverage drops', () => {
    const full = aggregate('delivery', [measured('discipline', 1, 80, ''), measured('deliveries_per_day', 1, 60, '')]);
    expect(full).toMatchObject({ total: 70, coverage: 1, readiness: 'ready' });
    const half = aggregate('delivery', [measured('discipline', 1, 80, ''), notMeasurable('deliveries_per_day', 'لا بيانات')]);
    expect(half.total).toBe(80);
    expect(half.coverage).toBe(0.5);
    expect(half.readiness).toBe('partial');
    expect(half.axes.find((a) => a.key === 'deliveries_per_day')).toMatchObject({ score: null, status: 'not_measurable' });
  });
});

describe('buildCycleScores', () => {
  const results = buildCycleScores(evidence());
  const byId = (id: string) => results.find((r) => r.staffId === id)!;

  it('conversation quality needs three official reviews and ranks the shrunk mean', () => {
    const conv = (id: string) => byId(id).axes.find((a) => a.key === 'conversation_quality')!;
    expect(conv('d4')).toMatchObject({ status: 'not_measurable', score: null });
    expect(conv('d3').score!).toBeLessThan(conv('d1').score!);
    expect(conv('d2').value!).toBeLessThan(100);
  });

  it('a new doctor below every threshold is insufficient, not punished', () => {
    const d4 = byId('d4');
    expect(d4.readiness).toBe('insufficient');
    expect(d4.total).toBeNull();
    expect(d4.axes.every((a) => a.score === null || a.weight === 0)).toBe(true);
  });

  it('unresolved attendance days are excluded from discipline and reported', () => {
    const d3 = byId('d3').axes.find((a) => a.key === 'discipline')!;
    expect(d3.status).toBe('measured');
    expect(d3.basis).toContain('6 يوم بانتظار المراجعة');
    expect(byId('d2').axes.find((a) => a.key === 'discipline')!.score!).toBeLessThan(d3.score!);
  });

  it('dormant follow-ups are visible but never weighted', () => {
    const followups = byId('d1').axes.find((a) => a.key === 'followups')!;
    expect(followups).toMatchObject({ status: 'not_measurable', weight: 0 });
  });

  it('branch manager is scored from branch outcomes and team, branches manager from managers', () => {
    const m1 = byId('m1');
    expect(m1.axes.find((a) => a.key === 'branch_target')!.value).toBeCloseTo(((100 * 500 + 100 * 300 + 60 * 400 + 2 * 100) / 100000) * 100, 0);
    expect(m1.axes.find((a) => a.key === 'requests_closure')!.value).toBe(50);
    expect(m1.team!.map((t) => t.staffId)).toEqual(expect.arrayContaining(['d1', 'd2', 'd3', 'd4', 'c1']));
    const h1 = byId('h1');
    expect(h1.axes.find((a) => a.key === 'branch_managers')).toMatchObject({ status: 'measured', score: m1.total });
  });

  it('couriers are scored only on deliveries resolved to their own id', () => {
    const withDeliveries = buildCycleScores(evidence({
      staff: [...evidence().staff, { id: 'c2', name: 'دليفري ٢', role: 'delivery', branch: 'فرع شكري' }, { id: 'c3', name: 'دليفري ٣', role: 'delivery', branch: 'فرع شكري' }],
      attendance: [...evidence().attendance, ...days('c2', 20), ...days('c3', 20)],
      invoices: [...evidence().invoices,
        ...Array.from({ length: 40 }, () => ({ staffId: null, net: 0, coded: true, branch: 'فرع شكري', deliveryStaffId: 'c1' })),
        ...Array.from({ length: 10 }, () => ({ staffId: null, net: 0, coded: true, branch: 'فرع شكري', deliveryStaffId: 'c2' }))],
    }));
    const c1 = withDeliveries.find((r) => r.staffId === 'c1')!.axes.find((a) => a.key === 'deliveries_per_day')!;
    const c3 = withDeliveries.find((r) => r.staffId === 'c3')!.axes.find((a) => a.key === 'deliveries_per_day')!;
    expect(c1.value).toBe(2);
    expect(c1.score!).toBeGreaterThan(c3.score!);
  });
});

describe('closedCycles', () => {
  it('returns closed 26→25 cycles in Cairo time', () => {
    expect(closedCycles(2, new Date('2026-10-28T10:00:00Z'))).toEqual([
      { start: '2026-09-26', endExclusive: '2026-10-26' },
      { start: '2026-08-26', endExclusive: '2026-09-26' },
    ]);
    expect(closedCycles(1, new Date('2026-10-20T10:00:00Z'))[0]).toEqual({ start: '2026-08-26', endExclusive: '2026-09-26' });
  });
});
