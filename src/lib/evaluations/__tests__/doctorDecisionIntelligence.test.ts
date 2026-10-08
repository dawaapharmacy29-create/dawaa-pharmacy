import { describe, expect, it } from 'vitest';
import {
  buildDecisionIntelligence,
  cycleProductivity,
  groupReviewRowsByDoctorCycle,
  trendOf,
  type QualityFacts,
  type QualityIndex,
} from '@/lib/evaluations/doctorDecisionIntelligence';
import type { BranchDoctorCycle, BranchPerformanceWindow, ShiftKey } from '@/lib/evaluations/doctorDecisionDataService';

const CYCLES = ['2026-06-26', '2026-07-26', '2026-08-26', '2026-09-26'];
const END: Record<string, string> = { '2026-06-26': '2026-07-26', '2026-07-26': '2026-08-26', '2026-08-26': '2026-09-26', '2026-09-26': '2026-10-26' };

type CycleSpec = { shift?: ShiftKey; hours?: number; rate?: number; late?: number; worked?: number; unplaced?: number; ambiguous?: number; attendance?: boolean; shifts?: Partial<Record<ShiftKey, { hours: number; rate: number; late?: number }>> };

function cycle(start: string, spec: CycleSpec | null): BranchDoctorCycle {
  if (!spec) return { start, sales: { salesAll: 0, invoicesAll: 0, customers: 0, directInvoices: 0, aliasInvoices: 0 }, ambiguousInvoices: 0, unmatched: { invoices: 0, sales: 0 }, shifts: {}, attendance: { available: true, workedDays: 0, lateDays: 0, workedHours: 0, pendingReviewDays: 0 } };
  const shiftsSpec = spec.shifts || { [spec.shift || 'morning']: { hours: spec.hours ?? 160, rate: spec.rate ?? 1000, late: spec.late ?? 0 } };
  const shifts: BranchDoctorCycle['shifts'] = {};
  let invoices = 0, sales = 0;
  for (const [s, v] of Object.entries(shiftsSpec) as [ShiftKey, { hours: number; rate: number; late?: number }][]) {
    const sh = v.hours * v.rate;
    const inv = Math.round(sh / 300);
    shifts[s] = { hours: v.hours, days: Math.round(v.hours / 8), pendingDays: 0, lateDays: v.late || 0, sales: sh, invoices: inv };
    invoices += inv; sales += sh;
  }
  const unplaced = spec.unplaced || 0;
  return {
    start,
    sales: { salesAll: sales + unplaced * 300, invoicesAll: invoices + unplaced, customers: invoices, directInvoices: 0, aliasInvoices: invoices + unplaced },
    ambiguousInvoices: spec.ambiguous || 0,
    unmatched: { invoices: unplaced, sales: unplaced * 300 },
    shifts,
    attendance: spec.attendance === false ? { available: false, error: 'x' } : { available: true, workedDays: spec.worked ?? 20, lateDays: spec.late ?? 0, workedHours: 160, pendingReviewDays: 0 },
  };
}

function window(doctors: Record<string, (CycleSpec | null)[]>, attribution = 0.9): BranchPerformanceWindow {
  return {
    branch: 'فرع الشامي', windowStart: CYCLES[0], windowEnd: '2026-10-26', dataAsOf: '2026-10-06',
    cycles: CYCLES.map(s => ({ start: s, endExclusive: END[s] })),
    ambiguousNames: [],
    branchCycles: CYCLES.map(s => ({ start: s, invoices: 1000, doctorInvoices: Math.round(1000 * attribution), ambiguousInvoices: 0 })),
    doctors: Object.entries(doctors).map(([id, specs]) => ({ staffId: id, name: `د ${id}`, active: true, homeBranch: 'فرع الشامي', cycles: specs.map((s, i) => cycle(CYCLES[i], s)) })),
  };
}

