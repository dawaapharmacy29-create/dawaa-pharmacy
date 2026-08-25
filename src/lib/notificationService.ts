import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { logActivity } from '@/lib/activityLog';
import { buildNotificationDedupeKey, canonicalNotificationRoute, canonicalNotificationType } from '@/lib/notifications/notificationDomain';

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
  const route = String(row.action_url || row.target_route || row.route || metadata?.route || '');
  const read = Boolean(row.is_read ?? row.read ?? row.status === 'read');
  return {
    id: String(row.id || ''),
    title: String(row.title || row.type || 'إشعار'),
    message,
    body: message,
    type: String(row.notification_type || row.type || 'system'),
    priority: String(row.priority || metadata?.priority || 'normal'),
    recipient_staff_id: row.recipient_staff_id as string | null | undefined,
    recipient_user_id: (row.recipient_user_id || row.user_id) as string | null | undefined,
    recipient_role: row.recipient_role as string | null | undefined,
    user_id: (row.user_id || row.recipient_user_id) as string | null | undefined,
    branch: row.branch as string | null | undefined,
    target_type: (row.entity_type || row.target_type) as string | null | undefined,
    target_id: (row.entity_id || row.target_id) as string | null | undefined,
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

export async function createNotification(payload: NotificationPayload) {
  if (!isSupabaseConfigured) return null;

  try {
    const type = canonicalNotificationType(payload.type || 'system');
    const route = canonicalNotificationRoute({
      type,
      entityId: payload.target_id || undefined,
      explicitRoute: payload.target_route || payload.route || (typeof payload.metadata?.route === 'string' ? payload.metadata.route : undefined),
      recipientStaffId: payload.recipient_staff_id || undefined,
    });
    const message = payload.message || payload.body || '';
    const priority = payload.priority || 'normal';
    const dedupeKey = buildNotificationDedupeKey({ type, recipientStaffId: payload.recipient_staff_id || payload.recipient_role || undefined, entityType: payload.target_type || undefined, entityId: payload.target_id || undefined });
    const { data: id, error } = await supabase.rpc('create_notification_audience_v1', {
      p_recipient_staff_id: payload.recipient_staff_id || null,
      p_recipient_role: payload.recipient_role || null,
      p_branch: payload.branch || null,
      p_notification_type: type,
      p_title: payload.title,
      p_message: message,
      p_entity_type: payload.target_type || null,
      p_entity_id: payload.target_id || null,
      p_action_url: route || null,
      p_priority: priority,
      p_metadata: { ...(payload.metadata || {}), requiresAction: payload.requires_action ?? ['high','urgent','critical'].includes(priority), soundEnabled: payload.sound_enabled ?? ['urgent','critical'].includes(priority), createdByName: payload.created_by_name || null },
      p_dedupe_key: dedupeKey || null,
    });
    if (error || !id) {
      console.warn('Notification insert failed', error);
      return null;
    }

    await logActivity({
      action: 'notification_created',
      module: 'notifications',
      target_type: payload.target_type || 'notification',
      target_id: String(id || payload.target_id || ''),
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

    const { data } = await supabase.from('notifications').select('*').eq('id', String(id)).maybeSingle();
    return data ? normalizeNotification(data as Record<string, unknown>) : null;
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
  const { data: ok, error } = await supabase.rpc('mark_my_notification_read_v1', { p_notification_id: id });
  if (error) return false;
  if (ok) await logNotificationAction('notification_read', id);
  return ok;
}

export async function markNotificationCompleted(id: string) {
  if (!isSupabaseConfigured || !id) return false;
  const { data: ok, error } = await supabase.rpc('transition_staff_notification_action', { p_notification_id: id, p_next_state: 'completed' });
  if (error) return false;
  if (ok) await logNotificationAction('notification_completed', id);
  return ok;
}

export async function dismissNotification(id: string) {
  if (!isSupabaseConfigured || !id) return false;
  const { data: ok, error } = await supabase.rpc('transition_staff_notification_action', { p_notification_id: id, p_next_state: 'dismissed' });
  if (error) return false;
  if (ok) await logNotificationAction('notification_dismissed', id);
  return ok;
}

export async function escalateNotification(id: string) {
  if (!isSupabaseConfigured || !id) return false;
  const { data: ok, error } = await supabase.rpc('transition_staff_notification_action', { p_notification_id: id, p_next_state: 'escalated' });
  if (error) return false;
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
  const { error } = await supabase.rpc('mark_all_my_notifications_read_v1');
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
  return createNotification({
    ...payload,
    type: payload.type || 'followup',
    recipient_role: payload.recipient_role || 'customer_service_manager',
    branch,
    metadata: {
      ...(payload.metadata || {}),
      audience: 'branch_customer_service_manager',
    },
  });
}
