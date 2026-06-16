import { MAX_BASE_INCENTIVE, STARTING_POINTS, calculateIncentive } from "@/lib/points";
import {
  pointRecordDelta,
  pointRecordStatus,
  type PointLedgerRecord,
} from "@/lib/pointsLedger";

type Row = Record<string, unknown>;

function moneyValue(row: Row) {
  const raw =
    row.cash_amount ??
    row.money_amount ??
    row.amount_egp ??
    row.reward_amount ??
    row.deduction_amount ??
    row.incentive_value ??
    0;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

function isCashReward(row: Row) {
  const text = String(
    row.type || row.transaction_type || row.kind || row.reward_type || row.value_type || "",
  ).toLowerCase();
  return (
    text.includes("cash_reward") ||
    text.includes("money_reward") ||
    text.includes("cash") ||
    String(row.reason || row.description || "").includes("مكافأة مالية")
  );
}

function isCashDeduction(row: Row) {
  const text = String(
    row.type || row.transaction_type || row.kind || row.deduction_type || row.value_type || "",
  ).toLowerCase();
  return (
    text.includes("cash_deduction") ||
    text.includes("money_deduction") ||
    text.includes("cash") ||
    String(row.reason || row.description || "").includes("خصم مالي")
  );
}

export function calculateMonthlyPayout(args: {
  pointRecords: PointLedgerRecord[];
  cashRecords?: Row[];
}) {
  const approvedPointRecords = args.pointRecords.filter((row) =>
    ["approved", "active", ""].includes(pointRecordStatus(row)),
  );
  const pointDeltas = approvedPointRecords.map(pointRecordDelta);
  const approvedExceptionalPointRewards = pointDeltas
    .filter((value) => value > 0)
    .reduce((sum, value) => sum + value, 0);
  const approvedPointDeductions = Math.abs(
    pointDeltas.filter((value) => value < 0).reduce((sum, value) => sum + value, 0),
  );
  const finalPoints =
    STARTING_POINTS - approvedPointDeductions + approvedExceptionalPointRewards;
  const cappedPoints = Math.min(Math.max(finalPoints, 0), STARTING_POINTS);
  const baseMonthlyIncentive = calculateIncentive(cappedPoints);

  const approvedCashRows = (args.cashRecords || []).filter((row) =>
    ["approved", "active", ""].includes(String(row.status || "approved").toLowerCase()),
  );
  const totalApprovedCashRewards = approvedCashRows
    .filter(isCashReward)
    .reduce((sum, row) => sum + moneyValue(row), 0);
  const totalApprovedCashDeductions = approvedCashRows
    .filter(isCashDeduction)
    .reduce((sum, row) => sum + moneyValue(row), 0);

  return {
    startingPoints: STARTING_POINTS,
    approvedPointDeductions,
    approvedExceptionalPointRewards,
    finalPoints,
    cappedPoints,
    baseMonthlyIncentive,
    maxBaseMonthlyIncentive: MAX_BASE_INCENTIVE,
    totalApprovedCashRewards,
    totalApprovedCashDeductions,
    finalPayout:
      baseMonthlyIncentive + totalApprovedCashRewards - totalApprovedCashDeductions,
  };
}

export function calculateQuarterlyPayout(args: {
  approvedQuarterlyCashRewards: number;
  approvedQuarterlyCashDeductions: number;
}) {
  const baseQuarterlyIncentive = 2000;
  return {
    baseQuarterlyIncentive,
    quarterlyFinalValue:
      baseQuarterlyIncentive +
      Math.max(0, args.approvedQuarterlyCashRewards || 0) -
      Math.max(0, args.approvedQuarterlyCashDeductions || 0),
  };
}