const q = (over: Partial<QualityFacts> = {}): QualityFacts => ({ reviewCount: 10, sampleSufficient: true, coreAverage: 8, medicalErrors: 0, criticalErrors: 0, complaints: 0, severeBadTone: 0, ...over });
function quality(map: Record<string, (QualityFacts | null)[]>): QualityIndex {
  const byDoctor: QualityIndex['byDoctor'] = {};
  for (const [id, list] of Object.entries(map)) list.forEach((f, i) => { if (f) (byDoctor[id] ||= {})[CYCLES[i]] = f; });
  return { available: true, byDoctor };
}
const allQ = (ids: string[], f: (QualityFacts | null)[] = [q(), q(), q(), q()]) => quality(Object.fromEntries(ids.map(id => [id, f])));

function run(w: BranchPerformanceWindow | null, opts: Partial<Parameters<typeof buildDecisionIntelligence>[0]> = {}) {
  return buildDecisionIntelligence({
    staffId: 'T', window: w, windowError: w ? null : 'انتهت مهلة مصدر مقارنة الفرع (57014).',
    quality: allQ(['T', 'A', 'B', 'C', 'D']), sections: [], previousEvaluation: null, openCycleStart: null, nextReviewDate: '2026-11-25', ...opts,
  });
}

const steady = (rate = 1000, extra: CycleSpec = {}): CycleSpec[] => CYCLES.map(() => ({ rate, ...extra }));

describe('doctor decision intelligence — fairness of productivity', () => {
  it('does not penalize a night-shift doctor whose rate matches night peers even if day shifts sell more', () => {
    const w = window({
      T: steady(400, { shift: 'night' }),
      A: steady(400, { shift: 'night' }),
      B: steady(420, { shift: 'night' }),
      C: steady(1200, { shift: 'morning' }),
      D: steady(1250, { shift: 'morning' }),
    });
    const r = run(w);
    const p = r.charts.trend[r.charts.trend.length - 1];
    expect(p.index !== null && p.index > 0.9 && p.index < 1.1).toBe(true);
    expect(r.problems.some(x => x.key === 'low_productivity')).toBe(false);
  });

  it('treats more hours at the same rate as the same productivity, not improvement', () => {
    const w = window({
      T: [{ hours: 80 }, { hours: 80 }, { hours: 80 }, { hours: 160 }],
      A: steady(), B: steady(), C: steady(),
    });
    const r = run(w);
    expect(r.indicators.self.state).toBe('stable');
    expect(r.changeDrivers?.hoursChange).toBe(1);
    expect(Math.abs(r.changeDrivers!.productivityChange) < 0.01).toBe(true);
  });

  it('blocks productivity when invoice identity is ambiguous or branch attribution is weak', () => {
    const ambiguous = window({ T: steady(1000, { ambiguous: 200 }), A: steady(), B: steady(), C: steady() });
    expect(run(ambiguous).indicators.self.detail).toContain('اسم مشترك');
    const weak = window({ T: steady(), A: steady(), B: steady(), C: steady() }, 0.5);
    const r = run(weak);
    expect(r.indicators.peers.state).toBe('insufficient');
    expect(r.confidence.level).toBe('low');
  });

  it('flags invoices outside attendance windows as a data question, not misconduct', () => {
    const w = window({ T: steady(1000, { unplaced: 400 }), A: steady(), B: steady(), C: steady() });
    const r = run(w);
    const gap = r.problems.find(p => p.key === 'attribution_gap');
    expect(gap?.severity).toBe('low');
    expect(gap?.action).toContain('ليست مخالفة');
  });
});

describe('doctor decision intelligence — peers', () => {
  it('compares against the median and band of at least three eligible peers', () => {
    const w = window({ T: steady(1400), A: steady(1000), B: steady(1050), C: steady(950), D: steady(1000) });
    const r = run(w);
    expect(r.indicators.peers.state).toBe('above');
    expect(r.indicators.peers.peerCount).toBe(4);
    expect(r.charts.peerBand !== null).toBe(true);
    expect(r.charts.peers.filter(p => !p.isTarget).every(p => p.label === 'زميل')).toBe(true);
  });

  it('refuses a misleading comparison with fewer than three eligible peers', () => {
    const w = window({ T: steady(), A: steady(), B: CYCLES.map(() => ({ hours: 5 })) });
    const r = run(w);
    expect(r.indicators.peers.state).toBe('insufficient');
    expect(r.indicators.peers.detail).toContain('الحد الأدنى');
  });
});

