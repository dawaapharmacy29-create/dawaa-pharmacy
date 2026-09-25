import { supabase } from '@/lib/supabase';

export type AttendanceCorrectionRequest = {
  id: string;
  staff_id: string | null;
  staff_name: string;
  branch_name: string | null;
  request_type: string;
  request_kind: string | null;
  attendance_date: string | null;
  requested_time: string;
  reason: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

export async function createMyAttendanceCorrectionRequest(args: {
  attendanceDate: string;
  requestKind: 'missing_checkin' | 'missing_checkout' | 'wrong_time' | 'other';
  requestedTime: string | null;
  reason: string;
}): Promise<AttendanceCorrectionRequest> {
  const { data, error } = await supabase.rpc('create_my_attendance_correction_request_v2', {
    p_attendance_date: args.attendanceDate,
    p_request_kind: args.requestKind,
    p_requested_time: args.requestedTime,
    p_reason: args.reason,
  });
  if (error) throw new Error(error.message);
  return data as AttendanceCorrectionRequest;
}

export async function listMyAttendanceCorrectionRequests(limit = 50): Promise<AttendanceCorrectionRequest[]> {
  const { data, error } = await supabase.rpc('list_my_attendance_correction_requests_v2', { p_limit: limit });
  if (error) throw new Error(error.message);
  return (data || []) as AttendanceCorrectionRequest[];
}

export async function listAttendanceCorrectionRequests(args: {
  branch?: string | null;
  status?: string | null;
  limit?: number;
} = {}): Promise<AttendanceCorrectionRequest[]> {
  const { data, error } = await supabase.rpc('list_attendance_correction_requests_v2', {
    p_branch: args.branch || null,
    p_status: args.status ?? 'pending',
    p_limit: args.limit ?? 200,
  });
  if (error) throw new Error(error.message);
  return (data || []) as AttendanceCorrectionRequest[];
}

export async function decideAttendanceCorrectionRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
  note?: string
): Promise<AttendanceCorrectionRequest> {
  const { data, error } = await supabase.rpc('decide_attendance_correction_request_v2', {
    p_request_id: requestId,
    p_decision: decision,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  return data as AttendanceCorrectionRequest;
}

export type PayrollSafetyGate = {
  ready: boolean;
  staff_id: string;
  month_cycle: string | null;
  blockers: Array<{ code: string; label: string; count?: number; hours?: number }>;
  warnings: Array<{ code: string; label: string; count?: number }>;
  engine: Record<string, unknown>;
};

export async function getPayrollSafetyGate(staffId: string, monthCycle: string): Promise<PayrollSafetyGate> {
  const { data, error } = await supabase.rpc('attendance_payroll_safety_gate_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  return data as PayrollSafetyGate;
}

export type PolicyShadowAudit = {
  evaluated_days: number;
  policies_resolved: number;
  late_classification_changes: number;
  early_leave_within_new_grace: number;
  generated_at: string;
};

export async function getPolicyShadowAudit(start: string, end: string, branch?: string | null): Promise<PolicyShadowAudit> {
  const { data, error } = await supabase.rpc('attendance_policy_shadow_audit_v1', {
    p_start: start,
    p_end: end,
    p_branch: branch || null,
  });
  if (error) throw new Error(error.message);
  return data as PolicyShadowAudit;
}

export type ScheduleGovernance = {
  staff_count: number;
  staff_days: number;
  missing_schedule_days: number;
  conflicting_schedule_days: number;
  healthy_schedule_days: number;
  published_like_rows: number;
  draft_rows: number;
  generated_at: string;
};

export async function getScheduleGovernance(start: string, end: string, branch?: string | null): Promise<ScheduleGovernance> {
  const { data, error } = await supabase.rpc('attendance_schedule_governance_v2', {
    p_start: start,
    p_end: end,
    p_branch: branch || null,
  });
  if (error) throw new Error(error.message);
  return data as ScheduleGovernance;
}


export type PolicySimulationSample = {
  staff_id: string;
  staff_name: string;
  branch: string;
  attendance_date: string;
  current_status: string;
  candidate_status: string;
  late_minutes: number;
  early_leave_minutes: number;
};

export type PolicySimulation = {
  range_start: string;
  range_end: string;
  branch: string | null;
  candidate: {
    late_grace_minutes: number;
    very_late_minutes: number;
    early_leave_grace_minutes: number;
  };
  evaluated_days: number;
  changed_days: number;
  late_to_on_time: number;
  on_time_to_late: number;
  early_leave_cleared: number;
  early_leave_new: number;
  samples: PolicySimulationSample[];
  generated_at: string;
};

export async function simulateAttendancePolicy(args: {
  start: string;
  end: string;
  branch?: string | null;
  lateGraceMinutes?: number | null;
  veryLateMinutes?: number | null;
  earlyLeaveGraceMinutes?: number | null;
}): Promise<PolicySimulation> {
  const candidate: Record<string, number> = {};
  if (args.lateGraceMinutes != null) candidate.late_grace_minutes = args.lateGraceMinutes;
  if (args.veryLateMinutes != null) candidate.very_late_minutes = args.veryLateMinutes;
  if (args.earlyLeaveGraceMinutes != null) candidate.early_leave_grace_minutes = args.earlyLeaveGraceMinutes;

  const { data, error } = await supabase.rpc('attendance_policy_simulate_v1', {
    p_start: args.start,
    p_end: args.end,
    p_branch: args.branch || null,
    p_candidate: candidate,
  });
  if (error) throw new Error(error.message);
  return data as PolicySimulation;
}


export type PolicyRolloutAssignment = {
  id: string;
  scope_type: 'staff' | 'role' | 'branch' | 'default';
  scope_key: string | null;
  mode: 'off' | 'shadow' | 'enforce';
  effective_from: string;
  effective_to: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
};

export async function getAttendancePolicyRollout(): Promise<PolicyRolloutAssignment[]> {
  const { data, error } = await supabase.rpc('list_attendance_policy_rollout_v1');
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as PolicyRolloutAssignment[] : [];
}


export type PolicyChangeAuditRow = {
  id: string;
  action: string;
  actor_id: string | null;
  actor_name: string | null;
  policy_version_id: string | null;
  rollout_assignment_id: string | null;
  scope_type: string | null;
  scope_key: string | null;
  effective_from: string | null;
  effective_to: string | null;
  note: string | null;
  created_at: string;
  before_snapshot?: Record<string, unknown> | null;
  after_snapshot?: Record<string, unknown> | null;
};

export type PolicyV3Compare = {
  checked_days: number;
  effective_status_changes: number;
  candidate_changes: number;
  shadow_days: number;
  enforced_days: number;
  samples: Array<{
    staff_id: string;
    staff_name: string;
    branch: string;
    attendance_date: string;
    v2_status: string;
    v3_status: string;
    candidate_status: string;
    rollout_mode: string;
    policy_version: string | null;
  }>;
  generated_at: string;
};

export async function createAttendancePolicyVersion(args: {
  policyCode: string;
  effectiveFrom: string;
  lateGraceMinutes: number;
  veryLateMinutes: number;
  earlyLeaveGraceMinutes?: number | null;
  overtimeThresholdMinutes?: number | null;
  roundingMinutes?: number | null;
  note?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('create_attendance_policy_version_v1', {
    p_policy_code: args.policyCode,
    p_effective_from: args.effectiveFrom,
    p_late_grace_minutes: args.lateGraceMinutes,
    p_very_late_minutes: args.veryLateMinutes,
    p_early_leave_grace_minutes: args.earlyLeaveGraceMinutes ?? null,
    p_overtime_threshold_minutes: args.overtimeThresholdMinutes ?? null,
    p_rounding_minutes: args.roundingMinutes ?? null,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}

export async function assignAttendancePolicy(args: {
  policyVersionId: string;
  scopeType: 'staff' | 'role' | 'branch';
  scopeKey: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('assign_attendance_policy_v1', {
    p_policy_version_id: args.policyVersionId,
    p_scope_type: args.scopeType,
    p_scope_key: args.scopeKey,
    p_effective_from: args.effectiveFrom,
    p_effective_to: args.effectiveTo || null,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}

export async function setAttendancePolicyRollout(args: {
  scopeType: 'staff' | 'role' | 'branch' | 'default';
  scopeKey?: string | null;
  mode: 'off' | 'shadow' | 'enforce';
  effectiveFrom: string;
  effectiveTo?: string | null;
  note?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('set_attendance_policy_rollout_v1', {
    p_scope_type: args.scopeType,
    p_scope_key: args.scopeType === 'default' ? null : (args.scopeKey || null),
    p_mode: args.mode,
    p_effective_from: args.effectiveFrom,
    p_effective_to: args.effectiveTo || null,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}

export async function listAttendancePolicyAudit(limit = 100): Promise<PolicyChangeAuditRow[]> {
  const { data, error } = await supabase.rpc('list_attendance_policy_change_audit_v1', {
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as PolicyChangeAuditRow[] : [];
}

export async function compareAttendancePolicyV3(args: {
  start: string;
  end: string;
  branch?: string | null;
  limit?: number;
}): Promise<PolicyV3Compare> {
  const { data, error } = await supabase.rpc('attendance_policy_v3_compare_v1', {
    p_start: args.start,
    p_end: args.end,
    p_branch: args.branch || null,
    p_limit: args.limit ?? 30,
  });
  if (error) throw new Error(error.message);
  return data as PolicyV3Compare;
}


export type PolicyEnforcePreflight = {
  ready: boolean;
  reason: string;
  scope_type: 'staff' | 'role' | 'branch' | 'default';
  scope_key: string | null;
  start_date: string;
  end_date: string;
  checked_days: number;
  evaluated_dates: number;
  effective_status_changes: number;
  candidate_changes: number;
  shadow_days: number;
  enforced_days: number;
  unresolved_policy_days: number;
  samples: PolicyV3Compare['samples'];
  generated_at: string;
};

export async function getAttendancePolicyEnforcePreflight(args: {
  scopeType: 'staff' | 'role' | 'branch' | 'default';
  scopeKey?: string | null;
  start?: string | null;
  end?: string | null;
}): Promise<PolicyEnforcePreflight> {
  const { data, error } = await supabase.rpc('attendance_policy_enforce_preflight_v1', {
    p_scope_type: args.scopeType,
    p_scope_key: args.scopeType === 'default' ? null : (args.scopeKey || null),
    p_start: args.start || null,
    p_end: args.end || null,
  });
  if (error) throw new Error(error.message);
  return data as PolicyEnforcePreflight;
}


export type PayrollFinalizationGate = {
  ready: boolean;
  staff_id: string;
  staff_username: string;
  month_cycle: string;
  cycle_start: string | null;
  cycle_end: string | null;
  blockers: Array<{ code: string; label: string; count?: number; hours?: number }>;
  warnings: Array<{ code: string; label: string; count?: number; hours?: number }>;
  attendance_gate: PayrollSafetyGate;
  payroll_components: Record<string, unknown>;
  policy_validation: {
    checked_days: number;
    effective_status_changes: number;
    candidate_changes: number;
    enforce_days: number;
    unresolved_policy_days: number;
    v3_materialized_days: number;
    v3_pending_days: number;
  };
  generated_at: string;
};

export async function getPayrollFinalizationGate(staffId: string, monthCycle: string): Promise<PayrollFinalizationGate> {
  const { data, error } = await supabase.rpc('payroll_finalization_gate_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  return data as PayrollFinalizationGate;
}


export type PayrollFinalSnapshotPreview = {
  snapshot_schema: string;
  snapshot_mode: 'preview_only';
  snapshot_fingerprint: string;
  staff_id: string;
  staff_username: string;
  staff_name: string;
  branch: string;
  month_cycle: string;
  cycle_start: string | null;
  cycle_end: string | null;
  finalization_ready: boolean;
  attendance_truth: PayrollSafetyGate;
  policy_validation: PayrollFinalizationGate['policy_validation'];
  payroll_components: Record<string, unknown>;
  blockers: PayrollFinalizationGate['blockers'];
  warnings: PayrollFinalizationGate['warnings'];
  generated_at: string;
};

export async function getPayrollFinalSnapshotPreview(staffId: string, monthCycle: string): Promise<PayrollFinalSnapshotPreview> {
  const { data, error } = await supabase.rpc('payroll_final_snapshot_preview_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  return data as PayrollFinalSnapshotPreview;
}


export type PayrollStagedSnapshot = {
  id: string;
  staff_id: string;
  staff_username: string;
  staff_name: string;
  branch: string | null;
  month_cycle: string;
  cycle_start: string | null;
  cycle_end: string | null;
  snapshot_schema: string;
  snapshot_mode: 'staged';
  finalization_ready: boolean;
  snapshot_fingerprint: string;
  payload: PayrollFinalSnapshotPreview;
  note: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type PayrollSnapshotAuditRow = {
  id: string;
  snapshot_id: string | null;
  action: 'staged' | 'reused';
  staff_id: string;
  month_cycle: string;
  snapshot_fingerprint: string;
  actor_id: string | null;
  actor_name: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export async function stagePayrollFinalSnapshot(args: {
  staffId: string;
  monthCycle: string;
  note?: string | null;
}): Promise<{ success: boolean; existing: boolean; snapshot: PayrollStagedSnapshot }> {
  const { data, error } = await supabase.rpc('stage_payroll_final_snapshot_v1', {
    p_staff_id: args.staffId,
    p_month_cycle: args.monthCycle,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return data as { success: boolean; existing: boolean; snapshot: PayrollStagedSnapshot };
}

export async function listPayrollStagedSnapshots(
  staffId: string,
  monthCycle: string,
  limit = 20
): Promise<PayrollStagedSnapshot[]> {
  const { data, error } = await supabase.rpc('list_payroll_final_snapshot_staging_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as PayrollStagedSnapshot[] : [];
}

export async function comparePayrollStagedSnapshot(snapshotId: string): Promise<{
  snapshot_id: string;
  stored_fingerprint: string;
  current_fingerprint: string;
  unchanged: boolean;
  stored_ready: boolean;
  current_ready: boolean;
  stored_created_at: string;
  current_generated_at: string;
}> {
  const { data, error } = await supabase.rpc('compare_payroll_final_snapshot_v1', {
    p_snapshot_id: snapshotId,
  });
  if (error) throw new Error(error.message);
  return data as {
    snapshot_id: string;
    stored_fingerprint: string;
    current_fingerprint: string;
    unchanged: boolean;
    stored_ready: boolean;
    current_ready: boolean;
    stored_created_at: string;
    current_generated_at: string;
  };
}

export async function listPayrollSnapshotAudit(
  staffId: string,
  monthCycle: string,
  limit = 50
): Promise<PayrollSnapshotAuditRow[]> {
  const { data, error } = await supabase.rpc('list_payroll_snapshot_audit_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as PayrollSnapshotAuditRow[] : [];
}


export type PayrollSnapshotReviewRow = {
  id: string;
  snapshot_id: string;
  decision: 'approved' | 'rejected';
  reviewer_id: string | null;
  reviewer_name: string;
  reviewer_role: string | null;
  note: string | null;
  comparison: Record<string, unknown>;
  created_at: string;
};

export async function reviewPayrollStagedSnapshot(args: {
  snapshotId: string;
  decision: 'approved' | 'rejected';
  note?: string | null;
}): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('review_payroll_staged_snapshot_v1', {
    p_snapshot_id: args.snapshotId,
    p_decision: args.decision,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}

export async function listPayrollSnapshotReviews(
  snapshotId: string,
  limit = 50
): Promise<PayrollSnapshotReviewRow[]> {
  const { data, error } = await supabase.rpc('list_payroll_snapshot_reviews_v1', {
    p_snapshot_id: snapshotId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data as PayrollSnapshotReviewRow[] : [];
}


export type PayrollCycleFinalizationOverview = {
  month_cycle: string;
  branch: string | null;
  staff_count: number;
  ready_count: number;
  blocked_count: number;
  rows: Array<{
    staff_id: string;
    staff_name: string;
    branch: string | null;
    role?: string | null;
    ready: boolean;
    blocker_count: number;
    warning_count: number;
    blockers: Array<{ code: string; label: string; count?: number; hours?: number }>;
    warnings: Array<{ code: string; label: string; count?: number; hours?: number }>;
    policy_validation: PayrollFinalizationGate['policy_validation'];
  }>;
  top_blockers: Array<{
    code: string;
    label: string;
    affected_staff: number;
  }>;
  scope_staff_count?: number;
  identified_staff_count?: number;
  identity_gap_count?: number;
  identity_priority_count?: number;
  identity_queue?: Array<{
    staff_id: string;
    staff_name: string;
    role: string | null;
    branch: string | null;
    identity_state: 'missing_account' | 'disabled_account';
    priority_review: boolean;
    account_count: number;
    active_login_account_count: number;
    has_profile: boolean;
    incentive_transactions: number;
    payroll_history_rows: number;
  }>;
  configured_staff_count?: number;
  unconfigured_staff_count?: number;
  unconfigured_priority_count?: number;
  configuration_queue?: Array<{
    staff_id: string;
    staff_name: string;
    role: string | null;
    branch: string | null;
    configuration_state: 'missing_with_incentive_activity' | 'missing_with_payroll_history' | 'missing_no_activity';
    priority_review: boolean;
    incentive_transactions: number;
    payroll_history_rows: number;
  }>;
  generated_at: string;
};

export async function getPayrollCycleFinalizationOverview(args: {
  monthCycle: string;
  branch?: string | null;
  limit?: number;
}): Promise<PayrollCycleFinalizationOverview> {
  const { data, error } = await supabase.rpc('payroll_cycle_finalization_overview_v2', {
    p_month_cycle: args.monthCycle,
    p_branch: args.branch || null,
    p_limit: args.limit ?? 100,
  });
  if (error) throw new Error(error.message);
  return data as PayrollCycleFinalizationOverview;
}
