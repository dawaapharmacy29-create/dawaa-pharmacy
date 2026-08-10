import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import type { EvaluationType, WeeklyAutoMetrics } from '@/lib/evaluations/managerEvaluationCriteria';
import { MANAGER_DAILY_TASKS, getManagerTaskCadence } from '@/lib/evaluations/managerDailyTasks';

export function weekBoundsOf(date: Date): { start: string; end: string } {
  // الأسبوع من السبت للجمعة (مطابق لطبيعة أسبوع العمل في مصر)
  const day = date.getDay(); // 0=Sunday ... 6=Saturday
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

export async function fetchWeeklyChecklistCompletion(
  staffId: string,
  weekStart: string,
  weekEnd: string
): Promise<Record<string, number>> {
  const allManagerTaskKeys = [...new Set(Object.values(MANAGER_DAILY_TASKS).flat().map((task) => task.key))];
  const cadencePayload = Object.fromEntries(
    allManagerTaskKeys.map((key) => [key, getManagerTaskCadence(key)])
  );

  // V2 يعرف إن المهمة الأسبوعية مطلوبة مرة واحدة فقط. نحتفظ بالـRPC القديم
  // كـfallback أثناء فترة نشر الـmigration، عشان الواجهة ما تتعطلش لو الكود
  // اتنشر قبل قاعدة البيانات بدقائق.
  const { data: cadenceData, error: cadenceError } = await supabase.rpc(
    'calculate_weekly_checklist_completion_v2',
    {
      p_staff_id: staffId,
      p_week_start: weekStart,
      p_week_end: weekEnd,
      p_task_cadences: cadencePayload,
    }
  );
  if (!cadenceError) return (cadenceData as Record<string, number>) || {};

  const { data, error } = await supabase.rpc('calculate_weekly_checklist_completion', {
    p_staff_id: staffId,
    p_week_start: weekStart,
    p_week_end: weekEnd,
  });
  if (error) throw new Error(error.message || cadenceError.message);
  return (data as Record<string, number>) || {};
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
