import { describe, expect, it } from 'vitest';
import { aggregate, codingGatePenalty, deviationScore, disciplineScore, notMeasurable, measured, percentileAmong, shrunkMean, targetScore } from '../scoring';
import { buildCycleScores, isSelfRecorded, type BrainRequest, type LabEvidence } from '../buildCycleScores';
import { closedCycles } from '../loadCycleEvidence';

const days = (staffId: string, n: number, status = 'on_time', late = 0) =>
  Array.from({ length: n }, (_, i) => ({ staffId, date: `2026-10-${String(i + 1).padStart(2, '0')}`, status, hasFirstIn: true, scheduled: true, lateMinutes: late }));
const invoices = (staffId: string, n: number, net: number, coded = n) =>
  Array.from({ length: n }, (_, i) => ({ staffId, net, date: `2026-10-${String((i % 20) + 1).padStart(2, '0')}`, coded: i < coded, branch: 'فرع شكري', deliveryStaffId: null }));

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
    expect(disciplineScore(1)).toBe(100);
    expect(disciplineScore(0.5)).toBe(50);
  });

  it('missing data is never a zero: weights are redistributed and coverage drops', () => {
    const full = aggregate('delivery', [measured('discipline', 1, 80, ''), measured('deliveries_per_day', 1, 60, '')], { version: 'v6.0' });
    expect(full).toMatchObject({ total: 70, coverage: 1, readiness: 'ready' });
    const half = aggregate('delivery', [measured('discipline', 1, 80, ''), notMeasurable('deliveries_per_day', 'لا بيانات')], { version: 'v6.0' });
    expect(half.total).toBe(80);
    expect(half.coverage).toBe(0.5);
    expect(half.readiness).toBe('partial');
    expect(half.axes.find((a) => a.key === 'deliveries_per_day')).toMatchObject({ score: null, status: 'not_measurable' });
  });
});

