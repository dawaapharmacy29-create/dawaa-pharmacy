import type { DoctorPerformanceIntelligence } from '@/lib/evaluations/doctorPerformanceIntelligenceService';
import type { EvaluationHeaderSummary } from '@/lib/evaluations/employeeEvaluationHeaderService';
import type { MonthlyConversationCoaching } from '@/lib/staff/employeeMonthlyEvidenceService';

/**
 * 10-second decision summary for the Doctor Performance Eye.
 *
 * It is a reading of evidence, never a score: the manager's monthly evaluation stays the only grade.
 * Inputs are the evidence the evaluation page already loaded (header + conversation coaching) plus the
 * Eye's sales intelligence, so the Eye cannot tell a different story than the page it opens from.
 * Problems are ranked by risk and only count when they are within the doctor's control and cross an
 * explicit threshold; unavailable evidence is reported as such, never as zero or as "no problem".
 */

export type VerdictSignal = 'improving' | 'stable' | 'declining' | 'insufficient';
export type VerdictTone = 'success' | 'warning' | 'danger' | 'neutral';

export type VerdictMetric = { key: 'sales' | 'discipline' | 'quality'; label: string; value: string; note: string; tone: VerdictTone };
export type VerdictLine = { text: string; evidence: string };
export type VerdictAction = { text: string; owner: 'doctor' | 'manager' };

export type DoctorPerformanceVerdict = {
  signal: VerdictSignal;
  signalLabel: string;
  /** What the headline leads with: a priority problem (safety, customer harm, discipline) outranks the sales trend. */
  lead: 'problem' | 'trend';
  badge: { label: string; tone: VerdictTone };
  headline: string;
  metrics: VerdictMetric[];
  strength: VerdictLine | null;
  problem: VerdictLine | null;
  /** Only an action tied to a documented problem; never a recommendation derived from a missing source. */
  action: VerdictAction | null;
  /** True only when every source loaded and the evidence is sufficient to say "no problem". */
  evidenceComplete: boolean;
};

export const VERDICT_RULES = {
  trendPct: 5,
  salesDeclinePct: -10,
  salesGrowthPct: 10,
  lateMinDays: 3,
  lateMinShare: 0.2,
  disciplineMinWorkedDays: 10,
  conversationWeak: 7,
  conversationStrong: 8.5,
  conversionWeakPct: 25,
  conversionMinOpportunities: 5,
} as const;

