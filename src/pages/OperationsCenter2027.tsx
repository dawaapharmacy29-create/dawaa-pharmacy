import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCircle2, Clock, Plus, Search, ShieldAlert, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useSupabaseQuery, supabaseInsert, supabaseUpdate } from '@/hooks/useSupabaseQuery';
import { supabase } from '@/lib/supabase';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { logActivity } from '@/lib/activityLog';
import {
  dismissNotification,
  markNotificationCompleted,
  markNotificationRead,
  normalizeNotification,
  notifyEmployee,
  type AppNotification,
} from '@/lib/notificationService';

type TaskRow = {
  id: string;
  title: string;
  description?: string | null;
  assigned_to?: string | null;
  assigned_name?: string | null;
  branch?: string | null;
  status?: string | null;
  priority?: string | null;
  due_date?: string | null;
  staff_id?: string | null;
  created_at?: string | null;
};

type StaffOption = { id: string; name: string; role?: string | null; branch?: string | null };

const MANAGER_ROLES = new Set([
  'general_manager',
  'executive_manager',
  'branches_manager',
  'branch_manager',
  'customer_service_manager',
  'shift_supervisor_morning',
  'shift_supervisor_evening',
  'procurement_manager',
]);
const CLOSED = new Set(['done', 'completed', 'مكتمل', 'closed', 'تم']);

