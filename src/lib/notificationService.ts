import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { logActivity } from '@/lib/activityLog';

export type NotificationType =
  | 'task'
  | 'followup'
  | 'deduction'
  | 'reward'
  | 'conversation_review'
  | 'customer_alert'
  | 'inventory'
  | 'stagnant_item'
  | 'list_item'
  | 'sales_performance'
  | 'delivery'
  | 'manager_alert'
  | 'system';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent' | 'critical';
export type NotificationStatus =
  | 'new'
  | 'read'
  | 'in_progress'
  | 'completed'
  | 'dismissed'
  | 'escalated';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  body: string;
  type: NotificationType | string;
  priority: NotificationPriority | string;
  recipient_staff_id?: string | null;
  recipient_user_id?: string | null;
  recipient_role?: string | null;
  user_id?: string | null;
  branch?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  target_route?: string | null;
  route?: string | null;
  status?: NotificationStatus | string | null;
  is_read: boolean;
  read: boolean;
  requires_action?: boolean | null;
  action_status?: string | null;
  sound_enabled?: boolean | null;
  created_by?: string | null;
  created_by_name?: string | null;
  created_at: string;
  read_at?: string | null;
  completed_at?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface NotificationPayload {
  title: string;
  message?: string;
  body?: string;
  type?: NotificationType | string;
  priority?: NotificationPriority;
  recipient_staff_id?: string | null;
  recipient_user_id?: string | null;
  recipient_role?: string | null;
  user_id?: string | null;
  branch?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  target_route?: string | null;
  route?: string | null;
  status?: NotificationStatus;
  is_read?: boolean;
  read?: boolean;
  requires_action?: boolean;
  action_status?: string | null;
  sound_enabled?: boolean;
  created_by?: string | null;
  created_by_name?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface NotificationFilters {
  userId?: string | null;
  staffId?: string | null;
  role?: string | null;
  branch?: string | null;
  type?: string;
  priority?: string;
  status?: string;
  search?: string;
  limit?: number;
  page?: number;
}

const COLUMN_ALIASES: Record<string, string> = {
  recipient_user_id: 'user_id',
  is_read: 'read',
  message: 'body',
  target_route: 'route',
};

function missingColumn(message: string) {
  return message.match(/'([^']+)' column/)?.[1] || message.match(/column "([^"]+)"/)?.[1] || '';
}

function compactPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));
}

function toLegacyType(type: string) {
  const map: Record<string, string> = {
    reward: 'مكافأة',
    deduction: 'خصم',
    task: 'مهمة',
    followup: 'متابعة',
    conversation_review: 'تقييم محادثة',
    customer_alert: 'تنبيه عميل',
    inventory: 'مخزون',
    stagnant_item: 'رواكد',
    list_item: 'لستة',
    delivery: 'توصيل',
    manager_alert: 'تنبيه مدير',
    system: 'عام',
  };
  return map[type] || type || 'عام';
}

export function normalizeNotification(row: Record<string, unknown>): AppNotification {
  const details =
    typeof row.details === 'object' && row.details
      ? (row.details as Record<string, unknown>)
      : null;
  const metadata =
    typeof row.metadata === 'object' && row.metadata
      ? (row.metadata as Record<string, unknown>)
      : details;
  const message = String(row.message || row.body || row.description || '');
  const route = String(row.target_route || row.route || metadata?.route || '');
  const read = Boolean(row.is_read ?? row.read ?? row.status === 'read');
  return {
    id: String(row.id || ''),
    title: String(row.title || row.type || 'إشعار'),
    message,
    body: message,
    type: String(row.type || 'system'),
    priority: String(row.priority || metadata?.priority || 'normal'),
    recipient_staff_id: row.recipient_staff_id as string | null | undefined,
    recipient_user_id: (row.recipient_user_id || row.user_id) as string | null | undefined,
    recipient_role: row.recipient_role as string | null | undefined,
    user_id: (row.user_id || row.recipient_user_id) as string | null | undefined,
    branch: row.branch as string | null | undefined,
    target_type: row.target_type as string | null | undefined,
    target_id: row.target_id as string | null | undefined,
    target_route: route || null,
    route: route || null,
    status: (row.status as string | null | undefined) || (read ? 'read' : 'new'),
    is_read: read,
    read,
    requires_action: row.requires_action as boolean | null | undefined,
    action_status: row.action_status as string | null | undefined,
    sound_enabled: row.sound_enabled as boolean | null | undefined,
    created_by: row.created_by as string | null | undefined,
    created_by_name: row.created_by_name as string | null | undefined,
    created_at: String(row.created_at || new Date().toISOString()),
    read_at: row.read_at as string | null | undefined,
    completed_at: row.completed_at as string | null | undefined,
    metadata,
  };
}