describe('doctor decision intelligence — history and evidence safety', () => {
  it('gives a new doctor no self-trend instead of inventing one', () => {
    const w = window({ T: [null, null, null, {}], A: steady(), B: steady(), C: steady() });
    const r = run(w);
    expect(r.indicators.self.state).toBe('insufficient');
    expect(r.indicators.self.detail).toContain('موظف جديد');
  });

  it('marks a problem with a data gap in the previous cycle as new, not recurring', () => {
    expect(trendOf([{ present: true, magnitude: 0.5 }, { present: null, magnitude: null }])).toBe('new');
    expect(trendOf([{ present: true, magnitude: 0.6 }, { present: true, magnitude: 0.4 }])).toBe('worsening');
    expect(trendOf([{ present: true, magnitude: 0.3 }, { present: true, magnitude: 0.5 }])).toBe('improving');
    expect(trendOf([{ present: false, magnitude: null }, { present: true, magnitude: 0.5 }])).toBe('resolved');
    expect(trendOf([{ present: null, magnitude: null }, { present: true, magnitude: 0.5 }])).toBe('insufficient');
  });

  it('detects lateness recurring across cycles and classifies it as shift-linked when peers share it', () => {
    const late: CycleSpec = { shift: 'night', late: 8, worked: 20 };
    const w = window({
      T: CYCLES.map(() => late), A: CYCLES.map(() => late),
      B: steady(1000, { shift: 'morning' }), C: steady(1000, { shift: 'morning' }), D: steady(1000, { shift: 'morning' }),
    });
    const r = run(w);
    const p = r.problems.find(x => x.key === 'lateness')!;
    expect(p.trend).toBe('recurring');
    expect(p.scope).toBe('shift_linked');
    expect(p.owner).toBe('manager');
    expect(p.causeCertainty).toBe('hypothesis');
  });

  it('classifies a problem shared by most doctors as a branch operational issue and counts doctors once', () => {
    const late: CycleSpec = { late: 9, worked: 20, shifts: { morning: { hours: 80, rate: 1000, late: 5 }, evening: { hours: 80, rate: 1000, late: 4 } } };
    const w = window({ T: CYCLES.map(() => late), A: CYCLES.map(() => late), B: CYCLES.map(() => late), C: steady() });
    const r = run(w);
    expect(r.problems.find(x => x.key === 'lateness')!.scope).toBe('branch_operational');
    const pr = r.branchPriorities.find(x => x.key === 'lateness')!;
    expect(pr.affected).toBe(3);
    expect(pr.covered).toBe(4);
  });

  it('keeps critical medical errors as an independent first priority even with strong sales', () => {
    const w = window({ T: steady(1500), A: steady(), B: steady(), C: steady() });
    const r = run(w, { quality: quality({ T: [q(), q(), q(), q({ medicalErrors: 1 })], A: [q(), q(), q(), q()], B: [q(), q(), q(), q()], C: [q(), q(), q(), q()] }) });
    expect(r.problems[0].key).toBe('medical_error');
    expect(r.summary.headline.startsWith('أولوية مستقلة')).toBe(true);
    expect(r.branchPriorities[0].standalone).toBe(true);
  });

  it('does not judge conversation quality from an insufficient sample', () => {
    const w = window({ T: steady(), A: steady(), B: steady(), C: steady() });
    const r = run(w, { quality: quality({ T: [q(), q(), q(), q({ sampleSufficient: false, coreAverage: null, reviewCount: 1 })] }) });
    expect(r.problems.some(p => p.key === 'weak_conversation')).toBe(false);
    expect(r.confidence.reasons).toContain('عينة المحادثات غير كافية');
  });

  it('never issues an all-clear when evidence is incomplete', () => {
    const w = window({ T: steady(), A: steady(), B: steady(), C: steady() });
    const r = run(w, { quality: { available: false, byDoctor: {} } });
    expect(r.problems.length).toBe(0);
    expect(r.summary.headline).toContain('الأدلة غير مكتملة');
    expect(r.dataWarnings.some(x => x.includes('غير متاحة'))).toBe(true);
  });

  it('reports a failed branch source instead of returning an empty success', () => {
    const r = run(null);
    expect(r.confidence.level).toBe('low');
    expect(r.decision.action).toContain('إعادة تحميل');
    expect(r.indicators.peers.detail).toContain('57014');
  });
});

