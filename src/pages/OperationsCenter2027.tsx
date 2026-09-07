import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpCircle,
  BellRing,
  CheckCircle2,
  Clock,
  ExternalLink,
  ListChecks,
  MessageSquareText,
  PlayCircle,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  UsersRound,
  Wifi,
  XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useStaffDirectory } from '@/hooks/useStaffDirectory';
import { useSupabaseQuery, supabaseInsert, supabaseUpdate } from '@/hooks/useSupabaseQuery';
import { supabase } from '@/lib/supabase';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { logActivity } from '@/lib/activityLog';
import {
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
type NotificationTab = 'urgent' | 'vip' | 'overdue' | 'completed' | 'reviews' | 'system' | 'all';
type WorkflowState = 'in_progress' | 'completed' | 'dismissed' | 'escalated';

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

const PRIORITY_AR: Record<string, string> = {
  low: 'منخفض',
  normal: 'عادي',
  medium: 'متوسط',
  high: 'مهم',
  urgent: 'عاجل',
  critical: 'حرج',
  خطر: 'عاجل',
  مهم: 'مهم',
  عادي: 'عادي',
};

const TYPE_AR: Record<string, string> = {
  conversation_review: 'تقييم محادثة',
  chat_evaluation: 'تقييم محادثة',
  staff_task: 'مهمة موظف',
  task: 'مهمة موظف',
  staff_task_overdue: 'مهمة متأخرة',
  staff_task_completed: 'مهمة تم تنفيذها',
  customer_followup: 'متابعة عميل',
  customer_request: 'طلب عميل',
  customer_alert: 'تنبيه عميل',
  vip_customer_silence: 'عميل VIP غير نشط',
  vip_customer_health: 'حركة عميل VIP',
  vip_customer_health_digest: 'تقرير عملاء VIP',
  daily_customer_attention_digest: 'عملاء يحتاجون متابعة',
  sync_health: 'حالة المزامنة',
  sync_health_alert: 'مشكلة مزامنة',
  attendance: 'الحضور والانصراف',
  reward: 'مكافأة',
  deduction: 'خصم',
  penalty: 'خصم',
  expiry_alert: 'تنبيه صلاحية',
  system: 'النظام',
};

const ACTION_AR: Record<string, string> = {
  new: 'جديد',
  in_progress: 'قيد المتابعة',
  completed: 'تمت المتابعة',
  dismissed: 'مغلق',
  escalated: 'تم التصعيد',
};

function priorityLabel(value: unknown) {
  const key = String(value || 'normal').trim().toLowerCase();
  return PRIORITY_AR[key] || String(value || 'عادي');
}

function typeLabel(value: unknown) {
  const key = String(value || 'system').trim().toLowerCase();
  return TYPE_AR[key] || 'تنبيه تشغيلي';
}

function actionLabel(value: unknown) {
  const key = String(value || 'new').trim().toLowerCase();
  return ACTION_AR[key] || 'جديد';
}

function notificationGroup(n: AppNotification): NotificationTab {
  const type = String(n.type || '').toLowerCase();
  const title = String(n.title || '').toLowerCase();
  const priority = String(n.priority || '').toLowerCase();
  if (['critical', 'urgent'].includes(priority) || type === 'sync_health_alert') return 'urgent';
  if (type.includes('vip_') || type === 'daily_customer_attention_digest' || title.includes('عميل مهم') || title.includes('vip')) return 'vip';
  if (type === 'staff_task_overdue' || title.includes('متأخر') || title.includes('تأخر')) return 'overdue';
  if (type === 'staff_task_completed' || title.includes('تم تنفيذ') || title.includes('تمت المهمة')) return 'completed';
  if (type.includes('conversation_review') || type === 'chat_evaluation' || title.includes('تقييم محادثة')) return 'reviews';
  if (type.includes('sync_health') || type === 'system' || title.includes('مزامنة') || title.includes('اتصال')) return 'system';
  if (priority === 'high') return 'urgent';
  return 'all';
}

function metadataValue(n: AppNotification, ...keys: string[]) {
  const metadata = n.metadata || {};
  for (const key of keys) {
    const value = metadata[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return null;
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-EG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function OperationsCenter2027() {
  const navigate = useNavigate();
  const { user, checkPermission } = useAuth();
  const role = normalizeRole(user?.role);
  const canCreateTasks = checkPermission('manage_operations') || MANAGER_ROLES.has(role);
  const canSeeAllBranches = ['general_manager', 'executive_manager', 'branches_manager'].includes(role);
  const { data: staffDirectory = [] } = useStaffDirectory();

  const { data: tasks, refetch: refetchTasks } = useSupabaseQuery<TaskRow>({
    table: 'tasks',
    limit: 200,
    orderBy: { column: 'created_at', ascending: false },
    realtimeEnabled: true,
  });

  const [notificationsRaw, setNotificationsRaw] = useState<Record<string, unknown>[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<NotificationTab>('urgent');
  const [actionNotes, setActionNotes] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
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

  const staffOptions = useMemo<StaffOption[]>(() => {
    if (!canCreateTasks) return [];
    const byId = new Map<string, StaffOption>();
    for (const identity of staffDirectory) {
      if (!identity.id || !identity.name || !identity.active || identity.source === 'alias') continue;
      if (!canSeeAllBranches && user?.branch && identity.branch !== user.branch) continue;
      if (!byId.has(identity.id)) {
        byId.set(identity.id, { id: identity.id, name: identity.name, role: identity.role, branch: identity.branch });
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [canCreateTasks, canSeeAllBranches, staffDirectory, user?.branch]);

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
    return tasks.filter((task) => `${task.title || ''} ${task.description || ''} ${task.assigned_name || ''} ${task.priority || ''}`.toLowerCase().includes(q));
  }, [search, tasks]);

  const filteredNotifications = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notifications
      .filter((n) => activeTab === 'all' || notificationGroup(n) === activeTab)
      .filter((n) => !q || `${n.title} ${n.message} ${n.type} ${n.priority} ${n.branch || ''} ${metadataValue(n, 'customerName') || ''} ${metadataValue(n, 'staffName', 'staff_name') || ''}`.toLowerCase().includes(q));
  }, [activeTab, notifications, search]);

  const groupCounts = useMemo(() => {
    const counts: Record<NotificationTab, number> = { urgent: 0, vip: 0, overdue: 0, completed: 0, reviews: 0, system: 0, all: notifications.length };
    for (const n of notifications) counts[notificationGroup(n)] += 1;
    return counts;
  }, [notifications]);

  const openTasks = tasks.filter((task) => !CLOSED.has(String(task.status || '').toLowerCase()));
  const urgentTasks = openTasks.filter((task) => ['خطر', 'high', 'urgent', 'critical'].includes(String(task.priority || '').toLowerCase()));
  const unread = notifications.filter((n) => !n.read && !n.is_read);
  const actionRequired = notifications.filter((n) => n.requires_action || ['high', 'urgent', 'critical'].includes(String(n.priority || '').toLowerCase()));
  const inProgressCount = notifications.filter((n) => String(n.action_status || metadataValue(n, 'actionState') || '') === 'in_progress').length;

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
      action: 'task_created', module: 'operations_center', target_type: 'task', target_id: String(data?.id || ''),
      user_id: user?.id, user_name: user?.name, user_role: user?.role, branch_name: user?.branch,
      route_path: '/operations-center', details: { assigned_staff_id: assignee.id, assigned_name: assignee.name },
    }).catch(() => undefined);

    setForm((current) => ({ ...current, title: '', staff_id: '' }));
    toast.success('تم إنشاء المهمة وإرسال التنبيه للموظف');
    refetchTasks();
    refetchNotifications();
  }

  async function completeTask(task: TaskRow) {
    const { error } = await supabaseUpdate('tasks', task.id, { status: 'completed' });
    if (error) return toast.error(error);
    toast.success('تم إنهاء المهمة — وسيظهر إشعار التنفيذ في قسم المهام التي تمت');
    refetchTasks();
    refetchNotifications();
  }

  async function notificationActionRead(id: string) {
    const ok = await markNotificationRead(id);
    if (!ok) return toast.error('تعذر تحديث التنبيه');
    refetchNotifications();
  }

  async function workflowAction(n: AppNotification, nextState: WorkflowState) {
    const note = (actionNotes[n.id] || '').trim();
    const group = notificationGroup(n);
    const mustRecordOutcome = nextState === 'completed' && ['urgent', 'vip', 'overdue'].includes(group);
    if (mustRecordOutcome && !note) {
      toast.error('اكتب نتيجة المتابعة قبل إغلاق هذا التنبيه المهم');
      return;
    }

    setActionBusy(n.id);
    const { data: ok, error } = await supabase.rpc('transition_notification_action_with_note_v1', {
      p_notification_id: n.id,
      p_next_state: nextState,
      p_note: note || null,
    });
    setActionBusy(null);

    if (error || !ok) {
      toast.error('تعذر تسجيل الإجراء. تأكد أن التنبيه داخل نطاق مسؤوليتك.');
      return;
    }

    const toastByState: Record<WorkflowState, string> = {
      in_progress: 'تم تسجيل أن المتابعة بدأت',
      completed: 'تم حفظ نتيجة المتابعة وإغلاق التنبيه',
      dismissed: 'تم إغلاق التنبيه',
      escalated: 'تم تصعيد التنبيه ورفع أولويته',
    };
    toast.success(toastByState[nextState]);
    setActionNotes((current) => ({ ...current, [n.id]: '' }));
    await logActivity({
      action: `notification_${nextState}`,
      module: 'operations_center',
      target_type: 'notification',
      target_id: n.id,
      user_id: user?.id,
      user_name: user?.name,
      user_role: user?.role,
      branch_name: user?.branch,
      route_path: '/operations-center',
      details: { note: note || null, notification_type: n.type, notification_title: n.title },
    }).catch(() => undefined);
    refetchNotifications();
  }

  function openNotification(n: AppNotification) {
    const route = n.target_route || n.route || (typeof n.metadata?.route === 'string' ? n.metadata.route : null);
    if (route?.startsWith('/')) navigate(route);
  }

  const tabs: Array<{ key: NotificationTab; label: string; icon: typeof BellRing }> = [
    { key: 'urgent', label: 'عاجل', icon: ShieldAlert },
    { key: 'vip', label: 'VIP والعملاء', icon: UsersRound },
    { key: 'overdue', label: 'مهام متأخرة', icon: Clock },
    { key: 'completed', label: 'مهام تمت', icon: CheckCircle2 },
    { key: 'reviews', label: 'تقييمات المحادثات', icon: MessageSquareText },
    { key: 'system', label: 'المزامنة والنظام', icon: Wifi },
    { key: 'all', label: 'الكل', icon: ListChecks },
  ];

  return (
    <div className="space-y-5" dir="rtl">
      <section className="dawaa-card dawaa-card--raised">
        <span className="dawaa-brand-chip">مركز التشغيل اليومي</span>
        <h1 className="dawaa-title mt-3 text-2xl">المهام والتنبيهات</h1>
        <p className="dawaa-caption mt-1 font-semibold">الأهم أولًا: المشكلات الحرجة، عملاء VIP، المهام المتأخرة، تقييمات المحادثات، ثم باقي التنبيهات. كل متابعة مهمة تُسجل باسم من بدأها ونتيجتها.</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={Clock} label="مهامي المفتوحة" value={openTasks.length} />
        <Kpi icon={BellRing} label="تنبيهات غير مقروءة" value={unread.length} />
        <Kpi icon={ShieldAlert} label="تحتاج إجراء" value={actionRequired.length} />
        <Kpi icon={PlayCircle} label="قيد المتابعة" value={inProgressCount} />
        <Kpi icon={Sparkles} label="مهام عاجلة" value={urgentTasks.length} />
      </div>

      <section className="dawaa-card space-y-4">
        <div className="relative max-w-xl">
          <Search className="dawaa-muted absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <input className="dawaa-input w-full pr-10" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم العميل أو الموظف أو نوع التنبيه" />
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button key={key} type="button" onClick={() => setActiveTab(key)} className={activeTab === key ? 'dawaa-button dawaa-button--primary' : 'dawaa-button dawaa-button--secondary'}>
              <Icon className="h-4 w-4" /> {label} <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5 text-xs">{groupCounts[key]}</span>
            </button>
          ))}
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
                <div>
                  <div className="font-black">{task.title}</div>
                  <div className="dawaa-caption mt-1">{task.assigned_name || 'مهمة موجهة لك'} · الموعد {task.due_date || 'غير محدد'} · {priorityLabel(task.priority)}</div>
                </div>
                {!done ? <button className="dawaa-button dawaa-button--secondary" onClick={() => void completeTask(task)}><CheckCircle2 className="h-4 w-4" /> تم التنفيذ</button> : <span className="dawaa-brand-chip">مكتملة</span>}
              </div>
            </div>;
          })}
        </div>
      </section>

      <section className="dawaa-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="dawaa-title text-lg">{tabs.find((tab) => tab.key === activeTab)?.label || 'التنبيهات'}</h2>
          <span className="dawaa-caption">{filteredNotifications.length} تنبيه</span>
        </div>
        <div className="space-y-2">
          {filteredNotifications.length === 0 ? <Empty text="لا توجد تنبيهات في هذا القسم حاليًا" /> : filteredNotifications.map((n) => {
            const score = metadataValue(n, 'score');
            const points = metadataValue(n, 'points_impact', 'pointsImpact');
            const customerName = metadataValue(n, 'customerName');
            const currentSales = metadataValue(n, 'currentSales');
            const previousSales = metadataValue(n, 'previousSalesSamePeriod');
            const changePct = metadataValue(n, 'changePct');
            const improvement = metadataValue(n, 'improvement_note');
            const actionState = String(n.action_status || metadataValue(n, 'actionState') || 'new');
            const actionByName = metadataValue(n, 'actionByName');
            const actionAt = metadataValue(n, 'actionStateUpdatedAt');
            const savedActionNote = metadataValue(n, 'actionNote');
            const terminal = ['completed', 'dismissed'].includes(actionState);
            const group = notificationGroup(n);
            const showWorkflow = ['urgent', 'vip', 'overdue'].includes(group) || Boolean(n.requires_action);
            return <div key={n.id} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-black">{n.title}</div>
                    <span className="dawaa-brand-chip">{priorityLabel(n.priority)}</span>
                    <span className="dawaa-caption">{typeLabel(n.type)}</span>
                    {actionState !== 'new' ? <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5 text-xs font-black">{actionLabel(actionState)}</span> : null}
                  </div>
                  <div className="dawaa-caption mt-1 leading-relaxed">{n.message || n.body}</div>
                  <div className="dawaa-caption mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {n.branch ? <span>الفرع: <b>{n.branch}</b></span> : null}
                    <span>الوقت: <b>{formatDate(n.created_at)}</b></span>
                    {score !== null ? <span>الدرجة: <b>{String(score)}/100</b></span> : null}
                    {points !== null ? <span>تأثير النقاط: <b>{String(points)}</b></span> : null}
                    {customerName !== null ? <span>العميل: <b>{String(customerName)}</b></span> : null}
                    {currentSales !== null ? <span>الحالي: <b>{Number(currentSales).toLocaleString('ar-EG')} ج</b></span> : null}
                    {previousSales !== null ? <span>نفس المدة السابقة: <b>{Number(previousSales).toLocaleString('ar-EG')} ج</b></span> : null}
                    {changePct !== null ? <span>التغير: <b>{String(changePct)}%</b></span> : null}
                  </div>
                  {improvement !== null ? <div className="mt-2 rounded-xl bg-[var(--dawaa-theme-soft)] px-3 py-2 text-xs font-bold">ملاحظة التحسين: {String(improvement)}</div> : null}
                  {(actionByName !== null || savedActionNote !== null) ? (
                    <div className="mt-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] px-3 py-2 text-xs">
                      <b>{actionLabel(actionState)}</b>
                      {actionByName !== null ? <> بواسطة <b>{String(actionByName)}</b></> : null}
                      {actionAt !== null ? <> · {formatDate(String(actionAt))}</> : null}
                      {savedActionNote !== null ? <div className="mt-1 font-bold">النتيجة/الملاحظة: {String(savedActionNote)}</div> : null}
                    </div>
                  ) : null}
                </div>
              </div>

              {showWorkflow && !terminal ? (
                <div className="mt-3 rounded-2xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] p-3">
                  <label className="text-xs font-black">نتيجة المتابعة أو ملاحظة المدير</label>
                  <input
                    className="dawaa-input mt-2 w-full"
                    value={actionNotes[n.id] || ''}
                    onChange={(event) => setActionNotes((current) => ({ ...current, [n.id]: event.target.value }))}
                    placeholder={['urgent', 'vip', 'overdue'].includes(group) ? 'مطلوبة عند إغلاق التنبيه: ماذا تم؟ وما النتيجة؟' : 'ملاحظة اختيارية'}
                  />
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {(n.target_route || n.route || n.metadata?.route) ? <button className="dawaa-button dawaa-button--primary" onClick={() => openNotification(n)}><ExternalLink className="h-4 w-4" /> فتح التفاصيل</button> : null}
                {!n.read && !n.is_read ? <button className="dawaa-button dawaa-button--ghost" onClick={() => void notificationActionRead(n.id)}>تمت القراءة</button> : null}
                {showWorkflow && !terminal && actionState !== 'in_progress' ? <button disabled={actionBusy === n.id} className="dawaa-button dawaa-button--secondary" onClick={() => void workflowAction(n, 'in_progress')}><PlayCircle className="h-4 w-4" /> بدأت المتابعة</button> : null}
                {showWorkflow && !terminal ? <button disabled={actionBusy === n.id} className="dawaa-button dawaa-button--secondary" onClick={() => void workflowAction(n, 'completed')}><CheckCircle2 className="h-4 w-4" /> تمت المتابعة</button> : null}
                {showWorkflow && !terminal ? <button disabled={actionBusy === n.id} className="dawaa-button dawaa-button--ghost" onClick={() => void workflowAction(n, 'escalated')}><ArrowUpCircle className="h-4 w-4" /> تصعيد</button> : null}
                {!terminal ? <button disabled={actionBusy === n.id} className="dawaa-button dawaa-button--ghost" onClick={() => void workflowAction(n, 'dismissed')}><XCircle className="h-4 w-4" /> إغلاق</button> : null}
              </div>
            </div>;
          })}
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
