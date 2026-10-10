import type { DoctorPerformanceDiagnosis, DoctorPerformanceIntelligence, PerformanceSourceHealth } from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import type { EvaluationHeaderSummary } from '@/lib/evaluations/employeeEvaluationHeaderService';
import { fairSalesChange, type DoctorPerformanceVerdict } from '@/lib/evaluations/doctorPerformanceVerdict';
import { SCOPE_LABEL, TREND_LABEL, type DecisionIntelligence, type Severity } from '@/lib/evaluations/doctorDecisionIntelligence';
import { cycleRangeLabel, type EyeChartModel, type EyePointStatus, type EyeTrendMetricKey } from '@/lib/evaluations/doctorEyeChartModel';
import { isEvaluationCycleClosed } from '@/lib/evaluations/monthlyEvaluationCycle';

export { cycleRangeLabel };

/**
 * Presentation model of the Doctor Performance Eye (executive layout).
 *
 * It composes outputs that already exist — the doctor verdict, the branch decision layer, the chart model and the
 * source-health contract — into what the screen shows first. It computes no new business figure: every number comes
 * from those sources, an unknown value stays null (never zero), and a change is shown only where the existing fair
 * comparison rules allow it.
 */

// ---------------------------------------------------------------------------------------------------------------
// A) Executive header
// ---------------------------------------------------------------------------------------------------------------
export type EyeHeaderFacts = {
  cycleRange: string;
  running: boolean;
  /** Short data-confidence label for the evaluated cycle, from the month's own coverage/confidence. */
  confidence: { label: string; tone: 'success' | 'info' | 'warning' | 'danger' };
  /** Last day with loaded sales; null when unknown (never today's date as a guess). */
  dataAsOf: string | null;
};

export function buildEyeHeaderFacts(args: { data: DoctorPerformanceIntelligence; cycleLabel: string; now?: Date }): EyeHeaderFacts {
  const cur = args.data.months[0];
  const running = !isEvaluationCycleClosed(args.cycleLabel, args.now || new Date());
  const confidence = !cur || cur.coverage === 'unavailable'
    ? { label: 'البيانات غير متاحة', tone: 'danger' as const }
    : cur.coverage === 'partial' ? { label: 'بيانات جزئية', tone: 'warning' as const }
    : cur.confidence === 'high' ? { label: 'ثقة عالية', tone: 'success' as const }
    : cur.confidence === 'medium' ? { label: 'ثقة متوسطة', tone: 'info' as const }
    : { label: 'ثقة منخفضة', tone: 'warning' as const };
  return { cycleRange: cycleRangeLabel(args.cycleLabel), running, confidence, dataAsOf: args.data.sources.sales.dataAsOf || null };
}

// ---------------------------------------------------------------------------------------------------------------
// B) Executive verdict level — a display reading of the existing verdict / decision outputs, never a new judgement.
// ---------------------------------------------------------------------------------------------------------------
export type EyeVerdictLevel = 'intervene' | 'followup' | 'excellent' | 'stable' | 'undetermined';
/**
 * Worded as a reading of the evidence, not as an evaluation grade: the monthly evaluation stays the only grade, so the
 * grade word «ممتاز» (points / evaluation tiers) is deliberately not used here.
 */
export const VERDICT_LEVEL_LABEL: Record<EyeVerdictLevel, string> = {
  intervene: 'يحتاج تدخل', followup: 'يحتاج متابعة', excellent: 'أداء قوي', stable: 'مستقر', undetermined: 'الأدلة غير مكتملة',
};
export const VERDICT_LEVEL_TONE: Record<EyeVerdictLevel, 'danger' | 'warning' | 'success' | 'info' | 'neutral'> = {
  intervene: 'danger', followup: 'warning', excellent: 'success', stable: 'info', undetermined: 'neutral',
};

