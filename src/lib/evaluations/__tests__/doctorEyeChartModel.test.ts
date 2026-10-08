import { describe, expect, it } from 'vitest';
import { buildEyeChartModel, eyeCycleName, type EyeChartModel } from '@/lib/evaluations/doctorEyeChartModel';
import { cycleRates, type DoctorPerformanceIntelligence, type DoctorPerformanceMonth, type PerformanceSourceHealth } from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import { unavailableDecision, type DecisionIntelligence } from '@/lib/evaluations/doctorDecisionIntelligence';

const NOW = new Date('2026-10-08T10:00:00Z'); // cycle 2026-10 (26 Sep → 25 Oct) is running
const impact = { available: false, commercialConversations: null, verifiedSaleConversations: null, verifiedRevenue: null, verifiedConversionRate: null, followupsNeeded: null, complaints: null, saleLeakage: null, unavailableProducts: null, acceptedProducts: null };
const detail = (pendingDays = 0) => ({ workedDays: 20, lateDays: 4, lateMinutes: 80, pendingDays, approvedHours: 160, pendingHours: pendingDays * 8 });

function month(label: string, o: Partial<DoctorPerformanceMonth> = {}): DoctorPerformanceMonth {
  return {
    cycleLabel: label, displayLabel: label, sales: 300000, invoices: 1500, customers: 900, averageInvoice: 200,
    workedHours: 160, salesPerHour: 1875, invoicesPerHour: 9.4, customersPerHour: 5.6,
    conversations: 40, convertedConversations: 10, conversionRate: 25, conversionRecorded: 40,
    attendanceDetail: detail(), hoursComplete: true, hoursNote: null, salesDays: 30,
    coverage: 'available', confidence: 'high', coverageReason: '', comparisonEligible: true, comparisonMode: 'full_cycle', comparisonReason: '',
    comparisonSnapshot: null, salesIdentity: 'canonical', salesSourceAvailable: true, attendanceSourceAvailable: true, conversationSourceAvailable: true,
    salesEvidenceCount: 1500, attendanceEvidenceCount: 20, conversationEvidenceCount: 40, customerImpact: impact, diagnoses: [], ...o,
  };
}
const ok: PerformanceSourceHealth = { status: 'available', state: 'available', reason: null, diagnostic: null, evidenceCount: 1, firstEvidenceDate: null, dataAsOf: '2026-10-07' };
const down = (state: 'failed' | 'not_enabled', reason: string): PerformanceSourceHealth => ({ ...ok, status: 'unavailable', state, reason, diagnostic: { source: 'x', code: null, message: 'x', details: null, hint: null } });

function data(months: DoctorPerformanceMonth[], sources: Partial<DoctorPerformanceIntelligence['sources']> = {}): DoctorPerformanceIntelligence {
  return { months, sources: { sales: ok, attendance: ok, conversations: ok, customerImpact: ok, ...sources }, actions: [], generatedAt: '', firstEvidenceDate: null, firstSalesEvidenceDate: null, firstAttendanceEvidenceDate: null, firstConversationEvidenceDate: null };
}
const full = () => data([month('2026-10', { salesDays: 12, sales: 120000, invoices: 600, hoursComplete: false, salesPerHour: null, hoursNote: '9 يوم حضور بانتظار المراجعة؛ إنتاجية الساعة لا تُحسب على ساعات ناقصة.', attendanceDetail: detail(9) }), month('2026-09'), month('2026-08')]);

function readyDecision(o: Partial<DecisionIntelligence['charts']> = {}): DecisionIntelligence {
  return {
    ...unavailableDecision('insufficient', null), availability: 'ready', availabilityReason: null, analysisCycleStart: '2026-08-26', analysisIsEvaluatedCycle: true,
    charts: {
      trend: [], quality: [],
      peers: [{ id: 'T', isTarget: true, index: 1.1, hours: 160, label: 'د/ أحمد' }, { id: 'a', isTarget: false, index: 0.9, hours: 150, label: 'زميل' }, { id: 'b', isTarget: false, index: 1, hours: 170, label: 'زميل' }],
      peerBand: { p25: 0.92, median: 1, p75: 1.05 },
      shifts: [{ shift: 'morning' as never, label: 'صباحي', actual: 1800, expected: 1700, p25: 1500, p75: 1900, hours: 80, invoices: 400, peers: 4, confidence: 'high' }],
      ...o,
    },
  };
}

const tab = (m: EyeChartModel, key: string) => m.tabs.find(t => t.key === key)!;
const NOT_ENABLED = 'مصدر «مقارنة الفرع» لم يُفعَّل بعد على قاعدة البيانات.';

