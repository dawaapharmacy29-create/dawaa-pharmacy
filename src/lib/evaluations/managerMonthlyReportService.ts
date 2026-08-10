import { supabase } from '@/lib/supabase';
import { formatCycleDate, getCurrentCycle, getCycleForDate, type PharmacyCycle } from '@/lib/pharmacy-cycle';
import {
  EVALUATION_MAX_MONTHLY_INCENTIVE_EGP,
  type EvaluationType,
  type WeeklyAutoMetrics,
} from '@/lib/evaluations/managerEvaluationCriteria';
import { calculateTieredIncentiveValue } from '@/lib/evaluations/incentiveTiers';
import { fetchManagerLiveIncentiveSnapshot } from '@/lib/evaluations/managerLiveIncentiveService';
import { fetchWeeklyAutoMetrics } from '@/lib/evaluations/managerEvaluationService';
import { calculateTargetAchievementBonus } from '@/lib/incentives/targetAchievementBonus';
import { evaluatePerformanceIncentiveEligibility } from '@/lib/evaluations/incentiveEligibility';

export type ManagerMonthlyReportRow = {
  cycleStart: string;
  cycleEnd: string;
  averageScore: number | null;
  approvedWeeks: number;
  tierLabel: string;
  payoutPercent: number;
  estimatedIncentiveEgp: number;
  targetAmount: number;
  targetAchievementPercent: number | null;
  targetBonusEgp: number | null;
  targetBonusTierLabel: string;
  totalEstimatedIncentiveEgp: number;
  settledIncentiveEgp: number | null;
  settlementStatus: 'estimated' | 'settled' | 'no_data';
  dataCoveragePercent: number | null;
  salesTotal: number;
  followupsTotal: number;
  followupsClosed: number;
  customerRequestsTotal: number;
  customerRequestsClosed: number;
  recoveredSalesEgp: number;
  conversationReviewsCount: number;
  conversationReviewsAverage: number | null;
  scoreChangeFromPrevious: number | null;
  isCurrentCycle: boolean;
  operationalDataAvailable: boolean;
  payoutEligible: boolean;
  eligibilityReasons: string[];
};

export type ManagerMonthlyReport = {
  rows: ManagerMonthlyReportRow[];
  averageScoreAcrossCycles: number | null;
  totalSettledIncentiveEgp: number;
  bestCycle: ManagerMonthlyReportRow | null;
};

type EvaluationRow = {
  week_start: string;
  week_end: string;
  total_score: number;
  status: string;
  auto_metrics: WeeklyAutoMetrics | null;
};

type SettlementRow = {
  amount: number | null;
  month_cycle: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
};

function previousCycle(cycle: PharmacyCycle): PharmacyCycle {
  const dayBefore = new Date(cycle.start);
  dayBefore.setDate(dayBefore.getDate() - 1);
  return getCycleForDate(dayBefore);
}

function lastCycles(count: number): PharmacyCycle[] {
  const cycles: PharmacyCycle[] = [];
  let cycle = getCurrentCycle();
  for (let index = 0; index < count; index += 1) {
    cycles.push(cycle);
    cycle = previousCycle(cycle);
  }
  return cycles;
}

function cycleContainsEvaluation(cycle: PharmacyCycle, evaluation: EvaluationRow): boolean {
  const closingDate = String(evaluation.week_end || evaluation.week_start || '').slice(0, 10);
  return closingDate >= formatCycleDate(cycle.start) && closingDate <= formatCycleDate(cycle.end);
}

function coverageOf(evaluations: EvaluationRow[]): number | null {
  const values = evaluations.flatMap((evaluation) =>
    Object.values(evaluation.auto_metrics?.data_coverage || {})
  );
  if (!values.length) return null;
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}

function metricCoverage(metrics: WeeklyAutoMetrics | null): number | null {
  const values = Object.values(metrics?.data_coverage || {});
  return values.length ? Math.round((values.filter(Boolean).length / values.length) * 100) : null;
}

function sumMetric(evaluations: EvaluationRow[], key: keyof WeeklyAutoMetrics): number {
  return evaluations.reduce((sum, evaluation) => sum + Number(evaluation.auto_metrics?.[key] || 0), 0);
}