/**
 * Mapping (in priority order):
 * - intervene: the speaking layer's top problem is a priority one (decision severity critical/high, or the verdict
 *   leads with a safety, customer-harm or discipline problem).
 * - followup: any other documented problem, or the fair sales trend is declining.
 * - undetermined: no documented problem but the evidence is incomplete — "no problem" cannot be claimed.
 * - excellent: complete evidence, no problem, improving trend and a documented strength.
 * - stable: complete evidence and no problem.
 */
export function eyeVerdictLevel(args: { verdict: DoctorPerformanceVerdict | null; ready: DecisionIntelligence | null; summaryFromReady: boolean }): EyeVerdictLevel {
  const { verdict, ready, summaryFromReady } = args;
  if (!verdict) return 'undetermined';
  const top = summaryFromReady ? ready?.problems[0] : undefined;
  const priority = (s: Severity | undefined) => s === 'critical' || s === 'high';
  if ((summaryFromReady && priority(top?.severity)) || verdict.lead === 'problem') return 'intervene';
  if ((summaryFromReady ? Boolean(top) : false) || verdict.problem || verdict.signal === 'declining') return 'followup';
  if (!verdict.evidenceComplete) return 'undetermined';
  if (verdict.signal === 'improving' && verdict.strength) return 'excellent';
  return 'stable';
}

// ---------------------------------------------------------------------------------------------------------------
// C) Core KPI strip
// ---------------------------------------------------------------------------------------------------------------
export type EyeKpi = {
  key: 'sales' | 'salesPerDay' | 'salesPerHour' | 'invoices' | 'conversion' | 'lateness';
  label: string;
  unit: 'money' | 'count' | 'pct' | 'days';
  value: number | null;
  status: EyePointStatus | null;
  /** Fair change in %, or null when no fair comparison exists (never a change across an unfair basis). */
  change: number | null;
  /** Short line under the value: the comparison basis, or why it is unavailable / not compared. */
  note: string | null;
  /** Full explanation for the tooltip (the complete reason when no fair comparison exists). */
  noteDetail: string | null;
};

const pctChange = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined || b === 0 ? null : ((a - b) / Math.abs(b)) * 100;

