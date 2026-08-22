import { supabase } from '@/lib/supabase';
import { readAttendanceRange } from '@/lib/readModels/attendanceReadModel';

export type EmployeeMonthlyEvidence = {
  metrics: Record<string, number>;
  health: {
    reviews: 'available' | 'unavailable';
    followups: 'available' | 'unavailable';
    attendance: 'available' | 'unavailable';
  };
  errors: Record<string, string>;
};

function safeNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

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
    ? reviewRows.reduce((sum, row) => sum + safeNumber(row.final_score || row.total_score), 0) /
      reviewRows.length
    : 0;
  const completedFollowups = followupRows.filter(
    (row) =>
      row.completed_at ||
      /completed|مكتمل|تم/.test(String(row.status || row.followup_status || ''))
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

  return {
    metrics: {
      review_count: reviewRows.length,
      review_average: Math.round(reviewAverage * 10) / 10,
      completed_followups: completedFollowups,
      followup_count: followupRows.length,
      positive_points: positivePoints,
      negative_points: negativePoints,
      attendance_days: attendanceRows.length,
      present_days: presentDays,
    },
    health: {
      reviews: reviewResult.error ? 'unavailable' : 'available',
      followups: followupResult.error ? 'unavailable' : 'available',
      attendance: attendanceResult.status,
    },
    errors,
  };
}