const num = (v: number, d = 0) => v.toLocaleString('ar-EG', { maximumFractionDigits: d, minimumFractionDigits: d });
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v), 1)}%`;
const change = (a: number | null | undefined, b: number | null | undefined) =>
  a === null || a === undefined || b === null || b === undefined || b === 0 ? null : ((a - b) / Math.abs(b)) * 100;

/** Fair sales change only: same-period while the cycle runs, full cycle once both cycles are eligible. */
export function fairSalesChange(data: DoctorPerformanceIntelligence): { pct: number | null; basis: string; reason: string } {
  const cur = data.months[0], prev = data.months[1];
  if (!cur || !prev) return { pct: null, basis: '', reason: 'لا توجد دورة سابقة للمقارنة.' };
  const snap = cur.comparisonMode === 'same_period' ? cur.comparisonSnapshot : null;
  if (snap) return { pct: change(snap.sales, snap.previousSales), basis: `عن نفس الفترة (${num(snap.days || 0)} يوم)`, reason: '' };
  if (cur.comparisonMode === 'full_cycle' && cur.comparisonEligible && prev.comparisonEligible && prev.coverage !== 'not_applicable') {
    return { pct: change(cur.sales, prev.sales), basis: 'عن الدورة السابقة', reason: '' };
  }
  return { pct: null, basis: '', reason: cur.comparisonReason };
}

export function buildDoctorPerformanceVerdict(args: {
  data: DoctorPerformanceIntelligence;
  header: EvaluationHeaderSummary | null;
  conversation: MonthlyConversationCoaching | null;
}): DoctorPerformanceVerdict {
  const { data, header, conversation } = args;
  const cur = data.months[0];
  const salesAvailable = data.sources.sales.status === 'available' && cur?.sales !== null && cur?.sales !== undefined;
  const sales = fairSalesChange(data);

  // Discipline comes from the same canonical attendance detail the evaluation header shows.
  const attendanceReady = header?.attendance.state === 'available' && header.attendance.workedDays !== null && header.attendance.lateDays !== null;
  const worked = attendanceReady ? Number(header!.attendance.workedDays) : null;
  const late = attendanceReady ? Number(header!.attendance.lateDays) : null;

  const conversationReady = Boolean(conversation?.sampleSufficient && conversation.coreAverage !== null);
  const flags = conversation?.flags;

  const metrics: VerdictMetric[] = [
    {
      key: 'sales', label: 'المبيعات',
      value: salesAvailable ? `${num(cur!.sales!)} ج` : 'غير متاح',
      note: !salesAvailable ? (data.sources.sales.reason || 'مصدر المبيعات لم يُحمّل — ليس صفرًا') : sales.pct !== null ? `${signed(sales.pct)} ${sales.basis}` : 'لا مقارنة عادلة بعد',
      tone: !salesAvailable ? 'neutral' : sales.pct === null ? 'neutral' : sales.pct <= VERDICT_RULES.salesDeclinePct ? 'danger' : sales.pct >= VERDICT_RULES.trendPct ? 'success' : 'neutral',
    },
    {
      key: 'discipline', label: 'الانضباط',
      value: late !== null && worked !== null ? `${num(late)} تأخير` : 'غير متاح',
      note: late !== null && worked !== null ? `من ${num(worked)} يوم حضور` : header ? 'تفاصيل الحضور غير متاحة' : 'بانتظار ملخص الحضور',
      tone: late === null || worked === null ? 'neutral' : late === 0 ? 'success' : late >= VERDICT_RULES.lateMinDays && late / Math.max(worked, 1) >= VERDICT_RULES.lateMinShare ? 'danger' : 'warning',
    },
    {
      key: 'quality', label: 'جودة التعامل',
      value: conversationReady ? `${num(conversation!.coreAverage!, 1)}/10` : 'غير كافٍ',
      note: conversation ? `${num(conversation.reviewCount)} محادثة مراجعة${conversationReady ? '' : ` — الحد الأدنى ${num(conversation.minSamples)}`}` : 'بانتظار دليل المحادثات',
      tone: !conversationReady ? 'neutral' : conversation!.coreAverage! < VERDICT_RULES.conversationWeak ? 'danger' : conversation!.coreAverage! >= VERDICT_RULES.conversationStrong ? 'success' : 'warning',
    },
  ];

  // Problems in risk order: patient safety > customer harm > discipline > sales > conversation skill > open opportunities.
  // `priority` problems lead the headline ahead of any sales trend.
  const problems: { line: VerdictLine; action: VerdictAction; short: string; priority?: boolean }[] = [];
  if (flags && (flags.medicalErrors > 0 || flags.criticalErrors > 0)) {
    const n = Math.max(flags.medicalErrors, flags.criticalErrors);
    problems.push({ priority: true, short: 'أخطاء حرجة في المحادثات', line: { text: `أخطاء طبية/حرجة موثقة في ${num(n)} محادثة`, evidence: 'تقييم المحادثات' }, action: { owner: 'manager', text: 'مراجعة هذه المحادثات مع الدكتور قبل اعتماد التقييم.' } });
  }
  if (flags && (flags.complaints > 0 || flags.severeBadTone > 0)) {
    problems.push({ priority: true, short: 'شكاوى العملاء', line: { text: `${num(flags.complaints)} شكوى و${num(flags.severeBadTone)} حالة أسلوب غير مناسب`, evidence: 'تقييم المحادثات' }, action: { owner: 'manager', text: 'جلسة مراجعة لأسلوب التعامل على حالات الشكاوى الموثقة.' } });
  }
  if (late !== null && worked !== null && late >= VERDICT_RULES.lateMinDays && late / Math.max(worked, 1) >= VERDICT_RULES.lateMinShare) {
    problems.push({ priority: true, short: 'التأخير', line: { text: `تأخير في ${num(late)} من ${num(worked)} يوم حضور`, evidence: 'الحضور الرسمي للدورة' }, action: { owner: 'doctor', text: `خفض التأخير إلى ${num(Math.floor(late / 2))} أيام أو أقل في الدورة القادمة.` } });
  }
  if (salesAvailable && sales.pct !== null && sales.pct <= VERDICT_RULES.salesDeclinePct) {
    problems.push({ short: 'تراجع المبيعات', line: { text: `المبيعات أقل ${num(Math.abs(sales.pct), 1)}% ${sales.basis}`, evidence: 'فواتير الدكتور الموثقة' }, action: { owner: 'manager', text: 'مراجعة أسباب التراجع مع الدكتور (الساعات، العملاء، متوسط الفاتورة) من التفاصيل.' } });
  }
  const weakest = conversationReady ? conversation!.weaknesses[0] : undefined;
  if (weakest && weakest.average < VERDICT_RULES.conversationWeak) {
    const training = conversation!.trainingRecommendations[0];
    problems.push({ short: `ضعف ${weakest.label}`, line: { text: `ضعف في ${weakest.label} (${num(weakest.average, 1)}/10)`, evidence: `${num(weakest.samples)} محادثة` }, action: { owner: 'doctor', text: training || `تدريب مركز على ${weakest.label} خلال الدورة القادمة.` } });
  }
  const impact = cur?.customerImpact;
  if (impact?.available && (impact.commercialConversations || 0) >= VERDICT_RULES.conversionMinOpportunities && impact.verifiedConversionRate !== null && impact.verifiedConversionRate < VERDICT_RULES.conversionWeakPct) {
    problems.push({ short: 'فرص بيع لا تُغلق', line: { text: `${num(impact.verifiedSaleConversations || 0)} بيع مؤكد من ${num(impact.commercialConversations || 0)} فرصة تجارية`, evidence: 'أثر العملاء' }, action: { owner: 'doctor', text: `متابعة ${num(impact.followupsNeeded || 0)} فرصة مفتوحة وتسجيل نتيجة كل منها.` } });
  }

  // Strengths in evidence-strength order.
  const strengths: VerdictLine[] = [];
  if (salesAvailable && sales.pct !== null && sales.pct >= VERDICT_RULES.salesGrowthPct) strengths.push({ text: `نمو المبيعات ${signed(sales.pct)} ${sales.basis}`, evidence: 'فواتير الدكتور الموثقة' });
  const best = conversationReady ? conversation!.strengths[0] : undefined;
  if (best) strengths.push({ text: `تميز في ${best.label} (${num(best.average, 1)}/10)`, evidence: `${num(best.samples)} محادثة` });
  if (late === 0 && worked !== null && worked >= VERDICT_RULES.disciplineMinWorkedDays) strengths.push({ text: `انضباط كامل: بدون تأخير في ${num(worked)} يوم`, evidence: 'الحضور الرسمي للدورة' });
  if (impact?.available && (impact.acceptedProducts || 0) > 0) strengths.push({ text: `${num(impact.acceptedProducts!)} ترشيح قبله العملاء`, evidence: 'أثر العملاء' });

  const signal: VerdictSignal = !salesAvailable || sales.pct === null ? 'insufficient' : sales.pct >= VERDICT_RULES.trendPct ? 'improving' : sales.pct <= -VERDICT_RULES.trendPct ? 'declining' : 'stable';
  const signalLabel = signal === 'improving' ? 'المبيعات تتحسن ↑' : signal === 'declining' ? 'المبيعات تتراجع ↓' : signal === 'stable' ? 'المبيعات مستقرة →' : salesAvailable ? 'لا مقارنة عادلة بعد' : 'المبيعات غير متاحة الآن';
  const problem = problems[0] || null;
  const salesClause = !salesAvailable ? 'لا يمكن قراءة المبيعات الآن' : signal === 'insufficient' ? 'لا توجد مقارنة مبيعات عادلة بعد' : signal === 'improving' ? 'المبيعات تتحسن' : signal === 'declining' ? 'المبيعات تتراجع' : 'المبيعات مستقرة';
  const lead: DoctorPerformanceVerdict['lead'] = problem?.priority ? 'problem' : 'trend';
  const trendAfterProblem = !salesAvailable ? 'والمبيعات غير متاحة الآن' : signal === 'improving' ? 'رغم تحسن المبيعات' : signal === 'declining' ? 'والمبيعات تتراجع أيضًا' : signal === 'stable' ? 'والمبيعات مستقرة' : 'ولا توجد مقارنة مبيعات عادلة بعد';
  const evidenceIncomplete = !salesAvailable || data.sources.conversations.status !== 'available' || data.sources.customerImpact.status !== 'available' || !conversationReady || !attendanceReady;
  const headline = lead === 'problem'
    ? `الأولوية: ${problem!.line.text} — ${trendAfterProblem}.`
    : problem
      ? `${salesClause}، والمشكلة الأساسية: ${problem.short}.`
      : evidenceIncomplete
        ? `${salesClause}، والأدلة غير مكتملة؛ لا يمكن تأكيد خلو الدورة من مشكلات.`
        : `${salesClause}، ولا توجد مشكلة موثقة تتجاوز حدود المتابعة.`;
  const badge: DoctorPerformanceVerdict['badge'] = lead === 'problem'
    ? { label: `أولوية: ${problem!.short}`, tone: 'danger' }
    : { label: signalLabel, tone: signal === 'improving' ? 'success' : signal === 'declining' ? 'danger' : 'neutral' };
  // A recommendation exists only for a documented problem; a missing source yields no action at all.
  const action: VerdictAction | null = problem?.action || null;

  return { signal, signalLabel, lead, badge, headline, metrics, strength: strengths[0] || null, problem: problem?.line || null, action, evidenceComplete: !evidenceIncomplete };
}
