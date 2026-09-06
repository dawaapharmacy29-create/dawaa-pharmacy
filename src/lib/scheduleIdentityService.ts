import { supabase } from '@/lib/supabase';

export type ScheduleIdentityHealth = {
  total_rows: number;
  linked_rows: number;
  unlinked_rows: number;
  unlinked_groups: number;
  same_branch_exact_candidate_rows: number;
  checked_at: string;
};

export type UnmappedScheduleGroup = {
  legacy_staff_name: string;
  legacy_branch: string;
  schedule_rows: number;
  first_created_at: string | null;
  last_updated_at: string | null;
  days: string[];
  exact_same_branch_candidate_id: string | null;
  exact_same_branch_candidate_name: string | null;
};

export type ScheduleStaffCandidate = {
  staff_id: string;
  staff_name: string;
  branch: string;
  role: string;
};

export async function getScheduleIdentityHealth(): Promise<ScheduleIdentityHealth> {
  const { data, error } = await supabase.rpc('get_shift_schedule_identity_health_v1');
  if (error) throw new Error(error.message);
  return (data || {}) as ScheduleIdentityHealth;
}

export async function listUnmappedScheduleGroups(search = '', limit = 200): Promise<UnmappedScheduleGroup[]> {
  const { data, error } = await supabase.rpc('list_unmapped_shift_schedule_groups_v1', {
    p_search: search.trim() || null,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data || []) as UnmappedScheduleGroup[];
}

export async function listScheduleStaffCandidates(args: {
  search: string;
  branch: string;
  limit?: number;
}): Promise<ScheduleStaffCandidate[]> {
  const { data, error } = await supabase.rpc('list_schedule_identity_staff_candidates_v1', {
    p_search: args.search.trim(),
    p_branch: args.branch || null,
    p_limit: args.limit ?? 40,
  });
  if (error) throw new Error(error.message);
  return (data || []) as ScheduleStaffCandidate[];
}

export async function assignScheduleIdentity(args: {
  legacyStaffName: string;
  legacyBranch: string;
  staffId: string;
  note: string;
}): Promise<{ success: boolean; staff_id: string; staff_name: string; branch: string; rows_updated: number }> {
  const { data, error } = await supabase.rpc('assign_shift_schedule_staff_identity_v1', {
    p_legacy_staff_name: args.legacyStaffName,
    p_legacy_branch: args.legacyBranch,
    p_staff_id: args.staffId,
    p_note: args.note,
  });
  if (error) throw new Error(error.message);
  return data as { success: boolean; staff_id: string; staff_name: string; branch: string; rows_updated: number };
}