async function insertNotificationWithFallback(payload: Record<string, unknown>) {
  const next = compactPayload(payload);
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data, error } = await supabase.from('notifications').insert(next).select().single();
    if (!error) return { data: data as Record<string, unknown>, error: null };

    const column = missingColumn(error.message);
    if (!column || removed.has(column)) return { data: null, error };

    removed.add(column);
    if (COLUMN_ALIASES[column] && column in next && !(COLUMN_ALIASES[column] in next)) {
      next[COLUMN_ALIASES[column]] = next[column];
    }
    delete next[column];
  }

  return { data: null, error: new Error('notification insert fallback exceeded') };
}

async function updateNotificationWithFallback(id: string, payload: Record<string, unknown>) {
  const next = compactPayload(payload);
  const removed = new Set<string>();

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await supabase.from('notifications').update(next).eq('id', id);
    if (!error) return true;

    const column = missingColumn(error.message);
    if (!column || removed.has(column)) return false;
    removed.add(column);
    if (COLUMN_ALIASES[column] && column in next && !(COLUMN_ALIASES[column] in next)) {
      next[COLUMN_ALIASES[column]] = next[column];
    }
    delete next[column];
  }

  return false;
}

export async function createNotification(payload: NotificationPayload) {
  if (!isSupabaseConfigured) return null;

  try {
    const now = new Date().toISOString();
    const route =
      typeof payload.target_route === 'string'
        ? payload.target_route
        : typeof payload.route === 'string'
          ? payload.route
          : typeof payload.metadata?.route === 'string'
            ? payload.metadata.route
            : null;
    const message = payload.message || payload.body || '';
    const type = payload.type || 'system';
    const priority = payload.priority || 'normal';
    const record: Record<string, unknown> = {
      title: payload.title,
      message,
      body: message,
      description: message,
      type,
      priority,
      recipient_staff_id: payload.recipient_staff_id || null,
      recipient_user_id: payload.recipient_user_id || payload.user_id || null,
      user_id: payload.user_id || payload.recipient_user_id || null,
      recipient_role: payload.recipient_role || null,
      branch: payload.branch || null,
      target_type: payload.target_type || null,
      target_id: payload.target_id || null,
      target_route: route,
      route,
      status: payload.status || 'new',
      is_read: payload.is_read ?? payload.read ?? false,
      read: payload.read ?? payload.is_read ?? false,
      requires_action: payload.requires_action ?? ['high', 'urgent', 'critical'].includes(priority),
      action_status: payload.action_status || 'new',
      sound_enabled: payload.sound_enabled ?? ['urgent', 'critical'].includes(priority),
      created_by: payload.created_by || null,
      created_by_name: payload.created_by_name || null,
      created_at: now,
      metadata: {
        ...(payload.metadata || {}),
        priority,
        route,
        legacy_type: toLegacyType(String(type)),
      },
      details: {
        ...(payload.metadata || {}),
        priority,
        route,
      },
    };

    const { data, error } = await insertNotificationWithFallback(record);
    if (error || !data) {
      console.warn('Notification insert failed', error);
      return null;
    }

    await logActivity({
      action: 'notification_created',
      module: 'notifications',
      target_type: payload.target_type || 'notification',
      target_id: String(data.id || payload.target_id || ''),
      user_id: payload.created_by || null,
      user_name: payload.created_by_name || 'النظام',
      branch_name: payload.branch || null,
      route_path: route,
      details: {
        title: payload.title,
        type: String(type),
        priority: String(priority),
        recipient_staff_id: payload.recipient_staff_id,
        recipient_user_id: payload.recipient_user_id || payload.user_id,
      },
    }).catch(() => undefined);

    return normalizeNotification(data);
  } catch (error) {
    console.warn('Notification creation skipped', error);
    return null;
  }
}

export async function createBulkNotifications(payloads: NotificationPayload[]) {
  const results = await Promise.all(payloads.map((payload) => createNotification(payload)));
  return results.filter(Boolean) as AppNotification[];
}

export async function markNotificationRead(id: string) {
  if (!isSupabaseConfigured || !id) return false;
  const ok = await updateNotificationWithFallback(id, {
    is_read: true,
    read: true,
    status: 'read',
    read_at: new Date().toISOString(),
  });
  if (ok) await logNotificationAction('notification_read', id);
  return ok;
}