export function buildEyeKpis(args: { data: DoctorPerformanceIntelligence; chart: EyeChartModel; header: EvaluationHeaderSummary | null }): EyeKpi[] {
  const { data, chart, header } = args;
  const cur = data.months[0], prev = data.months[1];
  if (!cur) return [];
  const running = chart.cycles[chart.cycles.length - 1]?.running ?? false;
  const fullFair = Boolean(prev && cur.comparisonMode === 'full_cycle' && cur.comparisonEligible && prev.comparisonEligible && prev.coverage !== 'not_applicable');
  const snap = cur.comparisonMode === 'same_period' ? cur.comparisonSnapshot : null;
  const noFairNote = snap ? 'لا مقارنة عادلة أثناء الدورة' : 'بدون مقارنة عادلة';
  const noFairDetail = snap ? 'المعدلات لا تُقارن أثناء دورة جارية؛ تُقارن المبيعات والفواتير عن نفس الفترة فقط.' : cur.comparisonReason || null;
  const salesStatus: EyePointStatus | null = cur.sales === null ? null : running || cur.coverage !== 'available' ? 'provisional' : 'final';

  const fromChart = (key: EyeTrendMetricKey) => {
    const metric = chart.trend.metrics.find(m => m.key === key);
    const points = metric?.points || [];
    return { now: points[points.length - 1] || null, before: points[points.length - 2] || null };
  };
  const chartKpi = (key: EyeKpi['key'], metricKey: EyeTrendMetricKey, label: string, unit: EyeKpi['unit']): EyeKpi => {
    const { now, before } = fromChart(metricKey);
    const value = now?.value ?? null;
    const change = fullFair && now?.status === 'final' && before?.status === 'final' ? pctChange(value, before.value) : null;
    return { key, label, unit, value, status: value === null ? null : now!.status, change,
      note: value === null ? now?.note || 'غير متاح' : change !== null ? 'عن الدورة السابقة' : noFairNote,
      noteDetail: value === null ? now?.note || null : change !== null ? null : noFairDetail };
  };

  const sales = fairSalesChange(data);
  const kpis: EyeKpi[] = [
    { key: 'sales', label: 'المبيعات الموثقة', unit: 'money', value: cur.sales, status: salesStatus, change: cur.sales === null ? null : sales.pct,
      note: cur.sales === null ? data.sources.sales.reason || 'مصدر المبيعات لم يُحمّل' : sales.pct !== null ? sales.basis : 'بدون مقارنة عادلة',
      noteDetail: cur.sales === null ? data.sources.sales.reason : sales.pct !== null ? null : sales.reason || null },
    chartKpi('salesPerDay', 'verifiedSalesPerDay', 'مبيعات/يوم حضور مثبت', 'money'),
    chartKpi('salesPerHour', 'salesPerHour', 'مبيعات/ساعة', 'money'),
    { key: 'invoices', label: 'الفواتير الموثقة', unit: 'count', value: cur.invoices, status: cur.invoices === null ? null : salesStatus,
      change: cur.invoices === null ? null : snap ? pctChange(snap.invoices, snap.previousInvoices) : fullFair ? pctChange(cur.invoices, prev?.invoices) : null,
      note: cur.invoices === null ? data.sources.sales.reason || 'مصدر المبيعات لم يُحمّل' : snap ? sales.basis || 'عن نفس الفترة' : fullFair ? 'عن الدورة السابقة' : noFairNote,
      noteDetail: cur.invoices === null ? data.sources.sales.reason : snap || fullFair ? null : noFairDetail },
  ];
  // Conversion is shown only when the chart model deems it eligible (enough recorded outcomes and coverage).
  const conversion = chartKpi('conversion', 'conversion', 'التحويل الموثق', 'pct');
  if (conversion.value !== null) kpis.push(conversion);
  // Lateness from the same canonical attendance detail as the evaluation header (the verdict's discipline source).
  const att = header?.attendance;
  const lateKnown = att?.state === 'available' && att.lateDays !== null && att.workedDays !== null;
  kpis.push({ key: 'lateness', label: 'أيام التأخير', unit: 'days', value: lateKnown ? Number(att!.lateDays) : null, status: lateKnown ? (running ? 'provisional' : 'final') : null, change: null,
    note: lateKnown ? `من ${Number(att!.workedDays).toLocaleString('ar-EG')} يوم حضور` : header ? 'تفاصيل الحضور غير متاحة' : 'بانتظار ملخص الحضور', noteDetail: null });
  return kpis;
}

// ---------------------------------------------------------------------------------------------------------------
// E) Diagnosis: why this result
// ---------------------------------------------------------------------------------------------------------------
export type EyeEvidenceFocus = 'all' | 'conversion' | 'opportunity' | 'availability';
/**
 * Where "عرض الدليل" leads: conversation/product evidence (with a focus), or the per-cycle table of attendance days,
 * hours and sales ('cycles') for findings about discipline, productivity or the sales trend.
 */
export type EyeEvidenceTarget = EyeEvidenceFocus | 'cycles';
export type EyeDiagnosisGroup = 'intervene' | 'review' | 'strength';
export type EyeDiagnosisItem = {
  id: string;
  group: EyeDiagnosisGroup;
  title: string;
  reason: string;
  /** Trend / scope / evidence basis — what this finding touches. */
  impact: string | null;
  confidence: 'high' | 'medium' | 'low';
  focus: EyeEvidenceTarget;
};
export const DIAGNOSIS_GROUP_LABEL: Record<EyeDiagnosisGroup, string> = { intervene: 'تحتاج تدخل', review: 'للمراجعة', strength: 'نقاط القوة' };
export const DEFAULT_DIAGNOSIS_LIMIT = 5;

const focusForDiagnosis = (d: DoctorPerformanceDiagnosis): EyeEvidenceTarget =>
  d.kind === 'conversion' ? 'conversion' : d.kind === 'opportunity' ? 'opportunity' : d.kind === 'customer_impact' ? (d.severity === 'watch' ? 'availability' : 'all')
  : 'cycles'; // sales trend, efficiency, data quality: the per-cycle figures are the evidence
