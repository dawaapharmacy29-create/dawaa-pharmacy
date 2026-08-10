import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, ChevronDown, ListChecks } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TABLES } from '@/lib/supabaseTables';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { MANAGER_DAILY_TASKS, MANAGER_DAILY_TASK_GROUPS, type ManagerDailyRole } from '@/lib/evaluations/managerDailyTasks';
import { ASSISTANT_DAILY_TASKS, ASSISTANT_TASKS_TOTAL_WEIGHT } from '@/lib/evaluations/assistantDailyTasks';
import { ManagerScoreBreakdownTab } from '@/components/evaluations/ManagerScoreBreakdownTab';
import type { EvaluationType } from '@/lib/evaluations/managerEvaluationCriteria';

const ROLE_TO_EVALUATION_TYPE: Record<ManagerDailyRole, EvaluationType> = {
  branch_manager: 'branch_manager',
  branches_manager: 'branches_manager',
  customer_service_manager: 'customer_service',
};

function todayInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type ChecklistRow = {
  id?: string;
  task_key: string;
  completed: boolean;
  note: string | null;
};

type EligibleRole = ManagerDailyRole | 'assistant';

export default function DailyManagerChecklist() {
  const { user } = useAuth();
  const role = normalizeRole(user?.role) as EligibleRole;
  const isAssistant = role === 'assistant';
  const isCsManager = role === 'customer_service_manager';
  const isEligible = role === 'branch_manager' || role === 'branches_manager' || isCsManager || isAssistant;
  const tasks = isAssistant
    ? ASSISTANT_DAILY_TASKS
    : isEligible
      ? MANAGER_DAILY_TASKS[role as ManagerDailyRole]
      : [];
  const pageTitle = isAssistant
    ? 'مهام مساعد الصيدلي اليومية'
    : isCsManager
      ? 'المهام اليومية لمدير خدمة العملاء'
      : 'المهام والمتابعة اليومية';
  const pageSubtitle = isAssistant
    ? 'سجّل إنجازك للمهام كل يوم — معدل الالتزام بيتحوّل لحافزك الشهري تلقائيًا عند إغلاق الدورة.'
    : 'سجّل إنك راجعت كل جانب من عملك اليوم — الالتزام هنا بيغذّي تقييمك الأسبوعي.';

  const [taskDate, setTaskDate] = useState(todayInput());
  const [activeTab, setActiveTab] = useState<'tasks' | 'score'>('tasks');
  const [rows, setRows] = useState<Record<string, ChecklistRow>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string> | null>(null);

  const groups = !isAssistant && isEligible ? MANAGER_DAILY_TASK_GROUPS[role as ManagerDailyRole] : [];

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
        if (groups.length) {
          const stillOpen = new Set(
            groups.filter((g) => g.subtasks.some((t) => !map[t.key]?.completed)).map((g) => g.groupKey)
          );
          setExpandedGroups(stillOpen);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId, taskDate, isEligible]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev || []);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const completedCount = tasks.filter((t) => rows[t.key]?.completed).length;
  const completionPercent = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
  const completedWeight = isAssistant
    ? ASSISTANT_DAILY_TASKS.filter((t) => rows[t.key]?.completed).reduce((sum, t) => sum + t.weight, 0)
    : 0;
  const estimatedMonthlyIncentive = isAssistant
    ? Math.round((completedWeight / ASSISTANT_TASKS_TOTAL_WEIGHT) * 1000)
    : 0;

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
          branch: role === 'branches_manager' ? null : (user?.branch || null),
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
        branch: role === 'branches_manager' ? null : (user?.branch || null),
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
        هذه الصفحة متاحة لمدير الفرع، مدير الفروع، مدير خدمة العملاء، ومساعد الصيدلي فقط.
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-6 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <ListChecks className="h-6 w-6 text-teal-300" />
        <div>
          <h1 className="text-xl font-black text-white">{pageTitle}</h1>
          <p className="text-sm text-slate-400">{pageSubtitle}</p>
        </div>
      </div>

      {isEligible && !isAssistant && (
        <div className="flex gap-2 border-b border-white/10">
          <button
            type="button"
            onClick={() => setActiveTab('tasks')}
            className={`px-4 py-2 text-sm font-black transition ${
              activeTab === 'tasks' ? 'border-b-2 border-teal-400 text-teal-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            المهام اليومية
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('score')}
            className={`px-4 py-2 text-sm font-black transition ${
              activeTab === 'score' ? 'border-b-2 border-teal-400 text-teal-300' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            الحافز والتقييم بالتفصيل
          </button>
        </div>
      )}

      {isEligible && !isAssistant && activeTab === 'score' ? (
        <ManagerScoreBreakdownTab
          evaluationType={ROLE_TO_EVALUATION_TYPE[role as ManagerDailyRole]}
          staffId={staffId}
          branch={role === 'branches_manager' ? null : (user?.branch || null)}
        />
      ) : (
        <>
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

          {isAssistant && (
            <p className="text-xs text-slate-400">
              لو استمريت بنفس معدل النهاردة طول الدورة، الحافز الشهري التقديري ≈ <span className="font-black text-emerald-300">{estimatedMonthlyIncentive} جنيه</span> من أصل 1000 — الرقم النهائي بيتحسب من معدل كل الأيام مجمّعة، مش يوم واحد بس.
            </p>
          )}

          {error && <p className="text-sm text-red-300">{error}</p>}
          {loading && <p className="text-sm text-slate-400">جارٍ التحميل...</p>}

          {!loading && groups.length > 0 && (
            <div className="space-y-3">
              {groups.map((group) => {
                const groupDone = group.subtasks.filter((t) => rows[t.key]?.completed).length;
                const groupTotal = group.subtasks.length;
                const groupComplete = groupDone === groupTotal;
                const isOpen = expandedGroups?.has(group.groupKey) ?? false;
                return (
                  <div
                    key={group.groupKey}
                    className={`overflow-hidden rounded-2xl border transition ${
                      groupComplete ? 'border-emerald-400/30 bg-emerald-500/5' : 'border-white/10 bg-slate-900/30'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.groupKey)}
                      className="flex w-full items-center gap-3 p-4 text-right"
                    >
                      {groupComplete ? (
                        <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" />
                      ) : (
                        <Circle className="h-6 w-6 shrink-0 text-slate-500" />
                      )}
                      <div className="flex-1">
                        <div className={`font-black ${groupComplete ? 'text-emerald-200' : 'text-white'}`}>{group.groupLabel}</div>
                        {group.groupHint && <div className="text-xs text-slate-500">{group.groupHint}</div>}
                      </div>
                      <span className="shrink-0 text-xs font-black text-slate-400">{groupDone} / {groupTotal}</span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isOpen && (
                      <div className="space-y-2 border-t border-white/10 p-3 pt-3">
                        {group.subtasks.map((task) => {
                          const row = rows[task.key];
                          const completed = row?.completed || false;
                          return (
                            <div
                              key={task.key}
                              className={`space-y-2 rounded-xl border p-3 transition ${
                                completed ? 'border-emerald-400/20 bg-emerald-500/5' : 'border-white/5 bg-black/10'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => toggleTask(task.key)}
                                disabled={saving === task.key}
                                className="flex w-full items-center gap-3 text-right"
                              >
                                {completed ? (
                                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                                ) : (
                                  <Circle className="h-5 w-5 shrink-0 text-slate-500" />
                                )}
                                <div className="flex-1">
                                  <div className={`text-sm font-bold ${completed ? 'text-emerald-200' : 'text-slate-200'}`}>{task.label}</div>
                                  {task.hint && <div className="text-[11px] text-slate-500">{task.hint}</div>}
                                </div>
                              </button>
                              <input
                                type="text"
                                className="input-dark w-full text-xs"
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
              })}
            </div>
          )}

          {!loading && isAssistant && (
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
        </>
      )}
    </div>
  );
}
