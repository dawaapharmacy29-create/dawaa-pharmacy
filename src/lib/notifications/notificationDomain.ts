export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent' | 'critical';
export type NotificationActionState = 'new' | 'in_progress' | 'completed' | 'dismissed' | 'escalated';
export type NotificationLifecycleState = NotificationActionState | 'read';
export type NotificationGroup = 'urgent' | 'vip' | 'overdue' | 'completed' | 'reviews' | 'system' | 'all';
export type NotificationPreferenceCategory = 'customerService' | 'delivery' | 'inventory' | 'reviews' | 'attendance' | 'targets' | 'other';

export type CanonicalNotificationType =
  | 'conversation_review'
  | 'staff_task'
  | 'customer_followup'
  | 'customer_request'
  | 'customer_data_review'
  | 'welcome_task'
  | 'reward'
  | 'deduction'
  | 'payroll'
  | 'attendance'
  | 'sales_target'
  | 'inventory'
  | 'expiry_alert'
  | 'delivery_order'
  | 'shift_issue'
  | 'manager_alert'
  | 'vip_customer_silence'
  | 'system';

export type NotificationLike = {
  type?: unknown;
  target_type?: unknown;
  title?: unknown;
  message?: unknown;
  body?: unknown;
  priority?: unknown;
  status?: unknown;
  action_status?: unknown;
  requires_action?: unknown;
  metadata?: Record<string, unknown> | null;
  created_at?: unknown;
};

const CANONICAL_TYPES = new Set<CanonicalNotificationType>([
  'conversation_review',
  'staff_task',
  'customer_followup',
  'customer_request',
  'customer_data_review',
  'welcome_task',
  'reward',
  'deduction',
  'payroll',
  'attendance',
  'sales_target',
  'inventory',
  'expiry_alert',
  'delivery_order',
  'shift_issue',
  'manager_alert',
  'vip_customer_silence',
  'system',
]);

const TYPE_ALIASES: Record<string, CanonicalNotificationType> = {
  chat_evaluation: 'conversation_review',
  conversation_sales_review: 'conversation_review',
  'تقييم محادثة': 'conversation_review',
  'تقييم المحادثة': 'conversation_review',

  task: 'staff_task',
  employee_task: 'staff_task',
  assignment: 'staff_task',
  cleaning_task: 'staff_task',
  branch_manager_task: 'staff_task',
  staff_task_overdue: 'staff_task',
  staff_task_completed: 'staff_task',

  followup: 'customer_followup',
  'متابعة': 'customer_followup',
  'متابعة عميل': 'customer_followup',
  'طلب متابعة': 'customer_followup',
  'طلب عميل': 'customer_request',
  customer_alert: 'customer_followup',
  customer_service_progress: 'customer_followup',
  customer_service_incomplete: 'customer_followup',
  daily_followup_queue_missing: 'customer_followup',

  delivery: 'delivery_order',
  stock_alert: 'inventory',
  low_stock: 'inventory',
  stagnant_item: 'inventory',
  penalty: 'deduction',

  vip_customer_health: 'vip_customer_silence',
  vip_customer_health_digest: 'vip_customer_silence',
  daily_customer_attention_digest: 'vip_customer_silence',

  branch_manager_operational_digest: 'manager_alert',
  branch_manager_checklist_gap: 'manager_alert',
  monthly_evaluation_ready: 'manager_alert',
  weekly_evaluation_submitted: 'manager_alert',
  reminder: 'manager_alert',

  sync_health: 'system',
  sync_health_alert: 'system',
};

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
  task: 'مهمة',
  employee_task: 'مهمة موظف',
  staff_task: 'مهمة موظف',
  cleaning_task: 'مهمة نظافة',
  branch_manager_task: 'مهمة مدير فرع',
  staff_task_overdue: 'مهمة متأخرة',
  staff_task_completed: 'مهمة تم تنفيذها',
  followup: 'متابعة عميل',
  customer_followup: 'متابعة عميل',
  customer_request: 'طلب عميل',
  customer_data_review: 'مراجعة بيانات عميل',
  welcome_task: 'مهمة ترحيب بعميل',
  conversation_review: 'تقييم محادثة',
  chat_evaluation: 'تقييم محادثة',
  customer_alert: 'تنبيه عميل',
  customer_service_progress: 'تقدم خدمة العملاء',
  customer_service_incomplete: 'متابعة خدمة عملاء غير مكتملة',
  daily_followup_queue_missing: 'نقص في قائمة المتابعات اليومية',
  vip_customer_silence: 'عميل VIP غير نشط',
  vip_customer_health: 'حركة عميل VIP',
  vip_customer_health_digest: 'تقرير عملاء VIP',
  daily_customer_attention_digest: 'عملاء يحتاجون متابعة',
  delivery: 'الدليفري',
  delivery_order: 'طلب توصيل',
  attendance: 'الحضور والانصراف',
  shift_issue: 'ملاحظة شيفت',
  sales_target: 'التارجت والمبيعات',
  low_stock: 'نقص مخزون',
  stock_alert: 'تنبيه مخزون',
  inventory: 'المخزون',
  expiry_alert: 'تنبيه صلاحية',
  reward: 'مكافأة',
  deduction: 'خصم',
  penalty: 'خصم',
  payroll: 'الرواتب والحوافز',
  branch_manager_operational_digest: 'ملخص تشغيل الفرع',
  branch_manager_checklist_gap: 'نقص في قائمة مدير الفرع',
  monthly_evaluation_ready: 'تقييم شهري جاهز',
  weekly_evaluation_submitted: 'تم إرسال تقييم أسبوعي',
  reminder: 'تذكير إداري',
  sync_health: 'حالة المزامنة',
  sync_health_alert: 'مشكلة مزامنة',
  manager_alert: 'تنبيه إداري',
  system: 'تنبيه نظام',
};

