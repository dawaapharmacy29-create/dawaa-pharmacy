import type { BranchDoctorCycle, BranchPerformanceWindow, PreviousEvaluation, ShiftKey } from '@/lib/evaluations/doctorDecisionDataService';

/**
 * Doctor decision intelligence — pure, deterministic analysis over evidence that canonical readers
 * already produced (branch performance window, canonical attendance counts, canonical conversation rubric,
 * the manager's own evaluation sections). It never produces a score that competes with the monthly
 * evaluation, never recommends a penalty, and never turns missing evidence into zero or into "no problem".
 *
 * Fairness model
 * - Productivity = sales placed inside the doctor's own attendance windows / those windows' hours.
 * - Expected productivity for a doctor = Σ_shift hours × the branch's rate for that shift in that cycle,
 *   computed from the OTHER doctors (leave-one-out). Index = actual / expected (1.00 = branch norm for the
 *   same shift mix). A thin shift falls back to the branch's pooled window rate for that shift.
 * - Peers are compared only when they pass the same sample, attribution and attendance gates.
 */

export const DECISION_RULES = {
  minHoursClosedCycle: 30,
  minHoursRunningCycle: 60,
  minPlacedInvoices: 40,
  maxUnplacedShare: 0.3,
  minBranchAttribution: 0.7,
  minPeers: 3,
  minShiftHours: 16,
  minShiftPeers: 2,
  minOtherDoctorsPerShiftCycle: 2,
  lowIndex: 0.8,
  highIndex: 1.2,
  meaningfulChange: 0.1,
  lateMinDays: 3,
  lateMinShare: 0.2,
  /** Fewer worked days than this cannot prove the absence of lateness (a "no problem" or "resolved" claim). */
  minWorkedDaysForAbsence: 5,
  conversationWeak: 7,
  conversationStrong: 8.5,
  shiftConcentration: 0.7,
  branchOperationalShare: 0.5,
  branchOperationalMinDoctors: 3,
  magnitudeChange: 0.15,
} as const;

export const SHIFT_LABELS: Record<ShiftKey, string> = { morning: 'صباحي', evening: 'مسائي', night: 'ليلي', unknown: 'غير محدد' };
const SHIFTS: ShiftKey[] = ['morning', 'evening', 'night'];

export type QualityFacts = {
  reviewCount: number;
  sampleSufficient: boolean;
  coreAverage: number | null;
  medicalErrors: number;
  criticalErrors: number;
  complaints: number;
  severeBadTone: number;
};
/** staffId -> cycleStart -> facts. Absent doctor/cycle = no reviews; `available=false` = source failed. */
export type QualityIndex = { available: boolean; byDoctor: Record<string, Record<string, QualityFacts>> };

export type Confidence = 'high' | 'medium' | 'low';
export type ProblemKey = 'medical_error' | 'customer_harm' | 'lateness' | 'low_productivity' | 'weak_conversation' | 'attribution_gap';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type ProblemScope = 'individual' | 'multi_doctor' | 'shift_linked' | 'branch_operational';
export type ProblemTrend = 'new' | 'recurring' | 'improving' | 'worsening' | 'resolved' | 'insufficient';

export const PROBLEM_META: Record<ProblemKey, { title: string; severity: Severity; owner: 'doctor' | 'manager'; category: 'safety' | 'customer' | 'discipline' | 'productivity' | 'skill' | 'data' }> = {
  medical_error: { title: 'أخطاء طبية/حرجة موثقة', severity: 'critical', owner: 'manager', category: 'safety' },
  customer_harm: { title: 'شكاوى أو أسلوب غير مناسب', severity: 'high', owner: 'manager', category: 'customer' },
  lateness: { title: 'تأخير متكرر', severity: 'medium', owner: 'doctor', category: 'discipline' },
  low_productivity: { title: 'إنتاجية أقل من المتوقع لظروف الشيفت', severity: 'medium', owner: 'manager', category: 'productivity' },
  weak_conversation: { title: 'جودة محادثات أقل من المعيار', severity: 'medium', owner: 'doctor', category: 'skill' },
  attribution_gap: { title: 'فواتير باسمه خارج ساعات حضوره المسجلة', severity: 'low', owner: 'manager', category: 'data' },
};
const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 100, high: 30, medium: 10, low: 3 };

export type CycleProductivity = {
  cycleStart: string;
  hours: number;
  placedSales: number;
  placedInvoices: number;
  attributedInvoices: number;
  unplacedShare: number | null;
  salesPerHour: number | null;
  invoicesPerHour: number | null;
  avgInvoice: number | null;
  expectedSales: number | null;
  index: number | null;
  eligible: boolean;
  blockedReason: string | null;
  shiftHours: Partial<Record<ShiftKey, number>>;
  usedPooledFallback: boolean;
};

export type ProblemInstance = { key: ProblemKey; present: boolean | null; magnitude: number | null; detail: string; lateShift?: ShiftKey | null };

export type DoctorTimeline = {
  staffId: string;
  name: string;
  cycles: { cycleStart: string; productivity: CycleProductivity; quality: QualityFacts | null; qualityAvailable: boolean; attendance: BranchDoctorCycle['attendance']; problems: ProblemInstance[]; lateByShift: Partial<Record<ShiftKey, number>> }[];
};

export type ProblemSummary = {
  key: ProblemKey;
  title: string;
  severity: Severity;
  trend: ProblemTrend;
  scope: ProblemScope;
  scopeDetail: string;
  detail: string;
  probableCause: string;
  causeCertainty: 'confirmed' | 'hypothesis';
  action: string;
  owner: 'doctor' | 'manager';
  successMetric: string;
  history: { cycleStart: string; present: boolean | null }[];
};

export type BranchPriority = {
  key: ProblemKey;
  title: string;
  severity: Severity;
  affected: number;
  covered: number;
  scope: ProblemScope;
  direction: 'worsening' | 'improving' | 'stable' | 'new' | 'unknown';
  action: string;
  standalone: boolean;
};

export type EvaluationGap = {
  axisKey: string;
  axisTitle: string;
  given: number;
  expected: [number, number];
  direction: 'higher_than_evidence' | 'lower_than_evidence';
  evidence: string;
};

/**
 * `ready`: the branch comparison loaded and the doctor has evidence in it. Any other state carries no verdict
 * and no recommendation: `not_enabled` (source not deployed yet), `failed` (source could not be read),
 * `insufficient` (source loaded but holds no comparable evidence for this doctor).
 */
export type DecisionAvailability = 'ready' | 'not_enabled' | 'failed' | 'insufficient';

