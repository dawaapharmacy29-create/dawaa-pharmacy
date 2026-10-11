import { describe, expect, it } from 'vitest';
import { buildEyeChartModel, eyeCycleName, type EyeChartModel } from '@/lib/evaluations/doctorEyeChartModel';
import { attendanceFacts, cycleRates, presentDaysThrough, type AttendanceFacts, type DoctorPerformanceIntelligence, type DoctorPerformanceMonth, type PerformanceSourceHealth } from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import { comparableProductivity, parseSalesReconciliation, totalSales, verifiedConversion, verifiedCoverage, type CycleReconciliation } from '@/lib/evaluations/doctorSalesReconciliation';
import { unavailableDecision, type DecisionIntelligence } from '@/lib/evaluations/doctorDecisionIntelligence';

const NOW = new Date('2026-10-08T10:00:00Z'); // cycle 2026-10 (26 Sep → 25 Oct) is running
const impact = { available: false, commercialConversations: null, verifiedSaleConversations: null, verifiedRevenue: null, verifiedConversionRate: null, followupsNeeded: null, complaints: null, saleLeakage: null, unavailableProducts: null, acceptedProducts: null };
const detail = (unsettledDays = 0, settledDays = 20, lateDays = 4): AttendanceFacts => ({ presentDays: settledDays + unsettledDays, settledDays, unsettledDays, absenceReviewDays: 0, lateDays, lateMinutes: 80, approvedHours: 160, pendingHours: unsettledDays * 8, presentDates: [] });

/** A reconciliation cycle as get_doctor_sales_reconciliation_v1 returns it. */
function rec(start: string, o: { verified?: [number, number]; identityOnly?: [number, number]; uncertain?: [number, number]; zero?: number; present?: number; settled?: number; approvedHours?: number; approvedDaysWithHours?: number; verifiedSales?: number; verifiedInvoices?: number; settledSales?: number; conversion?: Record<string, number> } = {}): CycleReconciliation {
  const [vi, vs] = o.verified ?? [600, 240000], [ii, is] = o.identityOnly ?? [0, 0], [ui, us] = o.uncertain ?? [0, 0];
  const present = o.present ?? 20, settled = o.settled ?? 20;
  return parseSalesReconciliation({ cycles: [{
    start, endExclusive: start,
    categories: { attendance_verified: { invoices: vi, sales: vs }, identity_only: { invoices: ii, sales: is }, uncertain: { invoices: ui, sales: us }, zero_value: { invoices: o.zero ?? 0, sales: 0 } },
    attendance: { presentDays: present, settledDays: settled, pendingDays: present - settled, approvedHours: o.approvedHours ?? 160, approvedDaysWithHours: o.approvedDaysWithHours ?? settled, pendingHours: 0, daysWithoutHours: 0, otherBranchDays: 0, lastDay: null },
    productivity: { verifiedSales: o.verifiedSales ?? vs, verifiedInvoices: o.verifiedInvoices ?? vi, verifiedSalesSettledDays: o.settledSales ?? vs, daysWithVerifiedSales: present },
    conversion: o.conversion ?? { verified: 10, no_sale: 30 },
  }] })[0];
}

function month(label: string, o: Partial<DoctorPerformanceMonth> = {}): DoctorPerformanceMonth {
  const r = o.reconciliation === undefined ? rec(label) : o.reconciliation;
  const p = r ? comparableProductivity(r) : null, c = r ? verifiedConversion(r) : null;
  return {
    cycleLabel: label, displayLabel: label, sales: 300000, invoices: 1500, customers: 900, averageInvoice: 200,
    workedHours: 160, salesPerHour: p?.perApprovedHour ?? null, invoicesPerHour: null, customersPerHour: null,
    conversations: 40, convertedConversations: c?.verified ?? null, conversionRate: c?.rate ?? null, conversionRecorded: c?.recorded ?? null,
    unverifiedConversions: c?.unverifiedClaims ?? null, reconciliation: r, attendanceDetail: detail(), hoursComplete: true, hoursNote: null, salesDays: 30, salesPresentDays: 20,
    coverage: 'available', confidence: 'high', coverageReason: '', comparisonEligible: true, comparisonMode: 'full_cycle', comparisonReason: '',
    comparisonSnapshot: null, salesIdentity: 'canonical', salesSourceAvailable: true, attendanceSourceAvailable: true, conversationSourceAvailable: true,
    salesEvidenceCount: 1500, attendanceEvidenceCount: 20, conversationEvidenceCount: 40, customerImpact: impact, diagnoses: [], ...o,
  };
}
const ok: PerformanceSourceHealth = { status: 'available', state: 'available', reason: null, diagnostic: null, evidenceCount: 1, firstEvidenceDate: null, dataAsOf: '2026-10-07' };
const down = (state: 'failed' | 'not_enabled', reason: string): PerformanceSourceHealth => ({ ...ok, status: 'unavailable', state, reason, diagnostic: { source: 'x', code: null, message: 'x', details: null, hint: null } });