describe('doctor eye chart — the individual tabs never depend on the branch comparison', () => {
  it('shows the performance trend while the branch comparison migration is absent', () => {
    const m = buildEyeChartModel({ data: full(), decision: unavailableDecision('not_enabled', NOT_ENABLED), decisionLoading: false, hasBranch: true, now: NOW });
    expect(m.tabs.map(t => t.key)).toEqual(['trend', 'shifts', 'peers', 'sources']);
    expect(tab(m, 'trend').available).toBe(true);
    expect(tab(m, 'sources').available).toBe(true);
    expect(m.defaultTab).toBe('trend');
    for (const key of ['shifts', 'peers']) {
      expect(tab(m, key).available).toBe(false);
      expect(tab(m, key).state).toBe('not_enabled');
      expect(String(tab(m, key).reason)).toContain('لم يُفعَّل بعد');
      expect(/PGRST|schema cache/.test(String(tab(m, key).reason))).toBe(false);
    }
    expect(m.sources.find(r => r.key === 'branch')!.stateLabel).toBe('لم يُفعَّل بعد');
  });

  it('keeps the trend when the branch comparison failed, is loading, or there is no branch', () => {
    const states: [DecisionIntelligence | null, boolean, boolean, string][] = [
      [unavailableDecision('failed', 'انتهت مهلة تحميل مصدر «مقارنة الفرع»؛ أعد المحاولة بعد قليل.'), false, true, 'failed'],
      [unavailableDecision('insufficient', null), false, true, 'insufficient'],
      [null, true, true, 'loading'],
      [null, false, false, 'insufficient'],
    ];
    for (const [decision, loading, hasBranch, state] of states) {
      const m = buildEyeChartModel({ data: full(), decision, decisionLoading: loading, hasBranch, now: NOW });
      expect(m.tabs.length).toBe(4);
      expect(tab(m, 'trend').available).toBe(true);
      expect(tab(m, 'shifts').state).toBe(state);
      expect(tab(m, 'peers').state).toBe(state);
      expect(Boolean(tab(m, 'peers').reason)).toBe(true);
    }
    expect(String(tab(buildEyeChartModel({ data: full(), decision: null, decisionLoading: false, hasBranch: false, now: NOW }), 'shifts').reason)).toContain('فرع');
  });

  it('enables the comparative tabs only from a ready comparison with enough evidence', () => {
    const m = buildEyeChartModel({ data: full(), decision: readyDecision(), decisionLoading: false, hasBranch: true, now: NOW });
    expect(m.tabs.every(t => t.available)).toBe(true);
    expect(m.shifts.length).toBe(1);
    const thin = buildEyeChartModel({ data: full(), decision: readyDecision({ shifts: [], peerBand: null, peers: [] }), decisionLoading: false, hasBranch: true, now: NOW });
    expect(tab(thin, 'shifts').state).toBe('insufficient');
    expect(tab(thin, 'peers').state).toBe('insufficient');
    expect(tab(thin, 'trend').available).toBe(true);
  });

  it('never removes a tab because one source is missing, in any combination', () => {
    const decisions = [null, unavailableDecision('not_enabled', NOT_ENABLED), unavailableDecision('failed', 'تعذر'), unavailableDecision('insufficient', null), readyDecision()];
    const sourceSets: Partial<DoctorPerformanceIntelligence['sources']>[] = [{}, { sales: down('failed', 'م') }, { attendance: down('failed', 'ح') }, { conversations: down('not_enabled', 'ك') }, { customerImpact: down('failed', 'أ') }];
    for (const decision of decisions) for (const sources of sourceSets) for (const loading of [false, true]) {
      const m = buildEyeChartModel({ data: data(full().months, sources), decision, decisionLoading: loading, hasBranch: true, now: NOW });
      expect(m.tabs.map(t => t.key)).toEqual(['trend', 'shifts', 'peers', 'sources']);
      expect(tab(m, 'sources').available).toBe(true);
      for (const t of m.tabs) if (!t.available) expect(Boolean(t.reason)).toBe(true);
    }
  });
});