describe('buildCycleScores (v6.0 baseline)', () => {
  const results = buildCycleScores(evidence(), 'v6.0');
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

  it('punctuality comes from late minutes on scheduled days, not status names', () => {
    const scoreOf = (attendance: LabEvidence['attendance']) => buildCycleScores(evidence({ attendance: [...evidence().attendance.filter((d) => d.staffId !== 'd1'), ...attendance] }), 'v6.0')
      .find((r) => r.staffId === 'd1')!.axes.find((a) => a.key === 'discipline')!;
    // A manager-approved day with 0 late minutes is on time; a 30-minute day is half credit; no-schedule days do not count.
    expect(scoreOf([...days('d1', 10, 'manager_approved_actual_punches', 0), ...days('d1', 10, 'approved_late', 30), ...days('d1', 5, 'no_schedule', 0)]).value).toBe(75);
    // Approved absence with deduction is a real missed shift.
    expect(scoreOf([...days('d1', 9, 'on_time'), ...days('d1', 1, 'manager_approved_absence_deduction_x2')]).value).toBe(90);
    // Unscheduled days carry no punctuality signal.
    expect(scoreOf(days('d1', 12, 'on_time').map((d) => ({ ...d, scheduled: false }))).status).toBe('not_measurable');
  });

  it('unresolved attendance days are excluded from discipline and reported', () => {
    const d3 = byId('d3').axes.find((a) => a.key === 'discipline')!;
    expect(d3.status).toBe('measured');
    expect(d3.basis).toContain('6 يوم بانتظار المراجعة');
    expect(byId('d2').axes.find((a) => a.key === 'discipline')!.score!).toBeLessThan(d3.score!);
  });

  it('fair share compares a part-timer only with the branch on his own days', () => {
    // Two doctors present on days 1-10; a part-timer present on days 1-5 only, selling his share.
    const share = buildCycleScores(evidence({
      staff: [{ id: 'a', name: 'أ', role: 'صيدلاني', branch: 'فرع شكري' }, { id: 'p', name: 'بارت', role: 'صيدلاني', branch: 'فرع شكري' }],
      attendance: [...days('a', 10), ...days('p', 5)],
      invoices: [
        ...Array.from({ length: 10 }, (_, i) => ({ staffId: 'a', net: 1000, date: `2026-10-${String(i + 1).padStart(2, '0')}`, coded: true, branch: 'فرع شكري', deliveryStaffId: null })),
        ...Array.from({ length: 5 }, (_, i) => ({ staffId: 'p', net: 1000, date: `2026-10-${String(i + 1).padStart(2, '0')}`, coded: true, branch: 'فرع شكري', deliveryStaffId: null })),
      ],
      reviews: [], requests: [],
    }), 'v6.0');
    const axis = (id: string) => share.find((r) => r.staffId === id)!.axes.find((a) => a.key === 'sales_per_day')!;
    // Days 1-5: branch 2000/day, 2 present → expected 1000; p sold 1000/day → share 1.0 (score 50).
    expect(axis('p').value).toBe(1);
    expect(axis('p').score).toBe(50);
    // Days 6-10: a is alone, so the whole branch is his share; he sold exactly that.
    expect(axis('a').value).toBeCloseTo(1, 1);
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
        ...Array.from({ length: 40 }, () => ({ staffId: null, net: 0, date: '2026-10-01', coded: true, branch: 'فرع شكري', deliveryStaffId: 'c1' })),
        ...Array.from({ length: 10 }, () => ({ staffId: null, net: 0, date: '2026-10-01', coded: true, branch: 'فرع شكري', deliveryStaffId: 'c2' }))],
    }), 'v6.0');
    const c1 = withDeliveries.find((r) => r.staffId === 'c1')!.axes.find((a) => a.key === 'deliveries_per_day')!;
    const c3 = withDeliveries.find((r) => r.staffId === 'c3')!.axes.find((a) => a.key === 'deliveries_per_day')!;
    expect(c1.value).toBe(2);
    expect(c1.score!).toBeGreaterThan(c3.score!);
  });
});

