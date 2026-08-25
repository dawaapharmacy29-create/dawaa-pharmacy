import { getCurrentCycle, type PharmacyCycle } from '@/lib/pharmacy-cycle';
import type { CustomerType } from '@/lib/constants';

export const MONTHLY_STARTING_POINTS = 500;
export const MONTHLY_MAX_INCENTIVE_EGP = 1500;
export const QUARTERLY_BASE_BONUS_EGP = 2000;
export const QUARTERLY_MIN_INCENTIVE_EGP = 500;
export const QUARTERLY_MAX_INCENTIVE_EGP = 2600;
export const FREE_PERMISSIONS_PER_CYCLE = 2;

/**
 * مضاعف أهمية العميل — يُطبَّق على أي حدث نقاط (مكافأة أو خصم) مرتبط بعميل،
 * عشان التعامل مع عميل "مهم جدًا" يفرق فعليًا عن التعامل مع عميل "عادي"
 * سواء كان الحدث إيجابي (تفوق) أو سلبي (إهمال) — الاتنين بيتضاعفوا بنفس القيمة.
 *
 * مهم: لازم يتحسب ويتخزن مع الحدث وقت وقوعه (snapshot)، مش يُحسب live وقت
 * العرض، عشان لو تصنيف العميل اتغيّر بعدين الحافز التاريخي يفضل صحيح.
 */
export const CUSTOMER_WEIGHT_MULTIPLIERS: Record<CustomerType, number> = {
  'عادي': 1,
  'متوسط': 1.25,
  'مهم': 1.5,
  'مهم جدًا': 2,
};

export const DEFAULT_CUSTOMER_WEIGHT_MULTIPLIER = 1;

export function customerWeightMultiplier(customerType?: CustomerType | string | null): number {
  if (!customerType) return DEFAULT_CUSTOMER_WEIGHT_MULTIPLIER;
  return CUSTOMER_WEIGHT_MULTIPLIERS[customerType as CustomerType] ?? DEFAULT_CUSTOMER_WEIGHT_MULTIPLIER;
}

/**
 * يطبّق مضاعف أهمية العميل على نقاط قاعدة أساسية (base rule)، ويرجع النقاط
 * النهائية بعد التقريب لأقرب رقم عشري واحد. يُستخدم وقت تسجيل الحدث نفسه
 * (مش وقت العرض) عشان يتحفظ كـ snapshot داخل points_delta.
 */
export function applyCustomerWeight(basePoints: number, customerType?: CustomerType | string | null): number {
  const multiplier = customerWeightMultiplier(customerType);
  return Math.round(basePoints * multiplier * 10) / 10;
}

export type IncentiveImpactType =
  | 'monthly_points_deduction'
  | 'monthly_exceptional_reward'
  | 'quarterly_money_deduction'
  | 'quarterly_money_reward'
  | 'warning_only'
  | 'operational_task';

export type IncentiveSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncentiveRepeatPolicy = 'linear_multiplier' | 'manager_review_only' | 'none';

export type IncentiveRuleDefinition = {
  rule_code: string;
  title_ar: string;
  description_ar: string;
  role_scope: string;
  category: string;
  impact_type: IncentiveImpactType;
  points_delta: number;
  money_delta: number;
  approval_required: boolean;
  severity: IncentiveSeverity;
  repeat_policy: IncentiveRepeatPolicy;
  visible_to_staff: boolean;
  included_in_pdf: boolean;
  source_module: string;
  active: boolean;
  /** المحور اللي القاعدة دي تتحسب فيه في الدرجة المركّبة الشهرية (اختياري لقواعد مالها محور، زي الحافز الربع سنوي). */
  pillar_key?: string;
};

export type MonthlyIncentiveCalculation = {
  startingPoints: number;
  approvedDeductionPoints: number;
  approvedExceptionalRewardPoints: number;
  pendingDeductionPoints: number;
  pendingRewardPoints: number;
  finalPoints: number;
  monthlyIncentiveValue: number;
  distinctionPointsAbove500: number;
  progressPercent: number;
};