const ACTION_AR: Record<string, string> = {
  new: 'جديد',
  unread: 'جديد',
  read: 'مقروء',
  in_progress: 'قيد المتابعة',
  completed: 'تمت المتابعة',
  dismissed: 'مغلق',
  escalated: 'تم التصعيد',
  overdue: 'متأخر',
};

const NOTE_REQUIRED_TYPES = new Set<CanonicalNotificationType>([
  'staff_task',
  'customer_followup',
  'customer_request',
  'customer_data_review',
  'welcome_task',
  'inventory',
  'expiry_alert',
  'delivery_order',
  'shift_issue',
  'manager_alert',
  'vip_customer_silence',
]);

export function canonicalNotificationType(value: unknown): CanonicalNotificationType {
  const raw = String(value || 'system').trim().toLowerCase();
  if (TYPE_ALIASES[raw]) return TYPE_ALIASES[raw];
  if (CANONICAL_TYPES.has(raw as CanonicalNotificationType)) return raw as CanonicalNotificationType;
  return 'system';
}

export function notificationPriorityLabel(value: unknown): string {
  const raw = String(value || 'normal').trim().toLowerCase();
  return PRIORITY_AR[raw] || (/[\u0600-\u06ff]/.test(raw) ? String(value) : 'عادي');
}

export function notificationTypeLabel(value: unknown): string {
  const raw = String(value || 'system').trim().toLowerCase();
  return TYPE_AR[raw] || TYPE_AR[canonicalNotificationType(raw)] || (/[\u0600-\u06ff]/.test(raw) ? String(value) : 'تنبيه تشغيلي');
}

export function notificationActionLabel(value: unknown): string {
  const raw = String(value || 'new').trim().toLowerCase();
  return ACTION_AR[raw] || (/[\u0600-\u06ff]/.test(raw) ? String(value) : 'جديد');
}

export function notificationMetadataValue(item: NotificationLike, ...keys: string[]): unknown | null {
  const metadata = item.metadata || {};
  for (const key of keys) {
    const value = metadata[key];
    if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  }
  return null;
}

export function notificationPreferenceCategory(type: unknown): NotificationPreferenceCategory {
  switch (canonicalNotificationType(type)) {
    case 'customer_followup':
    case 'customer_request':
    case 'customer_data_review':
    case 'welcome_task':
    case 'manager_alert':
    case 'vip_customer_silence':
      return 'customerService';
    case 'delivery_order':
      return 'delivery';
    case 'inventory':
    case 'expiry_alert':
      return 'inventory';
    case 'conversation_review':
      return 'reviews';
    case 'attendance':
    case 'shift_issue':
      return 'attendance';
    case 'sales_target':
      return 'targets';
    default:
      return 'other';
  }
}

