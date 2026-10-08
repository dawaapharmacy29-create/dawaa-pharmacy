import { describe, expect, it } from 'vitest';
import { buildEyeChartModel, eyeCycleName, type EyeChartModel } from '@/lib/evaluations/doctorEyeChartModel';
import { attendanceFacts, cycleRates, presentDaysThrough, type AttendanceFacts, type DoctorPerformanceIntelligence, type DoctorPerformanceMonth, type PerformanceSourceHealth } from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import { unavailableDecision, type DecisionIntelligence } from '@/lib/evaluations/doctorDecisionIntelligence';

const NOW = new Date('2026-10-08T10:00:00Z'); // cycle 2026-10 (26 Sep → 25 Oct) is running
const impact = { available: false, commercialConversations: null, verifiedSaleConversations: null, verifiedRevenue: null, verifiedConversionRate: null, followupsNeeded: null, complaints: null, saleLeakage: null, unavailableProducts: null, acceptedProducts: null };
const detail = (unsettledDays = 0, settledDays = 20, lateDays = 4): AttendanceFacts => ({ presentDays: settledDays + unsettledDays, settledDays, unsettledDays, absenceReviewDays: 0, lateDays, lateMinutes: 80, approvedHours: 160, pendingHours: unsettledDays * 8, presentDates: [] });

