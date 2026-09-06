import { supabase } from './supabase';
import {
  getPermissionPolicyStatusV2,
  listStaffTimeOffRequests,
} from './timeOffService';

export interface PermissionRecord {
  id: string;
  staff_id: string;
  staff_name: string;
  permission_date: string;
  reason: string;
  approved_by: string | null;
  cycle_start: string;
  cycle_end: string;
}

export interface PermissionPolicyStatus {
  staff_id: string;
  staff_name: string;
  free_allowance_used: number;
  remaining_free_permissions: number;
  penalized_permission_number: number;
  deduction_points: number;
  requires_manager_review: boolean;
  current_cycle_permissions: PermissionRecord[];
}

/**
 * Canonical permission policy reader.
 *
 * Source of truth:
 * staff_time_off_requests + attendance_policy_versions, through secured RPCs.
 * No missing-table fallback and no direct points deduction are allowed here.
 */
export class PermissionPolicyService {
  static async getPermissionPolicyStatus(
    staffId: string,
    cycleStart: string,
    cycleEnd: string
  ): Promise<PermissionPolicyStatus> {
    const [policy, requests, staffResult] = await Promise.all([
      getPermissionPolicyStatusV2(staffId, cycleStart, cycleEnd),
      listStaffTimeOffRequests({ staffId, from: cycleStart, to: cycleEnd, status: 'approved', limit: 100 }),
      supabase.from('staff').select('name').eq('id', staffId).maybeSingle(),
    ]);

    if (staffResult.error) throw new Error(staffResult.error.message);

    const permissions = requests.filter((request) => request.request_kind === 'permission');
    return {
      staff_id: staffId,
      staff_name: staffResult.data?.name || permissions[0]?.staff_name_snapshot || 'غير محدد',
      free_allowance_used: Math.min(policy.approved_permissions, policy.allowance),
      remaining_free_permissions: policy.remaining,
      penalized_permission_number: policy.exceeded_count,
      deduction_points: 0,
      requires_manager_review: policy.requires_manager_review,
      current_cycle_permissions: permissions.map((request) => ({
        id: request.id,
        staff_id: request.staff_id,
        staff_name: request.staff_name_snapshot,
        permission_date: request.start_date,
        reason: request.reason || 'غير محدد',
        approved_by: request.decided_by,
        cycle_start: cycleStart,
        cycle_end: cycleEnd,
      })),
    };
  }

  static async getPermissionPolicySummary(
    cycleStart: string,
    cycleEnd: string
  ): Promise<PermissionPolicyStatus[]> {
    const { data: staff, error } = await supabase
      .from('staff')
      .select('id')
      .eq('active', true);
    if (error) throw new Error(error.message);

    const summaries = await Promise.all(
      (staff || []).map((employee) => this.getPermissionPolicyStatus(employee.id, cycleStart, cycleEnd))
    );
    return summaries.sort((a, b) => b.penalized_permission_number - a.penalized_permission_number);
  }

  static async canTakeFreePermission(
    staffId: string,
    cycleStart: string,
    cycleEnd: string
  ): Promise<{ canTake: boolean; remainingFree: number; message: string }> {
    const status = await this.getPermissionPolicyStatus(staffId, cycleStart, cycleEnd);
    if (status.remaining_free_permissions > 0) {
      return {
        canTake: true,
        remainingFree: status.remaining_free_permissions,
        message: `يمكنك طلب إذن. متبقي ${status.remaining_free_permissions} من الحد المعتمد في الدورة، والتنفيذ بعد موافقة المدير المختص.`,
      };
    }
    return {
      canTake: false,
      remainingFree: 0,
      message: 'تم استخدام الحد المعتمد للأذونات في الدورة. أي طلب إضافي يذهب للمراجعة الإدارية ولا يتحول لخصم تلقائي.',
    };
  }

  static calculateDeductionForPermission(_currentApprovedCount: number): number {
    // Attendance policy creates review/impact events; it never deducts points directly.
    return 0;
  }

  static async getStaffExceedingFreeAllowance(cycleStart: string, cycleEnd: string) {
    const summary = await this.getPermissionPolicySummary(cycleStart, cycleEnd);
    return summary.filter((item) => item.penalized_permission_number > 0);
  }

  static async getStaffRequiringManagerReview(cycleStart: string, cycleEnd: string) {
    const summary = await this.getPermissionPolicySummary(cycleStart, cycleEnd);
    return summary.filter((item) => item.requires_manager_review);
  }
}