export default function OperationsCenter2027() {
  const { user, checkPermission } = useAuth();
  const role = normalizeRole(user?.role);
  const canCreateTasks = checkPermission('manage_operations') || MANAGER_ROLES.has(role);
  const canSeeAllBranches = ['general_manager', 'executive_manager', 'branches_manager'].includes(role);

  const { data: tasks, refetch: refetchTasks } = useSupabaseQuery<TaskRow>({
    table: 'tasks',
    limit: 200,
    orderBy: { column: 'created_at', ascending: false },
    realtimeEnabled: true,
  });

  const [notificationsRaw, setNotificationsRaw] = useState<Record<string, unknown>[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({
    title: '',
    priority: 'مهم',
    due_date: new Date().toISOString().slice(0, 10),
    staff_id: '',
  });

  const refetchNotifications = useCallback(() => {
    void supabase
      .from('notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(250)
      .then(({ data }) => setNotificationsRaw((data as Record<string, unknown>[]) || []));
  }, []);

  useEffect(() => {
    refetchNotifications();
  }, [refetchNotifications]);

  useEffect(() => {
    if (!canCreateTasks) return;
    let query = supabase
      .from('staff')
      .select('id,name,role,branch')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(300);
    if (!canSeeAllBranches && user?.branch) query = query.eq('branch', user.branch);
    void query.then(({ data }) => setStaffOptions((data as StaffOption[]) || []));
  }, [canCreateTasks, canSeeAllBranches, user?.branch]);

  const notifications = useMemo(() => {
    const unique = new Map<string, AppNotification>();
    for (const row of notificationsRaw) {
      const n = normalizeNotification(row);
      const key = [n.type, n.target_type, n.target_id, n.recipient_staff_id, n.title]
        .map((v) => String(v || '').trim().toLowerCase())
        .join('|');
      if (!unique.has(key)) unique.set(key, n);
    }
    return [...unique.values()];
  }, [notificationsRaw]);

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) =>
      `${task.title || ''} ${task.description || ''} ${task.assigned_name || ''} ${task.priority || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [search, tasks]);

  const visibleNotifications = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return notifications;
    return notifications.filter((n) =>
      `${n.title} ${n.message} ${n.type} ${n.priority}`.toLowerCase().includes(q)
    );
  }, [notifications, search]);

  const openTasks = tasks.filter((task) => !CLOSED.has(String(task.status || '').toLowerCase()));
  const urgentTasks = openTasks.filter((task) => ['خطر', 'high', 'urgent', 'critical'].includes(String(task.priority || '').toLowerCase()));
  const unread = notifications.filter((n) => !n.read && !n.is_read);
  const actionRequired = notifications.filter((n) => n.requires_action || ['high', 'urgent', 'critical'].includes(String(n.priority || '').toLowerCase()));

  async function addTask() {
    if (!canCreateTasks) return toast.error('ليس لديك صلاحية إنشاء مهمة');
    if (!form.title.trim()) return toast.error('اكتب عنوان المهمة');
    if (!form.staff_id) return toast.error('اختر الموظف المسؤول');
    const assignee = staffOptions.find((item) => item.id === form.staff_id);
    if (!assignee) return toast.error('تعذر تحديد الموظف');

    const { data, error } = await supabaseInsert<Record<string, unknown>>('tasks', {
      title: form.title.trim(),
      description: 'مهمة تشغيلية من مركز المهام والتنبيهات',
      priority: form.priority,
      status: 'open',
      due_date: form.due_date,
      staff_id: assignee.id,
      assigned_to: assignee.id,
      assigned_name: assignee.name,
      branch: assignee.branch || user?.branch || null,
      added_by: user?.id || null,
      target_type: 'staff',
      target_id: assignee.id,
    });
    if (error) return toast.error(error);

    await notifyEmployee({
      title: 'مهمة جديدة',
      message: form.title.trim(),
      type: 'task',
      priority: form.priority === 'خطر' ? 'urgent' : form.priority === 'مهم' ? 'high' : 'normal',
      recipient_staff_id: assignee.id,
      branch: assignee.branch || user?.branch || null,
      target_type: 'task',
      target_id: String(data?.id || ''),
      target_route: '/operations-center',
      requires_action: true,
      created_by: user?.id || null,
      created_by_name: user?.name || null,
      metadata: { due_date: form.due_date, assigned_name: assignee.name },
    });

    await logActivity({
      action: 'task_created',
      module: 'operations_center',
      target_type: 'task',
      target_id: String(data?.id || ''),
      user_id: user?.id,
      user_name: user?.name,
      user_role: user?.role,
      branch_name: user?.branch,
      route_path: '/operations-center',
      details: { assigned_staff_id: assignee.id, assigned_name: assignee.name },
    }).catch(() => undefined);

    setForm((current) => ({ ...current, title: '', staff_id: '' }));
    toast.success('تم إنشاء المهمة وإرسال التنبيه للموظف');
    refetchTasks();
    refetchNotifications();
  }

  async function completeTask(task: TaskRow) {
    const { error } = await supabaseUpdate('tasks', task.id, { status: 'completed' });
    if (error) return toast.error(error);
    toast.success('تم إنهاء المهمة');
    refetchTasks();
  }

  async function notificationAction(action: 'read' | 'completed' | 'dismissed', id: string) {
    const ok = action === 'read'
      ? await markNotificationRead(id)
      : action === 'completed'
        ? await markNotificationCompleted(id)
        : await dismissNotification(id);
    if (!ok) return toast.error('تعذر تحديث التنبيه');
    refetchNotifications();
  }

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <span className="dawaa-brand-chip">My Work Center</span>
        <h1 className="dawaa-title mt-3 text-2xl">المهام والتنبيهات</h1>
        <p className="dawaa-caption mt-1 font-semibold">
          المعروض هنا يخصك حسب دورك وفرعك ومسؤولياتك. الإدارة ترى نطاق مسؤوليتها فقط، والإدارة العليا ترى الصورة الكاملة.
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Clock} label="مهامي المفتوحة" value={openTasks.length} />
        <Kpi icon={BellRing} label="تنبيهات غير مقروءة" value={unread.length} />
        <Kpi icon={ShieldAlert} label="تحتاج إجراء" value={actionRequired.length} />
        <Kpi icon={Sparkles} label="مهام عاجلة" value={urgentTasks.length} />
      </div>

      <section className="dawaa-card">
        <div className="relative max-w-xl">
          <Search className="dawaa-muted absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <input className="dawaa-input w-full pr-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث في مهامي وتنبيهاتي" />
        </div>
      </section>

      {canCreateTasks ? (
        <section className="dawaa-card">
          <h2 className="dawaa-title mb-4 text-lg">إسناد مهمة لموظف</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <input className="dawaa-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="عنوان المهمة" />
            <select className="dawaa-select" value={form.staff_id} onChange={(e) => setForm({ ...form, staff_id: e.target.value })}>
              <option value="">اختر الموظف</option>
              {staffOptions.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.role}</option>)}
            </select>
            <select className="dawaa-select" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option>عادي</option><option>مهم</option><option>خطر</option>
            </select>
            <input className="dawaa-input" type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </div>
          <button className="dawaa-button dawaa-button--primary mt-4" onClick={() => void addTask()}><Plus className="h-4 w-4" /> إسناد المهمة</button>
        </section>
      ) : null}

      <section className="dawaa-card">
        <h2 className="dawaa-title mb-3 text-lg">المهام</h2>
        <div className="space-y-2">
          {visibleTasks.length === 0 ? <Empty text="لا توجد مهام تخصك حاليًا" /> : visibleTasks.map((task) => {
            const done = CLOSED.has(String(task.status || '').toLowerCase());
            return <div key={task.id} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="font-black">{task.title}</div><div className="dawaa-caption mt-1">{task.assigned_name || 'مهمة موجهة لك'} · {task.due_date || 'بدون موعد'} · {task.priority || 'عادي'}</div></div>
                {!done ? <button className="dawaa-button dawaa-button--secondary" onClick={() => void completeTask(task)}><CheckCircle2 className="h-4 w-4" /> تم التنفيذ</button> : <span className="dawaa-brand-chip">مكتملة</span>}
              </div>
            </div>;
          })}
        </div>
      </section>

      <section className="dawaa-card">
        <h2 className="dawaa-title mb-3 text-lg">التنبيهات</h2>
        <div className="space-y-2">
          {visibleNotifications.length === 0 ? <Empty text="لا توجد تنبيهات تخصك حاليًا" /> : visibleNotifications.map((n) => <div key={n.id} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
            <div className="font-black">{n.title}</div>
            <div className="dawaa-caption mt-1">{n.message || n.body}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!n.read && !n.is_read ? <button className="dawaa-button dawaa-button--ghost" onClick={() => void notificationAction('read', n.id)}>تمت القراءة</button> : null}
              {n.requires_action && n.status !== 'completed' ? <button className="dawaa-button dawaa-button--secondary" onClick={() => void notificationAction('completed', n.id)}>تم الإجراء</button> : null}
              <button className="dawaa-button dawaa-button--ghost" onClick={() => void notificationAction('dismissed', n.id)}>إخفاء</button>
            </div>
          </div>)}
        </div>
      </section>
    </div>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: typeof BellRing; label: string; value: number }) {
  return <div className="dawaa-card dawaa-card--soft"><Icon className="h-5 w-5" /><div className="dawaa-caption mt-2">{label}</div><div className="dawaa-title mt-1 text-2xl">{value}</div></div>;
}

function Empty({ text }: { text: string }) {
  return <div className="dawaa-caption rounded-2xl border border-dashed border-[var(--dawaa-theme-border)] p-6 text-center">{text}</div>;
}