function notificationClassification(item: NotificationLike) {
  const rawType = String(item.type || item.target_type || '').trim().toLowerCase();
  const canonical = canonicalNotificationType(rawType);
  const text = `${rawType} ${item.title || ''} ${item.message || ''} ${item.body || ''}`.toLowerCase();
  const priority = String(item.priority || '').trim().toLowerCase();
  const actionState = String(item.action_status || notificationMetadataValue(item, 'actionState') || '').toLowerCase();
  const completed = actionState === 'completed' || rawType === 'staff_task_completed' || /تمت المهمة|تم تنفيذ|اكتملت المهمة/.test(text);
  const dismissed = actionState === 'dismissed';
  const slaGenerated = String(notificationMetadataValue(item, 'slaGenerated') || '').toLowerCase() === 'true';
  const slaBreached = String(notificationMetadataValue(item, 'slaAckBreached', 'ackBreached') || '').toLowerCase() === 'true'
    || String(notificationMetadataValue(item, 'slaResolutionBreached', 'resolutionBreached') || '').toLowerCase() === 'true';

  return {
    rawType,
    canonical,
    text,
    priority,
    actionState,
    completed,
    dismissed,
    slaGenerated,
    slaBreached,
    overdue: rawType === 'staff_task_overdue' || /overdue|مهمة متأخرة|تأخر|فات موعد/.test(text),
    vip: rawType.startsWith('vip_') || rawType === 'daily_customer_attention_digest' || canonical === 'vip_customer_silence' || /عميل مهم|عميل vip|vip/.test(text),
    reviews: canonical === 'conversation_review' || /تقييم محادثة/.test(text),
    system: rawType.startsWith('sync_health') || canonical === 'system' || /مزامن|offline|اتصال/.test(text),
  };
}

export function notificationMatchesGroup(item: NotificationLike, group: NotificationGroup): boolean {
  if (group === 'all') return true;
  const c = notificationClassification(item);
  if (group === 'completed') return c.completed;
  if (c.completed || c.dismissed) return false;
  if (group === 'overdue') return c.overdue;
  if (group === 'vip') return c.vip;
  if (group === 'reviews') return c.reviews;
  if (group === 'system') return c.system;
  if (group === 'urgent') {
    return ['high', 'urgent', 'critical'].includes(c.priority) || c.slaBreached || c.slaGenerated;
  }
  return false;
}

export function notificationGroups(item: NotificationLike): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  for (const group of ['urgent', 'vip', 'overdue', 'completed', 'reviews', 'system'] as NotificationGroup[]) {
    if (notificationMatchesGroup(item, group)) groups.push(group);
  }
  return groups.length ? groups : ['all'];
}

export function notificationGroup(item: NotificationLike): NotificationGroup {
  const groups = notificationGroups(item);
  for (const preferred of ['completed', 'overdue', 'vip', 'reviews', 'urgent', 'system'] as NotificationGroup[]) {
    if (groups.includes(preferred)) return preferred;
  }
  return 'all';
}

export function notificationOperationalScore(item: NotificationLike): number {
  const priority = String(item.priority || '').toLowerCase();
  const text = `${item.type || ''} ${item.title || ''} ${item.body || ''} ${item.message || ''} ${item.status || ''}`.toLowerCase();
  const meta = item.metadata || {};
  let score = priority === 'critical' ? 1000 : priority === 'urgent' ? 900 : priority === 'high' ? 700 : priority === 'normal' ? 300 : 200;

  if (notificationMatchesGroup(item, 'system') && /مزامن|offline|توقف|sync_health/.test(text)) score += 180;
  if (notificationMatchesGroup(item, 'vip')) score += 160;
  if (notificationMatchesGroup(item, 'overdue')) score += 150;
  if (String(notificationMetadataValue(item, 'slaAckBreached', 'slaResolutionBreached') || '').toLowerCase() === 'true') score += 170;
  if (/مختفي|توقف عن الشراء|تراجع قوي/.test(text)) score += 140;
  if (notificationMatchesGroup(item, 'reviews')) {
    const scoreValue = Number(meta.score ?? meta.total_score ?? meta.review_score ?? NaN);
    score += Number.isFinite(scoreValue) && scoreValue < 80 ? 120 : 20;
  }
  if (notificationMatchesGroup(item, 'completed')) score -= 120;
  if (/ممتاز|100\/100|نمو قوي|تحسن/.test(text)) score -= 30;
  return score;
}

export function compareNotificationsOperationally(a: NotificationLike, b: NotificationLike): number {
  const scoreDiff = notificationOperationalScore(b) - notificationOperationalScore(a);
  if (scoreDiff !== 0) return scoreDiff;
  const aTime = new Date(String(a.created_at || 0)).getTime();
  const bTime = new Date(String(b.created_at || 0)).getTime();
  return bTime - aTime;
}

export function notificationLifecycleState(item: NotificationLike): NotificationLifecycleState {
  const raw = String(
    item.action_status ||
    notificationMetadataValue(item, 'actionState') ||
    item.status ||
    'new'
  ).trim().toLowerCase();
  if (raw === 'unread') return 'new';
  if (['new', 'read', 'in_progress', 'completed', 'dismissed', 'escalated'].includes(raw)) {
    return raw as NotificationLifecycleState;
  }
  return 'new';
}