function month(label: string, o: Partial<DoctorPerformanceMonth> = {}): DoctorPerformanceMonth {
  return {
    cycleLabel: label, displayLabel: label, sales: 300000, invoices: 1500, customers: 900, averageInvoice: 200,
    workedHours: 160, salesPerHour: 1875, invoicesPerHour: 9.4, customersPerHour: 5.6,
    conversations: 40, convertedConversations: 10, conversionRate: 25, conversionRecorded: 40,
    unverifiedConversions: 0, attendanceDetail: detail(), hoursComplete: true, hoursNote: null, salesDays: 30, salesPresentDays: 20,
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
const full = () => data([month('2026-10', { salesDays: 12, salesPresentDays: 8, sales: 80000, invoices: 600, hoursComplete: false, salesPerHour: null, hoursNote: '9 يوم حضور بانتظار المراجعة؛ إنتاجية الساعة لا تُحسب على ساعات ناقصة.', attendanceDetail: detail(9) }), month('2026-09'), month('2026-08')]);

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
    const perDay = m.trend.metrics.find(x => x.key === 'salesPerPresentDay')!;
    expect(perDay.points.map(p => p.value)).toEqual([15000, 15000, 10000]);
    expect(perDay.points.map(p => p.status)).toEqual(['final', 'final', 'provisional']);
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
    const oct = month('2026-10', { attendanceDetail: detail(4, 4, 0) });
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

describe('doctor eye — hours, attendance and conversion rules', () => {
  it('computes per-hour productivity only for a closed cycle with every attendance day settled', () => {
    const settled = cycleRates({ salesTotal: 160000, invoices: 800, customers: 500, hours: 160, detail: detail(0), cycleClosed: true, outcomes: [] });
    expect(settled.salesPerHour).toBe(1000);
    expect(settled.hoursComplete).toBe(true);
    const pending = cycleRates({ salesTotal: 160000, invoices: 800, customers: 500, hours: 100, detail: detail(6), cycleClosed: true, outcomes: [] });
    expect(pending.salesPerHour).toBe(null);
    expect(pending.invoicesPerHour).toBe(null);
    expect(String(pending.hoursNote)).toContain('6 يوم');
    const running = cycleRates({ salesTotal: 160000, invoices: 800, customers: 500, hours: 100, detail: detail(0), cycleClosed: false, outcomes: [] });
    expect(running.salesPerHour).toBe(null);
    expect(String(running.hoursNote)).toContain('جارية');
    expect(cycleRates({ salesTotal: 1, invoices: 1, customers: 1, hours: 10, detail: null, cycleClosed: true, outcomes: [] }).salesPerHour).toBe(null);
  });

  it('counts only verified sales (converted with an invoice) over recorded outcomes', () => {
    const o = (converted: boolean | null, invoiceNumber: string | null = null) => ({ converted, invoiceNumber });
    const r = cycleRates({ salesTotal: null, invoices: null, customers: null, hours: null, detail: null, cycleClosed: true, outcomes: [o(true, '101'), o(false), o(null), o(true, '102'), o(false), o(true, null), o(true, '  ')] });
    expect(r.converted).toBe(2);
    expect(r.unverified).toBe(2);
    expect(r.recorded).toBe(4);
    expect(r.conversionRate).toBe(50);
    const none = cycleRates({ salesTotal: null, invoices: null, customers: null, hours: null, detail: null, cycleClosed: true, outcomes: Array(57).fill(o(null)) });
    expect(none.conversionRate).toBe(null);
    expect(none.recorded).toBe(0);
    expect(cycleRates({ salesTotal: null, invoices: null, customers: null, hours: null, detail: null, cycleClosed: true, outcomes: null }).recorded).toBe(null);
  });

  it('derives present, settled and pending days from the daily rows, not from the summary pending count', () => {
    const day = (attendance_date: string, approval_state: string, first_in: string | null, last_out: string | null = null) => ({ attendance_date, approval_state, first_in, last_out });
    const facts = attendanceFacts([
      day('2026-09-26', 'approved', 'x'), day('2026-09-27', 'approved', 'x'), day('2026-09-28', 'pending_review', null, 'y'),
      day('2026-09-29', 'pending_review', null), day('2026-09-30', 'not_materialized', null), day('2026-10-09', 'pending_review', 'x'),
    ], { actual_worked_days: 2, late_days: 1, total_late_minutes: 20, absence_review_days: 1, total_worked_hours: 20, pending_worked_hours: 5 });
    expect(facts.presentDays).toBe(4);
    expect(facts.settledDays).toBe(2);
    expect(facts.unsettledDays).toBe(2);
    expect(facts.lateDays).toBe(1);
    // A running cycle only counts attendance up to the last loaded sales day.
    expect(presentDaysThrough(facts, '2026-09-26', '2026-10-07')).toBe(3);
    expect(presentDaysThrough(facts, '2026-09-26', null)).toBe(null);
  });
});

describe('doctor eye — real cycles of د/ أحمد حافظ (database facts, 2026-10-08)', () => {
  // Sales: canonical bundle (staff_id + exact seller-name match). Attendance: get_staff_attendance_detail_v3 daily rows.
  // Conversations: conversation_sales_reviews_canonical_v2 (Sep: 17 converted, all 17 with an invoice that exists).
  const att = (presentDays: number, settledDays: number, lateDays: number): AttendanceFacts => ({ presentDays, settledDays, unsettledDays: presentDays - settledDays, absenceReviewDays: 0, lateDays, lateMinutes: 0, approvedHours: 0, pendingHours: 0, presentDates: [] });
  const ahmed = () => data([
    month('2026-10', { sales: 85373.51, invoices: 336, salesDays: 12, salesPresentDays: 8, workedHours: 39.2, salesPerHour: null, hoursComplete: false, hoursNote: 'الدورة جارية', conversations: 0, convertedConversations: 0, conversionRecorded: 0, conversionRate: null, attendanceDetail: att(8, 4, 0), comparisonMode: 'same_period' }),
    month('2026-09', { sales: 401791.81, invoices: 908, salesDays: 31, salesPresentDays: 24, workedHours: 171.36, salesPerHour: null, hoursComplete: false, hoursNote: '9 يوم حضور بانتظار المراجعة', conversations: 24, convertedConversations: 17, conversionRecorded: 24, conversionRate: (17 / 24) * 100, attendanceDetail: att(24, 15, 10) }),
    month('2026-08', { sales: 326588.14, invoices: 942, salesDays: 31, salesPresentDays: 25, workedHours: 178.25, salesPerHour: null, hoursComplete: false, hoursNote: '9 يوم حضور بانتظار المراجعة', conversations: 57, convertedConversations: 0, conversionRecorded: 0, conversionRate: null, attendanceDetail: att(25, 16, 9) }),
  ]);
  const model = () => buildEyeChartModel({ data: ahmed(), decision: unavailableDecision('not_enabled', NOT_ENABLED), decisionLoading: false, hasBranch: true, now: NOW });
  const metric = (key: string) => model().trend.metrics.find(x => x.key === key)!;
  const round = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

  it('divides sales by attendance days, not calendar days, and keeps the result provisional while days are pending', () => {
    expect(metric('salesPerPresentDay').points.map(p => round(p.value))).toEqual([13063.5, 16741.3, 10671.7]);
    expect(metric('salesPerPresentDay').points.map(p => p.status)).toEqual(['provisional', 'provisional', 'provisional']);
    expect(metric('salesPerCalendarDay').points.map(p => round(p.value))).toEqual([10535.1, 12961, 7114.5]);
    expect(metric('salesPerCalendarDay').context).toBe(true);
    expect(model().trend.defaultMetric).toBe('salesPerPresentDay');
  });

  it('never falls back to calendar days when attendance days are unknown', () => {
    const d = ahmed();
    d.months[1] = { ...d.months[1], attendanceDetail: null, salesPresentDays: null };
    const m = buildEyeChartModel({ data: d, decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    const p = m.trend.metrics.find(x => x.key === 'salesPerPresentDay')!.points[1];
    expect(p.value).toBe(null);
    expect(String(p.note)).toContain('لا يُقسم على أيام تقويمية');
  });

  it('reads conversion only where outcomes were recorded and verified', () => {
    const c = metric('conversion').points;
    expect(c[0].value).toBe(null);
    expect(String(c[0].note)).toContain('٥٧ مراجعة بدون نتيجة');
    expect(round(c[1].value)).toBe(70.8);
    expect(c[1].status).toBe('final');
    expect(c[2].value).toBe(null);
  });

  it('marks partial outcome coverage as provisional and hides very low coverage', () => {
    const d = ahmed();
    d.months[1] = { ...d.months[1], conversations: 24, conversionRecorded: 14, convertedConversations: 10, conversionRate: (10 / 14) * 100 };
    const p = buildEyeChartModel({ data: d, decision: null, decisionLoading: false, hasBranch: true, now: NOW }).trend.metrics.find(x => x.key === 'conversion')!.points[1];
    expect(p.status).toBe('provisional');
    d.months[1] = { ...d.months[1], conversionRecorded: 6, convertedConversations: 5, conversionRate: (5 / 6) * 100 };
    expect(buildEyeChartModel({ data: d, decision: null, decisionLoading: false, hasBranch: true, now: NOW }).trend.metrics.find(x => x.key === 'conversion')!.points[1].value).toBe(null);
  });

  it('reads lateness on settled days only, provisional while days are pending, unknown below five settled days', () => {
    const l = metric('lateShare').points;
    expect(l.map(p => round(p.value))).toEqual([56.3, 66.7, null]);
    expect(l[0].status).toBe('provisional');
    expect(String(l[0].note)).toContain('لم يُحسم');
  });

  it('keeps every individual tab working while the branch comparison is not enabled', () => {
    const m = model();
    expect(m.tabs.map(t => [t.key, t.available])).toEqual([['trend', true], ['shifts', false], ['peers', false], ['sources', true]]);
    expect(metric('salesPerHour').available).toBe(false);
    expect(m.sources.find(r => r.key === 'attendance')!.cells!.map(c => c.text)).toEqual(['٢٥ يوم حضور، ٩ بانتظار المراجعة', '٢٤ يوم حضور، ٩ بانتظار المراجعة', '٨ يوم حضور، ٤ بانتظار المراجعة']);
  });
});