const PROBLEM_TARGET: Record<string, EyeEvidenceTarget> = { lateness: 'cycles', low_productivity: 'cycles', attribution_gap: 'cycles', medical_error: 'all', customer_harm: 'all', weak_conversation: 'all' };
/** The verdict names its evidence source; map it to where that evidence is shown. */
const targetForVerdictEvidence = (evidence: string): EyeEvidenceTarget =>
  evidence.includes('الحضور') || evidence.includes('فواتير') ? 'cycles' : evidence.includes('أثر العملاء') ? 'opportunity' : 'all';

export function buildEyeDiagnosis(args: { data: DoctorPerformanceIntelligence; verdict: DoctorPerformanceVerdict | null; ready: DecisionIntelligence | null }): EyeDiagnosisItem[] {
  const { data, verdict, ready } = args;
  const cur = data.months[0];
  const monthConfidence = cur?.confidence || 'low';
  const items: EyeDiagnosisItem[] = [];
  const seen = new Set<string>();
  const add = (item: EyeDiagnosisItem) => { const k = item.title.trim(); if (seen.has(k)) return; seen.add(k); items.push(item); };

  // Doctor-level priority problem from the verdict (safety, customer harm, discipline) leads.
  if (verdict?.lead === 'problem' && verdict.problem) add({ id: 'verdict-problem', group: 'intervene', title: verdict.problem.text, reason: verdict.action?.text || verdict.headline, impact: verdict.problem.evidence, confidence: 'high', focus: targetForVerdictEvidence(verdict.problem.evidence) });
  // Branch decision problems (only from a ready comparison covering the evaluated cycle).
  if (ready && ready.analysisIsEvaluatedCycle) {
    for (const p of ready.problems) {
      add({ id: `problem-${p.key}`, group: p.severity === 'critical' || p.severity === 'high' ? 'intervene' : 'review', title: p.title,
        reason: p.causeCertainty === 'hypothesis' ? `${p.detail} — السبب المحتمل: ${p.probableCause} (فرضية تحتاج تحقق)` : p.detail,
        impact: `${TREND_LABEL[p.trend]} · ${SCOPE_LABEL[p.scope]}`, confidence: ready.confidence.level, focus: PROBLEM_TARGET[p.key] || 'all' });
    }
  }
  // The doctor's own sales/customer findings.
  for (const [i, d] of (cur?.diagnoses || []).entries()) {
    add({ id: `diag-${d.kind}-${i}`, group: d.severity === 'attention' ? 'intervene' : d.severity === 'watch' ? 'review' : 'strength', title: d.title, reason: d.detail,
      impact: d.evidence.length ? d.evidence.slice(0, 3).join(' · ') : null, confidence: monthConfidence, focus: focusForDiagnosis(d) });
  }
  // A documented non-priority verdict problem and the verdict's strength, when not already covered.
  if (verdict?.lead !== 'problem' && verdict?.problem) add({ id: 'verdict-review', group: 'review', title: verdict.problem.text, reason: verdict.action?.text || verdict.headline, impact: verdict.problem.evidence, confidence: monthConfidence, focus: targetForVerdictEvidence(verdict.problem.evidence) });
  if (ready?.analysisIsEvaluatedCycle && ready.summary.strength) add({ id: 'ready-strength', group: 'strength', title: ready.summary.strength, reason: ready.indicators.peers.detail, impact: null, confidence: ready.confidence.level, focus: 'cycles' });
  if (verdict?.strength) add({ id: 'verdict-strength', group: 'strength', title: verdict.strength.text, reason: `الدليل: ${verdict.strength.evidence}`, impact: null, confidence: monthConfidence, focus: targetForVerdictEvidence(verdict.strength.evidence) });

  const order: Record<EyeDiagnosisGroup, number> = { intervene: 0, review: 1, strength: 2 };
  return items.map((x, i) => ({ x, i })).sort((a, b) => order[a.x.group] - order[b.x.group] || a.i - b.i).map(({ x }) => x);
}

