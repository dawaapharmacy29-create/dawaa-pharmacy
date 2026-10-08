import type { DoctorPerformanceIntelligence, DoctorPerformanceMonth, PerformanceSourceHealth } from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import type { DecisionIntelligence } from '@/lib/evaluations/doctorDecisionIntelligence';
import { isEvaluationCycleClosed } from '@/lib/evaluations/monthlyEvaluationCycle';

/**
 * View model for the Doctor Performance Eye chart: one chart, four tabs.
 *
 * The doctor's own tabs (performance trend, sources of trust) read only the doctor's verified sources, so they never
 * depend on the branch comparison. The comparative tabs (shift productivity, peers) read only the branch decision
 * layer. A missing source makes its own tab explain why; it never removes another tab, and an unknown value is
 * null (drawn as a gap), never zero.
 */
export type EyeChartTabKey = 'trend' | 'shifts' | 'peers' | 'sources';
export type EyeChartTabState = 'ready' | 'loading' | 'not_enabled' | 'failed' | 'insufficient';
export type EyeChartTab = { key: EyeChartTabKey; label: string; available: boolean; state: EyeChartTabState; reason: string | null };

export type EyeTrendMetricKey = 'salesPerPresentDay' | 'invoicesPerPresentDay' | 'salesPerHour' | 'conversion' | 'lateShare' | 'salesPerCalendarDay';
/**
 * `final`: closed cycle with every input settled. `provisional`: shown, but it can still change (running cycle,
 * attendance days pending review, conversation outcomes not all recorded) and is never a final judgement.
 */
export type EyePointStatus = 'final' | 'provisional';
export type EyeTrendPoint = { cycleLabel: string; name: string; running: boolean; value: number | null; status: EyePointStatus | null; note: string | null };
export type EyeTrendMetric = {
  key: EyeTrendMetricKey;
  label: string;
  unit: 'money' | 'count' | 'pct';
  /** What the number is: numerator ÷ denominator and its source, shown under the chart. */
  definition: string;
  /** Context only: never a productivity measure and never the default view. */
  context: boolean;
  available: boolean;
  reason: string | null;
  points: EyeTrendPoint[];
};

export type EyeSourceCellStatus = 'ok' | 'partial' | 'missing' | 'not_applicable';
export type EyeSourceCell = { status: EyeSourceCellStatus; text: string };
export type EyeSourceRow = { key: string; label: string; stateLabel: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; reason: string | null; cells: EyeSourceCell[] | null };

export type EyeChartModel = {
  tabs: EyeChartTab[];
  defaultTab: EyeChartTabKey;
  /** Oldest first, so lines read from past to present. */
  cycles: { cycleLabel: string; name: string; running: boolean }[];
  trend: { metrics: EyeTrendMetric[]; defaultMetric: EyeTrendMetricKey | null };
  shifts: DecisionIntelligence['charts']['shifts'];
  peers: { points: DecisionIntelligence['charts']['peers']; band: DecisionIntelligence['charts']['peerBand'] };
  sources: EyeSourceRow[];
};

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** A 26→25 cycle is named after the month it ends in, which is the month of its label. */
export const eyeCycleName = (cycleLabel: string) => MONTHS[(Number(cycleLabel.slice(5, 7)) + 11) % 12] || cycleLabel;
const ar = (v: number) => v.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
const arDate = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' }); };

/** Minimum outcomes recorded before a conversion rate is drawn; below it the rate is noise. */
export const MIN_CONVERSION_OUTCOMES = 5;
/** Below this share of reviews with a recorded outcome, a conversion rate describes the recorded few, not the doctor. */
export const MIN_CONVERSION_COVERAGE = 0.5;
/** Same minimum settled days the decision engine needs before reading discipline. */
export const MIN_LATENESS_DAYS = 5;

const TAB_LABEL: Record<EyeChartTabKey, string> = { trend: 'تطور الأداء', shifts: 'الإنتاجية حسب الشيفت', peers: 'مقارنة الزملاء', sources: 'مصادر الثقة' };

