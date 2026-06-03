import { getCurrentCycle, type PharmacyCycle } from "@/lib/pharmacy-cycle";

export const MONTHLY_STARTING_POINTS = 500;
export const MONTHLY_MAX_INCENTIVE_EGP = 1500;
export const QUARTERLY_BASE_BONUS_EGP = 2000;
export const FREE_PERMISSIONS_PER_CYCLE = 3;

export type IncentiveImpactType =
  | "monthly_points_deduction"
  | "monthly_exceptional_reward"
  | "quarterly_money_deduction"
  | "quarterly_money_reward"
  | "warning_only"
  | "operational_task";

export type IncentiveSeverity = "low" | "medium" | "high" | "critical";
export type IncentiveRepeatPolicy = "linear_multiplier" | "manager_review_only" | "none";

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
}): MonthlyIncentiveCalculation {
  const startingPoints = args.startingPoints ?? MONTHLY_STARTING_POINTS;
  const approvedDeductionPoints = Math.max(0, args.approvedDeductionPoints ?? 0);
  const approvedExceptionalRewardPoints = Math.max(0, args.approvedExceptionalRewardPoints ?? 0);
  const pendingDeductionPoints = Math.max(0, args.pendingDeductionPoints ?? 0);
  const pendingRewardPoints = Math.max(0, args.pendingRewardPoints ?? 0);
  const finalPoints = Math.max(0, startingPoints - approvedDeductionPoints + approvedExceptionalRewardPoints);
  const paidPoints = Math.min(finalPoints, MONTHLY_STARTING_POINTS);
  const monthlyIncentiveValue = Math.min(MONTHLY_MAX_INCENTIVE_EGP, (paidPoints / MONTHLY_STARTING_POINTS) * MONTHLY_MAX_INCENTIVE_EGP);
  const distinctionPointsAbove500 = Math.max(0, finalPoints - MONTHLY_STARTING_POINTS);
  return {
    startingPoints,
    approvedDeductionPoints,
    approvedExceptionalRewardPoints,
    pendingDeductionPoints,
    pendingRewardPoints,
    finalPoints,
    monthlyIncentiveValue,
    distinctionPointsAbove500,
    progressPercent: Math.min(100, (finalPoints / MONTHLY_STARTING_POINTS) * 100),
  };
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
    quarterlyFinalValue: Math.max(0, quarterlyBaseValue - approvedQuarterlyDeductions + approvedQuarterlyRewards),
  };
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
  const deductionPoints = penalizedPermissionNumber === 1 ? 10 : penalizedPermissionNumber === 2 ? 20 : 30;
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
