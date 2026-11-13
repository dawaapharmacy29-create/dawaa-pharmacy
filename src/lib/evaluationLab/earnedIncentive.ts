import { normalizeBranchName } from '@/lib/branch';
import { INVALID_REQUEST_STATUS, NON_PUNCTUALITY_ATTENDANCE } from './catalog';
import { clamp100, measured, notMeasurable, type AxisResult } from './scoring';

// v6.9 (owner decision 2026-11-13): the doctor's incentive is EARNED, not handed out. Seven items make a
// score out of 100, the score buys a share of the pool, the branch's sales target multiplies it, and
// unexcused absence cuts it. Pure: no I/O. See the design canvas of the monthly evaluation.

/** The pool a doctor can earn in a month (EGP). */
export const EARNED_POOL = 2500;

/** Score → share of the pool. Under 60 earns nothing. */
export const EARNED_TIERS: ReadonlyArray<{ min: number; percent: number; label: string }> = [
  { min: 90, percent: 100, label: 'ممتاز' },
  { min: 80, percent: 85, label: 'قوي جدًا' },
  { min: 70, percent: 65, label: 'كويس' },
  { min: 60, percent: 40, label: 'مقبول' },
  { min: 0, percent: 0, label: 'تحت الحد' },
];

/** Branch target achievement (%) → multiplier of the earned share. */
export const BRANCH_FACTORS: ReadonlyArray<{ min: number; factor: number }> = [
  { min: 100, factor: 1 },
  { min: 95, factor: 0.9 },
  { min: 90, factor: 0.8 },
  { min: 85, factor: 0.6 },
  { min: 0, factor: 0.4 },
];

/** Branch target bonus (EGP), only for a doctor who passed the 60-point line. */
export const SALES_BONUS: ReadonlyArray<{ min: number; amount: number }> = [
  { min: 100, amount: 600 },
  { min: 90, amount: 450 },
  { min: 0, amount: 0 },
];

/** Unexcused absence days (approved by the manager) → cut of the whole incentive. Approved leave is not absence. */
export const ABSENCE_CUTS: ReadonlyArray<{ min: number; cut: number }> = [
  { min: 8, cut: 0.6 },
  { min: 6, cut: 0.4 },
  { min: 4, cut: 0.25 },
  { min: 2, cut: 0.1 },
  { min: 0, cut: 0 },
];

/** Fixed targets per branch, from the last three months' averages. */
export const BRANCH_DOCTOR_TARGETS: Record<string, { avgInvoice: number; invoicesPerDay: number }> = {
  'فرع شكري': { avgInvoice: 390, invoicesPerDay: 19 },
  'فرع الشامي': { avgInvoice: 285, invoicesPerDay: 21 },
};

export const EARNED_RULES = {
  /** Follow-up requests: the branch's monthly target (when none is set), split by the doctors' working days. */
  defaultFollowupTarget: 1000,
  /** Complete customer requests (customer number + item, not cancelled) for the full item. */
  completeRequestsTarget: 20,
  /** Late (>15 min) or early-leave days allowed; each day after costs an eighth, ten or more lose it all. */
  lateAllowance: 2,
  lateSpan: 8,
  lateGraceMinutes: 15,
  /** Average invoice: 80% of the branch target → 0, the target → full. */
  avgInvoiceFloor: 0.8,
  /** Invoices per working day: 70% of the target → 0, the target → full. */
  invoicesFloor: 0.7,
  /** Conversation reviews: an average of 70 → 0, 90+ → full (80 is half). */
  conversationFloor: 70,
  conversationFull: 90,
  /** Each violation the manager records removes 3 of the item's 8 points. */
  violationShare: 3 / 8,
  /** Customer coding below 95% halves the two invoice items. */
  codingFloor: 0.95,
  /** The trial cycle: conversations and uniform are shown, not counted (their weight goes to the rest). */
  trialCycleStarts: ['2026-10-26'] as readonly string[],
} as const;

