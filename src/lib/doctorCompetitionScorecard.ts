import { supabase } from '@/lib/supabase';

/**
 * The doctor competition scorecard: one score out of 100 per doctor, measured inside their own
 * branch, built from eight criteria. A criterion whose source is unavailable for a doctor is
 * left out and the rest are scaled back to 100, so a missing source never reads as a zero.
 */
export const SCORE_WEIGHTS = {
  sales: 25,
  daily: 10,
  invoices: 10,
  average: 10,
  list: 15,
  followups: 15,
  requests: 5,
  attendance: 10,
} as const;

export type ScoreCriterion = keyof typeof SCORE_WEIGHTS;
export const SCORE_CRITERIA = Object.keys(SCORE_WEIGHTS) as ScoreCriterion[];

export const SCORE_LABELS: Record<ScoreCriterion, string> = {
  sales: 'المبيعات',
  daily: 'متوسط اليوم',
  invoices: 'عدد الفواتير',
  average: 'متوسط الفاتورة',
  list: 'حافز اللستة',
  followups: 'طلبات المتابعة',
  requests: 'طلبات العملاء',
  attendance: 'الالتزام بالحضور',
};

/** Average-invoice points grow to full only from this many invoices, so two big invoices cannot win it. */
export const AVERAGE_FULL_AT_INVOICES = 30;
/** Daily-average points grow to full only from this many working days. */
export const DAILY_FULL_AT_DAYS = 5;
/** Late (> 15 minutes) and early-leave days count as half a day; an approved absence as a whole missed day. */
export const LATE_DAY_WEIGHT = 0.5;
export const EARLY_LEAVE_DAY_WEIGHT = 0.5;

export interface AttendanceFacts {
  shiftDays: number;
  onTimeDays: number;
  lateDays: number;
  lateMinutes: number;
  earlyLeaveDays: number;
  absenceDays: number;
  underReviewDays: number;
}

export interface ScoreInput {
  key: string;
  sales: number;
  invoices: number;
  /** Days with at least one invoice in the period. */
  sellingDays: number;
  /**
   * The list incentive earned (units x each product's incentive), not the money the units sold for:
   * the list is competed on what it pays. null: the list source is unavailable.
   */
  listIncentive: number | null;
  /** null: the follow-up request log is unavailable. */
  followupRequests: number | null;
  /** null: customer requests are unavailable. */
  customerRequests: number | null;
  /** null: attendance is unavailable to this viewer, or no attendance is recorded for the doctor. */
  attendance: AttendanceFacts | null;
}

