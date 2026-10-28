import { LAB_AXES_BY_VERSION, LAB_CURRENT_VERSION, LAB_THRESHOLDS, type LabAxisKey, type LabFamily, type LabVersion } from './catalog';

// Pure scoring of the Evaluation Lab. No I/O: every input is an explicit, already-loaded value.

export type AxisStatus = 'measured' | 'not_measurable';

export interface AxisResult {
  key: LabAxisKey;
  label: string;
  weight: number;
  status: AxisStatus;
  /** Raw value in its own unit (EGP/day, %, count/day…), null when not measurable. */
  value: number | null;
  /** 0..100, null when not measurable. Never an invented 0 or 5. */
  score: number | null;
  /** What was counted, for the evidence line. */
  basis: string;
  /** Why the axis cannot be measured. */
  reason?: string;
}

export type Readiness = 'ready' | 'partial' | 'insufficient';

/** A gate that removes points from the weighted total (e.g. coding below its floor). */
export interface LabAdjustment {
  label: string;
  points: number;
  reason: string;
}

export interface LabScore {
  total: number | null;
  /** Weighted total before adjustments. */
  baseTotal: number | null;
  adjustments: LabAdjustment[];
  coverage: number;
  readiness: Readiness;
  axes: AxisResult[];
}

export const clamp100 = (value: number) => Math.max(0, Math.min(100, value));

/** Mid-rank percentile of `value` among `peers` (value included), 0..100; null below the peer minimum. */
export function percentileAmong(value: number, peers: readonly number[]): number | null {
  if (peers.length < LAB_THRESHOLDS.minPeersForPercentile) return null;
  const below = peers.filter((peer) => peer < value).length;
  const equal = peers.filter((peer) => peer === value).length;
  if (peers.length === 1) return 50;
  return clamp100(((below + Math.max(0, equal - 1) / 2) / (peers.length - 1)) * 100);
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Volume-aware mean: n reviews averaging `mean` pulled toward the population mean by k pseudo-reviews. */
export function shrunkMean(mean: number, n: number, populationMean: number, k = LAB_THRESHOLDS.reviewShrinkK): number {
  return (n * mean + k * populationMean) / (n + k);
}

/** Rates that saturate near 100%: 50 at the peer median, ±10 points per percentage point. */
export function deviationScore(rate: number, peerMedian: number): number {
  return clamp100(50 + (rate - peerMedian) * 1000);
}

/** Discipline: mean per-day punctuality credit (1, 0.5 or 0) over resolved scheduled days. */
export function disciplineScore(meanDayCredit: number): number {
  return clamp100(100 * meanDayCredit);
}

/** Absolute band: value at `floor` scores 0, at `ceiling` 100 (saturated quality rates). */
export function bandScore(value: number, floor: number, ceiling: number): number {
  return clamp100(((value - floor) / (ceiling - floor)) * 100);
}

/** Request closure: closed share minus a bounded delay penalty. */
export function closureScore(closedShare: number, medianHoursToClose: number | null): number {
  const delay = medianHoursToClose === null ? 0 : Math.min(30, medianHoursToClose / 4);
  return clamp100(100 * closedShare - delay);
}

/** Coding gate: 0 at or above the floor, otherwise minus N points per percentage point, capped. */
export function codingGatePenalty(rate: number): number {
  const gap = (LAB_THRESHOLDS.codingGateFloor - rate) * 100;
  if (gap <= 0) return 0;
  return -Math.min(LAB_THRESHOLDS.codingGateMaxPenalty, Math.round(gap * LAB_THRESHOLDS.codingGatePointsPerPercent * 10) / 10);
}

/** Target achievement (fraction), capped at 120% → 100. */
export function targetScore(achievement: number): number {
  return clamp100((Math.min(1.2, Math.max(0, achievement)) / 1.2) * 100);
}

export function measured(key: LabAxisKey, value: number, score: number, basis: string): Omit<AxisResult, 'label' | 'weight'> {
  return { key, status: 'measured', value, score: Math.round(clamp100(score) * 10) / 10, basis };
}

export function notMeasurable(key: LabAxisKey, reason: string, basis = ''): Omit<AxisResult, 'label' | 'weight'> {
  return { key, status: 'not_measurable', value: null, score: null, basis, reason };
}

/** Weighted total over measured axes only; coverage and readiness from the weights. */
export function aggregate(
  family: LabFamily,
  results: ReadonlyArray<Omit<AxisResult, 'label' | 'weight'>>,
  options: { version?: LabVersion; adjustments?: LabAdjustment[] } = {},
): LabScore {
  const byKey = new Map(results.map((result) => [result.key, result]));
  const adjustments = (options.adjustments || []).filter((adjustment) => adjustment.points !== 0);
  const axes: AxisResult[] = LAB_AXES_BY_VERSION[options.version || LAB_CURRENT_VERSION][family].map((definition) => {
    const result = byKey.get(definition.key) ?? notMeasurable(definition.key, 'لا يوجد مصدر بيانات لهذا المحور');
    return { ...result, label: definition.label, weight: definition.weight };
  });
  const totalWeight = axes.reduce((sum, axis) => sum + axis.weight, 0);
  const measuredAxes = axes.filter((axis) => axis.status === 'measured' && axis.weight > 0);
  const measuredWeight = measuredAxes.reduce((sum, axis) => sum + axis.weight, 0);
  const coverage = totalWeight ? measuredWeight / totalWeight : 0;
  const baseTotal = measuredWeight
    ? Math.round((measuredAxes.reduce((sum, axis) => sum + axis.weight * (axis.score as number), 0) / measuredWeight) * 10) / 10
    : null;
  const total = baseTotal === null
    ? null
    : Math.round(clamp100(baseTotal + adjustments.reduce((sum, adjustment) => sum + adjustment.points, 0)) * 10) / 10;
  const readiness: Readiness =
    coverage >= LAB_THRESHOLDS.readyCoverage ? 'ready' : coverage >= LAB_THRESHOLDS.partialCoverage ? 'partial' : 'insufficient';
  return { total, baseTotal, adjustments, coverage, readiness, axes };
}
