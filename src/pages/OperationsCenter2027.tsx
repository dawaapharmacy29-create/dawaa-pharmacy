import { useCallback, useEffect, useMemo, useState, type ElementType, type ReactNode } from 'react';
import {
  BellRing,
  CheckCircle2,
  Clock,
  ExternalLink,
  Plus,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSupabaseQuery, supabaseInsert, supabaseUpdate } from '@/hooks/useSupabaseQuery';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { currentCycleText } from '@/lib/dawaa2027';
import { logActivity } from '@/lib/activityLog';
import {
  dismissNotification,
  escalateNotification,
  markNotificationCompleted,
  markNotificationRead,
  normalizeNotification,
  notifyEmployee,
  type AppNotification,
} from '@/lib/notificationService';

const taskTypes = [
  'متابعة عميل',
  'رواكد',
  'أدوية اللستة',
  'اعتماد خصم',
  'مراجعة موظف',
  'طلب عميل',
  'تحسين بيانات',
];
const priorities = ['عادي', 'مهم', 'خطر'];
const ALL = 'all';

export default function OperationsCenter2027() {
  const { user } = useAuth();
  const { data: tasks, refetch: refetchTasks } = useSupabaseQuery<Record<string, unknown>>({
    table: 'tasks',
    limit: 200,
    orderBy: { column: 'created_at', ascending: false },
    realtimeEnabled: true,
  });
  const [rawNotifications, setRawNotifications] = useState<Record<string, unknown>[]>([]);

  const refetchNotifications = useCallback(() => {
    void supabase
      .rpc('get_my_notifications', {
        p_staff_id: user?.staffId || null,
        p_role: user?.role || null,
        p_branch: user?.branch || null,
        p_limit: 250,
      })
      .then(({ data }) => setRawNotifications((data as Record<string, unknown>[]) || []));
  }, [user?.staffId, user?.role, user?.branch]);

  useEffect(() => {
    refetchNotifications();
  }, [refetchNotifications]);

  const [form, setForm] = useState({
    title: '',
    type: 'متابعة عميل',
    priority: 'مهم',
    due_date: new Date().toISOString().slice(0, 10),
    assigned_to_name: '',
  });
  const [filters, setFilters] = useState({
    type: ALL,
    priority: ALL,
    status: ALL,
    branch: ALL,
    search: '',
  });

  const notifications = useMemo(() => {
    const uniqueRows = new Map<string, AppNotification>();
    for (const row of rawNotifications) {
      const notification = normalizeNotification(row);
      const semanticKey = [
        notification.type,
        notification.target_type,
        notification.target_id || notification.metadata?.entity_id,
        notification.recipient_staff_id,
        notification.branch || notification.metadata?.branch,
        notification.title,
      ]
        .map((value) =>
          String(value || '')
            .trim()
            .toLowerCase()
        )
        .join('|');
      if (!uniqueRows.has(semanticKey)) uniqueRows.set(semanticKey, notification);
    }
    return [...uniqueRows.values()];
  }, [rawNotifications]);

  const normalizedTasks = useMemo(
    () =>
      tasks.map((t) => ({
        id: String(t.id || ''),
        title: String(t.title || t.task_title || t.description || 'مهمة بدون عنوان'),
        type: String(t.type || t.category || 'مهمة'),
        priority: String(t.priority || 'عادي'),
        status: String(t.status || 'open'),
        due_date: String(t.due_date || t.deadline || t.created_at || ''),
        assigned_to_name: String(
          t.assigned_to_name || t.staff_name || t.employee_name || t.assigned_to || 'غير محدد'
        ),
      })),
    [tasks]
  );

  const open = normalizedTasks.filter(
    (t) => !['done', 'completed', 'مكتمل', 'closed'].includes(t.status)
  );
  const urgent = open.filter((t) => ['خطر', 'high', 'urgent', 'critical'].includes(t.priority));
  const today = open.filter(
    (t) => String(t.due_date).slice(0, 10) <= new Date().toISOString().slice(0, 10)
  );
  const unread = notifications.filter((n) => !n.read && !n.is_read);
  const requiresAction = notifications.filter(
    (n) => n.requires_action || ['high', 'urgent', 'critical'].includes(String(n.priority))
  );

  const filteredNotifications = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return notifications.filter((n) => {
      if (filters.type !== ALL && String(n.type) !== filters.type) return false;
      if (filters.priority !== ALL && String(n.priority) !== filters.priority) return false;
      if (
        filters.status !== ALL &&
        String(n.status || (n.read ? 'read' : 'new')) !== filters.status
      )
        return false;
      if (filters.branch !== ALL && String(n.branch || '') !== filters.branch) return false;
      if (!q) return true;
      return `${n.title} ${n.body} ${n.message} ${n.branch} ${n.type}`.toLowerCase().includes(q);
    });
  }, [filters, notifications]);

  const addTask = async () => {
    if (!form.title.trim()) return toast.error('اكتب عنوان المهمة');
    const { data, error } = await supabaseInsert<Record<string, unknown>>('tasks', {
      title: form.title.trim(),
      type: form.type,
      category: form.type,
      priority: form.priority,
      status: 'open',
      due_date: form.due_date,
      assigned_to_name: form.assigned_to_name,
      month_cycle: currentCycleText(),
      description: `مهمة تم إنشاؤها من مركز التنبيهات - ${currentCycleText()}`,
    });
    if (error) return toast.error(error);

    await logActivity({
      action: 'task_created',
      module: 'المهام اليومية',
      target_type: 'task',
      target_id: String(data?.id || ''),
      user_id: user?.id,
      user_name: user?.name,
      user_role: user?.role,
      branch_name: user?.branch,
      route_path: '/operations-center',
      details: {
        title: form.title.trim(),
        type: form.type,
        priority: form.priority,
        assigned_to_name: form.assigned_to_name,
        due_date: form.due_date,
      },
    }).catch(() => undefined);

    await notifyEmployee({
      title: 'مهمة جديدة',
      message: `تم إسناد مهمة: ${form.title.trim()}${form.assigned_to_name ? ` إلى ${form.assigned_to_name}` : ''}`,
      type: 'task',
      priority: form.priority === 'خطر' ? 'urgent' : form.priority === 'مهم' ? 'high' : 'normal',
      target_type: 'task',
      target_id: String(data?.id || ''),
      target_route: '/operations-center',
      branch: user?.branch,
      created_by: user?.id,
      created_by_name: user?.name,
      metadata: { assigned_to_name: form.assigned_to_name, due_date: form.due_date },
    });

    toast.success('تم إنشاء المهمة والتنبيه');
    setForm((f) => ({ ...f, title: '' }));
    refetchTasks();
    refetchNotifications();
  };

  const closeTask = async (id: string) => {
    const task = normalizedTasks.find((item) => item.id === id);
    const { error } = await supabaseUpdate('tasks', id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    } as Record<string, unknown>);
    if (error) return toast.error(error);

    await logActivity({
      action: 'task_completed',
      module: 'المهام اليومية',
      target_type: 'task',
      target_id: id,
      user_id: user?.id,
      user_name: user?.name,
      user_role: user?.role,
      branch_name: user?.branch,
      route_path: '/operations-center',
      old_value: { status: task?.status || 'open' },
      new_value: { status: 'completed' },
      details: { title: task?.title || 'مهمة', assigned_to_name: task?.assigned_to_name },
    }).catch(() => undefined);

    toast.success('تم إغلاق المهمة');
    refetchTasks();
  };

  const runNotificationAction = async (
    action: 'read' | 'completed' | 'dismissed' | 'escalated',
    id: string
  ) => {
    const ok =
      action === 'read'
        ? await markNotificationRead(id)
        : action === 'completed'
          ? await markNotificationCompleted(id)
          : action === 'escalated'
            ? await escalateNotification(id)
            : await dismissNotification(id);
    if (!ok) return toast.error('تعذر تحديث التنبيه');
    toast.success('تم تحديث التنبيه');
    refetchNotifications();
  };

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <span className="dawaa-brand-chip">Smart Notifications</span>
        <h1 className="dawaa-title mt-3 text-2xl">مركز التنبيهات والمهام</h1>
        <p className="dawaa-caption mt-1 font-semibold">
          كل حدث مهم يتحول إلى تنبيه واضح، إجراء مطلوب، وسجل مسؤولية.
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={Clock} label="مهام مفتوحة" value={open.length} hint="تحتاج تنفيذ" />
        <Kpi icon={BellRing} label="غير مقروءة" value={unread.length} hint="تنبيهات حقيقية" />
        <Kpi
          icon={Sparkles}
          label="مهام اليوم والمتأخرة"
          value={today.length}
          hint="أولوية الوردية"
        />
        <Kpi icon={Send} label="مهام خطر" value={urgent.length} hint="تدخل سريع" />
        <Kpi
          icon={ShieldAlert}
          label="تحتاج إجراء"
          value={requiresAction.length}
          hint="مساءلة ومتابعة"
        />
      </div>

      <section className="dawaa-card">
        <h2 className="dawaa-title mb-4 text-lg">إنشاء مهمة تشغيلية</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <input
            className="dawaa-input xl:col-span-2"
            placeholder="عنوان المهمة"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <select
            className="dawaa-select"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {taskTypes.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            className="dawaa-select"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
          >
            {priorities.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <input
            className="dawaa-input"
            type="date"
            value={form.due_date}
            onChange={(e) => setForm({ ...form, due_date: e.target.value })}
          />
          <input
            className="dawaa-input"
            placeholder="المسؤول"
            value={form.assigned_to_name}
            onChange={(e) => setForm({ ...form, assigned_to_name: e.target.value })}
          />
        </div>
        <button onClick={addTask} className="dawaa-button dawaa-button--primary mt-4">
          <Plus className="h-4 w-4" /> إنشاء مهمة وتنبيه
        </button>
      </section>

      <section className="dawaa-card">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex-1">
            <h2 className="dawaa-title text-lg">مركز التنبيهات</h2>
            <p className="dawaa-caption font-semibold">
              فلترة وتنفيذ ومراجعة التنبيهات بدون تحميل كامل الجدول.
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-6">
            <div className="relative md:col-span-2">
              <Search className="dawaa-muted absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                className="dawaa-input w-full pr-10"
                placeholder="بحث في التنبيهات"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              />
            </div>
            <Filter
              value={filters.type}
              onChange={(value) => setFilters({ ...filters, type: value })}
              options={[ALL, ...unique(notifications.map((n) => String(n.type || '')))]}
              allLabel="كل الأنواع"
            />
            <Filter
              value={filters.priority}
              onChange={(value) => setFilters({ ...filters, priority: value })}
              options={[ALL, ...unique(notifications.map((n) => String(n.priority || '')))]}
              allLabel="كل الأولويات"
            />
            <Filter
              value={filters.status}
              onChange={(value) => setFilters({ ...filters, status: value })}
              options={[ALL, 'new', 'read', 'completed', 'dismissed', 'escalated']}
              allLabel="كل الحالات"
            />
            <Filter
              value={filters.branch}
              onChange={(value) => setFilters({ ...filters, branch: value })}
              options={[ALL, ...unique(notifications.map((n) => String(n.branch || '')))]}
              allLabel="كل الفروع"
            />
          </div>
        </div>

        <div className="dawaa-table-shell">
          <table className="dawaa-table-semantic min-w-full text-sm">
            <thead className="text-xs">
              <tr>
                <th className="text-right">التنبيه</th>
                <th className="text-right">الأولوية</th>
                <th className="text-right">الحالة</th>
                <th className="text-right">الفرع</th>
                <th className="text-right">التاريخ</th>
                <th className="text-right">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredNotifications.slice(0, 80).map((n) => (
                <tr key={n.id} className={!n.read && !n.is_read ? 'dawaa-row--highlight' : ''}>
                  <td className="max-w-md">
                    <div className="dawaa-title text-sm">{n.title}</div>
                    <div className="dawaa-caption mt-1 line-clamp-2 text-xs font-semibold leading-5">
                      {n.body || n.message}
                    </div>
                    <div className="dawaa-muted mt-2 text-[11px] font-bold">
                      {n.target_type || n.type}
                    </div>
                  </td>
                  <td>
                    <PriorityBadge value={String(n.priority || 'normal')} />
                  </td>
                  <td className="dawaa-text">{String(n.status || (n.read ? 'read' : 'new'))}</td>
                  <td className="dawaa-text">{n.branch || 'غير محدد'}</td>
                  <td className="dawaa-caption text-xs">
                    {String(n.created_at).slice(0, 16).replace('T', ' ')}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <button
                        className="dawaa-button dawaa-button--secondary min-h-0 px-2 py-1 text-xs"
                        onClick={() => void runNotificationAction('read', n.id)}
                      >
                        قراءة
                      </button>
                      <button
                        className="dawaa-button dawaa-button--secondary min-h-0 px-2 py-1 text-xs"
                        onClick={() => void runNotificationAction('completed', n.id)}
                      >
                        تم التنفيذ
                      </button>
                      <button
                        className="dawaa-button dawaa-button--secondary min-h-0 px-2 py-1 text-xs"
                        onClick={() => void runNotificationAction('escalated', n.id)}
                      >
                        تصعيد
                      </button>
                      <button
                        className="dawaa-button dawaa-button--secondary min-h-0 px-2 py-1 text-xs"
                        onClick={() => void runNotificationAction('dismissed', n.id)}
                      >
                        تجاهل
                      </button>
                      {n.route && (
                        <a
                          className="dawaa-button dawaa-button--ghost min-h-0 px-2 py-1 text-xs"
                          href={n.route}
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredNotifications.length && (
                <tr>
                  <td colSpan={6} className="dawaa-caption py-10 text-center font-bold">
                    لا توجد تنبيهات مطابقة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="dawaa-card">
          <h2 className="dawaa-title mb-4 text-lg">المهام المفتوحة</h2>
          <div className="space-y-3">
            {open.slice(0, 40).map((t) => (
              <div key={t.id} className="dawaa-card dawaa-card--soft p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="dawaa-title text-sm">{t.title}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="dawaa-badge dawaa-badge--info">{t.type}</span>
                      <span className={`dawaa-badge ${priorityTone(t.priority)}`}>{t.priority}</span>
                      <span className="dawaa-badge dawaa-badge--info">{t.assigned_to_name}</span>
                      <span className="dawaa-badge dawaa-badge--info">{String(t.due_date).slice(0, 10)}</span>
                    </div>
                  </div>
                  <button onClick={() => closeTask(t.id)} className="dawaa-action-icon p-2">
                    <CheckCircle2 className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ))}
            {!open.length && <Empty text="لا توجد مهام مفتوحة. ممتاز." />}
          </div>
        </div>

        <div className="dawaa-card">
          <h2 className="dawaa-title mb-4 text-lg">خريطة المساءلة</h2>
          <div className="space-y-3">
            <Accountability
              title="حدث"
              text="أي متابعة، خصم، مكافأة، تقييم، طلب عميل أو مهمة تشغيلية."
            />
            <Accountability
              title="تنبيه"
              text="يصل للموظف أو المسؤول أو المدير حسب الفرع والدور."
            />
            <Accountability
              title="إجراء مطلوب"
              text="قراءة، تنفيذ، تصعيد، أو إغلاق من مركز التنبيهات."
            />
            <Accountability
              title="سجل النشاط"
              text="إنشاء وقراءة وتنفيذ التنبيهات يتم تسجيلها إذا كان activity_log متاحًا."
            />
            <Accountability
              title="أثر الأداء"
              text="النقاط والحوافز تعرض من مصادرها الحالية بدون كتابة نقاط جديدة من هنا."
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function Filter({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  allLabel: string;
}) {
  return (
    <select
      className="dawaa-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option === ALL ? allLabel : option}
        </option>
      ))}
    </select>
  );
}

function priorityTone(value: string) {
  if (/critical|urgent|high|خطر|عاجل|حرج/i.test(value)) return 'dawaa-badge--danger';
  if (/normal|مهم/i.test(value)) return 'dawaa-badge--warning';
  return 'dawaa-badge--info';
}

function PriorityBadge({ value }: { value: string }) {
  return <span className={`dawaa-badge ${priorityTone(value)}`}>{value}</span>;
}

function Accountability({ title, text }: { title: string; text: string }) {
  return (
    <div className="dawaa-card dawaa-card--soft p-4">
      <div className="dawaa-title text-sm">{title}</div>
      <p className="dawaa-caption mt-1 font-semibold leading-6">{text}</p>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: ElementType;
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <div className="dawaa-card">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="dawaa-caption text-xs font-bold">{label}</div>
          <div className="dawaa-title mt-2 text-3xl">{value}</div>
          <div className="dawaa-caption mt-1 text-xs font-semibold">{hint}</div>
        </div>
        <div className="dawaa-icon-tile h-12 w-12">
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="dawaa-empty-state p-6 text-sm font-bold">{text}</div>;
}