const pick = <T extends { min: number }>(rows: ReadonlyArray<T>, value: number) => rows.find((row) => value >= row.min) ?? rows[rows.length - 1];
const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const ar = (value: number) => Math.round(value).toLocaleString('ar-EG');
type AxisDraft = Omit<AxisResult, 'label' | 'weight'>;

export function tierFor(score: number) { return pick(EARNED_TIERS, score); }
export function branchFactorFor(achievementPct: number) { return pick(BRANCH_FACTORS, achievementPct).factor; }
export function salesBonusFor(achievementPct: number) { return pick(SALES_BONUS, achievementPct).amount; }
export function absenceCutFor(days: number) { return pick(ABSENCE_CUTS, days).cut; }
export const doctorTargetsFor = (branch: string | null | undefined) => BRANCH_DOCTOR_TARGETS[normalizeBranchName(branch || '') || ''] ?? null;

export interface EarnedIncentive {
  score: number | null;
  tierLabel: string;
  tierPercent: number;
  /** Branch sales against its target so far (%), null without a target. */
  branchAchievement: number | null;
  branchFactor: number;
  absenceDays: number;
  absenceCut: number;
  /** pool × tier × branch factor × (1 − cut). */
  performance: number;
  /** Branch bonus × (1 − cut), only at 60+. */
  bonus: number;
  total: number;
  /** The next tier and the points still needed to reach it. */
  next: { min: number; percent: number; points: number } | null;
}

export function earnedIncentive(score: number | null, branchAchievement: number | null, absenceDays: number): EarnedIncentive {
  const tier = score === null ? EARNED_TIERS[EARNED_TIERS.length - 1] : tierFor(score);
  const factor = branchAchievement === null ? 0 : branchFactorFor(branchAchievement);
  const cut = absenceCutFor(absenceDays);
  const performance = Math.round(EARNED_POOL * (tier.percent / 100) * factor * (1 - cut));
  const bonus = score !== null && score >= 60 && branchAchievement !== null ? Math.round(salesBonusFor(branchAchievement) * (1 - cut)) : 0;
  const next = score === null ? null : [...EARNED_TIERS].reverse().find((row) => row.min > score) ?? null;
  return {
    score, tierLabel: tier.label, tierPercent: tier.percent, branchAchievement, branchFactor: factor, absenceDays, absenceCut: cut,
    performance, bonus, total: performance + bonus,
    next: next ? { min: next.min, percent: next.percent, points: round(next.min - (score as number)) } : null,
  };
}

/** A customer request that counts: not cancelled/duplicate, with the customer's number (code or 8+ digit phone) and an item. */
export function isCompleteRequest(request: { status?: string | null; customerCode?: string | null; customerPhone?: string | null; medicineName?: string | null; productCode?: string | null }) {
  if (INVALID_REQUEST_STATUS.test(String(request.status || '').toLowerCase())) return false;
  const customer = Boolean(request.customerCode && !/^[0\s.-]*$/.test(request.customerCode))
    || String(request.customerPhone || '').replace(/\D/g, '').length >= 8;
  const item = Boolean(String(request.medicineName || '').trim() || String(request.productCode || '').trim());
  return customer && item;
}

/** Attendance of the incentive: only days the manager approved count; days under review are never punished. */
export function attendanceCounts(days: ReadonlyArray<{ status: string | null; approved?: boolean; hasFirstIn: boolean; scheduled: boolean; lateMinutes: number }>) {
  let late = 0;
  let early = 0;
  let absent = 0;
  for (const day of days) {
    if (!day.approved) continue;
    const status = String(day.status || '');
    if (/^absence_review$|absence_deduction/.test(status)) { absent += 1; continue; }
    if (!day.hasFirstIn || NON_PUNCTUALITY_ATTENDANCE.test(status)) continue;
    if (/early_leave/.test(status)) early += 1;
    else if ((day.lateMinutes || 0) > EARNED_RULES.lateGraceMinutes) late += 1;
  }
  return { late, early, absent };
}