type PointValue = { value: number | null; status: EyePointStatus | null; note: string | null };
const unknown = (note: string): PointValue => ({ value: null, status: null, note });

function trendPoint(m: DoctorPerformanceMonth, running: boolean, key: EyeTrendMetricKey): PointValue {
  if (m.coverage === 'not_applicable') return unknown('قبل أول دليل للدكتور');
  const d = m.attendanceDetail;
  const pendingNote = d && d.unsettledDays ? `${ar(d.unsettledDays)} يوم حضور بانتظار المراجعة` : null;
  switch (key) {
    case 'salesPerPresentDay':
    case 'invoicesPerPresentDay': {
      const total = key === 'salesPerPresentDay' ? m.sales : m.invoices;
      if (total === null) return unknown('المبيعات غير متاحة لهذه الدورة');
      if (!d || m.salesPresentDays === null) return unknown('أيام الحضور غير متاحة؛ لا يُقسم على أيام تقويمية بدلًا منها');
      if (!m.salesPresentDays) return unknown('لا توجد أيام حضور مسجلة في فترة المبيعات');
      const final = !running && !d.unsettledDays;
      return { value: total / m.salesPresentDays, status: final ? 'final' : 'provisional', note: [`${ar(m.salesPresentDays)} يوم حضور`, running ? 'دورة جارية حتى آخر يوم مبيعات محمّل' : null, pendingNote].filter(Boolean).join('، ') };
    }
    case 'salesPerCalendarDay': {
      if (m.sales === null || !m.salesDays) return unknown('المبيعات غير متاحة لهذه الدورة');
      return { value: m.sales / m.salesDays, status: running ? 'provisional' : 'final', note: `${ar(m.salesDays)} يوم تقويمي${running ? ' محمّل' : ''}` };
    }
    case 'salesPerHour':
      if (m.salesPerHour !== null) return { value: m.salesPerHour, status: 'final', note: m.workedHours === null ? null : `${ar(m.workedHours)} ساعة معتمدة` };
      return unknown(m.hoursNote || (m.workedHours === null ? 'ساعات الحضور غير متاحة' : m.sales === null ? 'المبيعات غير متاحة' : 'الساعات غير مكتملة'));
    case 'conversion': {
      if (m.conversations === null || m.conversionRecorded === null) return unknown('مراجعات المحادثات غير متاحة');
      if (!m.conversations) return unknown('لا توجد مراجعات محادثات');
      const coverage = m.conversionRecorded / m.conversations;
      const coverageText = `نتيجة البيع مسجلة في ${ar(m.conversionRecorded)} من ${ar(m.conversations)} مراجعة`;
      if (m.conversionRecorded === 0) return unknown(`${ar(m.conversations)} مراجعة بدون نتيجة بيع مسجلة — غير معروف وليس صفرًا`);
      if (m.conversionRecorded < MIN_CONVERSION_OUTCOMES) return unknown(`${coverageText}؛ أقل من ${ar(MIN_CONVERSION_OUTCOMES)} نتائج`);
      if (coverage < MIN_CONVERSION_COVERAGE) return unknown(`${coverageText}؛ التغطية أقل من ${ar(MIN_CONVERSION_COVERAGE * 100)}% فلا تمثل أداء الدكتور`);
      const final = !running && coverage === 1 && !m.unverifiedConversions;
      return { value: m.conversionRate, status: final ? 'final' : 'provisional', note: [`${ar(m.convertedConversations || 0)} بيع موثق بفاتورة من ${ar(m.conversionRecorded)} نتيجة مسجلة`, coverage < 1 ? coverageText : null, m.unverifiedConversions ? `${ar(m.unverifiedConversions)} «تم البيع» بلا رقم فاتورة لم تُحسب` : null].filter(Boolean).join('، ') };
    }
    case 'lateShare': {
      if (!d) return unknown('تفاصيل الحضور غير متاحة');
      if (!d.settledDays) return unknown(pendingNote ? `${pendingNote}؛ لا يوجد يوم معتمد بعد` : 'لا توجد أيام حضور');
      // Pending days never clear lateness, so a short settled sample cannot show a clean record.
      if (d.settledDays < MIN_LATENESS_DAYS) return unknown(`${ar(d.settledDays)} يوم معتمد فقط${pendingNote ? ` و${pendingNote}` : ''}؛ أقل من ${ar(MIN_LATENESS_DAYS)} أيام`);
      const final = !running && !d.unsettledDays;
      return { value: (d.lateDays / d.settledDays) * 100, status: final ? 'final' : 'provisional', note: `${ar(d.lateDays)} من ${ar(d.settledDays)} يوم معتمد${pendingNote ? `، و${pendingNote} لم يُحسم تأخيرها` : ''}` };
    }
  }
}

