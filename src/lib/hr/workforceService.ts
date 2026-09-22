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
