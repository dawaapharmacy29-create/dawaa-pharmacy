import type { CanonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';

// Evaluation Lab v6 (trial, read-only). See docs/EVALUATION_LAB_V6_DESIGN.md.

export type LabFamily = 'doctor' | 'assistant' | 'delivery' | 'branch_manager' | 'branches_manager';

export type LabAxisKey =
  | 'sales_per_day'
  | 'coding_quality'
  | 'conversation_quality'
  | 'discipline'
  | 'customer_requests'
  | 'followups'
  | 'purchase_entry'
  | 'deliveries_per_day'
  | 'branch_target'
  | 'team_discipline'
  | 'team_conversations'
  | 'branch_coding'
  | 'requests_closure'
  | 'branch_managers';

export interface LabAxisDefinition {
  key: LabAxisKey;
  label: string;
  /** 0 for informational axes whose source is dormant (shown, never weighted). */
  weight: number;
}

export const LAB_FAMILY_LABELS: Record<LabFamily, string> = {
  doctor: 'الصيادلة',
  assistant: 'المساعدون',
  delivery: 'الدليفري',
  branch_manager: 'مديرو الفروع',
  branches_manager: 'مدير الفروع',
};

export const LAB_AXES: Record<LabFamily, LabAxisDefinition[]> = {
  doctor: [
    { key: 'sales_per_day', label: 'نصيب المبيعات في أيام العمل', weight: 30 },
    { key: 'discipline', label: 'الانضباط', weight: 25 },
    { key: 'conversation_quality', label: 'جودة المحادثات', weight: 20 },
    { key: 'customer_requests', label: 'تسجيل طلبات العملاء', weight: 15 },
    { key: 'coding_quality', label: 'تكويد الفواتير', weight: 10 },
    { key: 'followups', label: 'متابعة العملاء', weight: 0 },
  ],
  assistant: [
    { key: 'discipline', label: 'الانضباط', weight: 50 },
    { key: 'purchase_entry', label: 'إدخال فواتير المشتريات', weight: 30 },
    { key: 'customer_requests', label: 'تسجيل طلبات العملاء', weight: 20 },
  ],
  delivery: [
    { key: 'discipline', label: 'الانضباط', weight: 50 },
    { key: 'deliveries_per_day', label: 'التوصيلات لكل يوم عمل', weight: 50 },
  ],
  branch_manager: [
    { key: 'branch_target', label: 'تحقيق تارجت الفرع', weight: 30 },
    { key: 'requests_closure', label: 'إغلاق طلبات العملاء', weight: 25 },
    { key: 'team_discipline', label: 'انضباط الفريق', weight: 20 },
    { key: 'team_conversations', label: 'جودة محادثات الفريق', weight: 15 },
    { key: 'branch_coding', label: 'تكويد فواتير الفرع', weight: 10 },
  ],
  branches_manager: [
    { key: 'branch_target', label: 'تحقيق تارجت الفرعين', weight: 35 },
    { key: 'branch_managers', label: 'أداء مديري الفروع', weight: 25 },
    { key: 'requests_closure', label: 'إغلاق طلبات العملاء', weight: 25 },
    { key: 'team_discipline', label: 'انضباط الفرق', weight: 15 },
  ],
};

export function labFamilyOf(role: CanonicalStaffRole): LabFamily | null {
  if (role === 'doctor' || role === 'assistant' || role === 'delivery' || role === 'branch_manager' || role === 'branches_manager') return role;
  return null;
}

/** Measurability thresholds (design §3). */
export const LAB_THRESHOLDS = {
  minWorkedDays: 5,
  minResolvedDays: 8,
  minInvoicesForCoding: 30,
  minOfficialReviews: 3,
  minPeersForPercentile: 3,
  reviewShrinkK: 5,
  readyCoverage: 0.7,
  partialCoverage: 0.4,
  /** Fair share of branch sales: 0.4 → 0, 1.0 → 50, 1.6 → 100. */
  fairShareFloor: 0.4,
  fairShareCeiling: 1.6,
} as const;

/** Attendance statuses that are still waiting for a decision: shown, never scored. */
export const UNRESOLVED_ATTENDANCE = /^(.*_review|missing_checkin|missing_checkout|invalid_schedule_time)$/;
/** Approved absence with a deduction: a real missed shift, zero punctuality credit. */
export const ABSENCE_WITH_DEDUCTION = /absence_deduction/;
/**
 * Days that carry no punctuality signal: no shift, flexible, leave, off day, employment ended.
 * Production uses 60+ resolution statuses (most manager approvals carry real late minutes), so
 * punctuality is read from late_minutes on scheduled days, never from the status name.
 */
export const NON_PUNCTUALITY_ATTENDANCE = /^(off_day|approved_time_off|approved_leave|manager_approved_leave|employment_ended|no_schedule|flexible_.*|time_off_with_events|approved_absence_permission|manager_not_currently_working.*)$/;
/** Late-minute bands per scheduled day: ≤15 full credit, ≤60 half, beyond 0. */
export const PUNCTUALITY_BANDS = { graceMinutes: 15, halfCreditMinutes: 60 } as const;
