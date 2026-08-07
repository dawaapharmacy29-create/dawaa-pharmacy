import { getCurrentCycle, type PharmacyCycle } from '@/lib/pharmacy-cycle';
import type { CustomerType } from '@/lib/constants';

export const MONTHLY_STARTING_POINTS = 500;
export const MONTHLY_MAX_INCENTIVE_EGP = 1500;
export const QUARTERLY_BASE_BONUS_EGP = 2000;
export const QUARTERLY_MIN_INCENTIVE_EGP = 500;
export const QUARTERLY_MAX_INCENTIVE_EGP = 2600;
export const FREE_PERMISSIONS_PER_CYCLE = 3;

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

export function calculateMonthlyIncentive(args: {
  startingPoints?: number;
  approvedDeductionPoints?: number;
  approvedExceptionalRewardPoints?: number;
  pendingDeductionPoints?: number;
  pendingRewardPoints?: number;
  /**
   * سقف الحافز الشهري بالجنيه — يُفترض إنه جاي من بروفايل الموظف
   * (employee_compensation_profiles.monthly_incentive_base) عشان الفئات
   * المختلفة (جدد / أساسيين / متميزين) تاخد سقف مختلف بدل الرقم الثابت
   * للجميع. لو الموظف مالوش بروفايل، بيرجع للقيمة الافتراضية العامة.
   */
  maxIncentiveEgp?: number;
}): MonthlyIncentiveCalculation {
  // startingPoints هنا هدف الدورة (target) مش رصيد افتتاحي — كل موظف يبدأ الدورة من صفر
  // نقاط فعلية، ويجمع نقاطه بالمكافآت، وتُخصم منه نقاط المخالفات. الوصول للهدف
  // (500 نقطة للفئات العادية، 1000 للفئة المتميزة) هو اللي بيدّي الحافز الأقصى،
  // مش نقطة بداية مجانية.
  const targetPoints = args.startingPoints ?? MONTHLY_STARTING_POINTS;
  const maxIncentiveEgp = args.maxIncentiveEgp ?? MONTHLY_MAX_INCENTIVE_EGP;
  const approvedDeductionPoints = Math.max(0, args.approvedDeductionPoints ?? 0);
  const approvedExceptionalRewardPoints = Math.max(0, args.approvedExceptionalRewardPoints ?? 0);
  const pendingDeductionPoints = Math.max(0, args.pendingDeductionPoints ?? 0);
  const pendingRewardPoints = Math.max(0, args.pendingRewardPoints ?? 0);
  const finalPoints = Math.max(
    0,
    approvedExceptionalRewardPoints - approvedDeductionPoints
  );
  const paidPoints = Math.min(finalPoints, targetPoints);
  const monthlyIncentiveValue = Math.min(
    maxIncentiveEgp,
    (paidPoints / targetPoints) * maxIncentiveEgp
  );
  const distinctionPointsAbove500 = Math.max(0, finalPoints - targetPoints);
  return {
    startingPoints: targetPoints,
    approvedDeductionPoints,
    approvedExceptionalRewardPoints,
    pendingDeductionPoints,
    pendingRewardPoints,
    finalPoints,
    monthlyIncentiveValue,
    distinctionPointsAbove500,
    progressPercent: Math.min(100, (finalPoints / targetPoints) * 100),
  };
}

/**
 * يحوّل بروفايل تعويض الموظف (employee_compensation_profiles) لمدخلات جاهزة
 * لـ calculateMonthlyIncentive — targetPoints = monthly_incentive_base / point_value.
 * لو الموظف مالوش بروفايل، بيرجع القيم الافتراضية العامة (500 نقطة / 1500 جنيه).
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
  return { targetPoints: Math.round(base / pointValue), maxIncentiveEgp: base };
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

export function calculateRepeatDeduction(args: {
  basePoints: number;
  previousOccurrences: number;
  severe?: boolean;
}) {
  const occurrenceNumber = Math.max(1, args.previousOccurrences + 1);
  const multiplier = args.severe ? 1 : Math.min(4, occurrenceNumber);
  return {
    occurrenceNumber,
    multiplier,
    finalPoints: Math.abs(args.basePoints) * multiplier,
    requiresManagerReview: Boolean(args.severe && occurrenceNumber > 1) || occurrenceNumber >= 4,
  };
}

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
  const penalizedPermissionNumber = count - FREE_PERMISSIONS_PER_CYCLE;
  const deductionPoints =
    penalizedPermissionNumber === 1 ? 10 : penalizedPermissionNumber === 2 ? 20 : 30;
  return {
    freeAllowanceUsed: FREE_PERMISSIONS_PER_CYCLE,
    remainingFreePermissions: 0,
    penalizedPermissionNumber,
    deductionPoints,
    requiresManagerReview: penalizedPermissionNumber >= 3,
  };
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