export type DecisionIntelligence = {
  availability: DecisionAvailability;
  /** Plain-language reason when not ready; never a PostgREST code or message. */
  availabilityReason: string | null;
  analysisCycleStart: string | null;
  /** False when the evidence comes from an earlier cycle than the one being evaluated (running cycle too young). */
  analysisIsEvaluatedCycle: boolean;
  analysisNote: string | null;
  confidence: { level: Confidence; reasons: string[] };
  summary: { headline: string; strength: string | null; problem: string | null; decision: string | null };
  indicators: {
    self: { state: 'improving' | 'stable' | 'declining' | 'insufficient'; value: number | null; label: string; detail: string };
    peers: { state: 'above' | 'within' | 'below' | 'insufficient'; value: number | null; label: string; detail: string; peerCount: number };
    evaluation: { state: 'consistent' | 'gaps' | 'not_rated' | 'insufficient'; label: string; detail: string; gaps: EvaluationGap[] };
  };
  changeDrivers: null | { salesChange: number; hoursChange: number; conditionsChange: number; productivityChange: number; comparable: boolean; note: string };
  problems: ProblemSummary[];
  /** Null whenever `availability !== 'ready'`: no recommendation is ever built on a missing source. */
  decision: { action: string; why: string; owner: 'doctor' | 'manager'; successMetric: string; reviewBy: string; previousDecision: string | null } | null;
  branchPriorities: BranchPriority[];
  charts: {
    trend: { cycleStart: string; index: number | null; salesPerHour: number | null; hours: number; invoices: number; eligible: boolean; note: string | null }[];
    peers: { id: string; isTarget: boolean; index: number; hours: number; label: string }[];
    peerBand: { p25: number; median: number; p75: number } | null;
    /** pendingDays: the doctor's days in this shift still pending review (their candidate hours are provisional). */
    shifts: { shift: ShiftKey; label: string; actual: number; expected: number | null; p25: number | null; p75: number | null; hours: number; invoices: number; peers: number; confidence: Confidence; pendingDays: number }[];
    /** Days of the analysed cycle still pending review for the doctor: the peer position is provisional while > 0. */
    targetPendingDays: number;
    /** reviews / medicalErrors are null when the review source is unavailable (unknown, never zero). */
    quality: { cycleStart: string; lateShare: number | null; lateDays: number | null; workedDays: number | null; coreAverage: number | null; reviews: number | null; medicalErrors: number | null }[];
  };
  dataWarnings: string[];
};