export interface ScoreResult {
  key: string;
  /** Out of 100, one decimal. */
  total: number;
  /** Points earned per criterion (out of its weight); null when the criterion was left out. */
  parts: Record<ScoreCriterion, number | null>;
  /** Working days used for the daily average and the follow-up share: the larger of approved shifts and selling days. */
  workingDays: number;
  dailyAverage: number;
  /** This doctor's share of the branch follow-up target, by working days; null without a target. */
  followupTarget: number | null;
  /** 0–100; null without attendance. */
  commitmentPercent: number | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const ratio = (value: number, max: number) => (max > 0 ? Math.max(0, Math.min(1, value / max)) : 0);

export function commitmentRate(attendance: AttendanceFacts | null): number | null {
  if (!attendance) return null;
  const expected = attendance.shiftDays + attendance.absenceDays;
  if (expected <= 0) return null;
  const kept =
    attendance.shiftDays -
    attendance.lateDays * LATE_DAY_WEIGHT -
    attendance.earlyLeaveDays * EARLY_LEAVE_DAY_WEIGHT;
  return Math.max(0, Math.min(1, kept / expected));
}

/**
 * Scores the doctors of ONE branch against each other.
 * @param followupTarget the branch's follow-up request target for the period, or null when there is none.
 */
export function scoreBranchDoctors(
  doctors: ScoreInput[],
  followupTarget: number | null
): ScoreResult[] {
  // The larger of approved shifts and selling days: shifts still under review are not counted as
  // shifts yet, so shifts alone would inflate the daily average of a doctor whose days are pending.
  const workingDaysOf = (doctor: ScoreInput) =>
    Math.max(doctor.attendance?.shiftDays ?? 0, doctor.sellingDays);
  const dailyOf = (doctor: ScoreInput) => {
    const days = workingDaysOf(doctor);
    return days > 0 ? doctor.sales / days : 0;
  };
  const averageOf = (doctor: ScoreInput) => (doctor.invoices ? doctor.sales / doctor.invoices : 0);

  const max = (values: number[]) => Math.max(0, ...values);
  const maxSales = max(doctors.map((d) => d.sales));
  const maxInvoices = max(doctors.map((d) => d.invoices));
  const maxDaily = max(
    doctors.map((d) => dailyOf(d) * Math.min(1, workingDaysOf(d) / DAILY_FULL_AT_DAYS))
  );
  const steady = doctors.filter((d) => d.invoices >= AVERAGE_FULL_AT_INVOICES);
  const maxAverage = max((steady.length ? steady : doctors).map(averageOf));
  const maxList = max(doctors.map((d) => d.listIncentive ?? 0));
  const maxFollowups = max(doctors.map((d) => d.followupRequests ?? 0));
  const maxRequests = max(doctors.map((d) => d.customerRequests ?? 0));
  const branchDays = doctors.reduce((total, d) => total + workingDaysOf(d), 0);

  return doctors.map((doctor) => {
    const workingDays = workingDaysOf(doctor);
    const share =
      followupTarget && branchDays > 0 ? (followupTarget * workingDays) / branchDays : null;
    const commitment = commitmentRate(doctor.attendance);
    const fraction: Record<ScoreCriterion, number | null> = {
      sales: ratio(doctor.sales, maxSales),
      daily: ratio(dailyOf(doctor) * Math.min(1, workingDays / DAILY_FULL_AT_DAYS), maxDaily),
      invoices: ratio(doctor.invoices, maxInvoices),
      average:
        ratio(averageOf(doctor), maxAverage) *
        Math.min(1, doctor.invoices / AVERAGE_FULL_AT_INVOICES),
      list: doctor.listIncentive === null ? null : ratio(doctor.listIncentive, maxList),
      // Against the doctor's own share of the target when there is one, else against the branch's best.
      followups:
        doctor.followupRequests === null
          ? null
          : share
            ? ratio(doctor.followupRequests, share)
            : ratio(doctor.followupRequests, maxFollowups),
      requests:
        doctor.customerRequests === null ? null : ratio(doctor.customerRequests, maxRequests),
      attendance: commitment,
    };

    const parts = {} as Record<ScoreCriterion, number | null>;
    let earned = 0;
    let possible = 0;
    for (const criterion of SCORE_CRITERIA) {
      const value = fraction[criterion];
      if (value === null) {
        parts[criterion] = null;
        continue;
      }
      parts[criterion] = round1(value * SCORE_WEIGHTS[criterion]);
      earned += value * SCORE_WEIGHTS[criterion];
      possible += SCORE_WEIGHTS[criterion];
    }
    return {
      key: doctor.key,
      total: possible ? round1((earned / possible) * 100) : 0,
      parts,
      workingDays,
      dailyAverage: Math.round(dailyOf(doctor) * 100) / 100,
      followupTarget: share === null ? null : Math.round(share),
      commitmentPercent: commitment === null ? null : round1(commitment * 100),
    };
  });
}

export interface ScorecardListRow {
  staffId: string;
  branch: string;
  listUnits: number;
  listValue: number;
  listIncentive: number;
  listProducts: number;
  stagnantUnits: number;
  stagnantValue: number;
  stagnantIncentive: number;
}
export interface ScorecardCountRow {
  staffId: string;
  branch: string;
  requests: number;
  fulfilled: number;
}
export interface ScorecardFacts {
  list: ScorecardListRow[];
  followups: { staffId: string; branch: string; requests: number; days: number }[];
  requests: ScorecardCountRow[];
  /** null: the viewer may not see attendance. */
  attendance: (AttendanceFacts & { staffId: string })[] | null;
}

type Raw = Record<string, unknown>;
const n = (value: unknown) => Number(value) || 0;
const s = (value: unknown) => String(value ?? '');

/** Reads the facts the scorecard needs beyond sales; throws when the function is missing or fails. */
export async function loadScorecardFacts(start: string, end: string): Promise<ScorecardFacts> {
  const { data, error } = await supabase.rpc('get_doctor_competition_scorecard_facts_v1', {
    p_start: start,
    p_end: end,
  });
  if (error) throw error;
  const raw = (data || {}) as {
    list?: Raw[];
    followups?: Raw[];
    requests?: Raw[];
    attendance?: Raw[] | null;
  };
  return {
    list: (raw.list || []).map((row) => ({
      staffId: s(row.staff_id),
      branch: s(row.branch),
      listUnits: n(row.list_units),
      listValue: n(row.list_value),
      listIncentive: n(row.list_incentive),
      listProducts: n(row.list_products),
      stagnantUnits: n(row.stagnant_units),
      stagnantValue: n(row.stagnant_value),
      stagnantIncentive: n(row.stagnant_incentive),
    })),
    followups: (raw.followups || []).map((row) => ({
      staffId: s(row.staff_id),
      branch: s(row.branch),
      requests: n(row.requests),
      days: n(row.days),
    })),
    requests: (raw.requests || []).map((row) => ({
      staffId: s(row.staff_id),
      branch: s(row.branch),
      requests: n(row.requests),
      fulfilled: n(row.fulfilled),
    })),
    attendance:
      raw.attendance === null || raw.attendance === undefined
        ? null
        : raw.attendance.map((row) => ({
            staffId: s(row.staff_id),
            shiftDays: n(row.shift_days),
            onTimeDays: n(row.on_time_days),
            lateDays: n(row.late_days),
            lateMinutes: n(row.late_minutes),
            earlyLeaveDays: n(row.early_leave_days),
            absenceDays: n(row.absence_days),
            underReviewDays: n(row.under_review_days),
          })),
  };
}