export type QuarterlyIncentiveCalculation = {
  quarterlyBaseValue: number;
  approvedQuarterlyDeductions: number;
  approvedQuarterlyRewards: number;
  quarterlyFinalValue: number;
};

/**
 * المصدر الحسابي المعتمد لنقاط الدورة.
 * كل موظف يبدأ برصيد افتتاحي مرتبط ببروفايل التعويض (500 افتراضيًا)، ثم تضاف
 * المكافآت المعتمدة وتُخصم المخالفات المعتمدة. الزيادة فوق الرصيد الافتتاحي
 * تظهر كنقاط تميز ولا ترفع الحافز الأساسي فوق سقفه المالي.
 */
export function calculateMonthlyIncentive(args: {
  startingPoints?: number;
  approvedDeductionPoints?: number;
  approvedExceptionalRewardPoints?: number;
  pendingDeductionPoints?: number;
  pendingRewardPoints?: number;
  maxIncentiveEgp?: number;
}): MonthlyIncentiveCalculation {
  const startingPoints = Math.max(1, args.startingPoints ?? MONTHLY_STARTING_POINTS);
  const maxIncentiveEgp = Math.max(0, args.maxIncentiveEgp ?? MONTHLY_MAX_INCENTIVE_EGP);
  const approvedDeductionPoints = Math.max(0, args.approvedDeductionPoints ?? 0);
  const approvedExceptionalRewardPoints = Math.max(0, args.approvedExceptionalRewardPoints ?? 0);
  const pendingDeductionPoints = Math.max(0, args.pendingDeductionPoints ?? 0);
  const pendingRewardPoints = Math.max(0, args.pendingRewardPoints ?? 0);
  const finalPoints = Math.max(
    0,
    startingPoints + approvedExceptionalRewardPoints - approvedDeductionPoints
  );
  const paidPoints = Math.min(finalPoints, startingPoints);
  const monthlyIncentiveValue = Math.min(
    maxIncentiveEgp,
    (paidPoints / startingPoints) * maxIncentiveEgp
  );
  const distinctionPointsAbove500 = Math.max(0, finalPoints - startingPoints);
  return {
    startingPoints,
    approvedDeductionPoints,
    approvedExceptionalRewardPoints,
    pendingDeductionPoints,
    pendingRewardPoints,
    finalPoints,
    monthlyIncentiveValue,
    distinctionPointsAbove500,
    progressPercent: Math.min(100, (finalPoints / startingPoints) * 100),
  };
}

/**
 * يحوّل بروفايل تعويض الموظف لمدخلات جاهزة للحساب. مثال:
 * 1500 جنيه / 3 جنيه للنقطة = 500 نقطة افتتاحية، و1000 / 10 = 100 نقطة للمساعد.
 */
export function monthlyIncentiveInputsFromProfile(profile?: {
  monthly_incentive_base?: number | null;
  point_value?: number | null;
} | null): { targetPoints: number; maxIncentiveEgp: number } {
  const pointValue = profile?.point_value && profile.point_value > 0 ? profile.point_value : null;
  const base = profile?.monthly_incentive_base && profile.monthly_incentive_base > 0
    ? profile.monthly_incentive_base
    : MONTHLY_MAX_INCENTIVE_EGP;
  if (!pointValue) return { targetPoints: MONTHLY_STARTING_POINTS, maxIncentiveEgp: base };
  return { targetPoints: Math.max(1, Math.round(base / pointValue)), maxIncentiveEgp: base };
}

