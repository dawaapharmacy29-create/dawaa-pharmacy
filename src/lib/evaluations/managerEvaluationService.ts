import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import type { EvaluationType, WeeklyAutoMetrics } from '@/lib/evaluations/managerEvaluationCriteria';
import { MANAGER_DAILY_TASKS, getManagerTaskCadence } from '@/lib/evaluations/managerDailyTasks';
import {
  readWeeklyChecklistMetrics,
  readWeeklyEvaluationMetrics,
} from '@/lib/evaluations/evaluationMetricsGateway';

export type ManagerEvaluationSubject = {
  id: string;
  name: string;
  role: string;
  branch: string;
};

export function weekBoundsOf(date: Date): { start: string; end: string } {
  const day = date.getDay();
  const diffToSaturday = (day + 1) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - diffToSaturday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const dayOfMonth = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${dayOfMonth}`;
  };
  return { start: fmt(start), end: fmt(end) };
}

export function previousWeekOf(weekStart: string): { start: string; end: string } {
  const start = new Date(weekStart);
  start.setDate(start.getDate() - 7);
  return weekBoundsOf(start);
}

export async function fetchManagerEvaluationSubjects(
  actorId: string,
  evaluationType: EvaluationType
): Promise<ManagerEvaluationSubject[]> {
  const { data, error } = await supabase.rpc('list_weekly_manager_evaluation_subjects_v1', {
    p_actor_id: actorId,
    p_evaluation_type: evaluationType,
  });
  if (error) throw new Error(error.message);
  return ((data || []) as ManagerEvaluationSubject[]).map((row) => ({
    id: String(row.id),
    name: String(row.name || ''),
    role: String(row.role || ''),
    branch: String(row.branch || ''),
  }));
}

export async function fetchWeeklyAutoMetrics(
  evaluationType: EvaluationType,
  branch: string | null,
  weekStart: string,
  weekEnd: string
): Promise<WeeklyAutoMetrics> {
  const result = await readWeeklyEvaluationMetrics({ evaluationType, branch, weekStart, weekEnd });
  return result.data;
}

export async function fetchWeeklyAutoMetricsFast(
  actorId: string,
  evaluationType: EvaluationType,
  branch: string | null,
  weekStart: string,
  weekEnd: string
): Promise<WeeklyAutoMetrics> {
  // Monthly branch/customer-service evaluations aggregate a full 26→25 cycle across
  // several large operational sources. Rebuilding that snapshot every five minutes
  // can overlap current + previous cycle requests and exceed Postgres statement_timeout.
  // Keep those cycle snapshots for one day; the weekly branches-manager path remains
  // much fresher because it covers a shorter period and is cheaper to rebuild.
  const maxAgeSeconds = evaluationType === 'branches_manager' ? 30 * 60 : 24 * 60 * 60;

  const { data, error } = await supabase.rpc('get_weekly_manager_metrics_fast_v1', {
    p_actor_id: actorId,
    p_evaluation_type: evaluationType,
    p_branch: branch,
    p_week_start: weekStart,
    p_week_end: weekEnd,
    p_max_age_seconds: maxAgeSeconds,
  });
  if (error) throw new Error(error.message);
  return (data || {}) as WeeklyAutoMetrics;
}

export type ManagerCycleSalesTargetSummary = {
  sales_total: number;
  sales_invoices_count: number;
  sales_target_amount: number;
  sales_target_achievement_rate: number | null;
};

export async function fetchManagerCycleSalesTargetSummary(
  evaluationType: EvaluationType,
  branch: string | null,
  cycleStart: string,
  asOf: string
): Promise<ManagerCycleSalesTargetSummary> {
  const { data, error } = await supabase.rpc('calculate_manager_cycle_sales_target_v1', {
    p_evaluation_type: evaluationType,
    p_branch: branch,
    p_cycle_start: cycleStart,
    p_as_of: asOf,
  });
  if (error) throw new Error(error.message);
  const result = (data || {}) as Partial<ManagerCycleSalesTargetSummary>;
  return {
    sales_total: Number(result.sales_total || 0),
    sales_invoices_count: Number(result.sales_invoices_count || 0),
    sales_target_amount: Number(result.sales_target_amount || 0),
    sales_target_achievement_rate:
      result.sales_target_achievement_rate === null || result.sales_target_achievement_rate === undefined
        ? null
        : Number(result.sales_target_achievement_rate),
  };
}

export async function fetchWeeklyChecklistCompletion(
  staffId: string,
  weekStart: string,
  weekEnd: string,
  branch: string | null = null
): Promise<Record<string, number>> {
  const allManagerTaskKeys = [...new Set(Object.values(MANAGER_DAILY_TASKS).flat().map((task) => task.key))];
  const cadencePayload = Object.fromEntries(
    allManagerTaskKeys.map((key) => [key, getManagerTaskCadence(key)])
  );

  const result = await readWeeklyChecklistMetrics({
    staffId,
    weekStart,
    weekEnd,
    branch,
    taskCadences: cadencePayload,
  });
  return result.data;
}

export type ManagerWeeklyEvaluation = {
  id?: string;
  evaluation_type: EvaluationType;
  subject_staff_id: string;
  subject_name?: string | null;
  branch?: string | null;
  evaluator_staff_id?: string | null;
  evaluator_name?: string | null;
  week_start: string;
  week_end: string;
  auto_metrics: WeeklyAutoMetrics & Record<string, unknown>;
  manual_scores: Record<string, number>;
  manual_note?: string | null;
  total_score: number;
  status: 'draft' | 'submitted';
  submitted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ManagerEvaluationHistoryRecord = ManagerWeeklyEvaluation & {
  id: string;
};

export async function saveWeeklyEvaluation(evaluation: ManagerWeeklyEvaluation): Promise<ManagerEvaluationHistoryRecord | null> {
  const { data, error } = await supabase
    .from(TABLES.managerWeeklyEvaluations)
    .upsert(
      {
        ...evaluation,
        submitted_at: evaluation.status === 'submitted' ? new Date().toISOString() : null,
      },
      { onConflict: 'evaluation_type,subject_staff_id,week_start,branch' }
    )
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data || null) as ManagerEvaluationHistoryRecord | null;
}

export async function fetchEvaluationHistory(
  evaluationType: EvaluationType,
  subjectStaffId: string,
  branch: string | null = null
): Promise<ManagerEvaluationHistoryRecord[]> {
  let query = supabase
    .from(TABLES.managerWeeklyEvaluations)
    .select('id,evaluation_type,subject_staff_id,subject_name,branch,evaluator_staff_id,evaluator_name,week_start,week_end,auto_metrics,manual_scores,manual_note,total_score,status,submitted_at,created_at,updated_at')
    .eq('evaluation_type', evaluationType)
    .eq('subject_staff_id', subjectStaffId);
  if (branch) query = query.eq('branch', branch);
  const { data, error } = await query.order('week_start', { ascending: false }).limit(24);
  if (error) throw new Error(error.message);
  return (data || []) as ManagerEvaluationHistoryRecord[];
}
