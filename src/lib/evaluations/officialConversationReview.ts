// Official conversation-review contract for staff evaluation and points (one definition).
//
// Two separate questions, never conflated:
//
// 1. Is the review OFFICIAL EVIDENCE of conversation quality (monthly scores, rankings, reports)?
//      official  — current, not superseded, not reversed/rejected, and
//                  * written by a human reviewer (the authorized customer-service team, managers):
//                    a valid human review counts as written; no general-manager review is required; or
//                  * an automatic analysis explicitly approved by a manager
//                    (manager_reviewed_at + manager_reviewed_by).
//      automatic_unapproved — an automatic analysis nobody approved. The automatic writer stores
//                  impact_status='approved' because it carries zero points; that is not an approval.
//      superseded / rejected_or_reversed — history, never evidence.
//
// 2. Are its POINTS PAYABLE? Official AND impact_status='approved'. impact_status is the approval
//    of the points effect, not of the review: a human review with a deduction or a severe error is
//    saved 'pending' until a manager approves the penalty. Such a review still counts as quality
//    evidence (excluding it would keep only near-perfect reviews and inflate every average), but
//    its points stay visible and unpaid until approved.
//
// Scores: final_score/total_score are stored on 0..100. Per-dimension columns are raw criterion
// points normalised to 0..10 by monthlyConversationScoreScale.ts. Out-of-scale values are invalid
// evidence (null), never clamped.
//
// Dates: the 26th -> 25th cycle is decided by the OPERATIONAL conversation date on the Cairo
// calendar, never created_at/reviewed_at and never the machine/server timezone.
// SQL mirrors: conversation_sales_reviews_official_v1 / conversation_sales_reviews_monthly_official_v1
// (question 1) and dawaa_conversation_review_points_payable_v1 (question 2).
import { cairoDayOf } from '@/lib/time/cairoDateBoundary';

type Row = Record<string, unknown>;

export type ConversationReviewEvaluationState =
  | 'official'
  | 'automatic_unapproved'
  | 'superseded'
  | 'rejected_or_reversed';

/** Columns this contract reads; every reader must select them. */
export const OFFICIAL_REVIEW_COLUMNS = [
  'is_current',
  'superseded_at',
  'impact_status',
  'evaluation_kind',
  'automatic_evaluation_version',
  'manager_reviewed_at',
  'manager_reviewed_by',
  'conversation_date',
  'final_score',
  'total_score',
] as const;

const RETIRED_IMPACT = new Set(['reversed', 'rejected', 'cancelled']);

function text(value: unknown) {
  return String(value ?? '').trim();
}

export function isAutomaticConversationReview(row: Row): boolean {
  return text(row.automatic_evaluation_version) !== '' || text(row.evaluation_kind).toLowerCase() === 'automatic';
}

export function classifyConversationReview(row: Row): ConversationReviewEvaluationState {
  if (row.is_current === false || text(row.superseded_at) !== '') return 'superseded';
  if (RETIRED_IMPACT.has(text(row.impact_status).toLowerCase())) return 'rejected_or_reversed';
  if (isAutomaticConversationReview(row)) {
    const managerApproved = text(row.manager_reviewed_at) !== '' && text(row.manager_reviewed_by) !== '';
    return managerApproved ? 'official' : 'automatic_unapproved';
  }
  return 'official';
}

/** Official evidence of conversation quality (scores, rankings, monthly evaluation). */
export function isOfficialConversationReview(row: Row): boolean {
  return classifyConversationReview(row) === 'official';
}

/** Official AND its points effect approved: the only reviews whose points may be paid. */
export function isPayableConversationReview(row: Row): boolean {
  return isOfficialConversationReview(row) && text(row.impact_status).toLowerCase() === 'approved';
}

/** Operational Cairo calendar day of the conversation, or null when it was never recorded. */
export function conversationReviewOperationalDay(row: Row): string | null {
  return cairoDayOf(row.conversation_date);
}

/** The 26th -> 25th evaluation cycle (start inclusive, end exclusive) containing a Cairo day. */
export function evaluationCycleOfDay(day: string): { cycleStart: string; cycleEndExclusive: string } {
  const [year, month, date] = day.split('-').map(Number);
  const startMonthIndex = date >= 26 ? month - 1 : month - 2; // 0-based month of the cycle start
  const start = new Date(Date.UTC(year, startMonthIndex, 26));
  const end = new Date(Date.UTC(year, startMonthIndex + 1, 26));
  return { cycleStart: start.toISOString().slice(0, 10), cycleEndExclusive: end.toISOString().slice(0, 10) };
}

/** 0..100 conversation score, or null when absent/out of scale (never clamped, never 0). */
export function conversationReviewScore100(row: Row): number | null {
  const raw = row.final_score ?? row.total_score;
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export interface OfficialConversationReviewSelection<T extends Row> {
  /** Official rows whose operational Cairo day lies in [startDay, endDayExclusive). */
  rows: T[];
  /** Official rows (included in `rows`) whose points still await approval: scored, not yet paid. */
  pointsPendingApproval: number;
  automaticUnapproved: number;
  superseded: number;
  rejectedOrReversed: number;
  /** Rows without an operational conversation date: cannot be placed in a cycle. */
  undated: number;
  outsideCycle: number;
}

export function selectOfficialConversationReviews<T extends Row>(
  rows: readonly T[],
  window: { startDay: string; endDayExclusive: string }
): OfficialConversationReviewSelection<T> {
  const result: OfficialConversationReviewSelection<T> = {
    rows: [], pointsPendingApproval: 0, automaticUnapproved: 0, superseded: 0, rejectedOrReversed: 0, undated: 0, outsideCycle: 0,
  };
  for (const row of rows) {
    const state = classifyConversationReview(row);
    if (state === 'automatic_unapproved') { result.automaticUnapproved += 1; continue; }
    if (state === 'superseded') { result.superseded += 1; continue; }
    if (state === 'rejected_or_reversed') { result.rejectedOrReversed += 1; continue; }
    const day = conversationReviewOperationalDay(row);
    if (!day) { result.undated += 1; continue; }
    if (day < window.startDay || day >= window.endDayExclusive) { result.outsideCycle += 1; continue; }
    if (!isPayableConversationReview(row)) result.pointsPendingApproval += 1;
    result.rows.push(row);
  }
  return result;
}

/** Mean 0..100 score of official rows; null (shown as "under review") when none is scoreable. */
export function averageOfficialConversationScore(rows: readonly Row[]): number | null {
  const values = rows.filter(isOfficialConversationReview).map(conversationReviewScore100)
    .filter((value): value is number => value !== null);
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}
