// Follow-up Promise Lifecycle — the single rule for judging "the staff member promised to get back
// to the customer" (هراجع لحضرتك / لحظات / هرجع لحضرتك ...).
//
//   promise ──► pending ──(SLA due)──► overdue ──(mature evidence)──► violated
//          └──────────────── staff returned ──────────────────► completed
//
// The end of a WhatsApp export is NOT evidence of failure: an export can be taken one minute after
// the promise. Only observed activity proves how long the conversation was watched. So:
//   * pending   — less than `dueAfterMinutes` observed after the promise: no penalty, no
//                 forgotten_customer, no negative evidence.
//   * overdue   — the SLA passed inside the observed window but the evidence is not yet mature
//                 (< `violationAfterMinutes` observed): flagged for human review, still no penalty.
//   * violated  — the conversation was observed for at least `violationAfterMinutes` after the
//                 promise (a later message proves it) with no staff return: only now may an
//                 automatic draft propose "لم يرجع نهائيًا". A human still approves any points.
//   * completed — a later staff reply fulfils the promise; the wait time is scored normally.

export const FOLLOWUP_PROMISE_LIFECYCLE_VERSION = 'followup-promise-lifecycle-v1';

export const FOLLOWUP_PROMISE_SLA = {
  /** Same boundary as the slowest scored band ("رجع بعد أكثر من 20 دقيقة"). */
  dueAfterMinutes: 20,
  /** Same boundary as a raw WhatsApp session gap: the conversation is mature for judgement. */
  violationAfterMinutes: 120,
} as const;

export type FollowUpPromiseLifecycleStatus = 'completed' | 'pending' | 'overdue' | 'violated';

export interface FollowUpPromiseLifecycle {
  version: typeof FOLLOWUP_PROMISE_LIFECYCLE_VERSION;
  status: FollowUpPromiseLifecycleStatus;
  promiseAt: string;
  dueAt: string;
  violationAt: string;
  returnedAt: string | null;
  /** Latest observed evidence after the promise (a real message timestamp), if any. */
  observedUntil: string | null;
  observedMinutes: number;
  waitMinutes: number | null;
  /** Only a violated promise may carry an automatic negative proposal (still human-approved). */
  penaltyEligible: boolean;
  reason: string;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

const MINUTE = 60_000;

export function evaluateFollowUpPromiseLifecycle(input: {
  promiseAt: Date | string;
  returnedAt?: Date | string | null;
  observedUntil?: Date | string | null;
  sla?: { dueAfterMinutes: number; violationAfterMinutes: number };
}): FollowUpPromiseLifecycle | null {
  const promise = toTime(input.promiseAt);
  if (promise == null) return null;
  const sla = input.sla ?? FOLLOWUP_PROMISE_SLA;
  const due = promise + sla.dueAfterMinutes * MINUTE;
  const violation = promise + sla.violationAfterMinutes * MINUTE;
  const returned = toTime(input.returnedAt);
  const observedRaw = toTime(input.observedUntil);
  const observed = observedRaw != null && observedRaw > promise ? observedRaw : null;
  const observedMinutes = observed == null ? 0 : Math.floor((observed - promise) / MINUTE);
  const base = {
    version: FOLLOWUP_PROMISE_LIFECYCLE_VERSION,
    promiseAt: new Date(promise).toISOString(),
    dueAt: new Date(due).toISOString(),
    violationAt: new Date(violation).toISOString(),
    observedUntil: observed == null ? null : new Date(observed).toISOString(),
    observedMinutes,
  } as const;

  if (returned != null && returned >= promise) {
    const waitMinutes = Math.round((returned - promise) / MINUTE);
    return {
      ...base,
      status: 'completed',
      returnedAt: new Date(returned).toISOString(),
      waitMinutes,
      penaltyEligible: false,
      reason: `تم تنفيذ وعد المتابعة بعد ${waitMinutes} دقيقة.`,
    };
  }

  if (observed == null || observed < due) {
    return {
      ...base,
      status: 'pending',
      returnedAt: null,
      waitMinutes: null,
      penaltyEligible: false,
      reason: `وعد المتابعة ما زال داخل المهلة (${sla.dueAfterMinutes} دقيقة) — المراقب بعد الوعد ${observedMinutes} دقيقة فقط. نهاية ملف التصدير ليست دليل نسيان؛ لا خصم.`,
    };
  }

  if (observed < violation) {
    return {
      ...base,
      status: 'overdue',
      returnedAt: null,
      waitMinutes: null,
      penaltyEligible: false,
      reason: `تجاوز وعد المتابعة المهلة (${sla.dueAfterMinutes} دقيقة) دون رجوع ظاهر، لكن الأدلة غير ناضجة بعد (مراقبة ${observedMinutes} من ${sla.violationAfterMinutes} دقيقة) — يحتاج مراجعة بشرية، بدون خصم تلقائي.`,
    };
  }

  return {
    ...base,
    status: 'violated',
    returnedAt: null,
    waitMinutes: null,
    penaltyEligible: true,
    reason: `لم يرجع الموظف للعميل رغم مرور ${observedMinutes} دقيقة مراقبة بعد الوعد (المهلة ${sla.dueAfterMinutes} دقيقة، النضج ${sla.violationAfterMinutes} دقيقة).`,
  };
}
