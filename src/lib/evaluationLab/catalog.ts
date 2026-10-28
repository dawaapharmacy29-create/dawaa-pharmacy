import type { CanonicalStaffRole } from '@/lib/staff/staffRoleCapabilities';

// Evaluation Lab v6 (trial, read-only). See docs/EVALUATION_LAB_V6_DESIGN.md.

export type LabFamily = 'doctor' | 'assistant' | 'delivery' | 'branch_manager' | 'branches_manager';

/** v6.0 is kept so the lab can show what each change moved; v6.1 is the proposal under review. */
/** Each version keeps every rule of the one before it; the lab shows the change against the previous one. */
export type LabVersion = 'v6.0' | 'v6.1' | 'v6.2';
export const LAB_CURRENT_VERSION: LabVersion = 'v6.2';
export const LAB_PREVIOUS_VERSION: Record<LabVersion, LabVersion | null> = { 'v6.0': null, 'v6.1': 'v6.0', 'v6.2': 'v6.1' };

export type LabAxisKey =
  | 'sales_per_day'
  | 'invoice_share'
  | 'avg_invoice'
  | 'basket_items'
  | 'coding_quality'
  | 'conversation_quality'
  | 'discipline'
  | 'customer_requests'
  | 'followups'
  | 'purchase_entry'
  | 'assistant_checklist'
  | 'deliveries_per_day'
  | 'delivery_rating'
  | 'branch_target'
  | 'team_discipline'
  | 'team_conversations'
  | 'team_quality'
  | 'team_followup'
  | 'branch_coding'
  | 'requests_closure'
  | 'decision_backlog'
  | 'branch_managers';

export interface LabAxisDefinition {
  key: LabAxisKey;
  label: string;
  /** 0 = shown for information (dormant source, gate, or ownership not agreed), never weighted. */
  weight: number;
}

export const LAB_FAMILY_LABELS: Record<LabFamily, string> = {
  doctor: 'الصيادلة',
  assistant: 'المساعدون',
  delivery: 'الدليفري',
  branch_manager: 'مديرو الفروع',
  branches_manager: 'مدير الفروع',
};