export function notificationTransitionAllowed(item: NotificationLike, nextState: Exclude<NotificationActionState, 'new'>): boolean {
  const currentState = notificationLifecycleState(item);
  const requiresAction = Boolean(item.requires_action);
  if (currentState === nextState) return true;
  if (currentState === 'completed' || currentState === 'dismissed') return false;
  if ((currentState === 'new' || currentState === 'read') && nextState === 'completed' && requiresAction) return false;
  if (currentState === 'new' || currentState === 'read') return ['in_progress', 'dismissed', 'escalated'].includes(nextState);
  if (currentState === 'in_progress') return ['completed', 'dismissed', 'escalated'].includes(nextState);
  if (currentState === 'escalated') return ['in_progress', 'completed', 'dismissed'].includes(nextState);
  return false;
}

export function notificationRequiresOutcomeNote(item: NotificationLike, nextState: NotificationActionState): boolean {
  if (!['completed', 'dismissed'].includes(nextState)) return false;
  const canonical = canonicalNotificationType(item.type || item.target_type);
  const priority = String(item.priority || 'normal').trim().toLowerCase();
  return Boolean(item.requires_action)
    || ['high', 'urgent', 'critical'].includes(priority)
    || NOTE_REQUIRED_TYPES.has(canonical);
}

export function notificationRequiresAction(type: unknown, priority: NotificationPriority): boolean {
  const canonical = canonicalNotificationType(type);
  if (priority === 'urgent' || priority === 'critical') return true;
  return [
    'staff_task',
    'customer_followup',
    'customer_request',
    'customer_data_review',
    'welcome_task',
    'deduction',
    'attendance',
    'inventory',
    'expiry_alert',
    'delivery_order',
    'shift_issue',
    'manager_alert',
    'vip_customer_silence',
  ].includes(canonical);
}

export function canonicalNotificationRoute(input: {
  type: unknown;
  entityId?: unknown;
  explicitRoute?: unknown;
  recipientStaffId?: unknown;
}): string {
  const explicit = String(input.explicitRoute || '').trim();
  if (explicit.startsWith('/')) return explicit;

  const id = encodeURIComponent(String(input.entityId || '').trim());
  const staffId = encodeURIComponent(String(input.recipientStaffId || '').trim());
  const type = canonicalNotificationType(input.type);

  const routes: Record<CanonicalNotificationType, string> = {
    conversation_review: id ? `/doctor-dashboard?tab=reviews&review=${id}` : '/doctor-dashboard?tab=reviews',
    staff_task: id ? `/operations-center?taskId=${id}` : '/operations-center',
    customer_followup: id ? `/customer-service?tab=today&openDetails=1&mode=edit&followupId=${id}` : '/customer-service?tab=today',
    customer_request: id ? `/customer-service?tab=requests&requestId=${id}` : '/customer-service?tab=requests',
    customer_data_review: '/customer-service?tab=data-review',
    welcome_task: id ? `/customer-service?tab=welcome&taskId=${id}` : '/customer-service?tab=welcome',
    reward: '/doctor-dashboard?tab=payroll',
    deduction: '/doctor-dashboard?tab=payroll',
    payroll: '/doctor-dashboard?tab=payroll',
    attendance: staffId ? `/attendance-report?staffId=${staffId}` : '/attendance-report',
    sales_target: '/daily-target',
    inventory: id ? `/shortages?itemId=${id}` : '/shortages',
    expiry_alert: id ? `/expiry-discounts?itemId=${id}` : '/expiry-discounts',
    delivery_order: id ? `/delivery?orderId=${id}` : '/delivery',
    shift_issue: id ? `/shift-notes?shiftId=${id}` : '/shift-notes',
    manager_alert: '/operations-center',
    vip_customer_silence: id ? `/customers?customerId=${id}` : '/customers',
    system: '/operations-center',
  };
  return routes[type];
}

function cleanPart(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 160);
}

export function buildNotificationDedupeKey(input: {
  type: unknown;
  recipientStaffId?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  stateKey?: unknown;
}): string | null {
  const type = canonicalNotificationType(input.type);
  const recipient = cleanPart(input.recipientStaffId);
  const entityType = cleanPart(input.entityType);
  const entityId = cleanPart(input.entityId);
  const stateKey = cleanPart(input.stateKey || 'current');
  if (!recipient || !entityId) return null;
  return [type, recipient, entityType || 'entity', entityId, stateKey].join(':');
}

export function isTerminalNotificationAction(state: unknown): boolean {
  return ['completed', 'dismissed'].includes(String(state || '').toLowerCase());
}
