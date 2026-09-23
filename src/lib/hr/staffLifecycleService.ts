import { supabase } from '@/lib/supabase';

export type StaffLifecycleStateV2 = 'active' | 'leaving' | 'archived';
export type StaffLifecycleRequestStateV2 = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type SeparationKindV2 = 'resignation' | 'termination' | 'contract_end' | 'retirement' | 'transfer_out' | 'other';

export type StaffLifecycleChangeV2 = {
  id: string | null;
  staff_id: string;
  effective_from: string | null;
  target_state: StaffLifecycleStateV2;
  effective_state?: StaffLifecycleStateV2;
  last_working_date: string | null;
  separation_kind: SeparationKindV2 | null;
  reason: string;
  state: StaffLifecycleRequestStateV2 | 'legacy_projection';
  requested_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  projection_applied_at: string | null;
  offboarding_applied_at: string | null;
  requested_by_name: string | null;
  decided_by_name: string | null;
};

export type StaffLifecycleSnapshotV2 = {
  staff_id: string;
  staff_name: string;
  as_of: string;
  current: StaffLifecycleChangeV2;
  projection: {
    status: string | null;
    active: boolean | null;
    is_active: boolean | null;
    visible_in_schedule: boolean | null;
  };
  history: StaffLifecycleChangeV2[];
  generated_at: string;
};

export type PendingStaffLifecycleChangeV2 = {
  id: string;
  staff_id: string;
  staff_name: string;
  branch: string | null;
  role: string | null;
  effective_from: string;
  target_state: StaffLifecycleStateV2;
  last_working_date: string | null;
  separation_kind: SeparationKindV2 | null;
  reason: string;
  state: 'pending';
  requested_at: string;
  requested_by_name: string | null;
};

export async function getStaffLifecycleSnapshotV2(staffId: string, asOf?: string | null): Promise<StaffLifecycleSnapshotV2> {
  const { data, error } = await supabase.rpc('hr_staff_lifecycle_snapshot_v2', {
    p_staff_id: staffId,
    p_as_of: asOf || null,
  });
  if (error) throw new Error(error.message);
  return data as StaffLifecycleSnapshotV2;
}

export async function requestStaffLifecycleChangeV2(args: {
  staffId: string;
  effectiveFrom: string;
  targetState: StaffLifecycleStateV2;
  lastWorkingDate?: string | null;
  separationKind?: SeparationKindV2 | null;
  reason: string;
}) {
  const { data, error } = await supabase.rpc('hr_staff_lifecycle_change_v2', {
    p_action: 'request',
    p_staff_id: args.staffId,
    p_change_id: null,
    p_payload: {
      effective_from: args.effectiveFrom,
      target_state: args.targetState,
      last_working_date: args.lastWorkingDate || null,
      separation_kind: args.separationKind || null,
      reason: args.reason,
    },
  });
  if (error) throw new Error(error.message);
  return data as { success: boolean; id: string; state: 'pending' };
}

export async function listPendingStaffLifecycleChangesV2(): Promise<PendingStaffLifecycleChangeV2[]> {
  const { data, error } = await supabase.rpc('hr_staff_lifecycle_change_v2', {
    p_action: 'list_pending',
    p_staff_id: null,
    p_change_id: null,
    p_payload: {},
  });
  if (error) throw new Error(error.message);
  return (data || []) as PendingStaffLifecycleChangeV2[];
}

export async function decideStaffLifecycleChangeV2(
  changeId: string,
  decision: 'approve' | 'reject',
  note?: string | null
) {
  const { data, error } = await supabase.rpc('hr_staff_lifecycle_change_v2', {
    p_action: decision,
    p_staff_id: null,
    p_change_id: changeId,
    p_payload: { note: note || null },
  });
  if (error) throw new Error(error.message);
  return data as {
    success: boolean;
    id: string;
    state: 'approved' | 'rejected';
    effective_from: string;
    target_state: StaffLifecycleStateV2;
  };
}
