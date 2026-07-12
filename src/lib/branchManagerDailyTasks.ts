import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type BranchDailyTaskStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'approved'
  | 'blocked'
  | 'cancelled';

export type BranchDailyTaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface BranchDailyTask {
  id: string;
  task_date: string;
  branch: string;
  category: string;
  title: string;
  description?: string | null;
  priority: BranchDailyTaskPriority;
  status: BranchDailyTaskStatus;
  assigned_staff_id?: string | null;
  assigned_staff_name?: string | null;
  due_at?: string | null;
  evidence_url?: string | null;
  completion_note?: string | null;
  completed_at?: string | null;
  completed_by?: string | null;
  approved_at?: string | null;
  approved_by?: string | null;
  approved_by_name?: string | null;
  source_template_key?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DailyTaskSummary {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  approved: number;
  blocked: number;
  overdue: number;
  completionRate: number;
}

function ensureConfigured() {
  if (!isSupabaseConfigured) throw new Error('قاعدة البيانات غير مفعلة');
}

export async function createDailyBranchTasks(params: {
  branch: string;
  taskDate: string;
  createdBy?: string | null;
}) {
  ensureConfigured();
  const branch = params.branch.trim();
  if (!branch) throw new Error('الفرع مطلوب لإنشاء مهام اليوم');

  const { data, error } = await supabase.rpc('create_daily_branch_tasks', {
    p_branch: branch,
    p_task_date: params.taskDate,
    p_created_by: params.createdBy || null,
  });

  if (error) throw new Error(`تعذر إنشاء مهام اليوم: ${error.message}`);
  const first = Array.isArray(data) ? data[0] : data;
  return {
    createdCount: Number(first?.created_count || 0),
    existingCount: Number(first?.existing_count || 0),
  };
}

export async function fetchBranchDailyTasks(params: {
  branch?: string | null;
  taskDate: string;
  includeAllBranches?: boolean;
}) {
  ensureConfigured();
  let query = supabase
    .from('branch_daily_tasks')
    .select('*')
    .eq('task_date', params.taskDate)
    .order('priority', { ascending: false })
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (!params.includeAllBranches && params.branch?.trim()) {
    query = query.eq('branch', params.branch.trim());
  }

  const { data, error } = await query;
  if (error) throw new Error(`تعذر تحميل مهام اليوم: ${error.message}`);
  return (data || []) as BranchDailyTask[];
}

export async function updateBranchDailyTaskStatus(params: {
  taskId: string;
  status: BranchDailyTaskStatus;
  actorId?: string | null;
  actorName?: string | null;
  note?: string | null;
  evidenceUrl?: string | null;
}) {
  ensureConfigured();
  const { data, error } = await supabase.rpc('set_branch_daily_task_status', {
    p_task_id: params.taskId,
    p_status: params.status,
    p_actor_id: params.actorId || null,
    p_actor_name: params.actorName || null,
    p_note: params.note || null,
    p_evidence_url: params.evidenceUrl || null,
  });

  if (error) throw new Error(`تعذر تحديث المهمة: ${error.message}`);
  return data as BranchDailyTask;
}

export function summarizeDailyTasks(tasks: BranchDailyTask[], now = new Date()): DailyTaskSummary {
  const total = tasks.length;
  const pending = tasks.filter((task) => task.status === 'pending').length;
  const inProgress = tasks.filter((task) => task.status === 'in_progress').length;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const approved = tasks.filter((task) => task.status === 'approved').length;
  const blocked = tasks.filter((task) => task.status === 'blocked').length;
  const overdue = tasks.filter((task) => {
    if (!task.due_at || ['completed', 'approved', 'cancelled'].includes(task.status)) return false;
    const due = new Date(task.due_at);
    return Number.isFinite(due.getTime()) && due.getTime() < now.getTime();
  }).length;
  const finished = completed + approved;

  return {
    total,
    pending,
    inProgress,
    completed,
    approved,
    blocked,
    overdue,
    completionRate: total ? Math.round((finished / total) * 100) : 0,
  };
}
