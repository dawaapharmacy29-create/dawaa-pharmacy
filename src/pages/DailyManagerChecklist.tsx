import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, ListChecks } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { MANAGER_DAILY_TASKS, type ManagerDailyRole } from '@/lib/evaluations/managerDailyTasks';

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

type ChecklistRow = {
  id?: string;
  task_key: string;
  completed: boolean;
  note: string | null;
};

export default function DailyManagerChecklist() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role) as ManagerDailyRole;
  const isEligible = role === 'branch_manager' || role === 'branches_manager';
  const tasks = isEligible ? MANAGER_DAILY_TASKS[role] : [];

  const [taskDate, setTaskDate] = useState(todayInput());
  const [rows, setRows] = useState<Record<string, ChecklistRow>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const staffId = user?.staffId || user?.id || '';

  useEffect(() => {
    if (!staffId || !isEligible) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    supabase
      .from(TABLES.managerDailyChecklist)
      .select('id, task_key, completed, note')
      .eq('staff_id', staffId)
      .eq('task_date', taskDate)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
          return;
        }
        const map: Record<string, ChecklistRow> = {};
        (data || []).forEach((row) => {
          map[row.task_key] = row as ChecklistRow;
        });
        setRows(map);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [staffId, taskDate, isEligible]);

  const completedCount = tasks.filter((t) => rows[t.key]?.completed).length;
  const completionPercent = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;

  const toggleTask = async (taskKey: string) => {
    if (!staffId) return;
    const current = rows[taskKey];
    const nextCompleted = !current?.completed;
    setSaving(taskKey);
    setRows((prev) => ({
      ...prev,
      [taskKey]: { task_key: taskKey, completed: nextCompleted, note: current?.note || null },
    }));
    try {
      const { error: err } = await supabase.from(TABLES.managerDailyChecklist).upsert(
        {
          staff_id: staffId,
          staff_name: user?.name || null,
          role,
          branch: role === 'branch_manager' ? user?.branch || null : null,
          task_date: taskDate,
          task_key: taskKey,
          completed: nextCompleted,
          completed_at: nextCompleted ? new Date().toISOString() : null,
        },
        { onConflict: 'staff_id,task_date,task_key' }
      );
      if (err) throw new Error(err.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر الحفظ');
      setRows((prev) => ({
        ...prev,
        [taskKey]: { task_key: taskKey, completed: !nextCompleted, note: current?.note || null },
      }));
    } finally {
      setSaving(null);
    }
  };

  const updateNote = (taskKey: string, note: string) => {
    setRows((prev) => ({
      ...prev,
      [taskKey]: { ...(prev[taskKey] || { task_key: taskKey, completed: false, note: null }), note },
    }));
  };

  const saveNote = async (taskKey: string) => {
    if (!staffId) return;
    const current = rows[taskKey];
    await supabase.from(TABLES.managerDailyChecklist).upsert(
      {
        staff_id: staffId,
        staff_name: user?.name || null,
        role,
        branch: role === 'branch_manager' ? user?.branch || null : null,
        task_date: taskDate,
        task_key: taskKey,
        completed: current?.completed || false,
        note: current?.note || null,
      },
      { onConflict: 'staff_id,task_date,task_key' }
    );
  };

  if (!isEligible) {
    return (
      <div dir="rtl" className="p-6 text-sm text-slate-400">
        هذه الصفحة متاحة لمدير الفرع ومدير الفروع فقط.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <ListChecks className="h-6 w-6 text-teal-300" />
        <div>
          <h1 className="text-xl font-black text-white">المهام والمتابعة اليومية</h1>
          <p className="text-sm text-slate-400">سجّل إنك راجعت كل جانب من عملك اليوم — الالتزام هنا بيغذّي تقييمك الأسبوعي.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input type="date" className="input-dark" value={taskDate} max={todayInput()} onChange={(e) => setTaskDate(e.target.value)} />
        <div className="flex-1">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-400 to-emerald-500 transition-all"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
        </div>
        <span className="text-sm font-black text-white">{completedCount} / {tasks.length}</span>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
      {loading && <p className="text-sm text-slate-400">جارٍ التحميل...</p>}

      {!loading && (
        <div className="space-y-3">
          {tasks.map((task) => {
            const row = rows[task.key];
            const completed = row?.completed || false;
            return (
              <div key={task.key} className={`stat-card space-y-2 transition ${completed ? 'border-emerald-400/30' : ''}`}>
                <button
                  type="button"
                  onClick={() => toggleTask(task.key)}
                  disabled={saving === task.key}
                  className="flex w-full items-center gap-3 text-right"
                >
                  {completed ? (
                    <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" />
                  ) : (
                    <Circle className="h-6 w-6 shrink-0 text-slate-500" />
                  )}
                  <div className="flex-1">
                    <div className={`font-black ${completed ? 'text-emerald-200' : 'text-white'}`}>{task.label}</div>
                    {task.hint && <div className="text-xs text-slate-500">{task.hint}</div>}
                  </div>
                </button>
                <input
                  type="text"
                  className="input-dark w-full text-sm"
                  placeholder="ملاحظة سريعة (اختياري)..."
                  value={row?.note || ''}
                  onChange={(e) => updateNote(task.key, e.target.value)}
                  onBlur={() => saveNote(task.key)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
