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


export type HRCanonicalArchitectureHealthV1 = {
  schema: 'hr_canonical_architecture_health_v1';
  status: 'healthy' | 'warning' | 'critical';
  month_cycle: string;
  cycle_start: string;
  cycle_end: string;
  legacy_api_exposure: number;
  employee_ledger_direct_write_exposure: number;
  attendance_points_cron: {
    v1_jobs: number;
    v2_jobs: number;
    healthy: boolean;
  };
  integrity: {
    approved_stale_overtime: number;
    approved_timeoff_truth_mismatch: number;
    duplicate_active_points_events: number;
    transactions_missing_cycle: number;
    transactions_missing_source: number;
    transactions_missing_points: number;
    sent_evaluations_missing_multiplier: number;
  };
  compensation_configuration: {
    scope_staff_count: number;
    configured_staff_count: number;
    unconfigured_staff_count: number;
    priority_review_count: number;
  };
  attendance_v3_cutover: {
    schema: 'attendance_policy_v3_cutover_readiness_v2';
    start_date: string;
    end_date: string;
    operational_scope: string;
    total_days: number;
    effective_status_changes: number;
    candidate_changes: number;
    unresolved_policy_days: number;
    open_days: number;
    open_v3_days: number;
    open_legacy_days: number;
    approved_frozen_legacy_days: number;
    approved_v3_days: number;
    inactive_archive_open_legacy_days: number;
    active_out_of_scope_open_legacy_days: number;
    operational_review_pending: number;
    materialization_pct: number;
    ready_for_v3_cutover: boolean;
    cutover_rule: string;
    generated_at: string;
  };
  generated_at: string;
};

export async function getHRCanonicalArchitectureHealthV1(): Promise<HRCanonicalArchitectureHealthV1> {
  const { data, error } = await supabase.rpc('hr_canonical_architecture_health_v1');
  if (error) throw new Error(error.message);
  return data as HRCanonicalArchitectureHealthV1;
}
