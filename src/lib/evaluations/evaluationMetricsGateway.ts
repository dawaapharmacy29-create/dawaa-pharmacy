import { supabase } from '@/lib/supabase';
import type { EvaluationType, WeeklyAutoMetrics } from '@/lib/evaluations/managerEvaluationCriteria';

export type EvaluationMetricsSource =
  | 'calculate_weekly_manager_metrics_v5'
  | 'calculate_weekly_manager_metrics_v4'
  | 'calculate_weekly_manager_metrics_v3'
  | 'calculate_weekly_manager_metrics_v2'
  | 'calculate_weekly_manager_metrics';

export type ChecklistMetricsSource =
  | 'calculate_weekly_checklist_completion_v4'
  | 'calculate_weekly_checklist_completion_v3'
  | 'calculate_weekly_checklist_completion_v2'
  | 'calculate_weekly_checklist_completion';

export type CompatibilityRead<T, TSource extends string> = {
  data: T;
  source: TSource;
  fallbackUsed: boolean;
};

type RpcFailure = { source: string; message: string };

function warnFallback(domain: string, source: string, failures: RpcFailure[]) {
  if (!failures.length) return;
  console.warn(`[${domain}] compatibility fallback used: ${source}`, {
    failedSources: failures,
  });
}

/**
 * Compatibility boundary for manager evaluation metrics.
 *
 * Consumers must not reproduce the historical v5 -> v4 -> v3 -> v2 -> legacy chain.
 * Once parity is proven, older calls can be retired here without touching evaluation pages/services.
 */
export async function readWeeklyEvaluationMetrics(args: {
  evaluationType: EvaluationType;
  branch: string | null;
  weekStart: string;
  weekEnd: string;
}): Promise<CompatibilityRead<WeeklyAutoMetrics, EvaluationMetricsSource>> {
  const rpcArgs = {
    p_evaluation_type: args.evaluationType,
    p_branch: args.branch,
    p_week_start: args.weekStart,
    p_week_end: args.weekEnd,
  };
  const failures: RpcFailure[] = [];
  const sources: EvaluationMetricsSource[] = [
    'calculate_weekly_manager_metrics_v5',
    'calculate_weekly_manager_metrics_v4',
    'calculate_weekly_manager_metrics_v3',
    'calculate_weekly_manager_metrics_v2',
    'calculate_weekly_manager_metrics',
  ];

  for (const source of sources) {
    const { data, error } = await supabase.rpc(source, rpcArgs);
    if (!error) {
      warnFallback('evaluation-metrics', source, failures);
      return {
        data: (data || {}) as WeeklyAutoMetrics,
        source,
        fallbackUsed: failures.length > 0,
      };
    }
    failures.push({ source, message: error.message });
  }

  throw new Error(
    failures.map((failure) => `${failure.source}: ${failure.message}`).join(' | ') ||
      'تعذر تحميل مؤشرات التقييم الأسبوعية.'
  );
}

/**
 * Compatibility boundary for manager checklist completion metrics.
 * Historical task aliases and older RPC signatures stay here during migration.
 */
export async function readWeeklyChecklistMetrics(args: {
  staffId: string;
  weekStart: string;
  weekEnd: string;
  branch: string | null;
  taskCadences: Record<string, unknown>;
}): Promise<CompatibilityRead<Record<string, number>, ChecklistMetricsSource>> {
  const failures: RpcFailure[] = [];

  const v4 = await supabase.rpc('calculate_weekly_checklist_completion_v4', {
    p_staff_id: args.staffId,
    p_week_start: args.weekStart,
    p_week_end: args.weekEnd,
    p_task_cadences: args.taskCadences,
    p_branch: args.branch,
  });
  if (!v4.error) {
    return {
      data: (v4.data as Record<string, number>) || {},
      source: 'calculate_weekly_checklist_completion_v4',
      fallbackUsed: false,
    };
  }
  failures.push({ source: 'calculate_weekly_checklist_completion_v4', message: v4.error.message });

  const v3 = await supabase.rpc('calculate_weekly_checklist_completion_v3', {
    p_staff_id: args.staffId,
    p_week_start: args.weekStart,
    p_week_end: args.weekEnd,
    p_task_cadences: args.taskCadences,
  });
  if (!v3.error) {
    warnFallback('checklist-metrics', 'calculate_weekly_checklist_completion_v3', failures);
    return {
      data: (v3.data as Record<string, number>) || {},
      source: 'calculate_weekly_checklist_completion_v3',
      fallbackUsed: true,
    };
  }
  failures.push({ source: 'calculate_weekly_checklist_completion_v3', message: v3.error.message });

  const v2 = await supabase.rpc('calculate_weekly_checklist_completion_v2', {
    p_staff_id: args.staffId,
    p_week_start: args.weekStart,
    p_week_end: args.weekEnd,
    p_task_cadences: args.taskCadences,
  });
  if (!v2.error) {
    warnFallback('checklist-metrics', 'calculate_weekly_checklist_completion_v2', failures);
    return {
      data: (v2.data as Record<string, number>) || {},
      source: 'calculate_weekly_checklist_completion_v2',
      fallbackUsed: true,
    };
  }
  failures.push({ source: 'calculate_weekly_checklist_completion_v2', message: v2.error.message });

  const legacy = await supabase.rpc('calculate_weekly_checklist_completion', {
    p_staff_id: args.staffId,
    p_week_start: args.weekStart,
    p_week_end: args.weekEnd,
  });
  if (!legacy.error) {
    warnFallback('checklist-metrics', 'calculate_weekly_checklist_completion', failures);
    return {
      data: (legacy.data as Record<string, number>) || {},
      source: 'calculate_weekly_checklist_completion',
      fallbackUsed: true,
    };
  }
  failures.push({ source: 'calculate_weekly_checklist_completion', message: legacy.error.message });

  throw new Error(
    failures.map((failure) => `${failure.source}: ${failure.message}`).join(' | ') ||
      'تعذر تحميل إنجاز قائمة المهام الأسبوعية.'
  );
}
