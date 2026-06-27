import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches, normalizeRole } from '@/lib/core/permissionSystem';
import {
  getEmployeeRoleOperatingProfile,
  getRoleDailyChecklist,
  normalizeEmployeeOperatingRole,
  type EmployeeOperatingRoleKey,
} from '@/lib/employeeRoleOperatingProfiles';
import type { User } from '@/types';

export type EmployeeTaskStatus = 'pending' | 'completed' | 'late' | 'cancelled';
export type EmployeeTaskPriority = 'normal' | 'high' | 'urgent';

export type EmployeeDailyTask = {
  id: string;
  staff_id: string | null;
  staff_name: string | null;
  role: string | null;
  branch: string | null;
  task_key: string;
  task_title: string;
  task_description: string | null;
  task_date: string;
  status: EmployeeTaskStatus | string;
  priority: EmployeeTaskPriority | string;
  source: string;
  related_route: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type EmployeeTaskFilters = {
  date?: string;
  branch?: string;
  role?: string;
  status?: string;
  staffId?: string;
  taskId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
  user?: Pick<User, 'id' | 'staffId' | 'name' | 'role' | 'branch'> | null;
};

export type EmployeeTaskSummary = {
  total: number;
  completed: number;
  late: number;
  pending: number;
  highPriority: number;
  needsIntervention: number;
  topLateRole: string | null;
  bestCommitment: string | null;
};

type StaffLike = {
  id?: string | null;
  staff_id?: string | null;
  name?: string | null;
  staff_name?: string | null;
  role?: string | null;
  branch?: string | null;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function safeDate(date?: string) {
  return String(date || todayIso()).slice(0, 10);
}

function isMissingSource(error: unknown) {
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  return (
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('could not find') ||
    message.includes('not found')
  );
}

function normalizeTask(row: Record<string, unknown>): EmployeeDailyTask {
  const dueDate = safeDate(String(row.task_date || row.created_at || todayIso()));
  const status =
    row.status === 'pending' && dueDate < todayIso()
      ? 'late'
      : String(row.status || 'pending');
  return {
    id: String(row.id || ''),
    staff_id: row.staff_id ? String(row.staff_id) : null,
    staff_name: row.staff_name ? String(row.staff_name) : null,
    role: row.role ? String(row.role) : null,
    branch: row.branch ? String(row.branch) : null,
    task_key: String(row.task_key || row.key || ''),
    task_title: String(row.task_title || row.title || 'مهمة يومية'),
    task_description: row.task_description ? String(row.task_description) : null,
    task_date: dueDate,
    status,
    priority: String(row.priority || 'normal'),
    source: String(row.source || 'system'),
    related_route: row.related_route ? String(row.related_route) : null,
    related_entity_type: row.related_entity_type ? String(row.related_entity_type) : null,
    related_entity_id: row.related_entity_id ? String(row.related_entity_id) : null,
    completed_at: row.completed_at ? String(row.completed_at) : null,
    completed_by: row.completed_by ? String(row.completed_by) : null,
    completed_by_name: row.completed_by_name ? String(row.completed_by_name) : null,
    notes: row.notes ? String(row.notes) : null,
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

function applyClientScope(tasks: EmployeeDailyTask[], user?: EmployeeTaskFilters['user']) {
  if (!user) return tasks;
  if (canSeeAllBranches(user.role)) return tasks;
  const role = normalizeRole(user.role);
  const userBranch = normalizeBranchName(user.branch || '');
  if (role === 'branch_manager' || role === 'customer_service_manager') {
    return tasks.filter((task) => normalizeBranchName(task.branch || '') === userBranch);
  }
  const staffId = String(user.staffId || user.id || '');
  const userName = String(user.name || '').trim().toLowerCase();
  return tasks.filter(
    (task) =>
      (task.staff_id && task.staff_id === staffId) ||
      (task.staff_name && userName && task.staff_name.toLowerCase() === userName)
  );
}

export { getRoleDailyChecklist };

export function buildDefaultTasksForStaff(staff: StaffLike, date = todayIso()): EmployeeDailyTask[] {
  const role = normalizeEmployeeOperatingRole(staff.role);
  const staffId = String(staff.id || staff.staff_id || '');
  const staffName = String(staff.name || staff.staff_name || '');
  return getRoleDailyChecklist(role).map((task) => ({
    id: `default-${staffId || staffName}-${task.key}-${date}`,
    staff_id: staffId || null,
    staff_name: staffName || null,
    role,
    branch: staff.branch || null,
    task_key: task.key,
    task_title: task.title,
    task_description: task.description,
    task_date: safeDate(date),
    status: 'pending',
    priority: task.priority,
    source: 'role_profile',
    related_route: task.related_route,
    related_entity_type: 'role_profile',
    related_entity_id: role,
    completed_at: null,
    completed_by: null,
    completed_by_name: null,
    notes: null,
    created_at: null,
    updated_at: null,
  }));
}

export async function generateTasksForStaff(staff: StaffLike, date = todayIso()) {
  const role = normalizeEmployeeOperatingRole(staff.role);
  const staffId = String(staff.id || staff.staff_id || '');
  const staffName = String(staff.name || staff.staff_name || '').trim();
  const profile = getEmployeeRoleOperatingProfile(role);
  const taskDate = safeDate(date);
  const defaults = buildDefaultTasksForStaff(staff, taskDate);

  if (!isSupabaseConfigured) return { tasks: defaults, generated: 0, unavailable: true, error: null };

  try {
    const { data, error } = await supabase.rpc('generate_employee_daily_tasks', {
      p_staff_id: staffId || null,
      p_staff_name: staffName || null,
      p_role: role,
      p_branch: staff.branch || null,
      p_task_date: taskDate,
    });
    if (!error && Array.isArray(data)) {
      return { tasks: data.map((row) => normalizeTask(row as Record<string, unknown>)), generated: data.length, unavailable: false, error: null };
    }
  } catch {
    // Fallback to safe upsert below when RPC is not installed yet.
  }

  try {
    const rows = defaults.map((task) => ({
      staff_id: task.staff_id,
      staff_name: task.staff_name,
      role,
      branch: task.branch,
      task_key: task.task_key,
      task_title: task.task_title,
      task_description: task.task_description,
      task_date: taskDate,
      status: 'pending',
      priority: task.priority,
      source: 'system',
      related_route: task.related_route,
      related_entity_type: 'role_profile',
      related_entity_id: profile.role_key,
    }));
    const { data, error } = await supabase
      .from('employee_daily_tasks')
      .upsert(rows, { onConflict: 'staff_id,task_date,task_key' })
      .select('*');
    if (error) throw error;
    return { tasks: (data || []).map((row) => normalizeTask(row as Record<string, unknown>)), generated: data?.length || 0, unavailable: false, error: null };
  } catch (error) {
    return {
      tasks: defaults,
      generated: 0,
      unavailable: isMissingSource(error),
      error: isMissingSource(error)
        ? 'جدول مهام الموظفين اليومية غير مطبق بعد. شغل migration ثم أعد المحاولة.'
        : error instanceof Error
          ? error.message
          : 'تعذر إنشاء مهام اليوم.',
    };
  }
}

export async function fetchEmployeeTasks(filters: EmployeeTaskFilters = {}) {
  const taskDate = safeDate(filters.date);
  const pageSize = Math.min(Math.max(Number(filters.pageSize || 50), 1), 200);
  const page = Math.max(Number(filters.page || 1), 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  if (!isSupabaseConfigured) {
    return { tasks: [] as EmployeeDailyTask[], total: 0, unavailable: true, error: null };
  }

  try {
    let query = supabase
      .from('employee_daily_tasks')
      .select('*', { count: 'exact' })
      .eq('task_date', taskDate)
      .order('priority', { ascending: false })
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (filters.taskId) query = query.eq('id', filters.taskId);
    if (filters.staffId) query = query.eq('staff_id', filters.staffId);
    if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
    if (filters.role && filters.role !== 'all') query = query.eq('role', normalizeEmployeeOperatingRole(filters.role));

    const requestedBranch = normalizeBranchName(filters.branch || '');
    if (requestedBranch && requestedBranch !== 'all' && requestedBranch !== 'الكل' && requestedBranch !== 'كل الفروع') {
      query = query.eq('branch', requestedBranch);
    } else if (filters.user && !canSeeAllBranches(filters.user.role)) {
      const userBranch = normalizeBranchName(filters.user.branch || '');
      if (userBranch) query = query.eq('branch', userBranch);
    }

    const search = String(filters.search || '').trim();
    if (search) {
      query = query.or(`staff_name.ilike.%${search}%,task_title.ilike.%${search}%,task_description.ilike.%${search}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    const tasks = applyClientScope((data || []).map((row) => normalizeTask(row as Record<string, unknown>)), filters.user);
    return { tasks, total: count ?? tasks.length, unavailable: false, error: null };
  } catch (error) {
    return {
      tasks: [] as EmployeeDailyTask[],
      total: 0,
      unavailable: isMissingSource(error),
      error: isMissingSource(error)
        ? 'جدول مهام الموظفين اليومية غير مطبق بعد.'
        : error instanceof Error
          ? error.message
          : 'تعذر تحميل مهام الموظفين.',
    };
  }
}

export async function completeTask(
  taskId: string,
  notes?: string,
  user?: Pick<User, 'id' | 'staffId' | 'name'>
) {
  if (!isSupabaseConfigured) return { ok: false, error: 'إعدادات Supabase غير موجودة' };

  try {
    const { error } = await supabase.rpc('complete_employee_daily_task', {
      p_task_id: taskId,
      p_notes: notes || null,
      p_completed_by: user?.staffId || user?.id || null,
      p_completed_by_name: user?.name || null,
    });
    if (!error) return { ok: true, error: null };
  } catch {
    // Fallback below.
  }

  try {
    const { error } = await supabase
      .from('employee_daily_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: user?.staffId || user?.id || null,
        completed_by_name: user?.name || null,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);
    if (error) throw error;
    return { ok: true, error: null };
  } catch (error) {
    return {
      ok: false,
      error: isMissingSource(error)
        ? 'جدول مهام الموظفين اليومية غير مطبق بعد.'
        : error instanceof Error
          ? error.message
          : 'تعذر إكمال المهمة.',
    };
  }
}

export function summarizeTasks(tasks: EmployeeDailyTask[]): EmployeeTaskSummary {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const late = tasks.filter((task) => task.status === 'late').length;
  const pending = tasks.filter((task) => task.status === 'pending').length;
  const highPriority = tasks.filter((task) => ['high', 'urgent'].includes(String(task.priority))).length;
  const byLateRole = new Map<string, number>();
  const byStaff = new Map<string, { total: number; completed: number }>();
  for (const task of tasks) {
    if (task.status === 'late') {
      const role = String(task.role || 'غير محدد');
      byLateRole.set(role, (byLateRole.get(role) || 0) + 1);
    }
    const name = String(task.staff_name || 'غير محدد');
    const current = byStaff.get(name) || { total: 0, completed: 0 };
    current.total += 1;
    if (task.status === 'completed') current.completed += 1;
    byStaff.set(name, current);
  }
  const topLateRole = [...byLateRole.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const bestCommitment =
    [...byStaff.entries()]
      .filter(([, value]) => value.total > 0)
      .sort((a, b) => b[1].completed / b[1].total - a[1].completed / a[1].total)[0]?.[0] || null;
  return {
    total,
    completed,
    late,
    pending,
    highPriority,
    needsIntervention: late + tasks.filter((task) => task.priority === 'urgent' && task.status !== 'completed').length,
    topLateRole,
    bestCommitment,
  };
}

export async function summarizeTeamTasks(date = todayIso(), branch?: string, user?: EmployeeTaskFilters['user']) {
  const { tasks, unavailable, error } = await fetchEmployeeTasks({
    date,
    branch,
    pageSize: 200,
    user,
  });
  return { summary: summarizeTasks(tasks), tasks, unavailable, error };
}
