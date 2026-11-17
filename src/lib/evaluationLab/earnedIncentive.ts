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
  /** v7.0 ramp (owner 2026-11-14): 700 in the cycle that opened 26/10, 1000 from 26/11. */
  followupTargetByCycle: { '2026-10-26': 700 } as Readonly<Record<string, number>>,
  /** v7.0: official conversation reviews a doctor needs in a full cycle for the item to count. */
  minConversationReviews: 30,
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
  /** v7.1: reviewed samples (invoices by camera, conversations) a doctor needs in a full cycle. */
  minSampleReviews: 6,
  /** v7.1 invoice camera review: an average of 50 → 0, 90+ → full. */
  invoiceReviewFloor: 50,
  invoiceReviewFull: 90,
  /** v7.1: the most a doctor's average-invoice target may rise over his hours' average of last cycle. */
  maxMonthlyGrowth: 1.15,
  /** v7.1: a full month is 26 days × 8 hours (punched hours, plus 8 per approved-leave day); 90% of it earns the whole
   *  incentive, fewer hours earn their share, so a few days of work never take a full month's money. */
  fullMonthHours: 208,
  fullHoursShare: 0.9,
  leaveDayHours: 8,
  /** v7.1: the average invoice leans on his hours' average of last cycle as if he had this many more invoices,
   *  so a handful of invoices cannot make a big average; with hundreds of invoices it is his own average. */
  avgInvoiceCredibility: 60,
  /** v7.1: one invoice counts in the average up to the branch's 99th percentile of the cycle. */
  avgInvoiceCapPercentile: 0.99,
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
  /** v7.1: real hours (punches + approved leave) against a full month; null before v7.1 or without punches. */
  hours: { worked: number; leaveDays: number; needed: number; factor: number } | null;
}

/** v7.1 hours factor: worked hours (+ approved leave) ÷ 90% of a full month (scaled to the evidence), at most 1. */
export function hoursFactorFor(worked: number, leaveDays: number, cycleShare = 1) {
  const needed = Math.round(EARNED_RULES.fullMonthHours * EARNED_RULES.fullHoursShare * Math.min(1, Math.max(0.01, cycleShare)));
  const factor = Math.round(Math.min(1, (worked + leaveDays * EARNED_RULES.leaveDayHours) / needed) * 100) / 100;
  return { worked, leaveDays, needed, factor };
}

/** v7.1 average invoice: capped net, leaning on the hours' expected average by the credibility weight. */
export function credibleAverage(cappedNet: number, count: number, base: number | null | undefined) {
  const k = base && base > 0 ? EARNED_RULES.avgInvoiceCredibility : 0;
  return count + k > 0 ? (cappedNet + k * (base || 0)) / (count + k) : 0;
}

