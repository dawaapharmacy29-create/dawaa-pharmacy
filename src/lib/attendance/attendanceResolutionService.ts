import { supabase } from '@/lib/supabase';

export type AttendanceResolutionRow = {
  id: string;
  staff_id: string;
  attendance_date: string;
  branch: string | null;
  first_in: string | null;
  last_out: string | null;
  total_hours: number | null;
  late_minutes: number | null;
  early_leave_minutes: number | null;
  status: string | null;
  source: string | null;
  schedule_id: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  candidate_hours: number | null;
  payroll_eligible_hours: number | null;
  resolution_status: string | null;
  resolution_version: number | null;
  resolution_snapshot: Record<string, unknown> | null;
  approved_at: string | null;
  approved_by_name: string | null;
  approval_note: string | null;
  resolution_origin: string | null;
  review_required: boolean;
  resolved_at: string | null;
  time_off_request_id: string | null;
  policy_version: string | null;
  sync_complete_through: string | null;
};

export type AttendanceImpactRow = {
  id: string;
  staff_id: string;
  attendance_date: string;
  event_type: string;
  source_resolution_id: string;
  source_time_off_request_id: string | null;
  policy_version: string | null;
  points_impact: number;
  incentive_impact: number;
  payroll_units_impact: number;
  monetary_impact: number;
  impact_status: string;
  evidence_snapshot: Record<string, unknown>;
  created_at: string;
};

export async function listAttendanceResolutionQueue(args: {
  start: string;
  end: string;
  branch?: string | null;
  status?: string | null;
  limit?: number;
}): Promise<AttendanceResolutionRow[]> {
  const { data, error } = await supabase.rpc('get_attendance_resolution_queue_v2', {
    p_start: args.start,
    p_end: args.end,
    p_branch: args.branch && args.branch !== 'الكل' ? args.branch : null,
    p_status: args.status || null,
    p_limit: args.limit ?? 300,
  });
  if (error) throw new Error(error.message);
  return (data || []) as AttendanceResolutionRow[];
}

export async function materializeAttendanceRange(args: {
  start: string;
  end: string;
  branch?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('materialize_attendance_range_v2', {
    p_start: args.start,
    p_end: args.end,
    p_branch: args.branch && args.branch !== 'الكل' ? args.branch : null,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}

export async function approveAttendanceResolution(args: {
  staffId: string;
  date: string;
  payrollEligibleHours?: number | null;
  note: string;
}): Promise<AttendanceResolutionRow> {
  const { data, error } = await supabase.rpc('approve_attendance_day_resolution_v2', {
    p_staff_id: args.staffId,
    p_attendance_date: args.date,
    p_payroll_eligible_hours: args.payrollEligibleHours ?? null,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return data as AttendanceResolutionRow;
}

export async function listAttendanceImpactLedger(args: {
  staffId?: string | null;
  start?: string | null;
  end?: string | null;
  limit?: number;
} = {}): Promise<AttendanceImpactRow[]> {
  const { data, error } = await supabase.rpc('get_attendance_impact_ledger_v2', {
    p_staff_id: args.staffId || null,
    p_start: args.start || null,
    p_end: args.end || null,
    p_limit: args.limit ?? 300,
  });
  if (error) throw new Error(error.message);
  return (data || []) as AttendanceImpactRow[];
}
