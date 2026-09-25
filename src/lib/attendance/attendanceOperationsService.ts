import { supabase } from '@/lib/supabase';

export type AttendanceDailyCommandRow = Record<string, unknown>;
export type AttendanceDailyIntelligenceRow = Record<string, unknown>;
export type AttendanceSyncHealthPayload = Record<string, unknown>;
export type UnmappedBiometricRow = Record<string, unknown>;
export type BiometricStaffCandidateRow = Record<string, unknown>;
export type BiometricCrossSourceCandidateRow = Record<string, unknown>;

export async function getAttendanceDailyCommand(date: string, branch?: string | null) {
  const { data, error } = await supabase.rpc('attendance_daily_command_v1', {
    p_date: date,
    p_branch: branch || null,
  });
  if (error) throw new Error(error.message);
  return (data || []) as AttendanceDailyCommandRow[];
}

export async function getAttendanceDailyIntelligence(date: string, branch?: string | null) {
  const { data, error } = await supabase.rpc('attendance_daily_intelligence_v2', {
    p_date: date,
    p_branch: branch || null,
  });
  if (error) throw new Error(error.message);
  return (data || []) as AttendanceDailyIntelligenceRow[];
}

export async function getAttendanceDashboardDailySummary(date: string, branch?: string | null) {
  const { data, error } = await supabase.rpc('attendance_dashboard_daily_summary_v1', {
    p_date: date,
    p_branch: branch || null,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('attendance_dashboard_summary_unavailable');
  }
  return data as Record<string, unknown>;
}

export async function getAttendanceSyncHealth(start: string, end: string) {
  const { data, error } = await supabase.rpc('attendance_sync_health_v4', {
    p_start: start,
    p_end: end,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as AttendanceSyncHealthPayload;
}

export async function listUnmappedBiometricStaff(start: string, end: string, limit = 100) {
  const { data, error } = await supabase.rpc('list_unmapped_biometric_staff_v2', {
    p_start: start,
    p_end: end,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data || []) as UnmappedBiometricRow[];
}

export async function getAttendanceReviewTriage(start: string, end: string, branch?: string | null) {
  const { data, error } = await supabase.rpc('attendance_review_triage_v1', {
    p_start: start,
    p_end: end,
    p_branch: branch || null,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}

export async function listPendingAttendanceDeductions() {
  const { data, error } = await supabase.rpc('attendance_deduction_pending_review_v1');
  if (error) throw new Error(error.message);
  return (data || []) as Array<Record<string, unknown>>;
}

export async function searchBiometricMappingCandidates(search: string, limit = 30) {
  const { data, error } = await supabase.rpc('list_biometric_mapping_staff_candidates_v1', {
    p_search: search,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data || []) as BiometricStaffCandidateRow[];
}

export async function getBiometricCrossSourceCandidates(provider: string, biometricUserId: string) {
  const { data, error } = await supabase.rpc('biometric_cross_source_candidate_v1', {
    p_provider: provider,
    p_biometric_user_id: biometricUserId,
  });
  if (error) throw new Error(error.message);
  return (data || []) as BiometricCrossSourceCandidateRow[];
}

export async function assignBiometricStaffMapping(provider: string, biometricUserId: string, staffId: string) {
  const { data, error } = await supabase.rpc('assign_biometric_staff_mapping_v3', {
    p_provider: provider,
    p_biometric_user_id: biometricUserId,
    p_staff_id: staffId,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as Record<string, unknown>;
}

export async function applyConfirmedBiometricBatch() {
  const { data, error } = await supabase.rpc('apply_confirmed_biometric_batch_v1');
  if (error) throw new Error(error.message);
  return (data || {}) as { applied?: number; already_mapped?: number };
}
