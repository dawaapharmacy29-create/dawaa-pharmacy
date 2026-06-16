import { supabase } from './supabase';
import { calculatePermissionPolicy, FREE_PERMISSIONS_PER_CYCLE } from './incentives/incentiveRulesEngine';

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

function emptyPermissionPolicyStatus(staffId: string, staffName = 'غير محدد'): PermissionPolicyStatus {
  return {
    staff_id: staffId,
    staff_name: staffName,
    free_allowance_used: 0,
    remaining_free_permissions: FREE_PERMISSIONS_PER_CYCLE,
    penalized_permission_number: 0,
    deduction_points: 0,
    requires_manager_review: false,
    current_cycle_permissions: [],
  };
}

function isMissingTimeOffTable(message?: string | null) {
  return /Could not find the table 'public\.time_off' in the schema cache/i.test(String(message || ""));
}

/**
 * خدمة إدارة سياسة الإذنات (3 إذنات مجانية لكل دورة)
 */
export class PermissionPolicyService {
  /**
   * حساب حالة سياسة الإذنات لموظف
   */
  static async getPermissionPolicyStatus(staffId: string, cycleStart: string, cycleEnd: string): Promise<PermissionPolicyStatus> {
    // الحصول على جميع الإذنات للموظف في الدورة الحالية
    const { data: permissions, error } = await supabase
      .from('time_off')
      .select('id, staff_id, staff_name, start_date, end_date, reason, approved_by, created_at')
      .eq('staff_id', staffId)
      .eq('type', 'permission')
      .gte('created_at', cycleStart)
      .lte('created_at', cycleEnd);

    if (error) {
      if (isMissingTimeOffTable(error.message)) return emptyPermissionPolicyStatus(staffId);
      throw new Error(error.message);
    }

    const approvedPermissions = (permissions || []).filter(p => p.approved_by);
    const approvedCount = approvedPermissions.length;

    // استخدام دالة calculatePermissionPolicy من incentiveRulesEngine
    const policy = calculatePermissionPolicy(approvedCount);

    // تحويل الإذنات إلى تنسيق PermissionRecord
    const currentCyclePermissions: PermissionRecord[] = approvedPermissions.map(p => ({
      id: p.id,
      staff_id: p.staff_id,
      staff_name: p.staff_name || 'غير محدد',
      permission_date: p.start_date || p.created_at,
      reason: p.reason || 'غير محدد',
      approved_by: p.approved_by,
      cycle_start: cycleStart,
      cycle_end: cycleEnd,
    }));

    // الحصول على اسم الموظف
    const { data: staff } = await supabase
      .from('staff')
      .select('name')
      .eq('id', staffId)
      .maybeSingle();

    return {
      staff_id: staffId,
      staff_name: staff?.name || 'غير محدد',
      free_allowance_used: policy.freeAllowanceUsed,
      remaining_free_permissions: policy.remainingFreePermissions,
      penalized_permission_number: policy.penalizedPermissionNumber,
      deduction_points: policy.deductionPoints,
      requires_manager_review: policy.requiresManagerReview,
      current_cycle_permissions: currentCyclePermissions,
    };
  }

  /**
   * الحصول على ملخص سياسة الإذنات لجميع الموظفين في دورة معينة
   */
  static async getPermissionPolicySummary(cycleStart: string, cycleEnd: string): Promise<PermissionPolicyStatus[]> {
    // الحصول على جميع الموظفين النشطين
    const { data: staff, error: staffError } = await supabase
      .from('staff')
      .select('id, name')
      .eq('active', true);

    if (staffError) throw new Error(staffError.message);

    const summaries: PermissionPolicyStatus[] = [];

    for (const employee of staff || []) {
      const status = await this.getPermissionPolicyStatus(employee.id, cycleStart, cycleEnd);
      summaries.push(status);
    }

    // ترتيب حسب عدد الإذنات المعاقبة (الأكثر استخداماً أولاً)
    return summaries.sort((a, b) => b.penalized_permission_number - a.penalized_permission_number);
  }

  /**
   * التحقق من ما إذا كان الموظف يستطيع أخذ إذن بدون عقوبة
   */
  static async canTakeFreePermission(staffId: string, cycleStart: string, cycleEnd: string): Promise<{
    canTake: boolean;
    remainingFree: number;
    message: string;
  }> {
    const status = await this.getPermissionPolicyStatus(staffId, cycleStart, cycleEnd);

    if (status.remaining_free_permissions > 0) {
      return {
        canTake: true,
        remainingFree: status.remaining_free_permissions,
        message: `يمكنك أخذ إذن بدون عقوبة. لديك ${status.remaining_free_permissions} إذن مجاني متبقي.`,
      };
    } else {
      return {
        canTake: false,
        remainingFree: 0,
        message: `لقد استنزفت جميع الإذنات المجانية (${FREE_PERMISSIONS_PER_CYCLE}). أي إذن إضافي سيؤدي إلى خصم نقاط.`,
      };
    }
  }

  /**
   * حساب الخصم النقطي لإذن معين
   */
  static calculateDeductionForPermission(currentApprovedCount: number): number {
    const policy = calculatePermissionPolicy(currentApprovedCount + 1);
    return policy.deductionPoints;
  }

  /**
   * الحصول على الموظفين الذين تجاوزوا حد الإذنات المجانية
   */
  static async getStaffExceedingFreeAllowance(cycleStart: string, cycleEnd: string): Promise<PermissionPolicyStatus[]> {
    const summary = await this.getPermissionPolicySummary(cycleStart, cycleEnd);
    return summary.filter(s => s.penalized_permission_number > 0);
  }

  /**
   * الحصول على الموظفين الذين يحتاجون مراجعة المدير
   */
  static async getStaffRequiringManagerReview(cycleStart: string, cycleEnd: string): Promise<PermissionPolicyStatus[]> {
    const summary = await this.getPermissionPolicySummary(cycleStart, cycleEnd);
    return summary.filter(s => s.requires_manager_review);
  }
}
