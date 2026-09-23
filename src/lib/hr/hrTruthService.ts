import { supabase } from '@/lib/supabase';

export type HRTruthQualitySnapshotV2 = {
  date: string;
  branch: string | null;
  active_staff: number;
  active_without_schedule: number;
  active_schedule_branch_mismatch: number;
  legacy_shift_drift: number;
  archived_visible_in_schedule: number;
  duplicate_active_display_names: number;
  overnight_schedules: number;
  generated_at: string;
};

export async function getHRTruthQualitySnapshotV2(args: {
  date: string;
  branch?: string | null;
}): Promise<HRTruthQualitySnapshotV2> {
  const { data, error } = await supabase.rpc('hr_truth_quality_snapshot_v2', {
    p_date: args.date,
    p_branch: args.branch || null,
  });
  if (error) throw new Error(error.message);
  return data as HRTruthQualitySnapshotV2;
}

export type HREmployeeCore360V2 = {
  staff: {
    id: string;
    name: string;
    role: string | null;
    type: string | null;
    branch: string | null;
    status: string | null;
    active: boolean;
    visible_in_schedule: boolean;
    join_date: string | null;
    day_off: string | null;
  };
  schedule: null | {
    schedule_id: string;
    branch: string | null;
    day_name: string | null;
    shift_start: string | null;
    shift_end: string | null;
    is_off: boolean | null;
    is_day_off: boolean | null;
    source_kind: string | null;
  };
  quality: {
    has_schedule: boolean;
    branch_matches: boolean;
    legacy_shift_matches: boolean;
  };
  date: string;
  generated_at: string;
};

export async function getHREmployeeCore360V2(staffId: string, date?: string | null): Promise<HREmployeeCore360V2> {
  const { data, error } = await supabase.rpc('hr_employee_core_360_v2', {
    p_staff_id: staffId,
    p_date: date || null,
  });
  if (error) throw new Error(error.message);
  return data as HREmployeeCore360V2;
}
