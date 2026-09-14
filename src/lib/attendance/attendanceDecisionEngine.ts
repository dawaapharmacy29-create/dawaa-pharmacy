import {
  attendanceMinutes,
  isMinuteInsideProtectedWindow,
  minutesBetween,
  type EffectivePolicyResult,
} from '@/lib/attendance/effectiveAttendancePolicy';

export type AttendanceDecisionInput = {
  policy: EffectivePolicyResult;
  firstIn: string | null;
  lastOut: string | null;
  nowTime?: string | null;
  shiftCompleted?: boolean;
  graceMinutes?: number;
};

export type AttendanceDecision = {
  status:
    | 'off'
    | 'scheduled'
    | 'on_time'
    | 'late'
    | 'working_now'
    | 'missing_checkin'
    | 'missing_checkout'
    | 'needs_review';
  lateMinutes: number;
  earlyLeaveMinutes: number;
  penaltyBlocked: boolean;
  requiresReview: boolean;
  reasons: string[];
};

function clampPositive(value: number | null) {
  return value == null ? 0 : Math.max(0, Math.round(value));
}

function coveredByPermission(time: string | null, policy: EffectivePolicyResult) {
  return policy.protectedWindows.some((window) => isMinuteInsideProtectedWindow(time, window));
}

export function decideAttendanceDay(input: AttendanceDecisionInput): AttendanceDecision {
  const grace = Math.max(0, input.graceMinutes ?? 15);
  const { policy, firstIn, lastOut } = input;
  const reasons = [...policy.rules];
  const penaltyBlocked = Boolean(policy.effective.protectedFromPenalty || policy.pendingReview);

  if (!policy.effective.start && !policy.effective.end) {
    return {
      status: 'off',
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      penaltyBlocked: true,
      requiresReview: false,
      reasons,
    };
  }

  if (!firstIn) {
    const beforeStart = input.nowTime && policy.effective.start
      ? (attendanceMinutes(input.nowTime) ?? 0) < (attendanceMinutes(policy.effective.start) ?? 0)
      : false;
    if (!input.shiftCompleted && beforeStart) {
      return { status: 'scheduled', lateMinutes: 0, earlyLeaveMinutes: 0, penaltyBlocked, requiresReview: false, reasons };
    }
    reasons.push('لا توجد بصمة دخول محتسبة');
    return {
      status: penaltyBlocked ? 'needs_review' : 'missing_checkin',
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      penaltyBlocked,
      requiresReview: true,
      reasons,
    };
  }

  let late = clampPositive(minutesBetween(firstIn, policy.effective.start, policy.isOvernightShift));
  if (late <= grace) late = 0;
  if (late > 0 && coveredByPermission(firstIn, policy)) {
    reasons.push('بصمة الدخول داخل نافذة إذن معتمد؛ تم إلغاء التأخير');
    late = 0;
  }

  if (!lastOut) {
    if (!input.shiftCompleted) {
      return {
        status: late > 0 ? 'late' : 'working_now',
        lateMinutes: late,
        earlyLeaveMinutes: 0,
        penaltyBlocked,
        requiresReview: false,
        reasons,
      };
    }
    reasons.push('انتهى الشيفت بدون بصمة خروج محتسبة');
    return {
      status: penaltyBlocked ? 'needs_review' : 'missing_checkout',
      lateMinutes: late,
      earlyLeaveMinutes: 0,
      penaltyBlocked,
      requiresReview: true,
      reasons,
    };
  }

  let earlyLeave = 0;
  if (policy.effective.end) {
    const delta = minutesBetween(lastOut, policy.effective.end, policy.isOvernightShift);
    earlyLeave = delta == null ? 0 : Math.max(0, -Math.round(delta));
    if (earlyLeave > 0 && coveredByPermission(lastOut, policy)) {
      reasons.push('بصمة الخروج داخل نافذة إذن معتمد؛ تم إلغاء الخروج المبكر');
      earlyLeave = 0;
    }
  }

  if (penaltyBlocked && (late > 0 || earlyLeave > 0)) {
    reasons.push('يوجد إذن/طلب يحجب اعتماد الجزاء آليًا');
    return {
      status: 'needs_review',
      lateMinutes: late,
      earlyLeaveMinutes: earlyLeave,
      penaltyBlocked: true,
      requiresReview: true,
      reasons,
    };
  }

  return {
    status: late > 0 ? 'late' : 'on_time',
    lateMinutes: late,
    earlyLeaveMinutes: earlyLeave,
    penaltyBlocked,
    requiresReview: false,
    reasons,
  };
}