function reviewsAverage(evaluations: EvaluationRow[]): number | null {
  const weighted = evaluations.reduce(
    (acc, evaluation) => {
      const count = Number(evaluation.auto_metrics?.conversation_reviews_count || 0);
      const average = Number(evaluation.auto_metrics?.conversation_reviews_avg_score || 0);
      return { total: acc.total + average * count, count: acc.count + count };
    },
    { total: 0, count: 0 }
  );
  return weighted.count ? Math.round((weighted.total / weighted.count) * 10) / 10 : null;
}

function matchingSettlement(settlements: SettlementRow[], cycleStart: string): SettlementRow | undefined {
  return settlements.find((settlement) => {
    const metadataStart = String(settlement.metadata?.cycle_start || '').slice(0, 10);
    return metadataStart === cycleStart || settlement.month_cycle === cycleStart.slice(0, 7);
  });
}

export async function fetchManagerMonthlyReport(
  evaluationType: EvaluationType,
  subjectStaffId: string,
  branch: string | null,
  cycleCount: 3 | 6 | 12
): Promise<ManagerMonthlyReport> {
  const cycles = lastCycles(cycleCount);
  const oldestStart = formatCycleDate(cycles[cycles.length - 1].start);
  const maxIncentive = EVALUATION_MAX_MONTHLY_INCENTIVE_EGP[evaluationType] || 0;

  const [evaluationResult, settlementResult, liveSnapshot, cycleMetrics] = await Promise.all([
    supabase
      .from('manager_weekly_evaluations')
      .select('week_start,week_end,total_score,status,auto_metrics')
      .eq('evaluation_type', evaluationType)
      .eq('subject_staff_id', subjectStaffId)
      .eq('status', 'submitted')
      .gte('week_end', oldestStart)
      .order('week_end', { ascending: false }),
    supabase
      .from('employee_transactions')
      .select('amount,month_cycle,status,metadata')
      .eq('staff_id', subjectStaffId)
      .eq('source', 'manager_evaluation_settlement')
      .order('created_at', { ascending: false }),
    fetchManagerLiveIncentiveSnapshot(evaluationType, subjectStaffId, branch).catch(() => null),
    Promise.all(cycles.map((cycle, index) => fetchWeeklyAutoMetrics(
      evaluationType,
      branch,
      formatCycleDate(cycle.start),
      index === 0 ? formatCycleDate(new Date()) : formatCycleDate(cycle.end)
    ).catch(() => null))),
  ]);

  if (evaluationResult.error) throw new Error(evaluationResult.error.message);
  if (settlementResult.error) throw new Error(settlementResult.error.message);

  const evaluations = (evaluationResult.data || []) as EvaluationRow[];
  const settlements = (settlementResult.data || []) as SettlementRow[];

  const rows = cycles.map((cycle, index): ManagerMonthlyReportRow => {
    const cycleStart = formatCycleDate(cycle.start);
    const cycleEnd = formatCycleDate(cycle.end);
    const cycleEvaluations = evaluations.filter((evaluation) => cycleContainsEvaluation(cycle, evaluation));
    const historicalAverage = cycleEvaluations.length
      ? cycleEvaluations.reduce((sum, evaluation) => sum + Number(evaluation.total_score || 0), 0) / cycleEvaluations.length
      : null;
    const isCurrentCycle = index === 0;
    const averageScore = isCurrentCycle && liveSnapshot
      ? liveSnapshot.cycleAverageScore
      : historicalAverage === null
        ? null
        : Math.round(historicalAverage * 10) / 10;
    const incentive = averageScore === null
      ? { tier: { label: 'لا توجد بيانات' }, payoutPercent: 0, incentiveValue: 0 }
      : calculateTieredIncentiveValue(averageScore, maxIncentive);
    const settlement = matchingSettlement(settlements, cycleStart);
    const operationalMetrics = cycleMetrics[index];
    const operationalDataAvailable = Boolean(
      operationalMetrics && Object.values(operationalMetrics.data_coverage || {}).some(Boolean)
    );
    const salesTotal = operationalMetrics ? Number(operationalMetrics.sales_total || 0) : sumMetric(cycleEvaluations, 'sales_total');
    const targetAmount = operationalMetrics ? Number(operationalMetrics.sales_target_amount || 0) : sumMetric(cycleEvaluations, 'sales_target_amount');
    const targetBonus = calculateTargetAchievementBonus(
      salesTotal,
      targetAmount,
      evaluationType === 'customer_service' ? 'not_eligible' : 'manager'
    );
    const dataCoveragePercent = metricCoverage(operationalMetrics)
      ?? (isCurrentCycle ? liveSnapshot?.dataCoveragePercent ?? null : coverageOf(cycleEvaluations));
    const eligibility = evaluatePerformanceIncentiveEligibility(cycleEvaluations.length, dataCoveragePercent);

    return {
      cycleStart,
      cycleEnd,
      averageScore,
      approvedWeeks: isCurrentCycle && liveSnapshot
        ? liveSnapshot.approvedWeeksInCycle
        : cycleEvaluations.length,
      tierLabel: incentive.tier.label,
      payoutPercent: incentive.payoutPercent,
      estimatedIncentiveEgp: incentive.incentiveValue,
      targetAmount,
      targetAchievementPercent: targetBonus.achievementPercent,
      targetBonusEgp: targetBonus.amountEgp,
      targetBonusTierLabel: targetBonus.tierLabel,
      totalEstimatedIncentiveEgp: incentive.incentiveValue + Number(targetBonus.amountEgp || 0),
      settledIncentiveEgp: settlement ? Number(settlement.amount || 0) : null,
      settlementStatus: settlement ? 'settled' : averageScore === null ? 'no_data' : 'estimated',
      dataCoveragePercent,
      salesTotal,
      followupsTotal: operationalMetrics ? Number(operationalMetrics.followups_total || 0) : sumMetric(cycleEvaluations, 'followups_total'),
      followupsClosed: operationalMetrics ? Number(operationalMetrics.followups_closed || 0) : sumMetric(cycleEvaluations, 'followups_closed'),
      customerRequestsTotal: operationalMetrics ? Number(operationalMetrics.customer_requests_total || 0) : sumMetric(cycleEvaluations, 'customer_requests_total'),
      customerRequestsClosed: operationalMetrics ? Number(operationalMetrics.customer_requests_closed || 0) : sumMetric(cycleEvaluations, 'customer_requests_closed'),
      recoveredSalesEgp: operationalMetrics ? Number(operationalMetrics.followups_purchase_amount || 0) : sumMetric(cycleEvaluations, 'followups_purchase_amount'),
      conversationReviewsCount: operationalMetrics ? Number(operationalMetrics.conversation_reviews_count || 0) : sumMetric(cycleEvaluations, 'conversation_reviews_count'),
      conversationReviewsAverage: operationalMetrics?.conversation_reviews_avg_score ?? reviewsAverage(cycleEvaluations),
      scoreChangeFromPrevious: null,
      isCurrentCycle,
      operationalDataAvailable,
      payoutEligible: eligibility.eligible,
      eligibilityReasons: eligibility.reasons,
    };
  });

  rows.forEach((row, index) => {
    const previous = rows[index + 1];
    row.scoreChangeFromPrevious = row.averageScore !== null && previous?.averageScore !== null && previous?.averageScore !== undefined
      ? Math.round((row.averageScore - previous.averageScore) * 10) / 10
      : null;
  });

  const scoredRows = rows.filter((row) => row.averageScore !== null);
  return {
    rows,
    averageScoreAcrossCycles: scoredRows.length
      ? Math.round((scoredRows.reduce((sum, row) => sum + Number(row.averageScore), 0) / scoredRows.length) * 10) / 10
      : null,
    totalSettledIncentiveEgp: rows.reduce((sum, row) => sum + Number(row.settledIncentiveEgp || 0), 0),
    bestCycle: scoredRows.reduce<ManagerMonthlyReportRow | null>(
      (best, row) => !best || Number(row.averageScore) > Number(best.averageScore) ? row : best,
      null
    ),
  };
}
