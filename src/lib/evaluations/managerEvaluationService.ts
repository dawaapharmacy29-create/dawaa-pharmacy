import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import type { EvaluationType, WeeklyAutoMetrics } from '@/lib/evaluations/managerEvaluationCriteria';
import { MANAGER_DAILY_TASKS, getManagerTaskCadence } from '@/lib/evaluations/managerDailyTasks';

export function weekBoundsOf(date: Date): { start: string; end: string } {
  // الأسبوع من السبت للجمعة (مطابق لطبيعة أسبوع العمل في مصر)
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

export async function fetchWeeklyAutoMetrics(
  evaluationType: EvaluationType,
  branch: string | null,
  weekStart: string,
  weekEnd: string
): Promise<WeeklyAutoMetrics> {
  const args = {
    p_evaluation_type: evaluationType,
    p_branch: branch,
    p_week_start: weekStart,
    p_week_end: weekEnd,
  };

  // v5 adds the daily smart-queue completion rate (VIP + +500 + Points) for customer_service
  // evaluations on top of v4's sales/target metrics.
  const { data: v5Data, error: v5Error } = await supabase.rpc('calculate_weekly_manager_metrics_v5', args);
  if (!v5Error) return v5Data as WeeklyAutoMetrics;

  // v4 هو المصدر الحالي: مبيعات آمنة باستثناء أكواد التحويل الداخلي +
  // التارجت الحي من branch_sales_targets مع احتساب نصيب الأسبوع من دورة 26→25.
  const { data: v4Data, error: v4Error } = await supabase.rpc('calculate_weekly_manager_metrics_v4', args);
  if (!v4Error) return v4Data as WeeklyAutoMetrics;

  const { data: v3Data, error: v3Error } = await supabase.rpc('calculate_weekly_manager_metrics_v3', args);
  if (!v3Error) return v3Data as WeeklyAutoMetrics;

  const { data, error } = await supabase.rpc('calculate_weekly_manager_metrics_v2', args);
  if (!error) return data as WeeklyAutoMetrics;

  const { data: legacyData, error: legacyError } = await supabase.rpc('calculate_weekly_manager_metrics', args);
  if (legacyError) throw new Error(legacyError.message || error.message || v4Error.message || v5Error.message);
  return legacyData as WeeklyAutoMetrics;
}

export type ManagerCycleSalesTargetSummary = {
  sales_total: number;
  sales_invoices_count: number;
  sales_target_amount: number;
  sales_target_achievement_rate: number | null;
};

/**
 * ملخص خفيف للمبيعات والتارجت داخل الدورة الحالية.
 * يفصل حساب حافز التارجت عن محرك التقييم الأسبوعي الثقيل حتى لا نعيد حساب
 * كل وحدات الأداء على فترة الدورة كاملة عند فتح لوحة القيادة.
 */
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

  const { data: v4Data, error: v4Error } = await supabase.rpc(
    'calculate_weekly_checklist_completion_v4',
    { p_staff_id: staffId, p_week_start: weekStart, p_week_end: weekEnd, p_task_cadences: cadencePayload, p_branch: branch }
  );
  if (!v4Error) return (v4Data as Record<string, number>) || {};

  // v3 يحافظ على المفاتيح الحالية ويعتبر مفاتيح المهام القديمة المعروفة مرادفات،
  // لذلك لا نفقد تنفيذًا تاريخيًا بعد تطوير المسميات.
  const { data: v3Data, error: v3Error } = await supabase.rpc(
    'calculate_weekly_checklist_completion_v3',
    {
      p_staff_id: staffId,
      p_week_start: weekStart,
      p_week_end: weekEnd,
      p_task_cadences: cadencePayload,
    }
  );
  if (!v3Error) return (v3Data as Record<string, number>) || {};

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
  if (error) throw new Error(error.message || cadenceError.message || v3Error.message);
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
      { onConflict: 'evaluation_type,subject_staff_id,week_start,branch' }
    )
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchEvaluationHistory(evaluationType: EvaluationType, subjectStaffId: string, branch: string | null = null) {
  let query = supabase
    .from(TABLES.managerWeeklyEvaluations)
    .select('*')
    .eq('evaluation_type', evaluationType)
    .eq('subject_staff_id', subjectStaffId);
  if (branch) query = query.eq('branch', branch);
  const { data, error } = await query.order('week_start', { ascending: false }).limit(12);
  if (error) throw new Error(error.message);
  return data || [];
}