describe('buildCycleScores v6.1 (owner review 2026-10-28)', () => {
  const v61 = buildCycleScores(evidence({ dormantSources: ['followups', 'assistant_checklist', 'delivery_ratings'] }), 'v6.1');
  const byId = (id: string) => v61.find((r) => r.staffId === id)!;
  const axis = (id: string, key: string) => byId(id).axes.find((a) => a.key === key)!;

  it('coding is a gate: no weight, points off only below 95%', () => {
    expect(codingGatePenalty(0.96)).toBe(0);
    expect(codingGatePenalty(0.94)).toBe(-2);
    expect(codingGatePenalty(0.5)).toBe(-10);
    expect(axis('d1', 'coding_quality').weight).toBe(0);
    expect(byId('d1').adjustments).toEqual([]);
    // d2 coded 90/100: 5 points below the floor → −10, shown with the base total.
    expect(byId('d2').adjustments).toEqual([expect.objectContaining({ points: -10 })]);
    expect(byId('d2').total).toBeCloseTo(Math.max(0, (byId('d2').baseTotal as number) - 10), 1);
  });

  it('an uncorrected missing punch is an employee-owned zero-credit day', () => {
    // d3: 10 on-time days + 6 missing checkouts → 10/16 credit; v6.0 ignored the 6 days (100%).
    expect(axis('d3', 'discipline').value).toBe(62.5);
    expect(axis('d3', 'discipline').basis).toContain('6 بصمة ناقصة');
    expect(buildCycleScores(evidence(), 'v6.0').find((r) => r.staffId === 'd3')!.axes.find((a) => a.key === 'discipline')!.value).toBe(100);
  });

  it('cancelled customer requests are not credited to the recorder nor counted for closure', () => {
    const withCancelled = buildCycleScores(evidence({
      requests: [
        { recordedStaffId: 'd1', branch: 'فرع شكري', createdAt: '2026-10-01T08:00:00Z', closedAt: '2026-10-02T08:00:00Z', status: 'delivered' },
        { recordedStaffId: 'd1', branch: 'فرع شكري', createdAt: '2026-10-01T08:00:00Z', closedAt: '2026-10-01T09:00:00Z', status: 'cancelled' },
        { recordedStaffId: 'd2', branch: 'فرع شكري', createdAt: '2026-10-01T08:00:00Z', closedAt: null, status: 'new' },
      ],
    }));
    const m1 = withCancelled.find((r) => r.staffId === 'm1')!.axes.find((a) => a.key === 'requests_closure')!;
    expect(m1.value).toBe(50);
    expect(m1.basis).toContain('1 مفتوح');
    expect(withCancelled.find((r) => r.staffId === 'd1')!.axes.find((a) => a.key === 'customer_requests')!.basis).toContain('1 ملغي لا يُحتسب');
  });

  it('deliveries are not scored where the branch does not record or link courier names', () => {
    const run = buildCycleScores(evidence({
      staff: [{ id: 'c1', name: 'أ', role: 'توصيل', branch: 'فرع شكري' }],
      attendance: days('c1', 10),
      invoices: [
        ...Array.from({ length: 10 }, () => ({ staffId: null, net: 0, date: '2026-10-01', coded: true, branch: 'فرع شكري', deliveryStaffId: 'c1', deliveryLabeled: true })),
        ...Array.from({ length: 10 }, () => ({ staffId: null, net: 0, date: '2026-10-01', coded: true, branch: 'فرع شكري', deliveryStaffId: null, deliveryLabeled: true })),
      ],
      reviews: [], requests: [], dormantSources: ['delivery_ratings'],
    }));
    const axis = run[0].axes.find((a) => a.key === 'deliveries_per_day')!;
    expect(axis.status).toBe('not_measurable');
    expect(axis.reason).toContain('50٪ فقط من أسماء الدليفري');
  });

  it('couriers are compared by fair share of the branch deliveries on their own days', () => {
    const run = buildCycleScores(evidence({
      staff: [{ id: 'c1', name: 'أ', role: 'توصيل', branch: 'فرع شكري' }, { id: 'c2', name: 'ب', role: 'delivery', branch: 'فرع شكري' }],
      attendance: [...days('c1', 10), ...days('c2', 5)],
      invoices: Array.from({ length: 10 }, (_, i) => [
        { staffId: null, net: 0, date: `2026-10-${String(i + 1).padStart(2, '0')}`, coded: true, branch: 'فرع شكري', deliveryStaffId: 'c1' },
        ...(i < 5 ? [{ staffId: null, net: 0, date: `2026-10-${String(i + 1).padStart(2, '0')}`, coded: true, branch: 'فرع شكري', deliveryStaffId: 'c2' }] : []),
      ]).flat(),
      reviews: [], requests: [],
      dormantSources: ['delivery_ratings'],
    }));
    // Days 1-5: 2 deliveries/day, 2 couriers → expected 1 each, both delivered 1. Days 6-10: c1 alone.
    expect(run.find((r) => r.staffId === 'c2')!.axes.find((a) => a.key === 'deliveries_per_day')!.value).toBe(1);
    expect(run.find((r) => r.staffId === 'c1')!.axes.find((a) => a.key === 'deliveries_per_day')!.value).toBe(1);
    expect(run.find((r) => r.staffId === 'c1')!.axes.find((a) => a.key === 'delivery_rating')).toMatchObject({ status: 'not_measurable', weight: 15 });
  });

  it('branch manager: team follow-up of missing punches and team quality; decision backlog is information only', () => {
    expect(axis('m1', 'team_followup')).toMatchObject({ status: 'measured' });
    expect(axis('m1', 'team_followup').basis).toContain('6 بصمة ناقصة');
    expect(axis('m1', 'team_quality')).toMatchObject({ status: 'measured', weight: 15 });
    expect(axis('m1', 'decision_backlog')).toMatchObject({ weight: 0 });
    expect(axis('h1', 'decision_backlog')).toMatchObject({ weight: 0 });
  });

  it('dormant assistant checklist and delivery ratings are not measurable, never zero', () => {
    const run = buildCycleScores(evidence({
      staff: [...evidence().staff, { id: 'a1', name: 'مساعد', role: 'مساعد صيدلي', branch: 'فرع شكري' }],
      attendance: [...evidence().attendance, ...days('a1', 20)],
      dormantSources: ['assistant_checklist', 'delivery_ratings'],
    }));
    const a1 = run.find((r) => r.staffId === 'a1')!;
    expect(a1.axes.find((a) => a.key === 'assistant_checklist')).toMatchObject({ status: 'not_measurable', score: null });
    expect(a1.total).toBe(100);
    // Only discipline (40 of 100) is measurable: the assistant is "partial", not scored as zero elsewhere.
    expect(a1.coverage).toBeCloseTo(0.4, 2);
    expect(a1.readiness).toBe('partial');
  });
});

