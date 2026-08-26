import { supabase } from '@/lib/supabase';

export type StaffPointsSourceBreakdown = {
  source: string;
  points: number;
  events: number;
};

export type CleaningRatingSummary = {
  staff_id: string;
  month_cycle: string;
  rated_days: number;
  five_star_days: number;
  avg_stars: number;
  avg_score_pct: number;
  total_star_points: number;
  performance_band: string;
};

export type StaffPointsDashboardV3 = {
  engine_version: number;
  staff_id: string;
  staff_name: string;
  staff_role: string;
  branch: string;
  tier_key: string | null;
  month_cycle: string;
  starting_points: number;
  reward_points: number;
  deduction_points: number;
  net_points_delta: number;
  final_points: number;
  distinction_points: number;
  target_points: number;
  point_rate_egp: number | null;
  max_incentive_egp: number | null;
  points_incentive_egp: number | null;
  competition_bonus_egp: number;
  final_incentive_egp: number | null;
  progress_pct: number;
  pending_reward_points: number;
  pending_deduction_points: number;
  profile_configured: boolean;
  source_breakdown: StaffPointsSourceBreakdown[];
  cleaning_rating: CleaningRatingSummary | null;
  error?: string;
};

function numberOrZero(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

export async function getStaffPointsDashboardV3(staffId: string, monthCycle?: string | null) {
  if (!staffId) throw new Error('staff_id مطلوب لحساب النقاط.');
  const { data, error } = await supabase.rpc('get_staff_points_dashboard_v3', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle || null,
  });
  if (error) throw new Error(error.message);
  const raw = (data || null) as Record<string, unknown> | null;
  if (!raw || raw.error) throw new Error(String(raw?.error || 'تعذر تحميل مصدر النقاط الموحد.'));

  const sources = Array.isArray(raw.source_breakdown) ? raw.source_breakdown : [];
  const cleaning = raw.cleaning_rating && typeof raw.cleaning_rating === 'object'
    ? (raw.cleaning_rating as Record<string, unknown>)
    : null;

  return {
    ...raw,
    engine_version: numberOrZero(raw.engine_version),
    starting_points: numberOrZero(raw.starting_points),
    reward_points: numberOrZero(raw.reward_points),
    deduction_points: numberOrZero(raw.deduction_points),
    net_points_delta: numberOrZero(raw.net_points_delta),
    final_points: numberOrZero(raw.final_points),
    distinction_points: numberOrZero(raw.distinction_points),
    target_points: numberOrZero(raw.target_points),
    point_rate_egp: raw.point_rate_egp == null ? null : numberOrZero(raw.point_rate_egp),
    max_incentive_egp: raw.max_incentive_egp == null ? null : numberOrZero(raw.max_incentive_egp),
    points_incentive_egp: raw.points_incentive_egp == null ? null : numberOrZero(raw.points_incentive_egp),
    competition_bonus_egp: numberOrZero(raw.competition_bonus_egp),
    final_incentive_egp: raw.final_incentive_egp == null ? null : numberOrZero(raw.final_incentive_egp),
    progress_pct: numberOrZero(raw.progress_pct),
    pending_reward_points: numberOrZero(raw.pending_reward_points),
    pending_deduction_points: numberOrZero(raw.pending_deduction_points),
    profile_configured: Boolean(raw.profile_configured),
    source_breakdown: sources.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        source: String(row.source || 'unknown'),
        points: numberOrZero(row.points),
        events: numberOrZero(row.events),
      };
    }),
    cleaning_rating: cleaning ? {
      staff_id: String(cleaning.staff_id || staffId),
      month_cycle: String(cleaning.month_cycle || raw.month_cycle || ''),
      rated_days: numberOrZero(cleaning.rated_days),
      five_star_days: numberOrZero(cleaning.five_star_days),
      avg_stars: numberOrZero(cleaning.avg_stars),
      avg_score_pct: numberOrZero(cleaning.avg_score_pct),
      total_star_points: numberOrZero(cleaning.total_star_points),
      performance_band: String(cleaning.performance_band || '—'),
    } : null,
  } as StaffPointsDashboardV3;
}