const METRICS: { key: EyeTrendMetricKey; label: string; unit: EyeTrendMetric['unit']; definition: string; missing: string; context?: boolean }[] = [
  { key: 'salesPerPresentDay', label: 'مبيعات/يوم حضور', unit: 'money', definition: 'صافي مبيعات الدكتور (فواتيره الموثقة) ÷ الأيام التي سجّل فيها بصمة حضور أو انصراف في نفس الفترة. يشمل البسط مبيعات أيام بلا بصمة إن وُجدت؛ الإنتاجية المطابقة للحضور بدقة ومقارنة الزملاء في تبويبي الشيفت والزملاء', missing: 'لا توجد دورتان بمبيعات وأيام حضور معروفة.' },
  { key: 'salesPerHour', label: 'مبيعات/ساعة', unit: 'money', definition: 'صافي المبيعات ÷ ساعات الحضور المعتمدة — يُحسب فقط لدورة مكتملة كل أيام حضورها معتمدة', missing: 'لا توجد دورتان مكتملتان بساعات حضور معتمدة بالكامل؛ أيام الحضور المعلقة تجعل الساعات ناقصة.' },
  { key: 'invoicesPerPresentDay', label: 'فواتير/يوم حضور', unit: 'count', definition: 'عدد فواتير الدكتور ÷ أيام الحضور في نفس الفترة', missing: 'لا توجد دورتان بفواتير وأيام حضور معروفة.' },
  { key: 'conversion', label: 'التحويل الموثق', unit: 'pct', definition: `بيع موثق (مراجعة «تم البيع» برقم فاتورة) ÷ المراجعات المسجل لها نتيجة. غير المسجل غير معروف ولا يدخل الحساب؛ يُرسم عند ${MIN_CONVERSION_OUTCOMES} نتائج وتغطية ${MIN_CONVERSION_COVERAGE * 100}% على الأقل`, missing: 'نتائج البيع غير مسجلة بعدد وتغطية كافيين في دورتين.' },
  { key: 'lateShare', label: 'نسبة أيام التأخير', unit: 'pct', definition: 'أيام التأخير المعتمدة ÷ أيام الحضور المعتمدة؛ الأيام المعلقة لم يُحسم تأخيرها فتبقى النسبة مؤقتة', missing: 'لا توجد دورتان بأيام حضور معتمدة كافية.' },
  { key: 'salesPerCalendarDay', label: 'متوسط يومي تقويمي', unit: 'money', definition: 'صافي المبيعات ÷ أيام الدورة التقويمية — سياق فقط، لا يقيس إنتاجية الدكتور ولا يُستخدم لمقارنته بزملائه', missing: 'المبيعات غير متاحة في دورتين على الأقل.', context: true },
];

