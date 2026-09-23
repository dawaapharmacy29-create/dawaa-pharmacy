import { supabase } from '@/lib/supabase';

export type StaffAssignmentVersionV2 = {
  id: string | null;
  staff_id: string;
  effective_from: string | null;
  branch: string;
  role: string;
  change_reason: string;
  state: string;
  requested_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  applied_to_staff_at: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
  previous_branch?: string | null;
  previous_role?: string | null;
};

export type StaffAssignmentTimelineV2 = {
  staff_id: string;
  staff_name: string;
  as_of: string;
  current: StaffAssignmentVersionV2;
  projection: { branch: string | null; role: string | null };
  history: StaffAssignmentVersionV2[];
  generated_at: string;
};

export async function getStaffAssignmentTimelineV2(staffId: string, asOf?: string | null): Promise<StaffAssignmentTimelineV2> {
  const { data, error } = await supabase.rpc('hr_staff_assignment_timeline_v2', {
    p_staff_id: staffId,
    p_as_of: asOf || null,
  });
  if (error) throw new Error(error.message);
  return data as StaffAssignmentTimelineV2;
}

export async function requestStaffAssignmentV2(args: {
  staffId: string;
  effectiveFrom: string;
  branch: string;
  role: string;
  reason: string;
}) {
  const { data, error } = await supabase.rpc('hr_staff_assignment_change_v2', {
    p_action: 'request',
    p_staff_id: args.staffId,
    p_assignment_id: null,
    p_payload: {
      effective_from: args.effectiveFrom,
      branch: args.branch,
      role: args.role,
      reason: args.reason,
    },
  });
  if (error) throw new Error(error.message);
  return data as { success: boolean; id: string; state: string };
}


export type PendingStaffAssignmentV2 = {
  id: string;
  staff_id: string;
  staff_name: string;
  effective_from: string;
  branch: string;
  role: string;
  change_reason: string;
  state: 'pending';
  requested_at: string;
  requested_by_name: string | null;
};

export async function listPendingStaffAssignmentsV2(): Promise<PendingStaffAssignmentV2[]> {
  const { data, error } = await supabase.rpc('hr_staff_assignment_change_v2', {
    p_action: 'list_pending',
    p_staff_id: null,
    p_assignment_id: null,
    p_payload: {},
  });
  if (error) throw new Error(error.message);
  return (data || []) as PendingStaffAssignmentV2[];
}

export async function decideStaffAssignmentV2(
  assignmentId: string,
  decision: 'approve' | 'reject',
  note?: string | null
) {
  const { data, error } = await supabase.rpc('hr_staff_assignment_change_v2', {
    p_action: decision,
    p_staff_id: null,
    p_assignment_id: assignmentId,
    p_payload: { note: note || null },
  });
  if (error) throw new Error(error.message);
  return data as {
    success: boolean;
    id: string;
    state: 'approved' | 'rejected';
    effective_from: string;
    applied_now: boolean;
  };
}
