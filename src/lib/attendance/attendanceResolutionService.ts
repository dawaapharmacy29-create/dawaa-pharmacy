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
  triage?: 'all' | 'manager' | 'system';
  limit?: number;
}): Promise<AttendanceResolutionRow[]> {
  const { data, error } = await supabase.rpc('get_attendance_resolution_queue_v3', {
    p_start: args.start,
    p_end: args.end,
    p_branch: args.branch && args.branch !== 'الكل' ? args.branch : null,
    p_status: args.status || null,
    p_triage: args.triage || 'all',
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


export async function reopenAttendanceResolution(args: {
  staffId: string;
  date: string;
  note: string;
}): Promise<AttendanceResolutionRow> {
  const { data, error } = await supabase.rpc('reopen_attendance_resolution_v1', {
    p_staff_id: args.staffId,
    p_attendance_date: args.date,
    p_note: args.note,
  });
  if (error) throw new Error(error.message);
  return data as AttendanceResolutionRow;
}


export type AttendanceExceptionLane = 'manager' | 'system';

export type AttendanceExceptionRow = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  attendance_date: string;
  resolution_status: string | null;
  queue_lane: AttendanceExceptionLane;
  action_required: boolean;
  employee_fault: boolean;
  issue_group: string;
  issue_label: string;
  raw_events: number;
  first_in: string | null;
  last_out: string | null;
  late_minutes: number;
  early_leave_minutes: number;
  candidate_hours: number | null;
  payroll_eligible_hours: number | null;
  status: string | null;
  resolution_origin: string | null;
  policy_version: string | null;
  schedule_id: string | null;
};

export async function listAttendanceExceptionInbox(args: {
  start: string;
  end: string;
  branch?: string | null;
  lane?: AttendanceExceptionLane | 'all';
  limit?: number;
}): Promise<AttendanceExceptionRow[]> {
  const { data, error } = await supabase.rpc('get_attendance_exception_inbox_v2', {
    p_start: args.start,
    p_end: args.end,
    p_branch: args.branch && args.branch !== 'الكل' ? args.branch : null,
    p_lane: args.lane || 'manager',
    p_limit: args.limit ?? 300,
  });
  if (error) throw new Error(error.message);
  return ((data || []) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.resolution_id || ''),
    staff_id: String(row.staff_id || ''),
    staff_name: String(row.staff_name || row.staff_id || 'غير محدد'),
    branch: row.branch == null ? null : String(row.branch),
    attendance_date: String(row.attendance_date || ''),
    resolution_status: row.resolution_status == null ? null : String(row.resolution_status),
    queue_lane: (row.queue_lane === 'system' ? 'system' : 'manager') as AttendanceExceptionLane,
    action_required: Boolean(row.action_required),
    employee_fault: Boolean(row.employee_fault),
    issue_group: String(row.issue_group || 'other'),
    issue_label: String(row.issue_label || row.resolution_status || 'حالة تحتاج مراجعة'),
    raw_events: Number(row.raw_events || 0),
    first_in: row.first_in == null ? null : String(row.first_in),
    last_out: row.last_out == null ? null : String(row.last_out),
    late_minutes: Number(row.late_minutes || 0),
    early_leave_minutes: Number(row.early_leave_minutes || 0),
    candidate_hours: row.candidate_hours == null ? null : Number(row.candidate_hours),
    payroll_eligible_hours: row.payroll_eligible_hours == null ? null : Number(row.payroll_eligible_hours),
    status: row.status == null ? null : String(row.status),
    resolution_origin: row.resolution_origin == null ? null : String(row.resolution_origin),
    policy_version: row.policy_version == null ? null : String(row.policy_version),
    schedule_id: row.schedule_id == null ? null : String(row.schedule_id),
  }));
}


export type AttendanceDiagnosticAction = {
  id: string;
  label: string;
};

export type AttendanceCaseDiagnosticV1 = {
  staff_id: string;
  staff_name: string;
  branch: string | null;
  date: string;
  root_cause_code: string;
  title: string;
  diagnosis: string;
  blocking_reason: string;
  owner: 'manager' | 'system' | 'schedule' | 'sync' | 'timeoff' | string;
  confidence: number;
  auto_fix_available: boolean;
  suggested_actions: AttendanceDiagnosticAction[];
  evidence: Record<string, unknown>;
  engine_version: string;
  generated_at: string;
};

export async function getAttendanceCaseDiagnosticV1(
  staffId: string,
  date: string
): Promise<AttendanceCaseDiagnosticV1> {
  const { data, error } = await supabase.rpc('attendance_case_diagnostic_v1', {
    p_staff_id: staffId,
    p_date: date,
  });
  if (error) throw new Error(error.message);
  return data as AttendanceCaseDiagnosticV1;
}


export type AttendanceDiagnosticSummaryV1 = {
  total_cases: number;
  manager_cases: number;
  system_cases: number;
  causes: Array<{
    code: string;
    label: string;
    owner: 'manager' | 'system' | string;
    cases: number;
  }>;
  generated_at: string;
};

export async function getAttendanceDiagnosticSummaryV1(args: {
  start: string;
  end: string;
  branch?: string | null;
}): Promise<AttendanceDiagnosticSummaryV1> {
  const { data, error } = await supabase.rpc('attendance_diagnostic_summary_v1', {
    p_start: args.start,
    p_end: args.end,
    p_branch: args.branch && args.branch !== 'الكل' ? args.branch : null,
  });
  if (error) throw new Error(error.message);
  return data as AttendanceDiagnosticSummaryV1;
}

export type AttendancePolicyCatalog = {
  policies: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
};

export async function getAttendancePolicyCatalog(): Promise<AttendancePolicyCatalog> {
  const { data, error } = await supabase.rpc('list_attendance_policy_catalog_v2');
  if (error) throw new Error(error.message);
  const payload = (data || {}) as Record<string, unknown>;
  return {
    policies: Array.isArray(payload.policies) ? payload.policies as Array<Record<string, unknown>> : [],
    assignments: Array.isArray(payload.assignments) ? payload.assignments as Array<Record<string, unknown>> : [],
  };
}

export async function resolveAttendancePolicy(staffId: string, date: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc('resolve_attendance_policy_v2', {
    p_staff_id: staffId,
    p_date: date,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}