// ---------------------------------------------------------------------------------------------------------------
// G) Data trust / source health
// ---------------------------------------------------------------------------------------------------------------
export type EyeSourceState = PerformanceSourceHealth['state'] | 'loading';
export type EyeSourceRow = {
  key: 'sales' | 'reconciliation' | 'attendance' | 'conversations' | 'customerImpact' | 'branch';
  label: string;
  state: EyeSourceState;
  stateLabel: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  reason: string | null;
  /** Re-requesting helps only a real (or partial) read failure; "not enabled" and "insufficient" are stable answers. */
  retryable: boolean;
  dataAsOf: string | null;
};
export type EyeDataQuality = { complete: number; total: number; hasFailure: boolean; retryable: boolean; rows: EyeSourceRow[] };

export const SOURCE_STATE_LABEL: Record<EyeSourceState, string> = { available: 'متاح', partial: 'جزئي', insufficient: 'بيانات غير كافية', not_enabled: 'لم يُفعَّل بعد', failed: 'تعذر التحميل', loading: 'جاري التحميل' };
const stateTone = (s: EyeSourceState): EyeSourceRow['tone'] => s === 'available' ? 'success' : s === 'failed' ? 'danger' : s === 'not_enabled' ? 'info' : s === 'loading' ? 'neutral' : 'warning';

export function buildEyeDataQuality(args: { data: DoctorPerformanceIntelligence; decision: DecisionIntelligence | null; decisionLoading: boolean; hasBranch: boolean }): EyeDataQuality {
  const { data, decision, decisionLoading, hasBranch } = args;
  const own = ([['sales', 'المبيعات'], ['reconciliation', 'مطابقة المبيعات بالحضور'], ['attendance', 'الحضور'], ['conversations', 'المحادثات'], ['customerImpact', 'أثر العملاء']] as const)
    .map(([key, label]): EyeSourceRow => {
      const s = data.sources[key];
      return { key, label, state: s.state, stateLabel: SOURCE_STATE_LABEL[s.state], tone: stateTone(s.state), reason: s.reason, retryable: s.state === 'failed' || s.state === 'partial', dataAsOf: s.dataAsOf };
    });
  const branchState: EyeSourceState = !hasBranch ? 'insufficient'
    : !decision ? (decisionLoading ? 'loading' : 'insufficient')
    : decision.availability === 'ready' ? 'available' : decision.availability;
  const branchReason = !hasBranch ? 'لا يوجد فرع محدد لهذا الدكتور.'
    : !decision ? (decisionLoading ? null : 'لم تُحمّل مقارنة الفرع بعد.')
    : decision.availability === 'ready' ? decision.analysisNote : decision.availabilityReason;
  const branch: EyeSourceRow = { key: 'branch', label: 'مقارنة الفرع', state: branchState, stateLabel: SOURCE_STATE_LABEL[branchState], tone: stateTone(branchState), reason: branchReason, retryable: branchState === 'failed', dataAsOf: null };
  const rows = [...own, branch];
  return {
    complete: rows.filter(r => r.state === 'available').length,
    total: rows.length,
    hasFailure: rows.some(r => r.state === 'failed'),
    retryable: rows.some(r => r.retryable),
    rows,
  };
}

/** Phase 3: a short, calm explanation when the branch comparison cannot speak for this cycle; null when it can. */
export function branchComparisonNotice(args: { decision: DecisionIntelligence | null; hasBranch: boolean }): string | null {
  const { decision, hasBranch } = args;
  if (!hasBranch) return 'لا يوجد فرع محدد لهذا الدكتور.';
  if (!decision) return null; // still loading or not requested: the comparative layer simply waits
  if (decision.availability === 'ready') return decision.analysisIsEvaluatedCycle ? null : decision.analysisNote;
  return decision.availabilityReason || 'لا توجد بيانات كافية للمقارنة بزملاء الفرع.';
}
