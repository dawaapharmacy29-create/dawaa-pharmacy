import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ClipboardList, ExternalLink, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches } from '@/lib/core/permissionSystem';
import {
  completeTask,
  fetchEmployeeTasks,
  generateTasksForStaff,
  summarizeTasks,
  type EmployeeDailyTask,
} from '@/lib/employeeDailyTasks';
import { EMPLOYEE_OPERATING_ROLE_KEYS, getEmployeeRoleOperatingProfile } from '@/lib/employeeRoleOperatingProfiles';

const ALL = 'all';
const PAGE_SIZE = 50;

type StaffRow = {
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

function statusLabel(status: string) {
  if (status === 'completed') return 'مكتمل';
  if (status === 'late') return 'متأخر';
  if (status === 'cancelled') return 'ملغي';
  return 'معلق';
}

function priorityLabel(priority: string) {
  if (priority === 'urgent') return 'عاجل';
  if (priority === 'high') return 'مهم';
  return 'عادي';
}

function badgeClass(kind: 'status' | 'priority', value: string) {
  if (kind === 'status') {
    if (value === 'completed') return 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200';
    if (value === 'late') return 'border-rose-400/25 bg-rose-400/10 text-rose-200';
    return 'border-amber-400/25 bg-amber-400/10 text-amber-200';
  }
  if (value === 'urgent') return 'border-rose-400/25 bg-rose-400/10 text-rose-200';
  if (value === 'high') return 'border-amber-400/25 bg-amber-400/10 text-amber-200';
  return 'border-slate-500/25 bg-slate-500/10 text-slate-200';
}

export default function EmployeeOperatingSystem() {
  const { user, checkPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tasks, setTasks] = useState<EmployeeDailyTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sourceIssue, setSourceIssue] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [date, setDate] = useState(params.get('date') || todayIso());
  const [branch, setBranch] = useState(params.get('branch') || ALL);
  const [role, setRole] = useState(params.get('role') || ALL);
  const [status, setStatus] = useState(params.get('status') || ALL);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounce(search, 350);
  const canManage = checkPermission('employee_operating_system.manage');

  const scopedBranch =
    !canSeeAllBranches(user?.role) && user?.branch ? normalizeBranchName(user.branch) : branch;

  const syncParams = useCallback(() => {
    const next = new URLSearchParams();
    if (date) next.set('date', date);
    if (branch !== ALL) next.set('branch', branch);
    if (role !== ALL) next.set('role', role);
    if (status !== ALL) next.set('status', status);
    setParams(next, { replace: true });
  }, [branch, date, role, setParams, status]);

  const load = useCallback(async () => {
    setLoading(true);
    setSourceIssue(null);
    syncParams();
    const result = await fetchEmployeeTasks({
      date,
      branch: scopedBranch,
      role,
      status,
      search: debouncedSearch,
      page,
      pageSize: PAGE_SIZE,
      taskId: params.get('taskId') || undefined,
      user,
    });
    setTasks(result.tasks);
    setTotal(result.total);
    setSourceIssue(result.error);
    setLoading(false);
  }, [date, debouncedSearch, page, params, role, scopedBranch, status, syncParams, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarizeTasks(tasks), [tasks]);
  const branches = useMemo(
    () => [...new Set(tasks.map((task) => task.branch).filter(Boolean))] as string[],
    [tasks]
  );

  async function loadStaffForGeneration() {
    if (!isSupabaseConfigured) return [] as StaffRow[];
    let query = supabase
      .from('staff')
      .select('id,staff_id,name,staff_name,role,branch,status,active,is_active')
      .limit(120);
    if (scopedBranch && scopedBranch !== ALL) query = query.eq('branch', scopedBranch);
    if (role && role !== ALL) query = query.eq('role', role);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).filter((row: Record<string, unknown>) => {
      const active = row.active ?? row.is_active ?? row.status;
      return active === true || String(active || '').includes('نشط') || String(active || '').toLowerCase() === 'active';
    }) as StaffRow[];
  }

  const generateToday = async () => {
    setGenerating(true);
    try {
      const staffRows = await loadStaffForGeneration();
      if (!staffRows.length) {
        toast.info('لا يوجد موظفون مطابقون للفلاتر الحالية.');
        return;
      }
      let generated = 0;
      for (const staff of staffRows) {
        const result = await generateTasksForStaff(staff, date);
        generated += result.generated;
      }
      toast.success(`تم تجهيز مهام اليوم لعدد ${staffRows.length} موظف.`);
      if (!generated) toast.info('لو ظهرت checklist فقط، تأكد من تطبيق migration في Supabase.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إنشاء مهام اليوم.');
    } finally {
      setGenerating(false);
    }
  };

  const finishTask = async (task: EmployeeDailyTask) => {
    if (task.id.startsWith('default-')) {
      toast.info('أنشئ مهام اليوم أولًا حتى يمكن إكمال المهمة.');
      return;
    }
    const result = await completeTask(task.id, notes[task.id], user);
    if (!result.ok) {
      toast.error(result.error || 'تعذر إكمال المهمة.');
      return;
    }
    toast.success('تم إكمال المهمة.');
    await load();
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="rounded-2xl border border-teal-500/20 bg-slate-900 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-teal-400/20 bg-teal-400/10 px-3 py-1 text-xs font-black text-teal-100">
              <Sparkles size={14} /> Employee Operating System
            </span>
            <h1 className="mt-3 text-2xl font-black text-white">مهام الفريق اليومية</h1>
            <p className="mt-1 text-sm font-semibold text-slate-400">
              متابعة يومية حسب الدور، الفرع، الحالة، والأولوية بدون تحميل كل الفروع لمستخدم فرع واحد.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2 text-sm font-black text-slate-200 hover:bg-slate-800"
            >
              <RefreshCw size={16} /> تحديث
            </button>
            {canManage && (
              <button
                type="button"
                onClick={() => void generateToday()}
                disabled={generating}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950 disabled:opacity-60"
              >
                {generating ? <Loader2 className="animate-spin" size={16} /> : <ClipboardList size={16} />}
                إنشاء مهام اليوم
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Kpi label="إجمالي المهام" value={summary.total} />
        <Kpi label="مكتمل" value={summary.completed} tone="green" />
        <Kpi label="متأخر" value={summary.late} tone="red" />
        <Kpi label="عالي الأولوية" value={summary.highPriority} tone="amber" />
        <Kpi label="يحتاج تدخل" value={summary.needsIntervention} tone="red" />
      </section>

      <section className="grid gap-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-4 md:grid-cols-2 xl:grid-cols-6">
        <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setPage(1); }} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" />
        <select value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); }} disabled={!canSeeAllBranches(user?.role)} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60">
          <option value={ALL}>كل الفروع</option>
          {branches.map((item) => <option key={item} value={item}>{item}</option>)}
          {user?.branch && <option value={normalizeBranchName(user.branch)}>{normalizeBranchName(user.branch)}</option>}
        </select>
        <select value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option value={ALL}>كل الأدوار</option>
          {EMPLOYEE_OPERATING_ROLE_KEYS.map((key) => (
            <option key={key} value={key}>{getEmployeeRoleOperatingProfile(key).role_name_ar}</option>
          ))}
        </select>
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white">
          <option value={ALL}>كل الحالات</option>
          <option value="pending">معلق</option>
          <option value="completed">مكتمل</option>
          <option value="late">متأخر</option>
        </select>
        <div className="relative xl:col-span-2">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder="بحث باسم الموظف أو المهمة..."
            className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pr-9 pl-3 text-sm text-white placeholder:text-slate-500"
          />
        </div>
      </section>

      {sourceIssue && (
        <div className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm font-bold text-amber-100">
          {sourceIssue}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/80">
        {loading ? (
          <div className="grid gap-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-16 animate-pulse rounded-xl bg-slate-800" />
            ))}
          </div>
        ) : tasks.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-slate-700 bg-slate-950/60 text-xs text-slate-400">
                <tr>
                  {['الموظف', 'الدور', 'الفرع', 'المهمة', 'الحالة', 'الأولوية', 'آخر تحديث', 'إجراء'].map((head) => (
                    <th key={head} className="p-3 text-right font-black">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {tasks.map((task) => (
                  <tr key={task.id} className="align-top hover:bg-slate-800/45">
                    <td className="p-3">
                      <Link className="font-black text-white hover:text-teal-200" to={task.staff_id ? `/staff/${task.staff_id}?tab=operating-system` : '/team'}>
                        {task.staff_name || 'غير محدد'}
                      </Link>
                    </td>
                    <td className="p-3 text-slate-300">{getEmployeeRoleOperatingProfile(task.role).role_name_ar}</td>
                    <td className="p-3 text-slate-300">{task.branch || '-'}</td>
                    <td className="p-3">
                      <div className="font-black text-white">{task.task_title}</div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">{task.task_description}</div>
                      <input
                        value={notes[task.id] || ''}
                        onChange={(event) => setNotes((current) => ({ ...current, [task.id]: event.target.value }))}
                        placeholder="ملاحظة التنفيذ..."
                        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white"
                      />
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full border px-2 py-1 text-xs font-black ${badgeClass('status', String(task.status))}`}>
                        {statusLabel(String(task.status))}
                      </span>
                    </td>
                    <td className="p-3">
                      <span className={`rounded-full border px-2 py-1 text-xs font-black ${badgeClass('priority', String(task.priority))}`}>
                        {priorityLabel(String(task.priority))}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-slate-400">{String(task.updated_at || task.created_at || '-').slice(0, 16)}</td>
                    <td className="p-3">
                      <div className="flex flex-col gap-2">
                        <Link to={task.related_route || '/employee-operating-system'} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-black text-slate-200 hover:bg-slate-800">
                          <ExternalLink size={14} /> فتح المهمة
                        </Link>
                        {task.status !== 'completed' && (
                          <button type="button" onClick={() => void finishTask(task)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-black text-slate-950">
                            <CheckCircle2 size={14} /> تم التنفيذ
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <div className="text-lg font-black text-white">لم يتم إنشاء مهام اليوم بعد</div>
            <p className="mt-2 text-sm text-slate-400">اضغط إنشاء مهام اليوم أو غيّر الفلاتر لعرض مهام أخرى.</p>
            {canManage && (
              <button type="button" onClick={() => void generateToday()} className="mt-4 rounded-xl bg-teal-500 px-4 py-2 text-sm font-black text-slate-950">
                إنشاء مهام اليوم
              </button>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-900/80 p-3 text-sm text-slate-300">
        <button disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-slate-700 px-3 py-2 disabled:opacity-40">السابق</button>
        <span>صفحة {page} - المعروض {tasks.length} من {total}</span>
        <button disabled={tasks.length < PAGE_SIZE} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-700 px-3 py-2 disabled:opacity-40">التالي</button>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone = 'cyan' }: { label: string; value: number; tone?: 'cyan' | 'green' | 'amber' | 'red' }) {
  const classes = {
    cyan: 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100',
    green: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-100',
    amber: 'border-amber-400/20 bg-amber-400/10 text-amber-100',
    red: 'border-rose-400/20 bg-rose-400/10 text-rose-100',
  };
  return (
    <div className={`rounded-2xl border p-4 ${classes[tone]}`}>
      <div className="text-xs font-black opacity-80">{label}</div>
      <div className="mt-2 text-2xl font-black">{value.toLocaleString('ar-EG')}</div>
    </div>
  );
}
