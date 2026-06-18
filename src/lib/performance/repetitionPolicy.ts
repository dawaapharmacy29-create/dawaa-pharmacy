import { calculateRepeatDeduction } from '@/lib/performance/performanceRulesEngine';

export function getRepeatedErrorImpact(args: {
  basePoints: number;
  previousOccurrences: number;
  severe?: boolean;
}) {
  return calculateRepeatDeduction(args);
}