describe('buildCycleScores v6.2 sales metrics', () => {
  // Two doctors on the same branch, day and shift. a: 10 invoices of 300 with 3 items; b: 10 of 100 with 1 item.
  const sale = (staffId: string, net: number, items: number, day = 1, shift = 'مسائي') =>
    ({ staffId, net, items, shift, date: `2026-10-${String(day).padStart(2, '0')}`, coded: true, branch: 'فرع شكري', deliveryStaffId: null });
  const run = (invoices: LabEvidence['invoices']) => buildCycleScores(evidence({
    staff: [{ id: 'a', name: 'أ', role: 'صيدلاني', branch: 'فرع شكري' }, { id: 'b', name: 'ب', role: 'صيدلاني', branch: 'فرع شكري' }],
    attendance: [...days('a', 10), ...days('b', 10)],
    invoices,
    reviews: [], requests: [],
  }), 'v6.2');
  const axis = (rows: ReturnType<typeof run>, id: string, key: string) => rows.find((r) => r.staffId === id)!.axes.find((x) => x.key === key)!;
  const same = Array.from({ length: 40 }, (_, i) => [sale('a', 300, 3, (i % 10) + 1), sale('b', 100, 1, (i % 10) + 1)]).flat();

  it('average invoice and basket are compared with the same branch, day and shift', () => {
    const rows = run(same);
    // Slot average 200 / 2 items: a ×1.5 → 100, b ×0.5 → 0.
    expect(axis(rows, 'a', 'avg_invoice')).toMatchObject({ value: 1.5, score: 100 });
    expect(axis(rows, 'b', 'avg_invoice')).toMatchObject({ value: 0.5, score: 0 });
    expect(axis(rows, 'a', 'basket_items').value).toBe(1.5);
    // Same number of customers on the same days: an equal invoice share.
    expect(axis(rows, 'a', 'invoice_share').value).toBe(1);
    expect(axis(rows, 'b', 'invoice_share').value).toBe(1);
  });

  it('a night shift is not compared with an evening shift', () => {
    // b works nights where every invoice is 100: on his own slot he is exactly average.
    const rows = run([...Array.from({ length: 40 }, (_, i) => sale('a', 300, 3, (i % 10) + 1, 'مسائي')),
      ...Array.from({ length: 40 }, (_, i) => sale('b', 100, 1, (i % 10) + 1, 'ليلي'))]);
    expect(axis(rows, 'b', 'avg_invoice')).toMatchObject({ value: 1, score: 50 });
  });

  it('returns are excluded and a small sample is not measurable', () => {
    const rows = run([...same, sale('a', -500, 2, 1)]);
    expect(axis(rows, 'a', 'avg_invoice').value).toBe(1.5);
    const few = run([sale('a', 300, 3), sale('b', 100, 1)]);
    expect(axis(few, 'a', 'avg_invoice')).toMatchObject({ status: 'not_measurable' });
  });

  it('dormant follow-ups keep their weight visible and are redistributed', () => {
    const rows = run(same);
    expect(axis(rows, 'a', 'followups')).toMatchObject({ status: 'not_measurable', weight: 15 });
    expect(rows.find((r) => r.staffId === 'a')!.coverage).toBeLessThan(1);
  });
});