const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}%`;
const fmt = (v: number, d = 0) => v.toLocaleString('ar-EG', { maximumFractionDigits: d, minimumFractionDigits: d });

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function shiftCells(c: BranchDoctorCycle) {
  return SHIFTS.map(s => ({ s, cell: c.shifts[s] })).filter((x): x is { s: ShiftKey; cell: NonNullable<BranchDoctorCycle['shifts'][ShiftKey]> } => Boolean(x.cell && x.cell.hours > 0));
}

/** A doctor-cycle whose invoices largely fall outside its attendance windows understates its rate; never use it as a reference. */
function timingReliable(c: BranchDoctorCycle) {
  return c.sales.invoicesAll > 0 && c.unmatched.invoices / c.sales.invoicesAll <= DECISION_RULES.maxUnplacedShare;
}

/** Leave-one-out branch rate per shift per cycle, with a pooled-window fallback for thin shifts. */
export function branchShiftRates(window: BranchPerformanceWindow, excludeStaffId: string) {
  const perCycle = new Map<string, Map<ShiftKey, { sales: number; hours: number; doctors: number }>>();
  const pooled = new Map<ShiftKey, { sales: number; hours: number; doctors: Set<string> }>();
  const attributionOk = new Set(window.branchCycles.filter(b => b.invoices > 0 && b.doctorInvoices / b.invoices >= DECISION_RULES.minBranchAttribution).map(b => b.start));
  for (const d of window.doctors) {
    if (d.staffId === excludeStaffId) continue;
    for (const c of d.cycles) {
      if (!attributionOk.has(c.start) || !timingReliable(c)) continue;
      for (const { s, cell } of shiftCells(c)) {
        if (cell.hours < 8) continue;
        const m = perCycle.get(c.start) || new Map();
        const v = m.get(s) || { sales: 0, hours: 0, doctors: 0 };
        v.sales += cell.sales; v.hours += cell.hours; v.doctors += 1;
        m.set(s, v); perCycle.set(c.start, m);
        const p = pooled.get(s) || { sales: 0, hours: 0, doctors: new Set<string>() };
        p.sales += cell.sales; p.hours += cell.hours; p.doctors.add(d.staffId);
        pooled.set(s, p);
      }
    }
  }
  return {
    rate(cycleStart: string, s: ShiftKey): { rate: number; pooled: boolean } | null {
      const v = perCycle.get(cycleStart)?.get(s);
      if (v && v.doctors >= DECISION_RULES.minOtherDoctorsPerShiftCycle && v.hours > 0) return { rate: v.sales / v.hours, pooled: false };
      const p = pooled.get(s);
      if (p && p.doctors.size >= 1 && p.hours >= DECISION_RULES.minShiftHours) return { rate: p.sales / p.hours, pooled: true };
      return null;
    },
    pooledRate(s: ShiftKey) {
      const p = pooled.get(s);
      return p && p.hours > 0 ? { rate: p.sales / p.hours, doctors: p.doctors.size } : null;
    },
    attributionOk,
  };
}

export function cycleProductivity(window: BranchPerformanceWindow, staffId: string, c: BranchDoctorCycle, running: boolean, rates = branchShiftRates(window, staffId)): CycleProductivity {
  const cells = shiftCells(c);
  const hours = cells.reduce((s, x) => s + x.cell.hours, 0);
  const placedSales = cells.reduce((s, x) => s + x.cell.sales, 0);
  const placedInvoices = cells.reduce((s, x) => s + x.cell.invoices, 0);
  const attributedInvoices = c.sales.invoicesAll;
  const unplacedShare = attributedInvoices > 0 ? c.unmatched.invoices / attributedInvoices : null;
  let expected = 0, coveredHours = 0, coveredSales = 0, usedPooled = false;
  for (const { s, cell } of cells) {
    const r = rates.rate(c.start, s);
    if (!r) continue;
    expected += cell.hours * r.rate; coveredHours += cell.hours; coveredSales += cell.sales; usedPooled ||= r.pooled;
  }
  const minHours = running ? DECISION_RULES.minHoursRunningCycle : DECISION_RULES.minHoursClosedCycle;
  const blockedReason = !rates.attributionOk.has(c.start) ? 'نسبة الفواتير المنسوبة لدكاترة في الفرع ضعيفة في هذه الدورة'
    : hours < minHours ? `ساعات الحضور المسجلة أقل من ${minHours} ساعة`
    : placedInvoices < DECISION_RULES.minPlacedInvoices ? 'عدد الفواتير داخل ساعات الحضور غير كافٍ'
    : unplacedShare !== null && unplacedShare > DECISION_RULES.maxUnplacedShare ? 'نسبة كبيرة من فواتيره خارج ساعات حضوره المسجلة'
    : c.ambiguousInvoices > 0.1 * Math.max(attributedInvoices, 1) ? 'جزء من فواتيره باسم مشترك مع موظف آخر'
    : coveredHours < hours * 0.7 || expected <= 0 ? 'لا يوجد مرجع كافٍ لنفس الشيفت في الفرع'
    : null;
  return {
    cycleStart: c.start, hours, placedSales, placedInvoices, attributedInvoices, unplacedShare,
    salesPerHour: hours > 0 ? placedSales / hours : null,
    invoicesPerHour: hours > 0 ? placedInvoices / hours : null,
    avgInvoice: placedInvoices > 0 ? placedSales / placedInvoices : null,
    expectedSales: expected > 0 ? expected * (hours / Math.max(coveredHours, 1e-9)) : null,
    index: expected > 0 ? coveredSales / expected : null,
    eligible: blockedReason === null,
    blockedReason,
    shiftHours: Object.fromEntries(cells.map(x => [x.s, x.cell.hours])),
    usedPooledFallback: usedPooled,
  };
}

function lateByShift(c: BranchDoctorCycle) {
  return Object.fromEntries(shiftCells(c).filter(x => x.cell.lateDays > 0).map(x => [x.s, x.cell.lateDays])) as Partial<Record<ShiftKey, number>>;
}

/** Problems for one doctor-cycle. present=null means the evidence needed to judge is missing (never "no problem"). */
export function detectProblems(args: { productivity: CycleProductivity; quality: QualityFacts | null; qualityAvailable: boolean; attendance: BranchDoctorCycle['attendance']; lateByShift: Partial<Record<ShiftKey, number>>; peerP25: number | null }): ProblemInstance[] {
  const { productivity: p, quality: q, qualityAvailable, attendance: a } = args;
  const out: ProblemInstance[] = [];
  const reviewsKnown = qualityAvailable;
  const reviews = q?.reviewCount || 0;
  // A conversation can carry both flags; counting the larger flag avoids reporting one incident twice.
  const med = Math.max(q?.medicalErrors || 0, q?.criticalErrors || 0);
  // Absence is proven only by a sufficient review sample; a thin sample is unknown, never "no problem".
  const absenceProven = reviews > 0 && Boolean(q?.sampleSufficient);
  out.push({ key: 'medical_error', present: !reviewsKnown ? null : med > 0 ? true : absenceProven ? false : null, magnitude: med || null, detail: med ? `${fmt(med)} حالة موثقة في مراجعات المحادثات` : '' });
  const harm = (q?.complaints || 0) + (q?.severeBadTone || 0);
  out.push({ key: 'customer_harm', present: !reviewsKnown ? null : harm > 0 ? true : absenceProven ? false : null, magnitude: harm || null, detail: harm ? `${fmt(q?.complaints || 0)} شكوى و${fmt(q?.severeBadTone || 0)} حالة أسلوب حاد` : '' });
  if (a?.available && a.workedDays !== undefined && a.lateDays !== undefined && (a.pendingReviewDays || 0) > 0 && a.lateDays < DECISION_RULES.lateMinDays) {
    // Days still under attendance review may hide lateness; only an already-proven problem survives them.
    out.push({ key: 'lateness', present: null, magnitude: null, detail: `${fmt(a.pendingReviewDays || 0)} يوم حضور بانتظار المراجعة؛ لا يُحكم على التأخير قبل اعتمادها` });
  } else if (a?.available && a.workedDays !== undefined && a.lateDays !== undefined) {
    const share = a.workedDays > 0 ? a.lateDays / a.workedDays : 0;
    const proven = a.lateDays >= DECISION_RULES.lateMinDays && share >= DECISION_RULES.lateMinShare;
    const present = proven ? true : a.workedDays >= DECISION_RULES.minWorkedDaysForAbsence && !(a.pendingReviewDays || 0) ? false : null;
    const totalLate = Object.values(args.lateByShift).reduce((s, v) => s + (v || 0), 0);
    const top = (Object.entries(args.lateByShift) as [ShiftKey, number][]).sort((x, y) => y[1] - x[1])[0];
    const lateShift = top && totalLate >= DECISION_RULES.lateMinDays && top[1] / totalLate >= DECISION_RULES.shiftConcentration ? top[0] : null;
    out.push({ key: 'lateness', present: a.workedDays > 0 ? present : null, magnitude: a.workedDays > 0 ? share : null, detail: `تأخير في ${fmt(a.lateDays)} من ${fmt(a.workedDays)} يوم حضور`, lateShift });
  } else {
    out.push({ key: 'lateness', present: null, magnitude: null, detail: 'الحضور الرسمي غير متاح لهذه الدورة' });
  }
  if (p.eligible && p.index !== null) {
    const present = p.index < DECISION_RULES.lowIndex && (args.peerP25 === null || p.index < args.peerP25);
    out.push({ key: 'low_productivity', present, magnitude: 1 - p.index, detail: `الإنتاجية ${fmt(p.index * 100)}% من المتوقع لنفس مزيج الشيفتات` });
  } else {
    out.push({ key: 'low_productivity', present: null, magnitude: null, detail: p.blockedReason || 'لا يمكن حساب الإنتاجية' });
  }
  if (reviewsKnown && q?.sampleSufficient && q.coreAverage !== null) {
    out.push({ key: 'weak_conversation', present: q.coreAverage < DECISION_RULES.conversationWeak, magnitude: DECISION_RULES.conversationWeak - q.coreAverage, detail: `متوسط أبعاد خدمة العميل ${fmt(q.coreAverage, 1)}/10 على ${fmt(q.reviewCount)} محادثة` });
  } else {
    out.push({ key: 'weak_conversation', present: null, magnitude: null, detail: !reviewsKnown ? 'مصدر المراجعات غير متاح' : 'عينة المحادثات غير كافية للحكم' });
  }
  if (p.attributedInvoices >= DECISION_RULES.minPlacedInvoices && p.unplacedShare !== null) {
    out.push({ key: 'attribution_gap', present: p.unplacedShare > DECISION_RULES.maxUnplacedShare, magnitude: p.unplacedShare, detail: `${fmt(p.unplacedShare * 100)}% من فواتيره خارج نوافذ حضوره المسجلة` });
  } else {
    out.push({ key: 'attribution_gap', present: null, magnitude: null, detail: 'عدد الفواتير غير كافٍ' });
  }
  return out;
}

export function trendOf(history: { present: boolean | null; magnitude: number | null }[]): ProblemTrend {
  const [cur, prev, prev2] = history;
  if (!cur) return 'insufficient';
  if (cur.present === null) return 'insufficient';
  if (cur.present === false) return prev?.present === true ? 'resolved' : 'insufficient';
  if (prev?.present !== true) return 'new';
  if (cur.magnitude !== null && prev.magnitude !== null && prev.magnitude > 0) {
    const change = (cur.magnitude - prev.magnitude) / prev.magnitude;
    if (change >= DECISION_RULES.magnitudeChange) return 'worsening';
    if (change <= -DECISION_RULES.magnitudeChange) return 'improving';
  }
  void prev2;
  return 'recurring';
}

function buildTimelines(window: BranchPerformanceWindow, quality: QualityIndex, analysisCycles: string[], openCycle: string | null) {
  const timelines: DoctorTimeline[] = window.doctors.map(d => {
    const rates = branchShiftRates(window, d.staffId);
    return {
      staffId: d.staffId,
      name: d.name,
      cycles: analysisCycles.map(start => {
        const c = d.cycles.find(x => x.start === start) || { start, sales: { salesAll: 0, invoicesAll: 0, customers: 0, directInvoices: 0, aliasInvoices: 0 }, ambiguousInvoices: 0, unmatched: { invoices: 0, sales: 0 }, shifts: {}, attendance: null };
        const productivity = cycleProductivity(window, d.staffId, c, start === openCycle, rates);
        const q = quality.available ? (quality.byDoctor[d.staffId]?.[start] || null) : null;
        return { cycleStart: start, productivity, quality: q, qualityAvailable: quality.available, attendance: c.attendance, problems: [] as ProblemInstance[], lateByShift: lateByShift(c) };
      }),
    };
  });
  // Peer p25 per cycle (eligible doctors only) so "low productivity" is relative to fair peers too.
  for (const start of analysisCycles) {
    const indices = timelines.map(t => t.cycles.find(c => c.cycleStart === start)!.productivity).filter(p => p.eligible && p.index !== null).map(p => p.index!).sort((a, b) => a - b);
    const p25 = indices.length >= DECISION_RULES.minPeers ? quantile(indices, 0.25) : null;
    for (const t of timelines) {
      const c = t.cycles.find(x => x.cycleStart === start)!;
      c.problems = detectProblems({ productivity: c.productivity, quality: c.quality, qualityAvailable: c.qualityAvailable, attendance: c.attendance, lateByShift: c.lateByShift, peerP25: p25 });
    }
  }
  return timelines;
}

function scopeFor(key: ProblemKey, cycleStart: string, timelines: DoctorTimeline[]): { scope: ProblemScope; affected: number; covered: number; detail: string; shift: ShiftKey | null } {
  let affected = 0, covered = 0;
  const shiftVotes = new Map<ShiftKey, number>();
  for (const t of timelines) {
    const c = t.cycles.find(x => x.cycleStart === cycleStart);
    const p = c?.problems.find(x => x.key === key);
    if (!c || !p || p.present === null) continue;
    covered += 1;
    if (!p.present) continue;
    affected += 1;
    const shift = key === 'lateness' ? p.lateShift || null
      : (Object.entries(c.productivity.shiftHours) as [ShiftKey, number][]).sort((a, b) => b[1] - a[1]).find(([, h]) => h / Math.max(c.productivity.hours, 1) >= DECISION_RULES.shiftConcentration)?.[0] || null;
    if (shift) shiftVotes.set(shift, (shiftVotes.get(shift) || 0) + 1);
  }
  const topShift = [...shiftVotes.entries()].sort((a, b) => b[1] - a[1])[0];
  const shift = topShift && affected >= 2 && topShift[1] / affected >= DECISION_RULES.shiftConcentration ? topShift[0] : null;
  if (affected >= DECISION_RULES.branchOperationalMinDoctors && covered > 0 && affected / covered >= DECISION_RULES.branchOperationalShare) {
    return { scope: 'branch_operational', affected, covered, shift, detail: `تظهر عند ${fmt(affected)} من ${fmt(covered)} دكاترة لديهم بيانات كافية — مشكلة تشغيلية محتملة على مستوى الفرع` };
  }
  if (shift) return { scope: 'shift_linked', affected, covered, shift, detail: `تتركز في الشيفت ال${SHIFT_LABELS[shift]} عند ${fmt(affected)} دكاترة` };
  if (affected >= 2) return { scope: 'multi_doctor', affected, covered, shift: null, detail: `متكررة عند ${fmt(affected)} من ${fmt(covered)} دكاترة` };
  return { scope: 'individual', affected, covered, shift: null, detail: 'مشكلة فردية لهذا الدكتور' };
}

function problemAction(key: ProblemKey, scope: ProblemScope, magnitude: number | null, facts: { lateDays?: number; index?: number | null; coreAverage?: number | null; shift?: ShiftKey | null }) {
  const branchLevel = scope === 'branch_operational' || scope === 'shift_linked';
  switch (key) {
    case 'medical_error':
      return { action: 'مراجعة الحالات الموثقة مع الدكتور فورًا وتوثيق الإجراء التصحيحي قبل اعتماد التقييم.', owner: 'manager' as const, metric: 'صفر أخطاء طبية/حرجة موثقة في الدورة القادمة', cause: 'أخطاء موثقة في مراجعات المحادثات', certainty: 'confirmed' as const };
    case 'customer_harm':
      return { action: 'جلسة مراجعة لحالات الشكاوى الموثقة وأسلوب التعامل، مع متابعة المحادثات التالية.', owner: 'manager' as const, metric: 'صفر شكاوى موثقة على الأسلوب في الدورة القادمة', cause: 'شكاوى/ملاحظات أسلوب موثقة في المراجعات', certainty: 'confirmed' as const };
    case 'lateness': {
      const target = Math.max(0, Math.floor((facts.lateDays || 0) / 2));
      return branchLevel
        ? { action: `مراجعة مواعيد بدء الشيفت ${facts.shift ? `ال${SHIFT_LABELS[facts.shift]} ` : ''}وتسليمه على مستوى الفرع قبل محاسبة فرد.`, owner: 'manager' as const, metric: 'انخفاض أيام التأخير في الفرع للنصف على الأقل خلال الدورة القادمة', cause: 'التأخير يتكرر عند أكثر من دكتور، وقد يرتبط بتوقيت الشيفت أو تنظيمه', certainty: 'hypothesis' as const }
        : { action: `اتفاق مع الدكتور على الالتزام بموعد البدء ومتابعة أسبوعية للحضور.`, owner: 'doctor' as const, metric: `أيام التأخير ${fmt(target)} أو أقل في الدورة القادمة`, cause: 'تأخير متكرر موثق في الحضور الرسمي', certainty: 'confirmed' as const };
    }
    case 'low_productivity':
      return branchLevel
        ? { action: 'مراجعة ضغط وتوزيع العمل في الشيفت قبل تقييم أي دكتور بمفرده.', owner: 'manager' as const, metric: 'عودة إنتاجية الشيفت إلى 90% من المتوقع على الأقل', cause: 'انخفاض متزامن عند أكثر من دكتور — قد يكون تشغيليًا (توافر أصناف، ضغط، توزيع)', certainty: 'hypothesis' as const }
        : { action: 'مراجعة مشتركة لفرص البيع الضائعة ومتوسط الفاتورة في شيفتات الدكتور، مع متابعة أسبوعين.', owner: 'manager' as const, metric: 'رفع الإنتاجية المعدلة إلى 90% من المتوقع على الأقل', cause: 'الإنتاجية أقل من المتوقع لنفس مزيج الشيفتات؛ السبب الدقيق يحتاج مراجعة الحالات', certainty: 'hypothesis' as const };
    case 'weak_conversation':
      return { action: 'تدريب مركز على أضعف أبعاد المحادثة مع مراجعة 5 محادثات جديدة.', owner: 'doctor' as const, metric: 'متوسط أبعاد خدمة العميل 7/10 أو أكثر على 3 محادثات على الأقل', cause: 'متوسط مراجعات المحادثات أقل من المعيار على عينة كافية', certainty: 'confirmed' as const };
    case 'attribution_gap':
      return { action: 'مراجعة نسب الفواتير وتسجيل الحضور (قد تكون فواتير مسجلة باسمه في غير وقته أو بصمة ناقصة) — ليست مخالفة على الدكتور.', owner: 'manager' as const, metric: 'أقل من 20% من فواتيره خارج نوافذ حضوره المسجلة', cause: 'فرق بين توقيت الفواتير والحضور المسجل', certainty: 'hypothesis' as const };
  }
  void magnitude;
}

function evaluationGaps(sections: { key: string; title: string; score: number }[], facts: { lateDays: number | null; workedDays: number | null; quality: QualityFacts | null; previousTrends: ProblemTrend[] }): { gaps: EvaluationGap[]; inferable: number; rated: boolean } {
  const rated = sections.some(s => s.score > 0);
  const gaps: EvaluationGap[] = [];
  let inferable = 0;
  const check = (key: string, expected: [number, number] | null, evidence: string) => {
    const s = sections.find(x => x.key === key);
    if (!s || !expected || s.score <= 0) return;
    inferable += 1;
    if (s.score > expected[1] + 1) gaps.push({ axisKey: key, axisTitle: s.title, given: s.score, expected, direction: 'higher_than_evidence', evidence });
    else if (s.score < expected[0] - 1) gaps.push({ axisKey: key, axisTitle: s.title, given: s.score, expected, direction: 'lower_than_evidence', evidence });
  };
  if (facts.lateDays !== null && facts.workedDays !== null && facts.workedDays > 0) {
    const repeated = facts.lateDays >= DECISION_RULES.lateMinDays && facts.lateDays / facts.workedDays >= DECISION_RULES.lateMinShare;
    check('discipline', repeated ? [1, 2] : facts.lateDays === 0 ? [4, 5] : [3, 4], `تأخير ${fmt(facts.lateDays)} من ${fmt(facts.workedDays)} يوم حضور`);
  }
  const q = facts.quality;
  if (q && ((q.complaints + q.severeBadTone) > 0 || (q.sampleSufficient && q.coreAverage !== null))) {
    const harm = q.complaints + q.severeBadTone;
    const band: [number, number] = harm > 0 ? [1, 2] : q.coreAverage! < 7 ? [2, 2] : q.coreAverage! < 8.5 ? [3, 3] : q.coreAverage! < 9.5 ? [4, 4] : [5, 5];
    check('conversations', band, harm > 0 ? `${fmt(harm)} شكوى/حالة أسلوب موثقة` : `متوسط أبعاد خدمة العميل ${fmt(q.coreAverage!, 1)}/10 على ${fmt(q.reviewCount)} محادثة`);
  }
  if (q && q.medicalErrors + q.criticalErrors > 0) check('dispensing', [1, 2], `${fmt(q.medicalErrors + q.criticalErrors)} خطأ طبي/حرج موثق`);
  if (facts.previousTrends.length) {
    const t = facts.previousTrends;
    const band: [number, number] | null = t.every(x => x === 'resolved') ? [4, 5] : t.some(x => x === 'worsening' || x === 'recurring') ? [1, 2] : t.some(x => x === 'improving') ? [3, 4] : null;
    check('development', band, band ? `مشكلات الدورة السابقة: ${t.map(x => TREND_LABEL[x]).join('، ')}` : '');
  }
  return { gaps, inferable, rated };
}

export const TREND_LABEL: Record<ProblemTrend, string> = { new: 'جديدة', recurring: 'متكررة', improving: 'تتحسن', worsening: 'تتفاقم', resolved: 'تم حلها بدليل', insufficient: 'بيانات غير كافية' };
export const SCOPE_LABEL: Record<ProblemScope, string> = { individual: 'فردية', multi_doctor: 'متكررة عند عدة دكاترة', shift_linked: 'مرتبطة بشيفت', branch_operational: 'تشغيلية محتملة على مستوى الفرع' };

const UNAVAILABLE_COPY: Record<Exclude<DecisionAvailability, 'ready'>, { headline: string; label: string; fallback: string }> = {
  not_enabled: { headline: 'المقارنة بالفرع لم تُفعَّل بعد؛ لا يوجد حكم مقارن لهذه الدورة.', label: 'لم يُفعَّل بعد', fallback: 'مصدر مقارنة الفرع لم يُفعَّل بعد.' },
  failed: { headline: 'تعذر تحميل المقارنة بالفرع؛ لا يوجد حكم مقارن حتى يكتمل التحميل.', label: 'تعذر التحميل', fallback: 'تعذر تحميل مقارنة الفرع.' },
  insufficient: { headline: 'بيانات غير كافية للمقارنة بالفرع في نطاق التحليل.', label: 'غير كافٍ', fallback: 'لا توجد بيانات حضور أو مبيعات لهذا الدكتور في الفرع خلال نطاق التحليل.' },
};

/** A neutral result: states why there is no comparison, carries no verdict, problem, recommendation or chart. */
export function unavailableDecision(state: Exclude<DecisionAvailability, 'ready'>, reason: string | null): DecisionIntelligence {
  const copy = UNAVAILABLE_COPY[state];
  const why = reason || copy.fallback;
  const indicator = { state: 'insufficient' as const, value: null, label: copy.label, detail: why };
  return {
    availability: state, availabilityReason: why,
    analysisCycleStart: null, analysisIsEvaluatedCycle: false, analysisNote: null,
    confidence: { level: 'low', reasons: [why] },
    summary: { headline: copy.headline, strength: null, problem: null, decision: null },
    indicators: { self: indicator, peers: { ...indicator, peerCount: 0 }, evaluation: { state: 'insufficient', label: copy.label, detail: 'لا توجد أدلة مقارنة لمطابقة التقييم', gaps: [] } },
    changeDrivers: null, problems: [], decision: null, branchPriorities: [],
    charts: { trend: [], peers: [], peerBand: null, shifts: [], quality: [], targetPendingDays: 0 }, dataWarnings: [],
  };
}

export function buildDecisionIntelligence(args: {
  staffId: string;
  window: BranchPerformanceWindow | null;
  windowSource: { status: 'available' | 'not_enabled' | 'failed'; reason: string | null };
  quality: QualityIndex;
  sections: { key: string; title: string; score: number }[];
  previousEvaluation: PreviousEvaluation | null;
  openCycleStart: string | null;
  /** Start of the cycle whose evaluation is being written; manager scores belong to this cycle. */
  evaluatedCycleStart: string;
  nextReviewDate: string;
}): DecisionIntelligence {
  const warnings: string[] = [];
  const window = args.window;
  if (args.windowSource.status !== 'available' || !window) {
    return unavailableDecision(args.windowSource.status === 'not_enabled' ? 'not_enabled' : 'failed', args.windowSource.reason);
  }
  const target = window.doctors.find(d => d.staffId === args.staffId);
  if (!target || !target.cycles.length) return unavailableDecision('insufficient', null);
  if (window.ambiguousNames.length) warnings.push(`أسماء بائع مشتركة بين أكثر من موظف نشط (${window.ambiguousNames.join('، ')}): فواتيرها مستبعدة من المقارنة حتى يُحسم نسبها.`);

  const cyclesDesc = [...window.cycles].map(c => c.start).sort().reverse();
  const timelines = buildTimelines(window, args.quality, cyclesDesc, args.openCycleStart);
  const me = timelines.find(t => t.staffId === args.staffId)!;

  // Analysis cycle: the running cycle only when it already has enough evidence, else the latest closed one.
  const running = args.openCycleStart ? me.cycles.find(c => c.cycleStart === args.openCycleStart) : undefined;
  // A running cycle is analysed only when the doctor AND enough peers already have substantive evidence in it.
  const runningPeers = running ? timelines.filter(t => t.staffId !== args.staffId && t.cycles.find(c => c.cycleStart === running.cycleStart)?.productivity.eligible).length : 0;
  const runningUsable = Boolean(running && running.productivity.eligible && running.productivity.hours >= DECISION_RULES.minHoursRunningCycle && runningPeers >= DECISION_RULES.minPeers);
  const analysis = runningUsable ? running! : me.cycles.find(c => c.cycleStart !== args.openCycleStart) || me.cycles[0];
  const analysisIdx = me.cycles.indexOf(analysis);
  const analysisNote = running && !runningUsable ? 'الدورة الحالية في أولها؛ التحليل مبني على آخر دورة مغلقة.' : running && runningUsable ? 'الدورة الحالية جارية؛ المعدلات محسوبة على ما تم حتى الآن.' : null;
  const prev = me.cycles.slice(analysisIdx + 1).find(c => c.productivity.eligible) || null;

  // 1) Self trend on the shift-adjusted index.
  const cur = analysis.productivity;
  let self: DecisionIntelligence['indicators']['self'];
  if (cur.eligible && cur.index !== null && prev?.productivity.index) {
    const change = cur.index / prev.productivity.index - 1;
    self = { state: change >= DECISION_RULES.meaningfulChange ? 'improving' : change <= -DECISION_RULES.meaningfulChange ? 'declining' : 'stable', value: change, label: pct(change), detail: `الإنتاجية المعدلة بالشيفت ${fmt(cur.index * 100)}% مقابل ${fmt(prev.productivity.index * 100)}% في الدورة المقارنة` };
  } else {
    self = { state: 'insufficient', value: null, label: 'غير كافٍ', detail: !cur.eligible ? (cur.blockedReason || 'بيانات الدورة غير كافية') : 'لا توجد دورة سابقة مؤهلة للمقارنة (موظف جديد أو بيانات ناقصة)' };
  }

  // 2) Fair peer position in the same analysis cycle.
  const peerRows = timelines.map(t => ({ t, c: t.cycles.find(c => c.cycleStart === analysis.cycleStart)! })).filter(x => x.c.productivity.eligible && x.c.productivity.index !== null);
  const others = peerRows.filter(x => x.t.staffId !== args.staffId).map(x => x.c.productivity.index!).sort((a, b) => a - b);
  let peers: DecisionIntelligence['indicators']['peers'];
  let peerBand: DecisionIntelligence['charts']['peerBand'] = null;
  if (cur.eligible && cur.index !== null && others.length >= DECISION_RULES.minPeers) {
    peerBand = { p25: quantile(others, 0.25), median: quantile(others, 0.5), p75: quantile(others, 0.75) };
    const vsMedian = cur.index / peerBand.median - 1;
    const state = cur.index > peerBand.p75 ? 'above' : cur.index < peerBand.p25 ? 'below' : 'within';
    peers = { state, value: vsMedian, label: pct(vsMedian), peerCount: others.length, detail: `${state === 'above' ? 'أعلى من نطاق' : state === 'below' ? 'أقل من نطاق' : 'داخل نطاق'} ${fmt(others.length)} زملاء مؤهلين، بعد معادلة مزيج الشيفتات` };
  } else {
    peers = { state: 'insufficient', value: null, label: 'غير كافٍ', peerCount: others.length, detail: !cur.eligible ? (cur.blockedReason || 'بيانات الدكتور غير كافية') : `عدد الزملاء المؤهلين للمقارنة العادلة ${fmt(others.length)} (الحد الأدنى ${DECISION_RULES.minPeers})` };
  }

  // 3) Change drivers (closed cycles only for totals; running cycle compares rates only).
  let changeDrivers: DecisionIntelligence['changeDrivers'] = null;
  if (cur.eligible && prev && cur.expectedSales && prev.productivity.expectedSales && cur.index && prev.productivity.index) {
    const comparable = analysis.cycleStart !== args.openCycleStart;
    const hoursChange = cur.hours / prev.productivity.hours - 1;
    const conditionsChange = (cur.expectedSales / cur.hours) / (prev.productivity.expectedSales / prev.productivity.hours) - 1;
    const productivityChange = cur.index / prev.productivity.index - 1;
    const salesChange = cur.placedSales / prev.productivity.placedSales - 1;
    changeDrivers = { salesChange, hoursChange, conditionsChange, productivityChange, comparable,
      note: comparable ? 'المبيعات = الساعات × ظروف الشيفت والفرع × الإنتاجية المعدلة' : 'الدورة جارية: تُقارن المعدلات فقط وليس الإجماليات' };
  }

  // Problems with history and branch scope.
  const keys = Object.keys(PROBLEM_META) as ProblemKey[];
  const histOf = (key: ProblemKey) => me.cycles.slice(analysisIdx).map(c => c.problems.find(p => p.key === key)!);
  const problems: ProblemSummary[] = [];
  for (const key of keys) {
    const hist = histOf(key);
    const curP = hist[0];
    const trend = trendOf(hist);
    if (!curP?.present) continue;
    const scope = scopeFor(key, analysis.cycleStart, timelines);
    const meta = PROBLEM_META[key];
    const att = analysis.attendance;
    const act = problemAction(key, scope.scope, curP.magnitude, { lateDays: att?.lateDays, index: cur.index, coreAverage: analysis.quality?.coreAverage, shift: scope.scope === 'shift_linked' ? scope.shift : null })!;
    problems.push({
      key, title: meta.title, severity: meta.severity, trend, scope: scope.scope, scopeDetail: scope.detail, detail: curP.detail,
      probableCause: act.cause, causeCertainty: act.certainty, action: act.action, owner: act.owner, successMetric: act.metric,
      history: me.cycles.slice(analysisIdx).reverse().map(c => ({ cycleStart: c.cycleStart, present: c.problems.find(p => p.key === key)!.present })),
    });
  }
  const trendRank: Record<ProblemTrend, number> = { worsening: 0, recurring: 1, new: 2, improving: 3, resolved: 4, insufficient: 5 };
  problems.sort((a, b) => SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] || trendRank[a.trend] - trendRank[b.trend]);

  // Previous problems that are now resolved count as strengths (with evidence), never as silence.
  const resolved = keys.filter(k => trendOf(histOf(k)) === 'resolved');

  // Strength.
  const strengths: string[] = [];
  if (peers.state === 'above' && peers.value !== null) strengths.push(`إنتاجية أعلى من نطاق الزملاء (${pct(peers.value)} عن الوسيط) لنفس ظروف الشيفت`);
  if (self.state === 'improving' && self.value !== null) strengths.push(`تحسن الإنتاجية المعدلة بالشيفت ${pct(self.value)} عن نفسه`);
  if (analysis.quality?.sampleSufficient && analysis.quality.coreAverage !== null && analysis.quality.coreAverage >= DECISION_RULES.conversationStrong) strengths.push(`جودة محادثات قوية ${fmt(analysis.quality.coreAverage, 1)}/10 على ${fmt(analysis.quality.reviewCount)} محادثة`);
  if (analysis.attendance?.available && analysis.attendance.lateDays === 0 && !(analysis.attendance.pendingReviewDays || 0) && (analysis.attendance.workedDays || 0) >= 10) strengths.push(`انضباط كامل: بدون تأخير في ${fmt(analysis.attendance.workedDays || 0)} يوم`);
  if (resolved.length) strengths.push(`لم تعد مشكلة "${PROBLEM_META[resolved[0]].title}" ظاهرة مقارنة بالدورة السابقة`);

  // Evaluation consistency against the manager's own axes (no alternative score).
  const prevAnalysis = me.cycles[analysisIdx + 1];
  const previousTrends = prevAnalysis ? keys.filter(k => prevAnalysis.problems.find(p => p.key === k)?.present).map(k => trendOf(histOf(k))) : [];
  // Manager scores belong to the evaluated cycle; evidence from another cycle can never prove a gap.
  const analysisIsEvaluatedCycle = analysis.cycleStart === args.evaluatedCycleStart;
  const attendanceSettled = analysis.attendance?.available && !(analysis.attendance.pendingReviewDays || 0);
  const ev = evaluationGaps(args.sections, { lateDays: attendanceSettled ? analysis.attendance!.lateDays ?? null : null, workedDays: attendanceSettled ? analysis.attendance!.workedDays ?? null : null, quality: analysis.quality, previousTrends });
  const evaluation: DecisionIntelligence['indicators']['evaluation'] = !analysisIsEvaluatedCycle
    ? { state: 'insufficient', label: 'غير قابل للمطابقة', detail: 'الأدلة من دورة سابقة؛ لا تُطابق عليها درجات الدورة الحالية', gaps: [] }
    : !ev.rated
    ? { state: 'not_rated', label: 'لم يُقيّم بعد', detail: 'لا توجد درجات محاور مسجلة لهذه الدورة', gaps: [] }
    : ev.inferable === 0 ? { state: 'insufficient', label: 'غير قابل للمطابقة', detail: 'لا توجد أدلة كافية لمطابقة محاور التقييم', gaps: [] }
    : ev.gaps.length ? { state: 'gaps', label: `فجوة في ${fmt(ev.gaps.length)} محور`, detail: ev.gaps.map(g => `${g.axisTitle}: ${fmt(g.given)}★ بينما الدليل يشير إلى ${fmt(g.expected[0])}–${fmt(g.expected[1])}★`).join(' · '), gaps: ev.gaps }
    : { state: 'consistent', label: 'متسق مع الأدلة', detail: `${fmt(ev.inferable)} محور قابل للمطابقة بدون فجوة`, gaps: [] };
  // Recurring problems that the previous evaluation never documented.
  const prevEval = args.previousEvaluation;
  const undocumented = analysisIsEvaluatedCycle && prevEval && prevEval.status !== 'draft' && !prevEval.developmentPoints.length ? problems.filter(p => p.trend === 'recurring' || p.trend === 'worsening') : [];
  if (undocumented.length) warnings.push(`مشكلة متكررة لم تُوثق في خطة تطوير الدورة السابقة: ${undocumented.map(p => p.title).join('، ')}.`);

  // Previous decision follow-up.
  let previousDecision: string | null = null;
  if (analysisIsEvaluatedCycle && prevEval && prevEval.status !== 'draft' && prevEval.developmentPoints.length && prevAnalysis) {
    const prevKeys = keys.filter(k => prevAnalysis.problems.find(p => p.key === k)?.present);
    const states = prevKeys.map(k => trendOf(histOf(k)));
    previousDecision = !prevKeys.length ? 'خطة التطوير السابقة موثقة، ولم تكن هناك مشكلة قابلة للقياس لمتابعتها.'
      : states.every(s => s === 'resolved') ? 'القرار السابق نجح: المشكلات الموثقة لم تعد ظاهرة بدليل.'
      : states.some(s => s === 'improving' || s === 'resolved') ? 'القرار السابق أثّر جزئيًا: تحسن بدون حل كامل.'
      : states.every(s => s === 'insufficient') ? 'لا توجد بيانات كافية للحكم على أثر القرار السابق.'
      : 'لم يظهر أثر للقرار السابق: المشكلة مستمرة.';
  }

  // Branch priorities (top 3) for the same analysis cycle; critical medical errors always stand alone.
  const prevCycleStart = cyclesDesc[cyclesDesc.indexOf(analysis.cycleStart) + 1];
  const branchPriorities: BranchPriority[] = keys.map(key => {
    const s = scopeFor(key, analysis.cycleStart, timelines);
    const before = prevCycleStart ? scopeFor(key, prevCycleStart, timelines) : null;
    const recurring = timelines.filter(t => { const h = t.cycles.slice(t.cycles.findIndex(c => c.cycleStart === analysis.cycleStart)).map(c => c.problems.find(p => p.key === key)!); return h[0]?.present && h[1]?.present; }).length;
    const direction: BranchPriority['direction'] = !before || before.covered === 0 ? 'unknown' : before.affected === 0 && s.affected > 0 ? 'new' : s.affected > before.affected ? 'worsening' : s.affected < before.affected ? 'improving' : 'stable';
    const act = problemAction(key, s.scope === 'individual' ? 'individual' : 'branch_operational', null, { shift: s.shift })!;
    return { key, title: PROBLEM_META[key].title, severity: PROBLEM_META[key].severity, affected: s.affected, covered: s.covered, scope: s.scope, direction, action: act.action, standalone: key === 'medical_error', _score: SEVERITY_WEIGHT[PROBLEM_META[key].severity] * s.affected * (1 + recurring / Math.max(s.affected, 1)) };
  }).filter(p => p.affected > 0)
    .sort((a, b) => Number(b.standalone) - Number(a.standalone) || b._score - a._score)
    .slice(0, 3)
    .map(({ _score, ...p }) => { void _score; return p; });

  // Decision.
  const top = problems[0];
  // Incomplete evidence can still surface a documented problem, but never a "no problem, carry on" decision.
  const incomplete = !args.quality.available || !analysis.quality?.sampleSufficient || !analysis.attendance?.available || !cur.eligible;
  const decision: DecisionIntelligence['decision'] = top
    ? { action: top.action, why: `${top.detail} — ${TREND_LABEL[top.trend]}، ${SCOPE_LABEL[top.scope]}${top.causeCertainty === 'hypothesis' ? ' (السبب فرضية تحتاج تحقق)' : ''}`, owner: top.owner, successMetric: top.successMetric, reviewBy: args.nextReviewDate, previousDecision }
    : incomplete ? null
    : { action: strengths.length ? 'تقدير الأداء الموثق والاستمرار بنفس المتابعة' : 'استمرار المتابعة المعتادة', why: strengths[0] || 'لا توجد مشكلة موثقة تتجاوز الحدود في الأدلة المتاحة', owner: 'manager', successMetric: 'الحفاظ على نفس المستوى في الدورة القادمة', reviewBy: args.nextReviewDate, previousDecision };

  // Confidence: explicit reasons, lowered by every missing or thin source.
  const reasons: string[] = [];
  if (!cur.eligible) reasons.push(cur.blockedReason || 'بيانات الإنتاجية غير كافية');
  if (!args.quality.available) reasons.push('مراجعات المحادثات غير متاحة');
  else if (!analysis.quality?.sampleSufficient) reasons.push('عينة المحادثات غير كافية');
  if (!analysis.attendance?.available) reasons.push('الحضور الرسمي غير متاح');
  if (peers.state === 'insufficient') reasons.push('لا توجد مجموعة زملاء كافية للمقارنة');
  if (cur.eligible && self.state === 'insufficient') reasons.push('لا توجد دورة سابقة مؤهلة لمقارنته بنفسه');
  if (cur.usedPooledFallback) reasons.push('مرجع بعض الشيفتات محسوب من نطاق أطول لقلة البيانات');
  const level: Confidence = !cur.eligible || !analysis.attendance?.available ? 'low' : reasons.length >= 2 ? 'medium' : reasons.length === 1 ? 'medium' : 'high';

  const headline = top
    ? `${top.severity === 'critical' ? 'أولوية مستقلة: ' : ''}${top.title} (${TREND_LABEL[top.trend]}، ${SCOPE_LABEL[top.scope]})${self.state === 'improving' ? ' رغم تحسن إنتاجيته' : self.state === 'declining' ? ' مع تراجع إنتاجيته' : ''}.`
    : incomplete ? 'لا توجد مشكلة موثقة، لكن الأدلة غير مكتملة؛ لا يمكن تأكيد خلو الدورة من مشكلات.'
    : peers.state === 'above' ? 'أداء قوي: إنتاجية أعلى من نطاق الزملاء بدون مشكلة موثقة تتجاوز الحدود.'
    : self.state === 'improving' ? 'أداء يتحسن بدون مشكلة موثقة تتجاوز الحدود.'
    : self.state === 'declining' ? 'تراجع في الإنتاجية المعدلة بدون مشكلة سلوكية موثقة؛ يحتاج فهم السبب.'
    : self.state === 'stable' ? 'أداء مستقر بدون مشكلة موثقة تتجاوز الحدود.'
    : 'لا توجد مشكلة موثقة تتجاوز الحدود في الأدلة المتاحة.';

  // Charts.
  const trend = [...me.cycles].reverse().map(c => ({ cycleStart: c.cycleStart, index: c.productivity.eligible ? c.productivity.index : null, salesPerHour: c.productivity.salesPerHour, hours: c.productivity.hours, invoices: c.productivity.placedInvoices, eligible: c.productivity.eligible, note: c.productivity.blockedReason }));
  const peersChart = peerRows.map(x => ({ id: x.t.staffId, isTarget: x.t.staffId === args.staffId, index: x.c.productivity.index!, hours: x.c.productivity.hours, label: x.t.staffId === args.staffId ? target.name : 'زميل' }));
  const shiftsChart: DecisionIntelligence['charts']['shifts'] = [];
  for (const s of SHIFTS) {
    let hours = 0, sales = 0, invoices = 0, pendingDays = 0;
    const rates = branchShiftRates(window, args.staffId);
    for (const c of target.cycles) { if (!rates.attributionOk.has(c.start) || !timingReliable(c)) continue; const cell = c.shifts[s]; if (cell) { hours += cell.hours; sales += cell.sales; invoices += cell.invoices; pendingDays += cell.pendingDays || 0; } }
    if (hours < DECISION_RULES.minShiftHours) continue;
    const pooled = rates.pooledRate(s);
    const peerRates = window.doctors.filter(d => d.staffId !== args.staffId).map(d => {
      let h = 0, v = 0;
      for (const c of d.cycles) { if (!rates.attributionOk.has(c.start) || !timingReliable(c)) continue; const cell = c.shifts[s]; if (cell) { h += cell.hours; v += cell.sales; } }
      return h >= DECISION_RULES.minShiftHours ? v / h : null;
    }).filter((v): v is number => v !== null).sort((a, b) => a - b);
    const enough = peerRates.length >= DECISION_RULES.minShiftPeers;
    shiftsChart.push({ shift: s, label: SHIFT_LABELS[s], actual: sales / hours, expected: pooled ? pooled.rate : null, p25: enough ? quantile(peerRates, 0.25) : null, p75: enough ? quantile(peerRates, 0.75) : null, hours, invoices, peers: peerRates.length, confidence: enough && hours >= 40 ? 'high' : enough ? 'medium' : 'low', pendingDays });
  }
  const qualityChart = [...me.cycles].reverse().map(c => ({
    cycleStart: c.cycleStart,
    lateShare: c.attendance?.available && (c.attendance.workedDays || 0) > 0 ? (c.attendance.lateDays || 0) / (c.attendance.workedDays || 1) : null,
    lateDays: c.attendance?.available ? c.attendance.lateDays ?? null : null,
    workedDays: c.attendance?.available ? c.attendance.workedDays ?? null : null,
    coreAverage: c.quality?.sampleSufficient ? c.quality.coreAverage : null,
    reviews: c.qualityAvailable ? c.quality?.reviewCount || 0 : null,
    medicalErrors: c.qualityAvailable ? Math.max(c.quality?.medicalErrors || 0, c.quality?.criticalErrors || 0) : null,
  }));

  return {
    availability: 'ready',
    availabilityReason: null,
    analysisCycleStart: analysis.cycleStart,
    analysisIsEvaluatedCycle,
    analysisNote,
    confidence: { level, reasons },
    summary: { headline, strength: strengths[0] || null, problem: top ? `${top.title}: ${top.detail}` : null, decision: decision?.action ?? null },
    indicators: { self, peers, evaluation },
    changeDrivers,
    problems: problems.slice(0, 3),
    decision,
    branchPriorities,
    charts: { trend, peers: peersChart, peerBand, shifts: shiftsChart, quality: qualityChart, targetPendingDays: analysis.attendance?.pendingReviewDays || 0 },
    dataWarnings: warnings,
  };
}

/** Groups canonical review rows by doctor (staff_id, else doctor_id) and evaluation cycle start. */
export function groupReviewRowsByDoctorCycle(rows: Record<string, unknown>[], cycles: { start: string; endExclusive: string }[]) {
  const out: Record<string, Record<string, Record<string, unknown>[]>> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const id = String(row.id || '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const who = String(row.staff_id || row.doctor_id || '');
    const when = new Date(String(row.conversation_date || row.created_at || ''));
    if (!who || Number.isNaN(when.getTime())) continue;
    // Cairo calendar day of the conversation (UTC+2/+3 handled via Intl to avoid off-by-one at midnight).
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
    const cycle = cycles.find(c => day >= c.start && day < c.endExclusive);
    if (!cycle) continue;
    ((out[who] ||= {})[cycle.start] ||= []).push(row);
  }
  return out;
}
