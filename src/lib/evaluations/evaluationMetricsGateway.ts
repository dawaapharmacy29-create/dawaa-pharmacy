import { supabase } from '@/lib/supabase';
import type { EvaluationType, WeeklyAutoMetrics } from '@/lib/evaluations/managerEvaluationCriteria';

/**
 * Canonical weekly evaluation read contracts. Both exist in Production with these exact
 * signatures and are the latest committed generations; older generations are not attempted.
 */
export const WEEKLY_EVALUATION_METRICS_RPC = 'calculate_weekly_manager_metrics_v5' as const;
export const WEEKLY_CHECKLIST_METRICS_RPC = 'calculate_weekly_checklist_completion_v4' as const;

export type EvaluationMetricsSource = typeof WEEKLY_EVALUATION_METRICS_RPC;
export type ChecklistMetricsSource = typeof WEEKLY_CHECKLIST_METRICS_RPC;

export type CanonicalRead<T, TSource extends string> = {
  data: T;
  source: TSource;
};

/**
 * Single-generation boundary for manager evaluation metrics. A failure (including a statement
 * timeout) surfaces as an error; it is never retried against older RPC generations, which used to
 * multiply the load and latency of one failing read by five.
 */
export async function readWeeklyEvaluationMetrics(args: {
  evaluationType: EvaluationType;
  branch: string | null;
  weekStart: string;
  weekEnd: string;
}): Promise<CanonicalRead<WeeklyAutoMetrics, EvaluationMetricsSource>> {
  const { data, error } = await supabase.rpc(WEEKLY_EVALUATION_METRICS_RPC, {
    p_evaluation_type: args.evaluationType,
    p_branch: args.branch,
    p_week_start: args.weekStart,
    p_week_end: args.weekEnd,
  });
  if (error) throw new Error(`${WEEKLY_EVALUATION_METRICS_RPC}: ${error.message}`);
  return { data: (data || {}) as WeeklyAutoMetrics, source: WEEKLY_EVALUATION_METRICS_RPC };
}

/** Single-generation boundary for manager checklist completion metrics. */
export async function readWeeklyChecklistMetrics(args: {
  staffId: string;
  weekStart: string;
  weekEnd: string;
  branch: string | null;
  taskCadences: Record<string, unknown>;
}): Promise<CanonicalRead<Record<string, number>, ChecklistMetricsSource>> {
  const { data, error } = await supabase.rpc(WEEKLY_CHECKLIST_METRICS_RPC, {
    p_staff_id: args.staffId,
    p_week_start: args.weekStart,
    p_week_end: args.weekEnd,
    p_task_cadences: args.taskCadences,
    p_branch: args.branch,
  });
  if (error) throw new Error(`${WEEKLY_CHECKLIST_METRICS_RPC}: ${error.message}`);
  return { data: (data as Record<string, number>) || {}, source: WEEKLY_CHECKLIST_METRICS_RPC };
}