function data(months: DoctorPerformanceMonth[], sources: Partial<DoctorPerformanceIntelligence['sources']> = {}): DoctorPerformanceIntelligence {
  return { months, sources: { sales: ok, attendance: ok, conversations: ok, customerImpact: ok, reconciliation: ok, ...sources }, actions: [], generatedAt: '', firstEvidenceDate: null, firstSalesEvidenceDate: null, firstAttendanceEvidenceDate: null, firstConversationEvidenceDate: null };
}
const full = () => data([month('2026-10', { salesDays: 12, sales: 80000, invoices: 600, hoursComplete: false, hoursNote: '9 يوم حضور بانتظار المراجعة', attendanceDetail: detail(9), reconciliation: rec('2026-09-26', { verified: [300, 64000], present: 8, settled: 4, approvedDaysWithHours: 1 }) }), month('2026-09'), month('2026-08')]);

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

  it('flags the shift and peer tabs as provisional while their days are pending review', () => {
    const base = readyDecision();
    const settled = buildEyeChartModel({ data: full(), decision: { ...base, charts: { ...base.charts, targetPendingDays: 0, shifts: base.charts.shifts.map(x => ({ ...x, pendingDays: 0 })) } }, decisionLoading: false, hasBranch: true, now: NOW });
    expect(tab(settled, 'shifts').provisionalNote).toBe(null);
    expect(tab(settled, 'peers').provisionalNote).toBe(null);
    const pending = buildEyeChartModel({ data: full(), decision: { ...base, charts: { ...base.charts, targetPendingDays: 9, shifts: base.charts.shifts.map(x => ({ ...x, pendingDays: 3 })) } }, decisionLoading: false, hasBranch: true, now: NOW });
    expect(String(tab(pending, 'shifts').provisionalNote)).toContain('٣ يوم');
    expect(String(tab(pending, 'peers').provisionalNote)).toContain('٩ يوم');
    expect(tab(pending, 'shifts').available).toBe(true);
  });

  it('never removes a tab because one source is missing, in any combination', () => {
    const decisions = [null, unavailableDecision('not_enabled', NOT_ENABLED), unavailableDecision('failed', 'تعذر'), unavailableDecision('insufficient', null), readyDecision()];
    const sourceSets: Partial<DoctorPerformanceIntelligence['sources']>[] = [{}, { sales: down('failed', 'م') }, { attendance: down('failed', 'ح') }, { conversations: down('not_enabled', 'ك') }, { customerImpact: down('failed', 'أ') }, { reconciliation: down('not_enabled', 'م') }];
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
    const empty = month('x', { sales: null, invoices: null, customers: null, averageInvoice: null, workedHours: null, salesPerHour: null, conversations: null, convertedConversations: null, conversionRate: null, conversionRecorded: null, attendanceDetail: null, reconciliation: null, hoursComplete: false, salesDays: null, coverage: 'unavailable' });
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
  });

  it('orders cycles oldest first, names them by end month and flags the running cycle', () => {
    const m = buildEyeChartModel({ data: full(), decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    expect(m.cycles.map(c => c.cycleLabel)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(m.cycles.map(c => c.running)).toEqual([false, false, true]);
    expect(eyeCycleName('2026-10')).toBe('أكتوبر');
    const perDay = m.trend.metrics.find(x => x.key === 'verifiedSalesPerDay')!;
    expect(perDay.points.map(p => p.value)).toEqual([12000, 12000, 8000]);
    expect(perDay.points.map(p => p.status)).toEqual(['final', 'final', 'provisional']);
  });

  it('never turns a missing number into zero anywhere in the model', () => {
    const empty = month('2026-09', { sales: null, invoices: null, salesDays: null, salesPerHour: null, conversations: null, conversionRecorded: null, conversionRate: null, attendanceDetail: null, reconciliation: null });
    const m = buildEyeChartModel({ data: data([month('2026-10'), empty, month('2026-08')]), decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    for (const metric of m.trend.metrics) expect(metric.points[1].value).toBe(null);
  });
});

describe('doctor eye — productivity uses verified sales only', () => {
  it('never divides sales of days without a punch by other attendance days', () => {
    // 100,000 total; 70,000 verified on 10 attendance days; 30,000 on days with no punch.
    const r = rec('2026-08-26', { verified: [700, 70000], identityOnly: [300, 30000], present: 10, settled: 10, approvedHours: 100, settledSales: 70000 });
    expect(totalSales(r)).toBe(100000);
    expect(comparableProductivity(r).perAttendanceDay).toBe(7000);
    expect(comparableProductivity(r).perApprovedHour).toBe(700);
    expect(verifiedCoverage(r)).toBe(0.7);
  });

  it('keeps per-hour off a sample of fewer than five approved days with hours', () => {
    const r = rec('2026-09-26', { verified: [240, 57494.56], present: 8, settled: 4, approvedHours: 10.33, approvedDaysWithHours: 1, settledSales: 3623.72 });
    expect(comparableProductivity(r).perApprovedHour).toBe(null);
  });

  it('shows productivity as unavailable, not as total sales over days, when the reconciliation source is missing', () => {
    const d = data([month('2026-10', { reconciliation: null }), month('2026-09', { reconciliation: null }), month('2026-08', { reconciliation: null })], { reconciliation: down('not_enabled', 'مصدر «مطابقة المبيعات بالحضور» لم يُفعَّل بعد على قاعدة البيانات.') });
    const m = buildEyeChartModel({ data: d, decision: null, decisionLoading: false, hasBranch: true, now: NOW });
    for (const key of ['verifiedSalesPerDay', 'verifiedInvoicesPerDay', 'salesPerHour', 'conversion']) {
      const metric = m.trend.metrics.find(x => x.key === key)!;
      expect(metric.points.every(p => p.value === null)).toBe(true);
    }
    expect(String(m.trend.metrics.find(x => x.key === 'verifiedSalesPerDay')!.points[0].note)).toContain('لا تُقسم مبيعات أيام بلا بصمة');
    // The doctor's own lateness still keeps the tab alive.
    expect(tab(m, 'trend').available).toBe(true);
    expect(m.trend.defaultMetric).toBe('lateShare');
    expect(m.sources.find(r => r.key === 'reconciliation')!.stateLabel).toBe('لم يُفعَّل بعد');
  });
});

describe('doctor eye — conversion verified at invoice, customer and seller level', () => {
  it('counts only verified sales against recorded no-sales; colleague sales and unverified claims sit outside both sides', () => {
    // September of د/ أحمد حافظ, review by review: 7 verified, 5 bought from a colleague, 5 invoice not matching the
    // customer or not after the conversation, 7 recorded no-sale.
    const c = verifiedConversion(rec('2026-08-26', { conversion: { verified: 7, served_other_seller: 5, invoice_not_matching_customer_or_time: 5, no_sale: 7 } }));
    expect(c.reviews).toBe(24);
    expect(c.recorded).toBe(14);
    expect(c.servedByColleague).toBe(5);
    expect(c.unverifiedClaims).toBe(5);
    expect(c.rate).toBe(50);
    expect(Math.round(c.coverage! * 100)).toBe(58);
  });

  it('keeps unknown outcomes unknown', () => {
    const c = verifiedConversion(rec('2026-07-26', { conversion: { unknown: 57 } }));
    expect(c.rate).toBe(null);
    expect(c.recorded).toBe(0);
  });
});

describe('doctor eye — hours and attendance rules', () => {
  it('marks hours complete only for a closed cycle with every attendance day settled', () => {
    expect(cycleRates({ hours: 160, detail: detail(0), cycleClosed: true }).hoursComplete).toBe(true);
    const pending = cycleRates({ hours: 100, detail: detail(6), cycleClosed: true });
    expect(pending.hoursComplete).toBe(false);
    expect(String(pending.hoursNote)).toContain('6 يوم');
    expect(String(cycleRates({ hours: 100, detail: detail(0), cycleClosed: false }).hoursNote)).toContain('جارية');
  });

  it('derives present, settled and pending days from the daily rows, not from the summary pending count', () => {
    const day = (attendance_date: string, approval_state: string, first_in: string | null, last_out: string | null = null) => ({ attendance_date, approval_state, first_in, last_out });
    const facts = attendanceFacts([
      day('2026-09-26', 'approved', 'x'), day('2026-09-27', 'approved', 'x'), day('2026-09-28', 'pending_review', null, 'y'),
      day('2026-09-29', 'pending_review', null), day('2026-09-30', 'not_materialized', null), day('2026-10-09', 'pending_review', 'x'),
    ], { actual_worked_days: 2, late_days: 1, total_late_minutes: 20, absence_review_days: 1, total_worked_hours: 20, pending_worked_hours: 5 });
    expect([facts.presentDays, facts.settledDays, facts.unsettledDays, facts.lateDays]).toEqual([4, 2, 2, 1]);
    expect(presentDaysThrough(facts, '2026-09-26', '2026-10-07')).toBe(3);
  });
});

describe('doctor eye — real cycles of د/ أحمد حافظ (read-only reconciliation with proven device branches, 2026-10-09)', () => {
  // From the reconciliation functions run against production data with temporary copies only.
  // Date-only imports count only with day-level evidence; a shift moving between branches follows each punch.
  const aug = rec('2026-07-26', { verified: [582, 222261], identityOnly: [207, 51191], uncertain: [144, 53136], zero: 9, present: 25, settled: 16, approvedHours: 178.25, verifiedSales: 227940, settledSales: 187796, conversion: { unknown: 57 } });
  const sep = rec('2026-08-26', { verified: [832, 379570], identityOnly: [59, 21875], uncertain: [3, 347], zero: 14, present: 24, settled: 15, approvedHours: 171.36, verifiedSales: 377862, settledSales: 296413, conversion: { verified: 7, served_other_seller: 5, invoice_not_matching_customer_or_time: 5, no_sale: 7 } });
  const oct = rec('2026-09-26', { verified: [224, 54762], identityOnly: [92, 27879], uncertain: [16, 2733], zero: 4, present: 8, settled: 4, approvedHours: 10.33, approvedDaysWithHours: 1, verifiedSales: 50790, settledSales: 3624, conversion: {} });
  const round = (v: number | null, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

  it('reconciles every invoice into exactly one category with nothing dropped', () => {
    expect([aug, sep, oct].map(r => totalSales(r))).toEqual([326588, 401792, 85374]);
    expect([aug, sep, oct].map(r => r.categories.attendance_verified.invoices + r.categories.identity_only.invoices + r.categories.uncertain.invoices + r.categories.zero_value.invoices)).toEqual([942, 908, 336]);
    expect([aug, sep, oct].map(r => round(verifiedCoverage(r)! * 100))).toEqual([68.1, 94.5, 64.1]);
  });

  it('computes comparable productivity from verified sales only', () => {
    expect([aug, sep, oct].map(r => round(comparableProductivity(r).perAttendanceDay))).toEqual([9117.6, 15744.3, 6348.8]);
    expect([aug, sep, oct].map(r => round(comparableProductivity(r).perApprovedHour))).toEqual([1053.6, 1729.8, null]);
  });

  it('replaces the inflated 70.8% with a verified 50% for September', () => {
    expect(verifiedConversion(sep).rate).toBe(50);
    expect(verifiedConversion(aug).rate).toBe(null);
  });
});