describe('doctor decision intelligence — evaluation consistency', () => {
  const sections = (discipline: number, conversations: number) => [
    { key: 'discipline', title: 'الالتزام والانضباط', score: discipline },
    { key: 'conversations', title: 'جودة المحادثات وخدمة العميل', score: conversations },
  ];

  it('detects a high score that the evidence does not support', () => {
    const w = window({ T: CYCLES.map(() => ({ late: 10, worked: 20 })), A: steady(), B: steady(), C: steady() });
    const r = run(w, { sections: sections(5, 3) });
    expect(r.indicators.evaluation.state).toBe('gaps');
    expect(r.indicators.evaluation.gaps[0].direction).toBe('higher_than_evidence');
  });

  it('detects a low score despite documented strong evidence', () => {
    const w = window({ T: steady(), A: steady(), B: steady(), C: steady() });
    const r = run(w, { sections: sections(4, 1), quality: quality({ T: [q(), q(), q(), q({ coreAverage: 9.6 })] }) });
    expect(r.indicators.evaluation.gaps.some(g => g.axisKey === 'conversations' && g.direction === 'lower_than_evidence')).toBe(true);
  });

  it('does not invent a gap before the manager rates the axes', () => {
    const w = window({ T: steady(), A: steady(), B: steady(), C: steady() });
    expect(run(w, { sections: sections(0, 0) }).indicators.evaluation.state).toBe('not_rated');
  });

  it('lists a resolved previous problem as a strength when nothing stronger exists', () => {
    const late: CycleSpec = { late: 8, worked: 20 };
    const w = window({ T: [late, late, late, { late: 1, worked: 8 }], A: steady(), B: steady(), C: steady() });
    expect(run(w).summary.strength).toContain('لم تعد مشكلة');
  });

  it('reports whether the previous documented decision worked', () => {
    const late: CycleSpec = { late: 8, worked: 20 };
    const w = window({ T: [late, late, late, { late: 0, worked: 20 }], A: steady(), B: steady(), C: steady() });
    const r = run(w, { previousEvaluation: { cycleLabel: '2026-09', status: 'approved', sections: [], developmentPoints: ['الالتزام بالمواعيد'], managerNotes: '' } });
    expect(r.decision.previousDecision).toContain('نجح');
    expect(r.problems.some(p => p.key === 'lateness')).toBe(false);
  });
});

describe('doctor decision intelligence — running cycle and grouping', () => {
  it('falls back to the last closed cycle when the running cycle has too little evidence', () => {
    const w = window({ T: [{}, {}, {}, { hours: 10 }], A: steady(), B: steady(), C: steady() });
    const r = run(w, { openCycleStart: '2026-09-26' });
    expect(r.analysisCycleStart).toBe('2026-08-26');
    expect(r.analysisNote).toContain('آخر دورة مغلقة');
  });

  it('assigns reviews to the Cairo-local cycle at midnight and drops duplicate rows', () => {
    const rows = [
      { id: 'r1', staff_id: 'T', conversation_date: '2026-08-25T22:30:00Z' },
      { id: 'r1', staff_id: 'T', conversation_date: '2026-08-25T22:30:00Z' },
      { id: 'r2', doctor_id: 'T', conversation_date: '2026-08-25T20:30:00Z' },
    ];
    const g = groupReviewRowsByDoctorCycle(rows, CYCLES.map(s => ({ start: s, endExclusive: END[s] })));
    expect(g.T['2026-08-26'].length).toBe(1);
    expect(g.T['2026-07-26'].length).toBe(1);
  });

  it('uses leave-one-out branch rates so a doctor is never compared with himself', () => {
    const w = window({ T: steady(2000), A: steady(1000), B: steady(1000) });
    const p = cycleProductivity(w, 'T', w.doctors[0].cycles[2], false);
    expect(Math.abs((p.index || 0) - 2) < 0.01).toBe(true);
  });
});
