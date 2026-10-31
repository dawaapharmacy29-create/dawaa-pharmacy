import { supabase } from '@/lib/supabase';
import type { ViolationCategory } from '@/lib/evaluationLab/complianceFactor';

// Staff compliance violations (migration 20261031100000). The branch manager records one for an employee
// with a note; a wrong one is withdrawn with a reason, never deleted.

export interface BranchStaffOption { staff_account_id: string; name: string; role: string; branch_key: string | null }
export interface StaffViolationRow {
  id: string; staff_account_id: string; staff_name: string; branch_key: string | null; category: ViolationCategory;
  points: number; occurred_on: string; note: string; recorded_by_name: string | null; recorded_at: string;
  withdrawn: boolean; withdraw_reason: string | null;
}

export function violationErrorMessage(error: unknown) {
  const message = String((error as { message?: string })?.message ?? error ?? '');
  if (message.includes('not_authorized')) return 'مش مسموح لك تسجّل للموظف ده';
  if (message.includes('note_required')) return 'اكتب حصل إيه بالظبط';
  if (message.includes('reason_required')) return 'اكتب سبب الإلغاء';
  if (message.includes('invalid_day')) return 'التاريخ لازم يكون خلال آخر 7 أيام';
  if (message.includes('Could not find the function') || message.includes('PGRST202')) return 'تسجيل المخالفات لسه مش متفعل على قاعدة البيانات';
  return 'حصلت مشكلة، جرّب تاني';
}

export async function listBranchStaffForViolations(branch: string | null) {
  const { data, error } = await supabase.rpc('list_branch_staff_for_violations_v1', { p_branch: branch });
  if (error) throw error;
  return (data || []) as BranchStaffOption[];
}

export async function listStaffViolations(from: string, to: string, branch: string | null) {
  const { data, error } = await supabase.rpc('list_staff_violations_v1', { p_from: from, p_to: to, p_branch: branch });
  if (error) throw error;
  return (data || []) as StaffViolationRow[];
}

export async function recordStaffViolation(staffId: string, category: ViolationCategory, note: string) {
  const { error } = await supabase.rpc('record_staff_violation_v1', { p_staff_account_id: staffId, p_category: category, p_note: note });
  if (error) throw error;
}

export async function withdrawStaffViolation(id: string, reason: string) {
  const { error } = await supabase.rpc('withdraw_staff_violation_v1', { p_id: id, p_reason: reason });
  if (error) throw error;
}