export function earnedIncentive(score: number | null, branchAchievement: number | null, absenceDays: number,
  hours: EarnedIncentive['hours'] = null): EarnedIncentive {
  const tier = score === null ? EARNED_TIERS[EARNED_TIERS.length - 1] : tierFor(score);
  const factor = branchAchievement === null ? 0 : branchFactorFor(branchAchievement);
  const cut = absenceCutFor(absenceDays);
  const presence = hours ? hours.factor : 1;
  const performance = Math.round(EARNED_POOL * (tier.percent / 100) * factor * (1 - cut) * presence);
  const bonus = score !== null && score >= 60 && branchAchievement !== null ? Math.round(salesBonusFor(branchAchievement) * (1 - cut) * presence) : 0;
  const next = score === null ? null : [...EARNED_TIERS].reverse().find((row) => row.min > score) ?? null;
  return {
    score, tierLabel: tier.label, tierPercent: tier.percent, branchAchievement, branchFactor: factor, absenceDays, absenceCut: cut,
    performance, bonus, total: performance + bonus,
    next: next ? { min: next.min, percent: next.percent, points: round(next.min - (score as number)) } : null,
    hours,
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
  /** v7.1: cappedNet (each invoice up to the branch's 99th percentile) and base (his hours' average last cycle). */
  invoices: { count: number; net: number; coded: number; minInvoices: number; minDays: number; cappedNet?: number; base?: number | null };
  reviews: number[];
  minReviews: number;
  violations: number | null;
  /** v7.1: the doctor's own follow-up target for the cycle (his share of the customers in his hours). */
  followupTarget?: number | null;
  followupTargetNote?: string;
  /** v7.1: the doctor's complete-requests target (default 20). */
  requestsTarget?: number | null;
  requestsTargetNote?: string;
  /** v7.1: the doctor's average-invoice target (his hours' average last cycle × growth). */
  avgInvoiceTarget?: number | null;
  avgInvoiceNote?: string;
  /** v7.1: the weekly conversation sample (undefined before v7.1; null when unreadable). */
  sampledConversations?: { reviewed: number; missing: number; average: number | null } | null;
  /** v7.1: the weekly invoice camera review (undefined before v7.1; null when unreadable). */
  invoiceReview?: { reviewed: number; average: number | null } | null;
  minSampleReviews?: number;
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
  } else if (input.followupTarget !== undefined) {
    // v7.1: his share of the branch target by the customers who came in his hours.
    const target = input.followupTarget || 0;
    const projected = project(input.followups);
    out.push(target <= 0
      ? notMeasurable('followup_requests', 'مفيش عملاء في ساعات شغله في الدورة')
      : measured('followup_requests', Math.round(projected), clamp100((projected / target) * 100),
        `${ar(input.followups)} متابعة · متوقع ${ar(projected)} من نصيبه ${ar(target)}${projectedNote}${input.followupTargetNote ? ` · ${input.followupTargetNote}` : ''}`));
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
  const minSample = input.minSampleReviews ?? EARNED_RULES.minSampleReviews;
  if (input.sampledConversations !== undefined) {
    // v7.1: the weekly random sample; a chat not uploaded by its deadline counts 0.
    const sample = input.sampledConversations;
    if (!sample) {
      out.push(notMeasurable('conversation_quality', 'مراجعات العينة الأسبوعية مش متاحة للقراءة من الجلسة دي'));
    } else if (sample.reviewed + sample.missing < minSample || sample.average === null) {
      out.push(notMeasurable('conversation_quality', `${sample.reviewed} محادثة اتراجعت من العينة${sample.missing ? ` و${sample.missing} مترفعتش` : ''} (الحد ${minSample})`));
    } else {
      out.push(measured('conversation_quality', round(sample.average),
        clamp100(((sample.average - EARNED_RULES.conversationFloor) / (EARNED_RULES.conversationFull - EARNED_RULES.conversationFloor)) * 100),
        `${sample.reviewed} محادثة من العينة العشوائية${sample.missing ? ` + ${sample.missing} مترفعتش في معادها (صفر)` : ''} · متوسط ${round(sample.average)}/100 · ${EARNED_RULES.conversationFull} أو أكتر = كاملة`));
    }
  } else if (input.trial) {
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

  // v7.1: invoices reviewed on the cameras from the weekly random sample.
  if (input.invoiceReview !== undefined) {
    const review = input.invoiceReview;
    if (!review) {
      out.push(notMeasurable('invoice_review', 'مراجعات جودة البيع مش متاحة للقراءة من الجلسة دي'));
    } else if (review.reviewed < minSample || review.average === null) {
      out.push(notMeasurable('invoice_review', `${review.reviewed} بيعة اتراجعت على الكاميرا (الحد ${minSample})`));
    } else {
      out.push(measured('invoice_review', round(review.average),
        clamp100(((review.average - EARNED_RULES.invoiceReviewFloor) / (EARNED_RULES.invoiceReviewFull - EARNED_RULES.invoiceReviewFloor)) * 100),
        `${review.reviewed} بيعة اتراجعت على الكاميرا · متوسط ${round(review.average)}/100 · ${EARNED_RULES.invoiceReviewFull} أو أكتر = كاملة`));
    }
  }

  // Complete customer requests.
  const projectedRequests = project(input.completeRequests);
  const requestsTarget = input.requestsTarget ?? EARNED_RULES.completeRequestsTarget;
  if (requestsTarget <= 0) {
    out.push(notMeasurable('complete_requests', 'مفيش عملاء في ساعات شغله في الدورة'));
  } else {
    out.push(measured('complete_requests', Math.round(projectedRequests), clamp100((projectedRequests / requestsTarget) * 100),
      `${ar(input.completeRequests)} طلب كامل (رقم العميل + الصنف ومتلغاش) · متوقع ${ar(projectedRequests)} من ${ar(requestsTarget)}${projectedNote}${input.requestsTargetNote ? ` · ${input.requestsTargetNote}` : ''}`));
  }

  // Average invoice and invoices per working day, against the branch's fixed targets; coding gate halves them.
  const targets = doctorTargetsFor(input.branch);
  const coding = input.invoices.count ? input.invoices.coded / input.invoices.count : 1;
  const gate = coding < EARNED_RULES.codingFloor ? 0.5 : 1;
  const gateNote = gate < 1 ? ` · التكويد ${round(coding * 100)}٪ أقل من ${EARNED_RULES.codingFloor * 100}٪ فالبند اتقسم على ٢` : '';
  const avgTarget = input.avgInvoiceTarget ?? targets?.avgInvoice ?? null;
  if (!targets || !avgTarget) {
    out.push(notMeasurable('avg_invoice_target', 'مفيش تارجت متوسط فاتورة لفرعه'));
    out.push(notMeasurable('invoices_per_day', 'مفيش تارجت فواتير في اليوم لفرعه'));
  } else if (input.invoices.count < input.invoices.minInvoices) {
    const reason = `${ar(input.invoices.count)} فاتورة فقط (الحد ${input.invoices.minInvoices})`;
    out.push(notMeasurable('avg_invoice_target', reason));
    out.push(notMeasurable('invoices_per_day', reason));
  } else {
    const raw = input.invoices.net / input.invoices.count;
    const credible = input.invoices.cappedNet !== undefined;
    const average = credible ? credibleAverage(input.invoices.cappedNet as number, input.invoices.count, input.invoices.base) : raw;
    const ratio = average / avgTarget;
    const credibleNote = credible && Math.round(average) !== Math.round(raw)
      ? ` · متوسطه الفعلي ${ar(raw)} ج على ${ar(input.invoices.count)} فاتورة، والمحسوب ${ar(average)} ج (الفاتورة الشاذة ليها سقف، والفواتير القليلة بتتقرّب من متوسط ساعاته)`
      : '';
    out.push(measured('avg_invoice_target', Math.round(average),
      ((ratio - EARNED_RULES.avgInvoiceFloor) / (1 - EARNED_RULES.avgInvoiceFloor)) * 100 * gate,
      `متوسط ${ar(average)} ج من تارجت ${ar(avgTarget)} ج (${round(ratio * 100)}٪)${credibleNote}${input.avgInvoiceNote ? ` · ${input.avgInvoiceNote}` : ''}${gateNote}`));
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