export interface EarnedDoctorInput {
  branch: string | null;
  /** Share of the cycle the evidence covers (counts are projected to the whole cycle). */
  cycleShare: number;
  trial: boolean;
  /** The doctor's working days and those of all the branch's doctors (for the follow-up share). */
  workedDays: number;
  branchDoctorDays: number;
  followups: number | null;
  branchFollowupTarget: number;
  completeRequests: number;
  attendance: { late: number; early: number; resolvedDays: number; minDays: number };
  invoices: { count: number; net: number; coded: number; minInvoices: number; minDays: number };
  reviews: number[];
  minReviews: number;
  violations: number | null;
}

/** The seven v6.9 doctor items, each 0..100 with partial credit. */
export function earnedDoctorAxes(input: EarnedDoctorInput): AxisDraft[] {
  const share = Math.min(1, Math.max(0.01, input.cycleShare));
  const project = (count: number) => count / share;
  const projectedNote = share < 1 ? ' (متوقع لآخر الشهر بنفس المعدل)' : '';
  const out: AxisDraft[] = [];

  // Follow-up requests: the doctor's share of the branch target, by working days.
  if (input.followups === null) {
    out.push(notMeasurable('followup_requests', 'سجل طلبات المتابعة غير متاح للقراءة من هذه الجلسة'));
  } else if (!input.workedDays || !input.branchDoctorDays) {
    out.push(notMeasurable('followup_requests', 'مفيش أيام شغل للدكتور في الدورة'));
  } else {
    const target = (input.branchFollowupTarget * input.workedDays) / input.branchDoctorDays;
    const projected = project(input.followups);
    out.push(measured('followup_requests', Math.round(projected), clamp100((projected / target) * 100),
      `${ar(input.followups)} متابعة · متوقع ${ar(projected)} من نصيبه ${ar(target)}${projectedNote} · نصيب الفرع ${ar(input.branchFollowupTarget)} على ${ar(input.workedDays)} من ${ar(input.branchDoctorDays)} يوم شغل للدكاترة`));
  }

  // Punctuality: two late/early days allowed, then an eighth per day.
  if (input.attendance.resolvedDays < input.attendance.minDays) {
    out.push(notMeasurable('punctuality', `${input.attendance.resolvedDays} يوم محسوم فقط (الحد ${input.attendance.minDays})`));
  } else {
    const days = input.attendance.late + input.attendance.early;
    const projected = Math.round(project(days));
    const credit = Math.max(0, Math.min(1, 1 - Math.max(0, projected - EARNED_RULES.lateAllowance) / EARNED_RULES.lateSpan));
    out.push(measured('punctuality', projected, credit * 100,
      `${ar(input.attendance.late)} يوم تأخير أكتر من ${EARNED_RULES.lateGraceMinutes} دقيقة · ${ar(input.attendance.early)} يوم خروج بدري · متوقع ${ar(projected)}${projectedNote} · المسموح ${EARNED_RULES.lateAllowance} · الأيام اللي لسه بتتراجع مش محسوبة`));
  }

  // Conversations: official reviews, 70 → 0, 90+ → full.
  if (input.trial) {
    out.push(notMeasurable('conversation_quality', 'شهر تجريبي: المحادثات بتتعرض ومش بتتحسب، ووزنها بيتوزع على باقي البنود',
      input.reviews.length ? `${input.reviews.length} مراجعة · متوسط ${round(input.reviews.reduce((s, v) => s + v, 0) / input.reviews.length)}` : ''));
  } else if (input.reviews.length < input.minReviews) {
    out.push(notMeasurable('conversation_quality', `${input.reviews.length} مراجعة رسمية فقط (الحد ${input.minReviews})`));
  } else {
    const average = input.reviews.reduce((s, v) => s + v, 0) / input.reviews.length;
    out.push(measured('conversation_quality', round(average),
      ((average - EARNED_RULES.conversationFloor) / (EARNED_RULES.conversationFull - EARNED_RULES.conversationFloor)) * 100,
      `${input.reviews.length} مراجعة · متوسط ${round(average)}/100 · ${EARNED_RULES.conversationFull} أو أكتر = كاملة`));
  }

  // Complete customer requests.
  const projectedRequests = project(input.completeRequests);
  out.push(measured('complete_requests', Math.round(projectedRequests), (projectedRequests / EARNED_RULES.completeRequestsTarget) * 100,
    `${ar(input.completeRequests)} طلب كامل (رقم العميل + الصنف ومتلغاش) · متوقع ${ar(projectedRequests)} من ${EARNED_RULES.completeRequestsTarget}${projectedNote}`));

  // Average invoice and invoices per working day, against the branch's fixed targets; coding gate halves them.
  const targets = doctorTargetsFor(input.branch);
  const coding = input.invoices.count ? input.invoices.coded / input.invoices.count : 1;
  const gate = coding < EARNED_RULES.codingFloor ? 0.5 : 1;
  const gateNote = gate < 1 ? ` · التكويد ${round(coding * 100)}٪ أقل من ${EARNED_RULES.codingFloor * 100}٪ فالبند اتقسم على ٢` : '';
  if (!targets) {
    out.push(notMeasurable('avg_invoice_target', 'مفيش تارجت متوسط فاتورة لفرعه'));
    out.push(notMeasurable('invoices_per_day', 'مفيش تارجت فواتير في اليوم لفرعه'));
  } else if (input.invoices.count < input.invoices.minInvoices) {
    const reason = `${ar(input.invoices.count)} فاتورة فقط (الحد ${input.invoices.minInvoices})`;
    out.push(notMeasurable('avg_invoice_target', reason));
    out.push(notMeasurable('invoices_per_day', reason));
  } else {
    const average = input.invoices.net / input.invoices.count;
    const ratio = average / targets.avgInvoice;
    out.push(measured('avg_invoice_target', Math.round(average),
      ((ratio - EARNED_RULES.avgInvoiceFloor) / (1 - EARNED_RULES.avgInvoiceFloor)) * 100 * gate,
      `متوسط ${ar(average)} ج من تارجت ${ar(targets.avgInvoice)} ج (${round(ratio * 100)}٪)${gateNote}`));
    if (input.workedDays < input.invoices.minDays) {
      out.push(notMeasurable('invoices_per_day', `${input.workedDays} يوم شغل فقط (الحد ${input.invoices.minDays})`));
    } else {
      const perDay = input.invoices.count / input.workedDays;
      const r = perDay / targets.invoicesPerDay;
      out.push(measured('invoices_per_day', round(perDay), ((r - EARNED_RULES.invoicesFloor) / (1 - EARNED_RULES.invoicesFloor)) * 100 * gate,
        `${round(perDay)} فاتورة في يوم الشغل من تارجت ${ar(targets.invoicesPerDay)} (${round(r * 100)}٪) · ${ar(input.invoices.count)} فاتورة في ${ar(input.workedDays)} يوم${gateNote}`));
    }
  }

  // Uniform, permissions and instructions: every violation the manager records removes 3 of 8 points.
  if (input.trial) {
    out.push(notMeasurable('uniform_compliance', 'شهر تجريبي: الزي والأذونات بيتعرضوا ومش بيتحسبوا',
      input.violations === null ? '' : `${input.violations} مخالفة مسجلة`));
  } else if (input.violations === null) {
    out.push(notMeasurable('uniform_compliance', 'سجل المخالفات غير متاح للقراءة من هذه الجلسة'));
  } else {
    out.push(measured('uniform_compliance', input.violations, (1 - input.violations * EARNED_RULES.violationShare) * 100,
      input.violations ? `${input.violations} مخالفة سجلها المدير · كل مخالفة بتشيل ٣ من ٨ نقط` : 'مفيش مخالفات مسجلة'));
  }
  return out;
}