export function calculateQuarterlyIncentive(args: {
  approvedQuarterlyDeductions?: number;
  approvedQuarterlyRewards?: number;
  baseValue?: number;
}): QuarterlyIncentiveCalculation {
  const quarterlyBaseValue = args.baseValue ?? QUARTERLY_BASE_BONUS_EGP;
  const approvedQuarterlyDeductions = Math.max(0, args.approvedQuarterlyDeductions ?? 0);
  const approvedQuarterlyRewards = Math.max(0, args.approvedQuarterlyRewards ?? 0);
  return {
    quarterlyBaseValue,
    approvedQuarterlyDeductions,
    approvedQuarterlyRewards,
    quarterlyFinalValue: Math.min(
      QUARTERLY_MAX_INCENTIVE_EGP,
      Math.max(
        QUARTERLY_MIN_INCENTIVE_EGP,
        quarterlyBaseValue - approvedQuarterlyDeductions + approvedQuarterlyRewards
      )
    ),
  };
}

export const SAME_EVENT_DEDUCTION_GROUPS = [
  ['CHAT-009', 'CHAT-010'],
  ['CLASS-001', 'CLASS-002', 'CLASS-003'],
  ['SALE-002A', 'SALE-002B', 'SALE-003', 'SALE-004'],
  ['APP-006', 'APP-007'],
] as const;

/** Prevents overlapping deductions for the same source event unless a manager explicitly overrides it. */
export function sameEventDeductionGuard(args: {
  incomingRuleCode: string;
  existingRuleCodes: string[];
  managerOverride?: boolean;
}) {
  if (args.managerOverride) return { allowed: true, conflictingRuleCodes: [] as string[] };
  const group = SAME_EVENT_DEDUCTION_GROUPS.find((codes) => codes.includes(args.incomingRuleCode as never));
  const conflicts = group ? args.existingRuleCodes.filter((code) => group.includes(code as never)) : [];
  return { allowed: conflicts.length === 0, conflictingRuleCodes: conflicts };
}

/** Conversation scores are mutually exclusive: below 50 uses CHAT-010; 50–69 uses CHAT-009. */
export function conversationScoreDeductionRule(score: number) {
  if (score < 50) return 'CHAT-010';
  if (score < 70) return 'CHAT-009';
  return null;
}

/** 90-99 مكافأة المحادثة الممتازة، و100/100 مكافأة الاستثنائي. */
export function conversationScoreRewardRule(score: number) {
  if (score >= 100) return 'CHAT-REW-002';
  if (score >= 90) return 'CHAT-REW-001';
  return null;
}

/**
 * تكرار المخالفة العادية يتدرج 1× ثم 2× ثم 4× (مثال 20 → 40 → 80).
 * المخالفات الحرجة لا تتضاعف آليًا؛ من التكرار الثاني تنتقل لمراجعة الإدارة.
 */
export function calculateRepeatDeduction(args: {
  basePoints: number;
  previousOccurrences: number;
  severe?: boolean;
}) {
  const MAX_SINGLE_EVENT_DEDUCTION = 80;
  const occurrenceNumber = Math.max(1, args.previousOccurrences + 1);
  const multiplier = args.severe
    ? 1
    : occurrenceNumber <= 1
      ? 1
      : occurrenceNumber === 2
        ? 2
        : 4;
  return {
    occurrenceNumber,
    multiplier,
    finalPoints: Math.min(Math.abs(args.basePoints) * multiplier, MAX_SINGLE_EVENT_DEDUCTION),
    requiresManagerReview: Boolean(args.severe && occurrenceNumber > 1) || occurrenceNumber >= 4,
  };
}

/**
 * الإذن المعتمد لا يتحول تلقائيًا لخصم نقاط. المسموح إذنان في الدورة؛ أي طلب
 * إضافي يحتاج قرار مدير قبل التنفيذ. الخروج/التأخير بدون اعتماد له مسار مخالفة
 * مستقل ولا يُخلط هنا مع الإذن المعتمد.
 */
export function calculatePermissionPolicy(approvedPermissionsInCycle: number) {
  const count = Math.max(0, approvedPermissionsInCycle);
  if (count <= FREE_PERMISSIONS_PER_CYCLE) {
    return {
      freeAllowanceUsed: count,
      remainingFreePermissions: FREE_PERMISSIONS_PER_CYCLE - count,
      penalizedPermissionNumber: 0,
      deductionPoints: 0,
      requiresManagerReview: false,
    };
  }
  return {
    freeAllowanceUsed: FREE_PERMISSIONS_PER_CYCLE,
    remainingFreePermissions: 0,
    penalizedPermissionNumber: count - FREE_PERMISSIONS_PER_CYCLE,
    deductionPoints: 0,
    requiresManagerReview: true,
  };
}