export async function markNotificationCompleted(id: string) {
  if (!isSupabaseConfigured || !id) return false;
  const ok = await updateNotificationWithFallback(id, {
    status: 'completed',
    action_status: 'completed',
    completed_at: new Date().toISOString(),
    is_read: true,
    read: true,
  });
  if (ok) await logNotificationAction('notification_completed', id);
  return ok;
}

export async function dismissNotification(id: string) {
  if (!isSupabaseConfigured || !id) return false;
  const ok = await updateNotificationWithFallback(id, {
    status: 'dismissed',
    action_status: 'dismissed',
    is_read: true,
    read: true,
    read_at: new Date().toISOString(),
  });
  if (ok) await logNotificationAction('notification_dismissed', id);
  return ok;
}

export async function escalateNotification(id: string) {
  if (!isSupabaseConfigured || !id) return false;
  const ok = await updateNotificationWithFallback(id, {
    status: 'escalated',
    action_status: 'escalated',
    priority: 'urgent',
  });
  if (ok) await logNotificationAction('notification_escalated', id);
  return ok;
}

async function logNotificationAction(action: string, id: string) {
  await logActivity({
    action,
    module: 'notifications',
    target_type: 'notification',
    target_id: id,
    details: { notification_id: id },
  }).catch(() => undefined);
}

export async function markAllNotificationsRead(filters: NotificationFilters = {}) {
  if (!isSupabaseConfigured) return false;
  let query = supabase.from('notifications').update({
    is_read: true,
    read: true,
    status: 'read',
    read_at: new Date().toISOString(),
  } as Record<string, unknown>);
  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.staffId) query = query.eq('recipient_staff_id', filters.staffId);
  const { error } = await query;
  if (error) {
    console.warn('Mark all notifications read failed', error);
    return false;
  }
  return true;
}

export async function getRecentNotifications(filters: NotificationFilters = {}) {
  if (!isSupabaseConfigured) return [];
  const limit = Math.min(filters.limit || 20, 100);
  const page = Math.max(filters.page || 1, 1);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  let query = supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (filters.type && filters.type !== 'all') query = query.eq('type', filters.type);
  if (filters.priority && filters.priority !== 'all')
    query = query.eq('priority', filters.priority);
  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status);
  if (filters.branch && filters.branch !== 'all') query = query.eq('branch', filters.branch);
  if (filters.staffId) query = query.eq('recipient_staff_id', filters.staffId);
  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.role) query = query.eq('recipient_role', filters.role);
  if (filters.search?.trim()) {
    const q = `%${filters.search.trim().replace(/\*/g, '%')}%`;
    query = query.or(`title.ilike.${q},body.ilike.${q},message.ilike.${q},description.ilike.${q}`);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('Recent notifications fetch failed', error);
    return [];
  }
  return (data || []).map((row) => normalizeNotification(row as Record<string, unknown>));
}

export async function getUnreadNotificationCount(filters: NotificationFilters = {}) {
  if (!isSupabaseConfigured) return 0;
  let query = supabase.from('notifications').select('id', { count: 'exact', head: true });
  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.staffId) query = query.eq('recipient_staff_id', filters.staffId);
  if (filters.role) query = query.eq('recipient_role', filters.role);
  if (filters.branch && filters.branch !== 'all') query = query.eq('branch', filters.branch);
  query = query.or('read.eq.false,is_read.eq.false,status.eq.new');
  const { count, error } = await query;
  if (error) {
    console.warn('Unread notification count failed', error);
    return 0;
  }
  return count || 0;
}

export function notifyEmployee(payload: NotificationPayload) {
  return createNotification(payload);
}

export function notifyRole(role: string, payload: NotificationPayload) {
  return createNotification({ ...payload, recipient_role: role });
}

export function notifyBranchManagers(payload: NotificationPayload) {
  return createNotification({
    ...payload,
    recipient_role: 'مدير فرع',
    type: payload.type || 'manager_alert',
    priority: payload.priority || 'high',
    requires_action: payload.requires_action ?? true,
  });
}

export function notifyCustomerServiceResponsible(
  payload: NotificationPayload & { branch?: string | null }
) {
  const branch = payload.branch || '';
  const responsibleName = branch.includes('الشامي')
    ? 'د ضحى'
    : branch.includes('شكري')
      ? 'د دنيا'
      : null;
  return createNotification({
    ...payload,
    type: payload.type || 'followup',
    recipient_role: responsibleName || payload.recipient_role || 'customer_service',
    metadata: {
      ...(payload.metadata || {}),
      responsible_name: responsibleName,
    },
  });
}
