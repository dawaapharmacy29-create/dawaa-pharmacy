export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent' | 'critical';
export type NotificationActionState = 'new' | 'in_progress' | 'completed' | 'dismissed' | 'escalated';

export type CanonicalNotificationType =
  | 'conversation_review'
  | 'staff_task'
  | 'customer_followup'
  | 'customer_request'
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

const TYPE_ALIASES: Record<string, CanonicalNotificationType> = {
  chat_evaluation: 'conversation_review',
  conversation_sales_review: 'conversation_review',
  'تقييم محادثة': 'conversation_review',
  'تقييم المحادثة': 'conversation_review',
  task: 'staff_task',
  employee_task: 'staff_task',
  assignment: 'staff_task',
  followup: 'customer_followup',
  'متابعة': 'customer_followup',
  'متابعة عميل': 'customer_followup',
  'طلب متابعة': 'customer_followup',
  'طلب عميل': 'customer_request',
  delivery: 'delivery_order',
  stock_alert: 'inventory',
  low_stock: 'inventory',
  stagnant_item: 'inventory',
  penalty: 'deduction',
};

export function canonicalNotificationType(value: unknown): CanonicalNotificationType {
  const raw = String(value || 'system').trim().toLowerCase();
  return TYPE_ALIASES[raw] || (raw as CanonicalNotificationType) || 'system';
}

export function notificationRequiresAction(type: unknown, priority: NotificationPriority): boolean {
  const canonical = canonicalNotificationType(type);
  if (priority === 'urgent' || priority === 'critical') return true;
  return [
    'staff_task',
    'customer_followup',
    'customer_request',
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
    staff_task: id ? `/doctor-dashboard?tab=requirements&assignment=${id}` : '/doctor-dashboard?tab=requirements',
    customer_followup: id ? `/customer-service?tab=today&openDetails=1&mode=edit&followupId=${id}` : '/customer-service?tab=today',
    customer_request: id ? `/customer-service?tab=requests&requestId=${id}` : '/customer-service?tab=requests',
    reward: '/doctor-dashboard?tab=payroll',
    deduction: '/doctor-dashboard?tab=payroll',
    payroll: '/doctor-dashboard?tab=payroll',
    attendance: staffId ? `/attendance-report?staffId=${staffId}` : '/attendance-report',
    sales_target: '/daily-target',
    inventory: id ? `/shortages?itemId=${id}` : '/shortages',
    expiry_alert: id ? `/expiry-discounts?itemId=${id}` : '/expiry-discounts',
    delivery_order: id ? `/delivery?orderId=${id}` : '/delivery',
    shift_issue: id ? `/shift-notes?shiftId=${id}` : '/shift-notes',
    manager_alert: '/daily-command',
    vip_customer_silence: id ? `/customers?customerId=${id}` : '/customers',
    system: '/operations-center',
  };
  return routes[type] || '/operations-center';
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
