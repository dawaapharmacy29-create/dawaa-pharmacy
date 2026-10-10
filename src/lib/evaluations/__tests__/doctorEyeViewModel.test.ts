import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEyeChartModel, cycleRangeLabel } from '@/lib/evaluations/doctorEyeChartModel';
import {
  branchComparisonNotice, buildEyeDataQuality, buildEyeDiagnosis, buildEyeHeaderFacts, buildEyeKpis, eyeVerdictLevel,
  DEFAULT_DIAGNOSIS_LIMIT, VERDICT_LEVEL_LABEL,
} from '@/lib/evaluations/doctorEyeViewModel';
import type { AttendanceFacts, DoctorPerformanceIntelligence, DoctorPerformanceMonth, PerformanceSourceHealth } from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import { comparableProductivity, parseSalesReconciliation, verifiedConversion, type CycleReconciliation } from '@/lib/evaluations/doctorSalesReconciliation';
import { unavailableDecision, type DecisionIntelligence, type ProblemSummary } from '@/lib/evaluations/doctorDecisionIntelligence';
import type { DoctorPerformanceVerdict } from '@/lib/evaluations/doctorPerformanceVerdict';
import type { EvaluationHeaderSummary } from '@/lib/evaluations/employeeEvaluationHeaderService';

const RUNNING = new Date('2026-10-08T10:00:00Z'); // cycle 2026-10 (26 Sep → 25 Oct) is running
const CLOSED = new Date('2026-10-28T10:00:00Z'); // cycle 2026-10 is closed
const impact = { available: false, commercialConversations: null, verifiedSaleConversations: null, verifiedRevenue: null, verifiedConversionRate: null, followupsNeeded: null, complaints: null, saleLeakage: null, unavailableProducts: null, acceptedProducts: null };
const detail = (unsettledDays = 0, settledDays = 20, lateDays = 4): AttendanceFacts => ({ presentDays: settledDays + unsettledDays, settledDays, unsettledDays, absenceReviewDays: 0, lateDays, lateMinutes: 80, approvedHours: 160, pendingHours: unsettledDays * 8, presentDates: [] });

