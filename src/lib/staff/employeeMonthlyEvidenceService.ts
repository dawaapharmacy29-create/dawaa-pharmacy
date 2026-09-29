import { supabase } from '@/lib/supabase';
import { readAttendanceRange } from '@/lib/readModels/attendanceReadModel';

export type EmployeeMonthlyEvidenceMetrics = {
  review_count: number;
  review_average: number;
  completed_followups: number;
  followup_count: number;
  conversation_positive_points: number;
  conversation_negative_points: number;
  attendance_days: number;
  present_days: number;
  engine_version: number;
};

export type EmployeeMonthlyEvidence = {
  metrics: EmployeeMonthlyEvidenceMetrics;
  health: {
    reviews: 'available' | 'unavailable';
    followups: 'available' | 'unavailable';
    attendance: 'available' | 'unavailable';
  };
  ready: boolean;
  errors: Record<string, string>;
};

function safeNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Canonical evidence reader for the monthly staff evaluation.
 *
 * Important: an unavailable source is NOT the same as a genuine zero. Callers
 * must check the ready flag before finalizing an evaluation so a transient query
 * failure cannot silently become a bad monthly score/evidence snapshot.
 */
export async function loadEmployeeMonthlyEvidence(args: {
  staffId: string;
  startDate: string;
  endDateExclusive: string;
}): Promise<EmployeeMonthlyEvidence> {
  const errors: Record<string, string> = {};

  const [reviewResult, followupResult, attendanceResult] = await Promise.all([
    supabase
      .from('conversation_sales_reviews')
      .select('total_score,final_score,doctor_points_impact,point_impact,created_at')
      .eq('staff_id', args.staffId)
      .gte('created_at', args.startDate)
      .lt('created_at', args.endDateExclusive)
      .limit(500),
    supabase
      .from('daily_followups')
      .select('status,followup_status,completed_at,created_at,assigned_staff_id,requested_by_staff_id')
      .or(`assigned_staff_id.eq.${args.staffId},requested_by_staff_id.eq.${args.staffId}`)
      .gte('created_at', args.startDate)
      .lt('created_at', args.endDateExclusive)
      .limit(1000),
    readAttendanceRange({
      staffId: args.staffId,
      startDate: args.startDate,
      endDateExclusive: args.endDateExclusive,
      limit: 400,
    }),
  ]);

  const reviewRows = reviewResult.error ? [] : reviewResult.data || [];
  if (reviewResult.error) errors.reviews = reviewResult.error.message;

  const followupRows = followupResult.error ? [] : followupResult.data || [];
  if (followupResult.error) errors.followups = followupResult.error.message;

  const attendanceRows = attendanceResult.status === 'available' ? attendanceResult.rows : [];
  if (attendanceResult.status === 'unavailable') errors.attendance = attendanceResult.error;

  const reviewAverage = reviewRows.length
    ? reviewRows.reduce((sum, row) => sum + safeNumber(row.final_score ?? row.total_score), 0) /
      reviewRows.length
    : 0;

  const completedFollowups = followupRows.filter(
    (row) =>
      row.completed_at ||
      /completed|مكتمل|تم/i.test(String(row.status || row.followup_status || ''))
  ).length;

  const reviewImpacts = reviewRows.map((row) =>
    safeNumber(row.doctor_points_impact ?? row.point_impact)
  );
  const positivePoints = reviewImpacts
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  const negativePoints = reviewImpacts
    .filter((value) => value < 0)
    .reduce((sum, value) => sum + Math.abs(value), 0);

  const presentDays = attendanceRows.filter((row) =>
    /present|حاضر|late|متأخر/i.test(String(row.status || ''))
  ).length;

  const health = {
    reviews: reviewResult.error ? 'unavailable' as const : 'available' as const,
    followups: followupResult.error ? 'unavailable' as const : 'available' as const,
    attendance: attendanceResult.status,
  };

  return {
    metrics: {
      review_count: reviewRows.length,
      review_average: Math.round(reviewAverage * 10) / 10,
      completed_followups: completedFollowups,
      followup_count: followupRows.length,
      conversation_positive_points: positivePoints,
      conversation_negative_points: negativePoints,
      attendance_days: attendanceRows.length,
      present_days: presentDays,
      engine_version: 4,
    },
    health,
    ready:
      health.reviews === 'available' &&
      health.followups === 'available' &&
      health.attendance === 'available',
    errors,
  };
}
