import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import type { EvaluationType, WeeklyAutoMetrics } from '@/lib/evaluations/managerEvaluationCriteria';

export function weekBoundsOf(date: Date): { start: string; end: string } {
  // الأسبوع من السبت للجمعة (مطابق لطبيعة أسبوع العمل في مصر)
  const day = date.getDay(); // 0=Sunday ... 6=Saturday
  const diffToSaturday = (day + 1) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - diffToSaturday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export function previousWeekOf(weekStart: string): { start: string; end: string } {
  const start = new Date(weekStart);
  start.setDate(start.getDate() - 7);
  return weekBoundsOf(start);
}

export async function fetchWeeklyAutoMetrics(
  evaluationType: EvaluationType,
  branch: string | null,
  weekStart: string,
  weekEnd: string
): Promise<WeeklyAutoMetrics> {
  const { data, error } = await supabase.rpc('calculate_weekly_manager_metrics', {
    p_evaluation_type: evaluationType,
    p_branch: branch,
    p_week_start: weekStart,
    p_week_end: weekEnd,
  });
  if (error) throw new Error(error.message);
  return data as WeeklyAutoMetrics;
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
  auto_metrics: WeeklyAutoMetrics;
  manual_scores: Record<string, number>;
  manual_note?: string | null;
  total_score: number;
  status: 'draft' | 'submitted';
};

export async function saveWeeklyEvaluation(evaluation: ManagerWeeklyEvaluation) {
  const { data, error } = await supabase
    .from(TABLES.managerWeeklyEvaluations)
    .upsert(
      {
        ...evaluation,
        submitted_at: evaluation.status === 'submitted' ? new Date().toISOString() : null,
      },
      { onConflict: 'evaluation_type,subject_staff_id,week_start' }
    )
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchEvaluationHistory(evaluationType: EvaluationType, subjectStaffId: string) {
  const { data, error } = await supabase
    .from(TABLES.managerWeeklyEvaluations)
    .select('*')
    .eq('evaluation_type', evaluationType)
    .eq('subject_staff_id', subjectStaffId)
    .order('week_start', { ascending: false })
    .limit(12);
  if (error) throw new Error(error.message);
  return data || [];
}