const V60: Record<LabFamily, LabAxisDefinition[]> = {
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

// v6.1 (owner review 2026-10-28): saturated rates become gates, counts only valid records,
// fair share for couriers, branch-manager follow-up of the team's missing punches.
const V61: Record<LabFamily, LabAxisDefinition[]> = {
  doctor: [
    { key: 'sales_per_day', label: 'نصيب المبيعات في أيام العمل', weight: 30 },
    { key: 'discipline', label: 'الانضباط والبصمات', weight: 25 },
    { key: 'conversation_quality', label: 'جودة المحادثات', weight: 20 },
    { key: 'customer_requests', label: 'طلبات العملاء الصالحة', weight: 15 },
    { key: 'coding_quality', label: 'تكويد الفواتير (حد أدنى)', weight: 0 },
    { key: 'followups', label: 'متابعة العملاء', weight: 0 },
  ],
  assistant: [
    { key: 'discipline', label: 'الانضباط والبصمات', weight: 40 },
    { key: 'assistant_checklist', label: 'قائمة المهام اليومية', weight: 35 },
    { key: 'purchase_entry', label: 'إدخال فواتير المشتريات', weight: 25 },
  ],
  delivery: [
    { key: 'discipline', label: 'الانضباط والبصمات', weight: 40 },
    { key: 'deliveries_per_day', label: 'نصيب التوصيلات في أيام العمل', weight: 45 },
    { key: 'delivery_rating', label: 'تقييم العملاء للتوصيل', weight: 15 },
  ],
  branch_manager: [
    { key: 'branch_target', label: 'تحقيق تارجت الفرع', weight: 30 },
    { key: 'requests_closure', label: 'تنفيذ وإغلاق طلبات العملاء', weight: 25 },
    { key: 'team_discipline', label: 'انضباط الفريق', weight: 15 },
    { key: 'team_followup', label: 'متابعة بصمات الفريق', weight: 15 },
    { key: 'team_quality', label: 'جودة الفريق (محادثات وتكويد)', weight: 15 },
    { key: 'decision_backlog', label: 'قرارات حضور معلّقة في الفرع', weight: 0 },
  ],
  branches_manager: [
    { key: 'branch_target', label: 'تحقيق تارجت الفرعين', weight: 35 },
    { key: 'branch_managers', label: 'أداء مديري الفروع', weight: 25 },
    { key: 'requests_closure', label: 'تنفيذ وإغلاق طلبات العملاء', weight: 25 },
    { key: 'team_discipline', label: 'انضباط الفرق', weight: 15 },
    { key: 'decision_backlog', label: 'قرارات حضور معلّقة', weight: 0 },
  ],
};

// v6.2 (owner focus 2026-10-28): sales split into value share, customers served, average invoice
// and basket size, each compared with the same branch, day and shift; conversations, requests and
// follow-ups next; punctuality lighter (policy breaches move to the incentive compliance factor).
const V62: Record<LabFamily, LabAxisDefinition[]> = {
  ...V61,
  doctor: [
    { key: 'sales_per_day', label: 'نصيب المبيعات', weight: 15 },
    { key: 'invoice_share', label: 'نصيب عدد الفواتير (عملاء خدمهم)', weight: 10 },
    { key: 'avg_invoice', label: 'متوسط الفاتورة مقابل الفرع والشيفت', weight: 10 },
    { key: 'basket_items', label: 'الأصناف في الفاتورة مقابل الفرع والشيفت', weight: 5 },
    { key: 'conversation_quality', label: 'جودة المحادثات', weight: 20 },
    { key: 'customer_requests', label: 'طلبات العملاء الصالحة', weight: 15 },
    { key: 'followups', label: 'متابعات العملاء', weight: 15 },
    { key: 'discipline', label: 'الانضباط والبصمات', weight: 10 },
    { key: 'coding_quality', label: 'تكويد الفواتير (حد أدنى)', weight: 0 },
  ],
};

export const LAB_AXES_BY_VERSION: Record<LabVersion, Record<LabFamily, LabAxisDefinition[]>> = { 'v6.0': V60, 'v6.1': V61, 'v6.2': V62 };
export const LAB_AXES = LAB_AXES_BY_VERSION[LAB_CURRENT_VERSION];

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
  /** Fair share of branch sales (and deliveries): 0.4 → 0, 1.0 → 50, 1.6 → 100. */
  fairShareFloor: 0.4,
  fairShareCeiling: 1.6,
  /** Coding gate (v6.1): no credit above the floor, 2 points off per point below it, at most 10. */
  codingGateFloor: 0.95,
  codingGatePointsPerPercent: 2,
  codingGateMaxPenalty: 10,
  /**
   * Delivery evidence gate (v6.1): a branch's deliveries are scored only when it writes a courier
   * name on enough invoices and those names resolve to couriers; otherwise the axis measures the
   * recording, not the courier.
   */
  minCourierLabelShare: 0.25,
  minCourierLabelResolved: 0.8,
  /** v6.2 basket metrics: ratio to the same branch/day/shift average. 0.7 → 0, 1.0 → 50, 1.3 → 100. */
  minInvoicesForBasket: 30,
  avgInvoiceFloor: 0.7,
  avgInvoiceCeiling: 1.3,
  /** Items per invoice move less: 0.85 → 0, 1.0 → 50, 1.15 → 100. */
  basketFloor: 0.85,
  basketCeiling: 1.15,
  /** Team follow-up of missing punches (v6.1): 85% corrected → 0, 100% → 100. */
  followupFloor: 0.85,
} as const;

/** Attendance statuses that are still waiting for a decision: shown, never scored. */
export const UNRESOLVED_ATTENDANCE = /^(.*_review|missing_checkin|missing_checkout|invalid_schedule_time)$/;
/** v6.1: a punch the employee never corrected is the employee's own miss (zero credit that day). */
export const MISSING_PUNCH = /^(missing_checkin|missing_checkout)$/;
/** Days waiting for a manager/administration decision. */
export const PENDING_DECISION = /^(.*_review|invalid_schedule_time)$/;
/** Customer requests that do not count for the recording employee. */
export const INVALID_REQUEST_STATUS = /^(cancelled|canceled|duplicate|rejected)$/;
/** Approved absence with a deduction: a real missed shift, zero punctuality credit. */
export const ABSENCE_WITH_DEDUCTION = /absence_deduction/;
/**
 * Days that carry no punctuality signal: no shift, flexible, leave, off day, employment ended.
 * Production uses 60+ resolution statuses (most manager approvals carry real late minutes), so
 * punctuality is read from late_minutes on scheduled days, never from the status name.
 */
export const NON_PUNCTUALITY_ATTENDANCE = /^(off_day|approved_time_off|approved_leave|manager_approved_leave|employment_ended|no_schedule|flexible_.*|time_off_with_events|approved_absence_permission|manager_not_currently_working.*)$/;
/** Cairo shift buckets for invoices (from invoice_datetime): night 0–8, morning 8–16, evening 16–24. */
export function invoiceShiftOf(cairoHour: number): 'ليلي' | 'صباحي' | 'مسائي' {
  return cairoHour < 8 ? 'ليلي' : cairoHour < 16 ? 'صباحي' : 'مسائي';
}

/** Late-minute bands per scheduled day: ≤15 full credit, ≤60 half, beyond 0. */
export const PUNCTUALITY_BANDS = { graceMinutes: 15, halfCreditMinutes: 60 } as const;
