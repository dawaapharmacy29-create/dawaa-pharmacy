import { supabase } from '@/lib/supabase';

export interface CustomerRequestDoctorPointsSummary {
  staff_id: string;
  staff_name: string | null;
  branch: string | null;
  tier_key: string | null;
  month_cycle: string;
  eligible_registered_requests: number;
  achieved_requests: number;
  achievement_rate: number;
  registration_events: number;
  achievement_events: number;
  registration_points: number;
  achievement_points: number;
  total_points: number;
}

function numeric(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeRow(row: Record<string, unknown>): CustomerRequestDoctorPointsSummary {
  return {
    staff_id: String(row.staff_id || ''),
    staff_name: row.staff_name ? String(row.staff_name) : null,
    branch: row.branch ? String(row.branch) : null,
    tier_key: row.tier_key ? String(row.tier_key) : null,
    month_cycle: String(row.month_cycle || ''),
    eligible_registered_requests: numeric(row.eligible_registered_requests),
    achieved_requests: numeric(row.achieved_requests),
    achievement_rate: numeric(row.achievement_rate),
    registration_events: numeric(row.registration_events),
    achievement_events: numeric(row.achievement_events),
    registration_points: numeric(row.registration_points),
    achievement_points: numeric(row.achievement_points),
    total_points: numeric(row.total_points),
  };
}

export async function getCustomerRequestDoctorPointsSummary(staffId: string, monthCycle?: string | null) {
  let query = supabase
    .from('customer_request_doctor_points_summary_v1')
    .select('*')
    .eq('staff_id', staffId);
  if (monthCycle) query = query.eq('month_cycle', monthCycle);
  const { data, error } = await query.order('month_cycle', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => normalizeRow(row as Record<string, unknown>));
}

export async function getCustomerRequestDoctorPointsLeaderboard(monthCycle: string, branch?: string | null) {
  let query = supabase
    .from('customer_request_doctor_points_summary_v1')
    .select('*')
    .eq('month_cycle', monthCycle)
    .order('total_points', { ascending: false });
  if (branch?.trim()) query = query.eq('branch', branch.trim());
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((row) => normalizeRow(row as Record<string, unknown>));
}
