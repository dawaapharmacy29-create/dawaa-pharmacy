import { supabase } from '@/lib/supabase';

export type TimeOffKind =
  | 'permission'
  | 'annual_leave'
  | 'sick_leave'
  | 'exceptional_leave'
  | 'approved_absence'
  | 'shift_swap';

export type TimeOffStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface StaffTimeOffRequest {
  id: string;
  staff_id: string;
  staff_name_snapshot: string;
  branch_snapshot: string | null;
  request_kind: TimeOffKind;
  request_label: string | null;
  status: TimeOffStatus;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  reason: string | null;
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  policy_version: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface PermissionPolicyStatusV2 {
  staff_id: string;
  approved_permissions: number;
  allowance: number;
  remaining: number;
  exceeded_count: number;
  total_minutes: number;
  max_minutes_per_permission: number;
  over_duration_count: number;
  requires_manager_review: boolean;
  policy_version: string;
}

export interface AnnualLeaveBalanceV1 {
  staff_id: string;
  year: number;
  balance: number;
  used: number;
  reserved: number;
  policy_version: string;
}

export async function listStaffTimeOffRequests(args: {
  staffId?: string | null;
  from?: string | null;
  to?: string | null;
  status?: TimeOffStatus | null;
  limit?: number;
} = {}): Promise<StaffTimeOffRequest[]> {
  const { data, error } = await supabase.rpc('list_staff_time_off_requests_v1', {
    p_staff_id: args.staffId || null,
    p_from: args.from || null,
    p_to: args.to || null,
    p_status: args.status || null,
    p_limit: args.limit ?? 200,
  });
  if (error) throw new Error(error.message);
  return (data || []) as StaffTimeOffRequest[];
}

export async function createStaffTimeOffRequest(args: {
  staffId: string;
  kind: TimeOffKind;
  label?: string | null;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  durationMinutes?: number | null;
  reason?: string | null;
}): Promise<StaffTimeOffRequest> {
  const { data, error } = await supabase.rpc('create_staff_time_off_request_v1', {
    p_staff_id: args.staffId,
    p_request_kind: args.kind,
    p_request_label: args.label || null,
    p_start_date: args.startDate,
    p_end_date: args.endDate || args.startDate,
    p_start_time: args.startTime || null,
    p_end_time: args.endTime || null,
    p_duration_minutes: args.durationMinutes ?? null,
    p_reason: args.reason || null,
  });
  if (error) throw new Error(error.message);
  return data as StaffTimeOffRequest;
}

export async function decideStaffTimeOffRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
  note?: string | null
): Promise<StaffTimeOffRequest> {
  const { data, error } = await supabase.rpc('decide_staff_time_off_request_v1', {
    p_request_id: requestId,
    p_decision: decision,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  return data as StaffTimeOffRequest;
}

export async function cancelStaffTimeOffRequest(requestId: string, reason: string): Promise<StaffTimeOffRequest> {
  const { data, error } = await supabase.rpc('cancel_staff_time_off_request_v1', {
    p_request_id: requestId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as StaffTimeOffRequest;
}

export async function getPermissionPolicyStatusV2(
  staffId: string,
  cycleStart: string,
  cycleEnd: string
): Promise<PermissionPolicyStatusV2> {
  const { data, error } = await supabase.rpc('get_permission_policy_status_v2', {
    p_staff_id: staffId,
    p_cycle_start: cycleStart,
    p_cycle_end: cycleEnd,
  });
  if (error) throw new Error(error.message);
  return data as PermissionPolicyStatusV2;
}

export async function getAnnualLeaveBalanceV1(staffId: string, year: number): Promise<AnnualLeaveBalanceV1> {
  const { data, error } = await supabase.rpc('get_annual_leave_balance_v1', {
    p_staff_id: staffId,
    p_year: year,
  });
  if (error) throw new Error(error.message);
  return data as AnnualLeaveBalanceV1;
}
