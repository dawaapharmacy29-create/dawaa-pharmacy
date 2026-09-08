import { useMemo, useState } from 'react';
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
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useStaffDirectory } from '@/hooks/useStaffDirectory';
import { useSupabaseQuery, supabaseInsert, supabaseUpdate } from '@/hooks/useSupabaseQuery';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { logActivity } from '@/lib/activityLog';
import { notifyEmployee, type AppNotification } from '@/lib/notificationService';
import {
  isTerminalNotificationAction,
  notificationActionLabel,
  notificationGroup,
  notificationMetadataValue,
  notificationPriorityLabel,
  notificationRequiresOutcomeNote,
  notificationTypeLabel,
  type NotificationActionState,
  type NotificationGroup,
} from '@/lib/notifications/notificationDomain';
import { transitionNotificationWorkflow } from '@/lib/notifications/notificationWorkflowService';

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
type WorkflowState = Exclude<NotificationActionState, 'new'>;

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

function formatDate(value: string | null | undefined) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ar-EG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function isSlaGenerated(item: AppNotification) {
  return String(notificationMetadataValue(item, 'slaGenerated') || '').toLowerCase() === 'true';
}

function hasActiveSlaBreach(item: AppNotification) {
  if (isSlaGenerated(item)) return false;
  const actionState = String(item.action_status || notificationMetadataValue(item, 'actionState') || 'new');
  if (isTerminalNotificationAction(actionState)) return false;
  return Boolean(notificationMetadataValue(item, 'slaAckBreached')) || Boolean(notificationMetadataValue(item, 'slaResolutionBreached'));
}

