import { supabase } from '@/lib/supabase';

export type AttendanceTruthCycleRowV2 = {
  staff_id: string;
  staff_name: string;
  role: string | null;
  branch: string | null;
  approved_days: number;
  pending_attendance_days: number;
  worked_days: number;
  worked_hours: number;
  off_days: number;
  approved_leave_days: number;
  absence_days: number;
  worked_on_off_days: number;
  approved_overtime_hours: number;
  pending_overtime_hours: number;
  pending_overtime_count: number;
  stale_approved_overtime: number;
  pending_corrections: number;
  pending_timeoff: number;
  truth_ready: boolean;
};

export type AttendanceTruthCycleV2 = {
  range_start: string;
  range_end: string;
  branch: string | null;
  summary: {
    staff_count: number;
    approved_days: number;
    pending_attendance_days: number;
    worked_days: number;
    worked_hours: number;
    approved_overtime_hours: number;
    pending_overtime_hours: number;
    pending_corrections: number;
    pending_timeoff: number;
    stale_approved_overtime: number;
    ready_for_payroll_truth: boolean;
  };
  rows: AttendanceTruthCycleRowV2[];
  generated_at: string;
};

export async function getAttendanceTruthCycleV2(args: {
  start: string;
  end: string;
  branch?: string | null;
}): Promise<AttendanceTruthCycleV2> {
  const { data, error } = await supabase.rpc('attendance_truth_cycle_v2', {
    p_start: args.start,
    p_end: args.end,
    p_branch: args.branch || null,
  });
  if (error) throw new Error(error.message);
  return data as AttendanceTruthCycleV2;
}
