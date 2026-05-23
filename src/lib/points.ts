import { getEvaluationCycle } from "@/lib/evaluationCycle";
import { INCENTIVE_CONFIG } from "@/lib/incentiveConfig";

export const STARTING_POINTS = INCENTIVE_CONFIG.defaultTargetPoints;
export const POINT_VALUE_EGP = INCENTIVE_CONFIG.pointValueEgp;
export const MAX_BASE_INCENTIVE = INCENTIVE_CONFIG.maxBaseIncentiveEgp;
export const DEDUCTION_RATE = INCENTIVE_CONFIG.deductionRate;
export const BONUS_RATE = INCENTIVE_CONFIG.rewardRate;

export function calculateFinalPoints(start = STARTING_POINTS, additions = 0, deductions = 0) {
  return Math.max(0, Math.min(STARTING_POINTS, start + additions - deductions));
}

export function calculateIncentive(finalPoints: number) {
  return Math.min(MAX_BASE_INCENTIVE, Math.max(0, finalPoints) * POINT_VALUE_EGP);
}

export function calculateSalaryDeduction(pointsDeducted: number) {
  return pointsDeducted * POINT_VALUE_EGP * DEDUCTION_RATE;
}

export function calculateSalaryBonus(pointsAdded: number) {
  return pointsAdded * POINT_VALUE_EGP * BONUS_RATE;
}

export function calculateNetSalary(baseSalary: number, points: number, maxPoints: number = STARTING_POINTS) {
  const pointsDiff = points - maxPoints;
  if (pointsDiff >= 0) {
    const bonus = calculateSalaryBonus(pointsDiff);
    return baseSalary + bonus;
  }
  const deduction = calculateSalaryDeduction(Math.abs(pointsDiff));
  return Math.max(0, baseSalary - deduction);
}

export function getPerformanceLevel(points: number) {
  if (points >= 480) return "ممتاز جدا";
  if (points >= 450) return "ممتاز";
  if (points >= 400) return "جيد";
  if (points >= 350) return "يحتاج متابعة";
  if (points >= 300) return "ضعيف";
  return "خطر ويحتاج مراجعة إدارية";
}

export interface SalaryCalculation {
  baseSalary: number;
  currentPoints: number;
  maxPoints: number;
  pointsDifference: number;
  incentive: number;
  deduction: number;
  netSalary: number;
  performanceLevel: string;
}

export function calculateSalaryDetails(baseSalary: number, currentPoints: number, maxPoints: number = STARTING_POINTS): SalaryCalculation {
  const pointsDifference = currentPoints - maxPoints;
  const incentive = pointsDifference > 0 ? calculateSalaryBonus(pointsDifference) : 0;
  const deduction = pointsDifference < 0 ? calculateSalaryDeduction(Math.abs(pointsDifference)) : 0;
  const netSalary = calculateNetSalary(baseSalary, currentPoints, maxPoints);
  const performanceLevel = getPerformanceLevel(currentPoints);

  return {
    baseSalary,
    currentPoints,
    maxPoints,
    pointsDifference,
    incentive,
    deduction,
    netSalary,
    performanceLevel,
  };
}

export { getEvaluationCycle };