function rec(start: string, o: { verified?: [number, number]; present?: number; settled?: number; conversion?: Record<string, number> } = {}): CycleReconciliation {
  const [vi, vs] = o.verified ?? [600, 240000];
  const present = o.present ?? 20, settled = o.settled ?? 20;
  return parseSalesReconciliation({ cycles: [{
    start, endExclusive: start,
    categories: { attendance_verified: { invoices: vi, sales: vs }, identity_only: { invoices: 0, sales: 0 }, uncertain: { invoices: 0, sales: 0 }, zero_value: { invoices: 0, sales: 0 } },
    attendance: { presentDays: present, settledDays: settled, pendingDays: present - settled, approvedHours: 160, approvedDaysWithHours: settled, pendingHours: 0, daysWithoutHours: 0, otherBranchDays: 0, lastDay: null },
    productivity: { verifiedSales: vs, verifiedInvoices: vi, verifiedSalesSettledDays: vs, daysWithVerifiedSales: present },
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
const state = (s: PerformanceSourceHealth['state'], reason: string): PerformanceSourceHealth => ({ ...ok, status: s === 'available' ? 'available' : 'unavailable', state: s, reason, dataAsOf: s === 'failed' ? null : ok.dataAsOf });
function data(months: DoctorPerformanceMonth[], sources: Partial<DoctorPerformanceIntelligence['sources']> = {}): DoctorPerformanceIntelligence {
  return { months, sources: { sales: ok, attendance: ok, conversations: ok, customerImpact: ok, reconciliation: ok, ...sources }, actions: [], generatedAt: '', firstEvidenceDate: null, firstSalesEvidenceDate: null, firstAttendanceEvidenceDate: null, firstConversationEvidenceDate: null };
}
const header = (late: number | null = 2, worked: number | null = 20): EvaluationHeaderSummary => ({
  roleGroup: 'doctor', branch: 'فرع الشامي',
  sales: { state: 'available', total: 1, invoices: 1, avgInvoice: 1, customers: 1, dataAsOf: null },
  conversations: { state: 'available', count: 1, average: 8 },
  attendance: { state: late === null ? 'unavailable' : 'available', workedDays: worked, workedHours: 160, scheduledDays: 22, lateDays: late, absenceReviewDays: 0 },
  timeOff: { state: 'available', permissions: 0, permissionMinutes: 0, annualLeaveCycleDays: 0, annualLeaveYearUsed: 0, annualLeaveYearBalance: 0, weeklyOffDays: 0, otherApprovedLeaveDays: 0 },
  warnings: [],
});
const verdict = (o: Partial<DoctorPerformanceVerdict> = {}): DoctorPerformanceVerdict => ({
  signal: 'stable', signalLabel: '', lead: 'trend', badge: { label: '', tone: 'neutral' }, headline: 'المبيعات مستقرة', metrics: [],
  strength: null, problem: null, action: null, evidenceComplete: true, ...o,
});
const problem = (o: Partial<ProblemSummary>): ProblemSummary => ({
  key: 'lateness', title: 'التأخير', severity: 'medium', trend: 'new', scope: 'individual', scopeDetail: '', detail: 'تفاصيل', probableCause: '', causeCertainty: 'confirmed',
  action: '', owner: 'doctor', successMetric: '', history: [], ...o,
});
const ready = (problems: ProblemSummary[] = [], strength: string | null = null): DecisionIntelligence => ({
  ...unavailableDecision('insufficient', null), availability: 'ready', availabilityReason: null, analysisCycleStart: '2026-09-26', analysisIsEvaluatedCycle: true,
  problems, summary: { headline: 'h', strength, problem: null, decision: null }, confidence: { level: 'high', reasons: [] },
});

const closedData = () => data([month('2026-10'), month('2026-09'), month('2026-08')]);
const runningData = (snapshot: DoctorPerformanceMonth['comparisonSnapshot']) => data([
  month('2026-10', { comparisonMode: 'same_period', comparisonSnapshot: snapshot, attendanceDetail: detail(3), reconciliation: rec('2026-10', { present: 10, settled: 7 }) }),
  month('2026-09'), month('2026-08'),
]);
const kpisOf = (d: DoctorPerformanceIntelligence, now: Date, h: EvaluationHeaderSummary | null = header()) =>
  buildEyeKpis({ data: d, chart: buildEyeChartModel({ data: d, decision: null, decisionLoading: false, hasBranch: true, now }), header: h });
const kpi = (list: ReturnType<typeof kpisOf>, key: string) => list.find(k => k.key === key)!;

describe('doctor eye view model — KPIs never turn missing into zero', () => {
  it('shows an unavailable sales source as null with its reason, never 0', () => {
    const d = data([month('2026-10', { sales: null, invoices: null, coverage: 'partial' }), month('2026-09'), month('2026-08')], { sales: state('failed', 'تعذر تحميل المبيعات') });
    const k = kpisOf(d, CLOSED);
    expect(kpi(k, 'sales').value).toBe(null);
    expect(kpi(k, 'sales').status).toBe(null);
    expect(kpi(k, 'sales').change).toBe(null);
    expect(kpi(k, 'sales').note).toBe('تعذر تحميل المبيعات');
    expect(kpi(k, 'invoices').value).toBe(null);
  });

  it('marks a closed, settled cycle final and a running cycle provisional', () => {
    const closed = kpisOf(closedData(), CLOSED);
    expect(kpi(closed, 'sales').status).toBe('final');
    expect(kpi(closed, 'salesPerDay').status).toBe('final');
    const running = kpisOf(runningData({ days: 12, dataAsOf: '2026-10-07', presentDays: 8, previousPresentDays: 9, sales: 90000, previousSales: 100000, invoices: 450, previousInvoices: 500, customers: 1, previousCustomers: 1, averageInvoice: 1, previousAverageInvoice: 1 }), RUNNING);
    expect(kpi(running, 'sales').status).toBe('provisional');
    expect(kpi(running, 'salesPerDay').status).toBe('provisional');
    expect(kpi(running, 'lateness').status).toBe('provisional');
  });

  it('uses the same-period comparison while the cycle runs and no change for rate KPIs', () => {
    const k = kpisOf(runningData({ days: 12, dataAsOf: '2026-10-07', presentDays: 8, previousPresentDays: 9, sales: 90000, previousSales: 100000, invoices: 450, previousInvoices: 500, customers: 1, previousCustomers: 1, averageInvoice: 1, previousAverageInvoice: 1 }), RUNNING);
    expect(Math.round(kpi(k, 'sales').change!)).toBe(-10);
    expect(Math.round(kpi(k, 'invoices').change!)).toBe(-10);
    expect(kpi(k, 'salesPerDay').change).toBe(null);
    expect(kpi(k, 'salesPerDay').note).toBe('لا مقارنة عادلة أثناء الدورة');
  });

  it('uses the full-cycle comparison once both cycles are eligible', () => {
    const d = data([month('2026-10', { sales: 330000, invoices: 1650 }), month('2026-09'), month('2026-08')]);
    const k = kpisOf(d, CLOSED);
    expect(Math.round(kpi(k, 'sales').change!)).toBe(10);
    expect(kpi(k, 'invoices').note).toBe('عن الدورة السابقة');
  });

  it('shows no change when the comparison is not fair', () => {
    const d = data([month('2026-10', { comparisonMode: 'blocked', comparisonEligible: false, comparisonReason: 'بدأ الدكتور العمل خلال هذه الدورة' }), month('2026-09'), month('2026-08')]);
    const k = kpisOf(d, CLOSED);
    for (const key of ['sales', 'invoices', 'salesPerDay', 'salesPerHour']) expect(kpi(k, key).change).toBe(null);
    expect(kpi(k, 'invoices').note).toBe('بدون مقارنة عادلة');
    expect(kpi(k, 'invoices').noteDetail).toBe('بدأ الدكتور العمل خلال هذه الدورة');
  });

  it('includes conversion only when the chart model deems it eligible', () => {
    expect(kpisOf(closedData(), CLOSED).some(k => k.key === 'conversion')).toBe(true);
    const few = data([month('2026-10', { reconciliation: rec('2026-10', { conversion: { verified: 1, no_sale: 1 } }) }), month('2026-09'), month('2026-08')]);
    expect(kpisOf(few, CLOSED).some(k => k.key === 'conversion')).toBe(false);
  });

  it('keeps lateness unknown (null) when the attendance detail is unavailable', () => {
    expect(kpi(kpisOf(closedData(), CLOSED, header(null, null)), 'lateness').value).toBe(null);
    expect(kpi(kpisOf(closedData(), CLOSED, null), 'lateness').note).toBe('بانتظار ملخص الحضور');
    expect(kpi(kpisOf(closedData(), CLOSED, header(3, 18)), 'lateness').value).toBe(3);
  });
});

describe('doctor eye view model — header, verdict level and diagnosis', () => {
  it('names the 26→25 cycle range and the running state', () => {
    expect(cycleRangeLabel('2026-10')).toBe(`${(26).toLocaleString('ar-EG')} سبتمبر ← ${(25).toLocaleString('ar-EG')} أكتوبر`);
    const facts = buildEyeHeaderFacts({ data: closedData(), cycleLabel: '2026-10', now: RUNNING });
    expect(facts.running).toBe(true);
    expect(facts.dataAsOf).toBe('2026-10-07');
    expect(buildEyeHeaderFacts({ data: closedData(), cycleLabel: '2026-10', now: CLOSED }).running).toBe(false);
  });

  it('maps the existing verdict to a reading, never claiming "no problem" on incomplete evidence', () => {
    expect(eyeVerdictLevel({ verdict: verdict({ lead: 'problem', problem: { text: 'تأخير', evidence: '' } }), ready: null, summaryFromReady: false })).toBe('intervene');
    expect(eyeVerdictLevel({ verdict: verdict(), ready: ready([problem({ severity: 'high' })]), summaryFromReady: true })).toBe('intervene');
    expect(eyeVerdictLevel({ verdict: verdict(), ready: ready([problem({ severity: 'medium' })]), summaryFromReady: true })).toBe('followup');
    expect(eyeVerdictLevel({ verdict: verdict({ signal: 'declining' }), ready: null, summaryFromReady: false })).toBe('followup');
    expect(eyeVerdictLevel({ verdict: verdict({ evidenceComplete: false }), ready: null, summaryFromReady: false })).toBe('undetermined');
    expect(eyeVerdictLevel({ verdict: verdict({ signal: 'improving', strength: { text: 'نمو', evidence: '' } }), ready: null, summaryFromReady: false })).toBe('excellent');
    expect(eyeVerdictLevel({ verdict: verdict(), ready: null, summaryFromReady: false })).toBe('stable');
    expect(eyeVerdictLevel({ verdict: null, ready: null, summaryFromReady: false })).toBe('undetermined');
    // The reading is never worded as an evaluation grade.
    expect(Object.values(VERDICT_LEVEL_LABEL)).not.toContain('ممتاز');
  });

  it('orders the diagnosis: intervention, review, then strengths, without duplicates', () => {
    const d = data([month('2026-10', { diagnoses: [
      { kind: 'sales_trend', severity: 'positive', title: 'نمو المبيعات', detail: 'x', evidence: [] },
      { kind: 'conversion', severity: 'watch', title: 'تحويل منخفض', detail: 'x', evidence: ['10 مراجعة'] },
      { kind: 'opportunity', severity: 'attention', title: 'فرص مفقودة', detail: 'x', evidence: [] },
    ] }), month('2026-09'), month('2026-08')]);
    const items = buildEyeDiagnosis({ data: d, verdict: verdict({ strength: { text: 'نمو المبيعات', evidence: 'فواتير' } }), ready: ready([problem({ title: 'التأخير', severity: 'high' })]) });
    expect(items.map(i => i.group)).toEqual(['intervene', 'intervene', 'review', 'strength']);
    expect(items.filter(i => i.title === 'نمو المبيعات').length).toBe(1);
    expect(items.find(i => i.title === 'تحويل منخفض')!.focus).toBe('conversion');
    // Discipline / productivity findings lead to the per-cycle figures, not to conversation rows.
    expect(items.find(i => i.title === 'التأخير')!.focus).toBe('cycles');
    const lateVerdict = buildEyeDiagnosis({ data: closedData(), verdict: verdict({ lead: 'problem', problem: { text: 'تأخير في ٤ أيام', evidence: 'الحضور الرسمي للدورة' } }), ready: null });
    expect(lateVerdict[0].focus).toBe('cycles');
    expect(DEFAULT_DIAGNOSIS_LIMIT).toBe(5);
  });

  it('ignores branch problems from a comparison that does not cover the evaluated cycle', () => {
    const stale = { ...ready([problem({ title: 'إنتاجية منخفضة', severity: 'high' })]), analysisIsEvaluatedCycle: false };
    expect(buildEyeDiagnosis({ data: closedData(), verdict: verdict(), ready: stale }).some(i => i.title === 'إنتاجية منخفضة')).toBe(false);
  });
});

describe('doctor eye view model — data quality and branch comparison', () => {
  it('separates insufficient data from a load failure and offers retry only for failed/partial', () => {
    const d = data([month('2026-10'), month('2026-09'), month('2026-08')], {
      conversations: state('insufficient', 'عدد المراجعات أقل من الحد'),
      customerImpact: state('not_enabled', 'لم يُفعّل'),
      attendance: state('partial', 'جزء من الحضور لم يُحمّل'),
      sales: state('failed', 'تعذر تحميل المبيعات'),
    });
    const q = buildEyeDataQuality({ data: d, decision: ready(), decisionLoading: false, hasBranch: true });
    const row = (k: string) => q.rows.find(r => r.key === k)!;
    expect(row('conversations').retryable).toBe(false);
    expect(row('conversations').stateLabel).toBe('بيانات غير كافية');
    expect(row('customerImpact').retryable).toBe(false);
    expect(row('attendance').retryable).toBe(true);
    expect(row('sales').retryable).toBe(true);
    expect(q.hasFailure).toBe(true);
    expect(q.complete).toBe(2); // reconciliation + branch
    expect(q.total).toBe(6);
  });

  it('reports the branch comparison calmly and retries it only when it failed', () => {
    const base = closedData();
    const notEnabled = buildEyeDataQuality({ data: base, decision: unavailableDecision('not_enabled', 'لم يُفعّل'), decisionLoading: false, hasBranch: true });
    expect(notEnabled.rows.find(r => r.key === 'branch')!.retryable).toBe(false);
    const failed = buildEyeDataQuality({ data: base, decision: unavailableDecision('failed', 'انتهت المهلة'), decisionLoading: false, hasBranch: true });
    expect(failed.rows.find(r => r.key === 'branch')!.retryable).toBe(true);
    const loading = buildEyeDataQuality({ data: base, decision: null, decisionLoading: true, hasBranch: true });
    expect(loading.rows.find(r => r.key === 'branch')!.state).toBe('loading');
    expect(buildEyeDataQuality({ data: base, decision: null, decisionLoading: false, hasBranch: false }).rows.find(r => r.key === 'branch')!.reason).toBe('لا يوجد فرع محدد لهذا الدكتور.');
    expect(branchComparisonNotice({ decision: unavailableDecision('insufficient', 'عدد الزملاء غير كافٍ'), hasBranch: true })).toBe('عدد الزملاء غير كافٍ');
    expect(branchComparisonNotice({ decision: ready(), hasBranch: true })).toBe(null);
    expect(branchComparisonNotice({ decision: null, hasBranch: true })).toBe(null);
  });

  it('keeps the trend chart when peer data is missing', () => {
    const m = buildEyeChartModel({ data: closedData(), decision: unavailableDecision('insufficient', 'لا زملاء'), decisionLoading: false, hasBranch: true, now: CLOSED });
    expect(m.tabs.find(t => t.key === 'trend')!.available).toBe(true);
    expect(m.tabs.find(t => t.key === 'peers')!.available).toBe(false);
    expect(m.cycles[m.cycles.length - 1].range).toBe(cycleRangeLabel('2026-10'));
  });
});

describe('doctor eye component — runtime contract (source checks)', () => {
  const eye = fs.readFileSync(path.join(process.cwd(), 'src/components/evaluations/DoctorPerformanceEye.tsx'), 'utf8');
  it('clears every per-doctor state when the doctor, cycle, branch or viewer changes', () => {
    const reset = eye.slice(eye.indexOf('requestRef.current += 1;'), eye.indexOf('}, [staffId, cycleLabel, branch, viewerScopeKey]);'));
    for (const setter of ['setData(null)', 'setEvidence(null)', 'setDecisionSources(null)', 'setShowAllDiagnosis(false)', 'setQualityOpen(false)', 'setDetailsOpen(false)']) expect(reset).toContain(setter);
  });
  it('never queries the database and never builds figures outside the canonical models', () => {
    expect(eye.includes('supabase.')).toBe(false);
    for (const builder of ['buildEyeKpis(', 'buildEyeDataQuality(', 'buildEyeDiagnosis(', 'buildEyeChartModel(', 'buildDoctorPerformanceVerdict(']) expect(eye).toContain(builder);
  });
  it('retries the comparison without reloading the primary summary, and only while idle', () => {
    expect(eye).toContain('const retryComparison = () => { if (!decisionLoading) void loadDecision(true, requestRef.current); };');
  });
  it('loads evidence only on request', () => {
    const loadBody = eye.slice(eye.indexOf('async function load(force: boolean)'), eye.indexOf('function show()'));
    expect(loadBody.includes('loadDoctorPerformanceEvidence')).toBe(false);
    expect(eye).toContain('hidden={!detailsOpen}');
  });
});