export type ApprovalRole = 'shift_supervisor' | 'branch_manager' | 'branches_manager' | 'general_manager';

/**
 * مصفوفة اعتماد الصلاحيات حسب خطورة الحدث — كل قاعدة نقاط عندها severity
 * محسوبة تلقائيًا في ruleDefinitions.ts (حسب حجم النقاط)، والدالة دي بتحدد
 * مين لازم يعتمد الحدث فعليًا قبل ما يتفعّل، ومين ينفع يضيفه من الأساس.
 */
export function approvalAuthorityFor(severity: IncentiveSeverity): {
  addedBy: ApprovalRole;
  approvedBy: ApprovalRole | 'auto';
  autoApproveAfterHours: number | null;
} {
  switch (severity) {
    case 'low':
      return { addedBy: 'shift_supervisor', approvedBy: 'auto', autoApproveAfterHours: 0 };
    case 'medium':
      return { addedBy: 'shift_supervisor', approvedBy: 'branch_manager', autoApproveAfterHours: 48 };
    case 'high':
      return { addedBy: 'branch_manager', approvedBy: 'branches_manager', autoApproveAfterHours: null };
    case 'critical':
      return { addedBy: 'branch_manager', approvedBy: 'general_manager', autoApproveAfterHours: null };
    default:
      return { addedBy: 'shift_supervisor', approvedBy: 'auto', autoApproveAfterHours: 0 };
  }
}

export type PointAppealStatus = 'pending' | 'under_review' | 'upheld' | 'overturned';
export const POINT_APPEAL_WINDOW_DAYS = 5;

export const EXCEPTIONAL_FOLLOWUP_BASE_POINTS = 5;
export const EXCEPTIONAL_FOLLOWUP_FULL_REWARD_PER_CYCLE = 15;
export const EXCEPTIONAL_FOLLOWUP_REDUCED_REWARD_PER_CYCLE = 5;

/**
 * سياسة نقاط "طلب متابعة استثنائية" — مكافأة كاملة لحد سقف معقول في الدورة،
 * وبعدها تناقص، عشان نمنع تسجيل طلبات شكلية فقط لتجميع النقاط.
 */
export function exceptionalFollowupPointsPolicy(countInCycleSoFar: number): {
  requestNumber: number;
  basePoints: number;
  tier: 'full' | 'reduced' | 'none';
} {
  const requestNumber = Math.max(0, countInCycleSoFar) + 1;
  if (requestNumber <= EXCEPTIONAL_FOLLOWUP_FULL_REWARD_PER_CYCLE) {
    return { requestNumber, basePoints: EXCEPTIONAL_FOLLOWUP_BASE_POINTS, tier: 'full' };
  }
  if (requestNumber <= EXCEPTIONAL_FOLLOWUP_FULL_REWARD_PER_CYCLE + EXCEPTIONAL_FOLLOWUP_REDUCED_REWARD_PER_CYCLE) {
    return { requestNumber, basePoints: Math.round(EXCEPTIONAL_FOLLOWUP_BASE_POINTS / 2), tier: 'reduced' };
  }
  return { requestNumber, basePoints: 0, tier: 'none' };
}

export function getQuarterRange(date = new Date()) {
  const month = date.getMonth();
  const qStartMonth = Math.floor(month / 3) * 3;
  const start = new Date(date.getFullYear(), qStartMonth, 1);
  const end = new Date(date.getFullYear(), qStartMonth + 3, 0, 23, 59, 59);
  return { start, end, label: `الربع ${Math.floor(month / 3) + 1} ${date.getFullYear()}` };
}

export function getMonthlyCycleOrCurrent(cycle?: PharmacyCycle) {
  return cycle ?? getCurrentCycle();
}