const SOURCE_STATE_TEXT: Record<PerformanceSourceHealth['state'], string> = { available: 'متاح', partial: 'جزئي', insufficient: 'بيانات غير كافية', not_enabled: 'لم يُفعَّل بعد', failed: 'تعذر التحميل' };
const sourceTone = (s: PerformanceSourceHealth['state']): EyeSourceRow['tone'] => (s === 'available' ? 'success' : s === 'failed' ? 'danger' : s === 'not_enabled' ? 'info' : 'warning');

function comparativeTab(key: 'shifts' | 'peers', decision: DecisionIntelligence | null, decisionLoading: boolean, hasBranch: boolean): EyeChartTab {
  const label = TAB_LABEL[key];
  const needs = key === 'shifts' ? 'تحليل الشيفتات يعتمد على مقارنة الفرع' : 'مقارنة الزملاء تعتمد على مقارنة الفرع';
  if (!decision && decisionLoading) return { key, label, available: false, state: 'loading', reason: 'جاري تحميل مقارنة الفرع…' };
  if (!decision) return { key, label, available: false, state: 'insufficient', reason: hasBranch ? `${needs}، ولم تُحمّل بعد.` : `${needs}، ولا يوجد فرع محدد لهذا الدكتور.` };
  if (decision.availability !== 'ready') return { key, label, available: false, state: decision.availability, reason: `${needs}: ${decision.availabilityReason || 'غير متاحة حاليًا.'}` };
  if (key === 'shifts' && !decision.charts.shifts.length) return { key, label, available: false, state: 'insufficient', reason: 'لا يوجد شيفت بساعات كافية لهذا الدكتور في نطاق التحليل.' };
  if (key === 'peers' && (!decision.charts.peerBand || decision.charts.peers.length < 2)) return { key, label, available: false, state: 'insufficient', reason: decision.indicators.peers.detail || 'عدد الزملاء المؤهلين غير كافٍ لمقارنة عادلة.' };
  return { key, label, available: true, state: 'ready', reason: null };
}