describe('doctor eye chart — unknown values stay unknown', () => {
  it('explains, instead of hiding, a trend with no individual data at all', () => {
    const empty = month('x', { sales: null, invoices: null, customers: null, averageInvoice: null, workedHours: null, salesPerHour: null, conversations: null, convertedConversations: null, conversionRate: null, conversionRecorded: null, attendanceDetail: null, hoursComplete: false, salesDays: null, coverage: 'unavailable' });
    const m = buildEyeChartModel({ data: data([{ ...empty, cycleLabel: '2026-10' }, { ...empty, cycleLabel: '2026-09' }, { ...empty, cycleLabel: '2026-08' }], { sales: down('failed', 'انتهت مهلة تحميل مصدر «المبيعات».'), attendance: down('failed', 'تعذر الحضور.') }), decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    expect(tab(m, 'trend').available).toBe(false);
    expect(String(tab(m, 'trend').reason)).toContain('المبيعات');
    expect(m.defaultTab).toBe('sources');
    expect(m.trend.metrics.every(x => x.points.every(p => p.value === null))).toBe(true);
    expect(m.sources.find(r => r.key === 'sales')!.cells!.every(c => c.status === 'missing')).toBe(true);
  });

  it('does not draw a trend from a single cycle', () => {
    const m = buildEyeChartModel({ data: data([month('2026-10'), month('2026-09', { coverage: 'not_applicable' }), month('2026-08', { coverage: 'not_applicable' })]), decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    expect(tab(m, 'trend').available).toBe(false);
    expect(String(m.trend.metrics[0].reason)).toContain('دورة واحدة');
    expect(m.trend.metrics[0].points.filter(p => p.value !== null).length).toBe(1);
  });

  it('orders cycles oldest first, names them by end month and flags the running cycle', () => {
    const m = buildEyeChartModel({ data: full(), decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    expect(m.cycles.map(c => c.cycleLabel)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(m.cycles.map(c => c.running)).toEqual([false, false, true]);
    expect(eyeCycleName('2026-10')).toBe('أكتوبر');
    const perDay = m.trend.metrics.find(x => x.key === 'salesPerDay')!;
    expect(perDay.points.map(p => p.value)).toEqual([10000, 10000, 10000]);
  });

  it('shows conversion as unknown, not 0%, when no sale outcome was recorded', () => {
    const jul = month('2026-08', { conversations: 57, convertedConversations: 0, conversionRate: null, conversionRecorded: 0 });
    const m = buildEyeChartModel({ data: data([month('2026-10'), month('2026-09'), jul]), decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    const p = m.trend.metrics.find(x => x.key === 'conversion')!.points[0];
    expect(p.value).toBe(null);
    expect(String(p.note)).toContain('بدون نتيجة');
    expect(m.sources.find(r => r.key === 'conversations')!.cells![0].status).toBe('partial');
  });

  it('keeps sales per hour off the chart while attendance days are pending', () => {
    const m = buildEyeChartModel({ data: full(), decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    const p = m.trend.metrics.find(x => x.key === 'salesPerHour')!.points[2];
    expect(p.value).toBe(null);
    expect(String(p.note)).toContain('بانتظار المراجعة');
    expect(m.sources.find(r => r.key === 'attendance')!.cells![2].status).toBe('partial');
  });

  it('does not read a clean lateness record from fewer than five settled days', () => {
    const oct = month('2026-10', { attendanceDetail: { workedDays: 4, lateDays: 0, lateMinutes: 0, pendingDays: 6, approvedHours: 39.2, pendingHours: 0 } });
    const m = buildEyeChartModel({ data: data([oct, month('2026-09'), month('2026-08')]), decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    const p = m.trend.metrics.find(x => x.key === 'lateShare')!.points[2];
    expect(p.value).toBe(null);
    expect(String(p.note)).toContain('بانتظار المراجعة');
  });

  it('never turns a missing number into zero anywhere in the model', () => {
    const empty = month('2026-09', { sales: null, invoices: null, salesDays: null, salesPerHour: null, conversations: null, conversionRecorded: null, conversionRate: null, attendanceDetail: null });
    const m = buildEyeChartModel({ data: data([month('2026-10'), empty, month('2026-08')]), decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    for (const metric of m.trend.metrics) expect(metric.points[1].value).toBe(null);
  });
});

describe('doctor eye — hours and conversion rules', () => {
  it('computes per-hour productivity only when every attendance day is settled', () => {
    const settled = cycleRates({ salesTotal: 160000, invoices: 800, customers: 500, hours: 160, detail: detail(0), outcomes: [] });
    expect(settled.salesPerHour).toBe(1000);
    expect(settled.hoursComplete).toBe(true);
    const pending = cycleRates({ salesTotal: 160000, invoices: 800, customers: 500, hours: 100, detail: detail(6), outcomes: [] });
    expect(pending.salesPerHour).toBe(null);
    expect(pending.invoicesPerHour).toBe(null);
    expect(String(pending.hoursNote)).toContain('6 يوم');
    expect(cycleRates({ salesTotal: 1, invoices: 1, customers: 1, hours: 10, detail: null, outcomes: [] }).salesPerHour).toBe(null);
  });

  it('divides conversion by recorded outcomes only', () => {
    const r = cycleRates({ salesTotal: null, invoices: null, customers: null, hours: null, detail: null, outcomes: [true, false, null, undefined, true, false] });
    expect(r.recorded).toBe(4);
    expect(r.converted).toBe(2);
    expect(r.conversionRate).toBe(50);
    const none = cycleRates({ salesTotal: null, invoices: null, customers: null, hours: null, detail: null, outcomes: Array(57).fill(null) });
    expect(none.conversionRate).toBe(null);
    expect(cycleRates({ salesTotal: null, invoices: null, customers: null, hours: null, detail: null, outcomes: null }).recorded).toBe(null);
  });
});