export default function OperationsCenter2027() {
  const { user, checkPermission } = useAuth();
  const role = normalizeRole(user?.role);
  const canCreateTasks = checkPermission('manage_operations') || MANAGER_ROLES.has(role);
  const canSeeAllBranches = ['general_manager', 'executive_manager', 'branches_manager'].includes(role);
  const { data: staffDirectory = [] } = useStaffDirectory();
  const {
    notifications,
    refreshNotifications,
    markAsRead,
    handleNotificationClick,
  } = useNotifications();

  const { data: tasks, refetch: refetchTasks } = useSupabaseQuery<TaskRow>({
    table: 'tasks',
    limit: 200,
    orderBy: { column: 'created_at', ascending: false },
    realtimeEnabled: true,
  });

  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<NotificationGroup>('urgent');
  const [actionNotes, setActionNotes] = useState<Record<string, string>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    priority: 'مهم',
    due_date: new Date().toISOString().slice(0, 10),
    staff_id: '',
  });

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

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter((task) => `${task.title || ''} ${task.description || ''} ${task.assigned_name || ''} ${task.priority || ''}`.toLowerCase().includes(q));
  }, [search, tasks]);

  const filteredNotifications = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notifications
      .filter((item) => activeTab === 'all' || notificationGroup(item) === activeTab)
      .filter((item) => !q || `${item.id} ${item.title} ${item.message} ${item.type} ${item.priority} ${item.branch || ''} ${notificationMetadataValue(item, 'sourceNotificationId') || ''} ${notificationMetadataValue(item, 'customerName') || ''} ${notificationMetadataValue(item, 'staffName', 'staff_name') || ''}`.toLowerCase().includes(q));
  }, [activeTab, notifications, search]);

  const groupCounts = useMemo(() => {
    const counts: Record<NotificationGroup, number> = { urgent: 0, vip: 0, overdue: 0, completed: 0, reviews: 0, system: 0, all: notifications.length };
    for (const item of notifications) counts[notificationGroup(item)] += 1;
    return counts;
  }, [notifications]);

  const openTasks = tasks.filter((task) => !CLOSED.has(String(task.status || '').toLowerCase()));
  const urgentTasks = openTasks.filter((task) => ['خطر', 'high', 'urgent', 'critical'].includes(String(task.priority || '').toLowerCase()));
  const unread = notifications.filter((item) => !item.read && !item.is_read);
  const actionRequired = notifications.filter((item) => !isSlaGenerated(item) && (item.requires_action || ['high', 'urgent', 'critical'].includes(String(item.priority || '').toLowerCase())));
  const inProgressCount = notifications.filter((item) => !isSlaGenerated(item) && String(item.action_status || notificationMetadataValue(item, 'actionState') || '') === 'in_progress').length;
  const slaBreaches = notifications.filter(hasActiveSlaBreach);

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
    void refreshNotifications(true);
  }

  async function completeTask(task: TaskRow) {
    const { error } = await supabaseUpdate('tasks', task.id, { status: 'completed' });
    if (error) return toast.error(error);
    toast.success('تم إنهاء المهمة — وسيظهر إشعار التنفيذ في قسم المهام التي تمت');
    refetchTasks();
    void refreshNotifications(true);
  }

  async function notificationActionRead(id: string) {
    const ok = await markAsRead(id);
    if (!ok) return toast.error('تعذر تحديث التنبيه');
  }

  function openNotification(item: AppNotification) {
    if (!isSlaGenerated(item)) {
      handleNotificationClick(item);
      return;
    }
    const sourceId = String(notificationMetadataValue(item, 'sourceNotificationId') || '').trim();
    const source = notifications.find((candidate) => candidate.id === sourceId);
    if (source) {
      handleNotificationClick(source);
      return;
    }
    setActiveTab('all');
    setSearch(sourceId);
    toast.info('تم تحويل العرض إلى التنبيه الأصلي إن كان ضمن السجل المحمّل');
  }

  async function workflowAction(item: AppNotification, nextState: WorkflowState) {
    const note = (actionNotes[item.id] || '').trim();
    if (notificationRequiresOutcomeNote(item, nextState) && !note) {
      toast.error('اكتب نتيجة المتابعة قبل إغلاق هذا التنبيه المهم');
      return;
    }

    setActionBusy(item.id);
    const result = await transitionNotificationWorkflow({
      notificationId: item.id,
      nextState,
      note,
      actor: { id: user?.id, name: user?.name, role: user?.role, branch: user?.branch },
      context: { notificationType: String(item.type || ''), notificationTitle: item.title },
    });
    setActionBusy(null);

    if (!result.ok) {
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
    setActionNotes((current) => ({ ...current, [item.id]: '' }));
    void refreshNotifications(true);
  }

  const tabs: Array<{ key: NotificationGroup; label: string; icon: typeof BellRing }> = [
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Kpi icon={Clock} label="مهامي المفتوحة" value={openTasks.length} />
        <Kpi icon={BellRing} label="تنبيهات غير مقروءة" value={unread.length} />
        <Kpi icon={ShieldAlert} label="تحتاج إجراء" value={actionRequired.length} />
        <Kpi icon={PlayCircle} label="قيد المتابعة" value={inProgressCount} />
        <Kpi icon={ShieldAlert} label="تجاوز SLA" value={slaBreaches.length} />
        <Kpi icon={Sparkles} label="مهام عاجلة" value={urgentTasks.length} />
      </div>

      <section className="dawaa-card space-y-4">
        <div className="relative max-w-xl">
          <Search className="dawaa-muted absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <input className="dawaa-input w-full pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث باسم العميل أو الموظف أو نوع التنبيه" />
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
            <input className="dawaa-input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="عنوان المهمة" />
            <select className="dawaa-select" value={form.staff_id} onChange={(event) => setForm({ ...form, staff_id: event.target.value })}>
              <option value="">اختر الموظف</option>
              {staffOptions.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.role}</option>)}
            </select>
            <select className="dawaa-select" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
              <option>عادي</option><option>مهم</option><option>خطر</option>
            </select>
            <input className="dawaa-input" type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} />
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
                  <div className="dawaa-caption mt-1">{task.assigned_name || 'مهمة موجهة لك'} · الموعد {task.due_date || 'غير محدد'} · {notificationPriorityLabel(task.priority)}</div>
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
          {filteredNotifications.length === 0 ? <Empty text="لا توجد تنبيهات في هذا القسم حاليًا" /> : filteredNotifications.map((item) => {
            const score = notificationMetadataValue(item, 'score');
            const points = notificationMetadataValue(item, 'points_impact', 'pointsImpact');
            const customerName = notificationMetadataValue(item, 'customerName');
            const currentSales = notificationMetadataValue(item, 'currentSales');
            const previousSales = notificationMetadataValue(item, 'previousSalesSamePeriod');
            const changePct = notificationMetadataValue(item, 'changePct');
            const improvement = notificationMetadataValue(item, 'improvement_note');
            const actionState = String(item.action_status || notificationMetadataValue(item, 'actionState') || 'new');
            const actionByName = notificationMetadataValue(item, 'actionByName');
            const actionAt = notificationMetadataValue(item, 'actionStateUpdatedAt');
            const savedActionNote = notificationMetadataValue(item, 'actionNote');
            const slaGenerated = isSlaGenerated(item);
            const slaAckBreached = Boolean(notificationMetadataValue(item, 'slaAckBreached'));
            const slaResolutionBreached = Boolean(notificationMetadataValue(item, 'slaResolutionBreached'));
            const slaAckDeadline = notificationMetadataValue(item, 'slaAckDeadlineAt');
            const slaResolutionDeadline = notificationMetadataValue(item, 'slaResolutionDeadlineAt');
            const sourceNotificationId = notificationMetadataValue(item, 'sourceNotificationId');
            const terminal = isTerminalNotificationAction(actionState);
            const group = notificationGroup(item);
            const showWorkflow = !slaGenerated && (['urgent', 'vip', 'overdue'].includes(group) || Boolean(item.requires_action));
            return <div key={item.id} className="rounded-2xl border border-[var(--dawaa-theme-border)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-black">{item.title}</div>
                    <span className="dawaa-brand-chip">{notificationPriorityLabel(item.priority)}</span>
                    <span className="dawaa-caption">{notificationTypeLabel(item.type)}</span>
                    {slaGenerated ? <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5 text-xs font-black">تصعيد SLA</span> : null}
                    {actionState !== 'new' ? <span className="rounded-full border border-[var(--dawaa-theme-border)] px-2 py-0.5 text-xs font-black">{notificationActionLabel(actionState)}</span> : null}
                  </div>
                  <div className="dawaa-caption mt-1 leading-relaxed">{item.message || item.body}</div>
                  <div className="dawaa-caption mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {item.branch ? <span>الفرع: <b>{item.branch}</b></span> : null}
                    <span>الوقت: <b>{formatDate(item.created_at)}</b></span>
                    {score !== null ? <span>الدرجة: <b>{String(score)}/100</b></span> : null}
                    {points !== null ? <span>تأثير النقاط: <b>{String(points)}</b></span> : null}
                    {customerName !== null ? <span>العميل: <b>{String(customerName)}</b></span> : null}
                    {currentSales !== null ? <span>الحالي: <b>{Number(currentSales).toLocaleString('ar-EG')} ج</b></span> : null}
                    {previousSales !== null ? <span>نفس المدة السابقة: <b>{Number(previousSales).toLocaleString('ar-EG')} ج</b></span> : null}
                    {changePct !== null ? <span>التغير: <b>{String(changePct)}%</b></span> : null}
                  </div>
                  {!slaGenerated && (slaAckBreached || slaResolutionBreached) ? (
                    <div className="mt-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] px-3 py-2 text-xs font-bold">
                      <div>{slaResolutionBreached ? 'تجاوز زمن إغلاق التنبيه' : 'تجاوز زمن بدء المتابعة'}</div>
                      <div className="dawaa-caption mt-1">
                        الموعد المستهدف: {formatDate(String(slaResolutionBreached ? slaResolutionDeadline || '' : slaAckDeadline || ''))}
                      </div>
                    </div>
                  ) : null}
                  {slaGenerated && sourceNotificationId !== null ? (
                    <div className="mt-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] px-3 py-2 text-xs font-bold">
                      هذا تنبيه تصعيد إداري مرتبط بالتنبيه الأصلي؛ الإجراء يتم على الأصل وليس على نسخة التصعيد.
                    </div>
                  ) : null}
                  {improvement !== null ? <div className="mt-2 rounded-xl bg-[var(--dawaa-theme-soft)] px-3 py-2 text-xs font-bold">ملاحظة التحسين: {String(improvement)}</div> : null}
                  {(actionByName !== null || savedActionNote !== null) ? (
                    <div className="mt-2 rounded-xl border border-[var(--dawaa-theme-border)] bg-[var(--dawaa-theme-soft)] px-3 py-2 text-xs">
                      <b>{notificationActionLabel(actionState)}</b>
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
                    value={actionNotes[item.id] || ''}
                    onChange={(event) => setActionNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder={notificationRequiresOutcomeNote(item, 'completed') ? 'مطلوبة عند إغلاق التنبيه: ماذا تم؟ وما النتيجة؟' : 'ملاحظة اختيارية'}
                  />
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="dawaa-button dawaa-button--primary" onClick={() => openNotification(item)}><ExternalLink className="h-4 w-4" /> {slaGenerated ? 'فتح التنبيه الأصلي' : 'فتح التفاصيل'}</button>
                {!item.read && !item.is_read ? <button className="dawaa-button dawaa-button--ghost" onClick={() => void notificationActionRead(item.id)}>تمت القراءة</button> : null}
                {showWorkflow && !terminal && actionState !== 'in_progress' ? <button disabled={actionBusy === item.id} className="dawaa-button dawaa-button--secondary" onClick={() => void workflowAction(item, 'in_progress')}><PlayCircle className="h-4 w-4" /> بدأت المتابعة</button> : null}
                {showWorkflow && !terminal ? <button disabled={actionBusy === item.id} className="dawaa-button dawaa-button--secondary" onClick={() => void workflowAction(item, 'completed')}><CheckCircle2 className="h-4 w-4" /> تمت المتابعة</button> : null}
                {showWorkflow && !terminal ? <button disabled={actionBusy === item.id} className="dawaa-button dawaa-button--ghost" onClick={() => void workflowAction(item, 'escalated')}><ArrowUpCircle className="h-4 w-4" /> تصعيد</button> : null}
                {!slaGenerated && !terminal ? <button disabled={actionBusy === item.id} className="dawaa-button dawaa-button--ghost" onClick={() => void workflowAction(item, 'dismissed')}><XCircle className="h-4 w-4" /> إغلاق</button> : null}
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