export function buildEyeChartModel(args: { data: DoctorPerformanceIntelligence; decision: DecisionIntelligence | null; decisionLoading: boolean; hasBranch: boolean; now?: Date }): EyeChartModel {
  const { data, decision, decisionLoading, hasBranch } = args;
  const now = args.now || new Date();
  const ordered = [...data.months].reverse();
  const cycles = ordered.map(m => ({ cycleLabel: m.cycleLabel, name: eyeCycleName(m.cycleLabel), running: !isEvaluationCycleClosed(m.cycleLabel, now) }));

  const metrics: EyeTrendMetric[] = METRICS.map(def => {
    const points = ordered.map((m, i) => ({ cycleLabel: m.cycleLabel, name: cycles[i].name, running: cycles[i].running, ...trendPoint(m, cycles[i].running, def.key) }));
    const known = points.filter(p => p.value !== null && Number.isFinite(p.value)).length;
    return { key: def.key, label: def.label, unit: def.unit, definition: def.definition, context: Boolean(def.context), available: known >= 2, reason: known >= 2 ? null : known === 1 ? 'قيمة دورة واحدة فقط؛ لا يُرسم اتجاه من نقطة واحدة.' : def.missing, points };
  });
  // A context-only metric never opens the tab or stands in for productivity.
  const defaultMetric = metrics.find(m => m.available && !m.context)?.key ?? null;
  const ownSourcesDown = (['sales', 'attendance', 'conversations'] as const).filter(k => data.sources[k].state === 'failed' || data.sources[k].state === 'not_enabled');
  const trendReason = defaultMetric ? null : ownSourcesDown.length
    ? `لا توجد دورتان ببيانات فردية كافية لرسم اتجاه. ${ownSourcesDown.map(k => data.sources[k].reason).filter(Boolean).join(' ')}`.trim()
    : 'لا توجد دورتان ببيانات فردية كافية لرسم اتجاه بعد.';

  const tabs: EyeChartTab[] = [
    { key: 'trend', label: TAB_LABEL.trend, available: Boolean(defaultMetric), state: defaultMetric ? 'ready' : 'insufficient', reason: trendReason },
    comparativeTab('shifts', decision, decisionLoading, hasBranch),
    comparativeTab('peers', decision, decisionLoading, hasBranch),
    { key: 'sources', label: TAB_LABEL.sources, available: true, state: 'ready', reason: null },
  ];

  const health = data.sources;
  const cellFor = (m: DoctorPerformanceMonth, running: boolean, key: 'sales' | 'attendance' | 'conversations' | 'customerImpact'): EyeSourceCell => {
    if (m.coverage === 'not_applicable') return { status: 'not_applicable', text: 'قبل أول دليل' };
    if (key === 'sales') {
      if (m.invoices === null) return { status: 'missing', text: 'غير متاح' };
      return { status: running ? 'partial' : 'ok', text: `${ar(m.invoices)} فاتورة${running && health.sales.dataAsOf ? ` حتى ${arDate(health.sales.dataAsOf)}` : ''}` };
    }
    if (key === 'attendance') {
      const d = m.attendanceDetail;
      if (!d) return { status: 'missing', text: 'غير متاح' };
      return { status: d.unsettledDays ? 'partial' : 'ok', text: `${ar(d.presentDays)} يوم حضور${d.unsettledDays ? `، ${ar(d.unsettledDays)} بانتظار المراجعة` : ' معتمد'}` };
    }
    if (key === 'conversations') {
      if (m.conversations === null || m.conversionRecorded === null) return { status: 'missing', text: 'غير متاح' };
      const recorded = m.conversionRecorded;
      return { status: recorded >= m.conversations ? 'ok' : 'partial', text: `${ar(m.conversations)} مراجعة، ${ar(recorded)} بنتيجة بيع` };
    }
    const ci = m.customerImpact;
    if (!ci.available || ci.commercialConversations === null) return { status: 'missing', text: 'لا توجد بيانات' };
    return { status: 'ok', text: `${ar(ci.commercialConversations)} فرصة بيع` };
  };
  const ownRow = (key: 'sales' | 'attendance' | 'conversations' | 'customerImpact', label: string): EyeSourceRow => ({
    key, label, stateLabel: SOURCE_STATE_TEXT[health[key].state], tone: sourceTone(health[key].state), reason: health[key].reason,
    cells: ordered.map((m, i) => cellFor(m, cycles[i].running, key)),
  });
  const branchRow: EyeSourceRow = !decision
    ? { key: 'branch', label: 'مقارنة الفرع', stateLabel: decisionLoading ? 'جاري التحميل' : 'غير محملة', tone: 'neutral', reason: hasBranch ? (decisionLoading ? null : 'لم تُحمّل مقارنة الفرع بعد.') : 'لا يوجد فرع محدد لهذا الدكتور.', cells: null }
    : decision.availability === 'ready'
      ? { key: 'branch', label: 'مقارنة الفرع', stateLabel: 'متاح', tone: 'success', reason: decision.analysisNote, cells: null }
      : { key: 'branch', label: 'مقارنة الفرع', stateLabel: decision.availability === 'not_enabled' ? 'لم يُفعَّل بعد' : decision.availability === 'failed' ? 'تعذر التحميل' : 'بيانات غير كافية', tone: decision.availability === 'failed' ? 'danger' : decision.availability === 'not_enabled' ? 'info' : 'warning', reason: decision.availabilityReason, cells: null };

  return {
    tabs,
    defaultTab: defaultMetric ? 'trend' : 'sources',
    cycles,
    trend: { metrics, defaultMetric },
    shifts: decision?.availability === 'ready' ? decision.charts.shifts : [],
    peers: decision?.availability === 'ready' ? { points: decision.charts.peers, band: decision.charts.peerBand } : { points: [], band: null },
    sources: [ownRow('sales', 'المبيعات'), ownRow('attendance', 'الحضور'), ownRow('conversations', 'المحادثات'), ownRow('customerImpact', 'أثر العملاء'), branchRow],
  };
}