describe('buildCycleScores v6.3 request capture', () => {
  const detected = (n: number, staffId = 'd1', overrides: Partial<BrainRequest> = {}): BrainRequest => ({
    id: `b${n}`, staffId, customerId: null, customerCode: `C${n}`, customerPhone: null, productCode: null,
    productName: `صنف ${n}`, status: 'proposed', targetId: null,
    conversationStartedAt: '2026-10-05T10:00:00Z', conversationEndedAt: '2026-10-05T10:30:00Z', ...overrides,
  });
  const recorded = (n: number, staffId = 'd1', createdAt = '2026-10-05T11:00:00Z', overrides: Partial<LabEvidence['requests'][number]> = {}) => ({
    id: `r${n}`, recordedStaffId: staffId, branch: 'فرع شكري', createdAt, closedAt: null, status: 'new',
    customerId: null, customerCode: `C${n}`, customerPhone: null, medicineName: `صنف ${n}`, productCode: null, ...overrides,
  });

  it('a request counts as self-recorded only by the same doctor, customer, product and time window', () => {
    expect(isSelfRecorded(detected(1), [recorded(1)])).toBe(true);
    expect(isSelfRecorded(detected(1), [recorded(1, 'd2')])).toBe(false);
    expect(isSelfRecorded(detected(1), [recorded(1, 'd1', '2026-10-09T10:00:00Z')])).toBe(false);
    expect(isSelfRecorded(detected(1), [recorded(1, 'd1', '2026-10-05T11:00:00Z', { status: 'cancelled' })])).toBe(false);
    // The request created by approving the Master Brain proposal is not self-recorded.
    expect(isSelfRecorded(detected(1, 'd1', { targetId: 'r1' }), [recorded(1)])).toBe(false);
    // Phone match (last 10 digits) and a longer product name still match.
    expect(isSelfRecorded(detected(1, 'd1', { customerCode: null, customerPhone: '+20 100 123 4567' }),
      [recorded(1, 'd1', '2026-10-05T11:00:00Z', { customerCode: null, customerPhone: '01001234567', medicineName: 'صنف 1 شريط' })])).toBe(true);
  });

  it('capture share is scored once the Master Brain found enough requests, never zero below that', () => {
    const run = (brainRequests: BrainRequest[] | null, requests: LabEvidence['requests']) =>
      buildCycleScores(evidence({ brainRequests, requests }), 'v6.3').find((r) => r.staffId === 'd1')!.axes;
    const axis = (axes: ReturnType<typeof run>, key: string) => axes.find((a) => a.key === key)!;
    const ten = Array.from({ length: 10 }, (_, i) => detected(i + 1));
    const nine = Array.from({ length: 9 }, (_, i) => recorded(i + 1));
    expect(axis(run(ten, nine), 'request_capture')).toMatchObject({ status: 'measured', value: 90, weight: 15 });
    expect(axis(run(ten, nine), 'request_capture').score).toBeCloseTo(80, 0);
    expect(axis(run(ten.slice(0, 3), nine), 'request_capture')).toMatchObject({ status: 'not_measurable', score: null });
    expect(axis(run(null, nine), 'request_capture')).toMatchObject({ status: 'not_measurable' });
    expect(axis(run(ten, nine), 'customer_requests')).toMatchObject({ weight: 0 });
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
