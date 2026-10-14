import type {
  CanonicalNotificationType,
  NotificationPriority,
} from '@/lib/notifications/notificationDomain';

export type NotificationType = CanonicalNotificationType | string;
export type NotificationStatus = 'new' | 'read' | 'in_progress' | 'completed' | 'dismissed' | 'escalated';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  body: string;
  type: NotificationType;
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
  type?: NotificationType;
  priority?: NotificationPriority;
  recipient_staff_id?: string | null;
  recipient_role?: string | null;
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

// Notifications are intentionally paused in the admin application.
// Keep the public API stable so existing business flows do not fail while the
// notification subsystem is disabled.
export const CANONICAL_NOTIFICATION_READ_MODEL = 'notification_events_v2';
export const NOTIFICATIONS_ENABLED = false;

export function normalizeNotification(row: Record<string, unknown>): AppNotification {
  const message = String(row.message || row.body || '');
  return {
    id: String(row.id || ''),
    title: String(row.title || 'إشعار'),
    message,
    body: message,
    type: String(row.type || 'system'),
    priority: String(row.priority || 'normal'),
    recipient_staff_id: row.recipient_staff_id as string | null | undefined,
    recipient_user_id: row.recipient_user_id as string | null | undefined,
    user_id: row.recipient_user_id as string | null | undefined,
    recipient_role: row.recipient_role as string | null | undefined,
    branch: row.branch as string | null | undefined,
    target_type: row.target_type as string | null | undefined,
    target_id: row.target_id as string | null | undefined,
    target_route: row.target_route as string | null | undefined,
    route: row.route as string | null | undefined,
    status: String(row.status || 'read'),
    is_read: true,
    read: true,
    requires_action: false,
    action_status: row.action_status as string | null | undefined,
    sound_enabled: false,
    created_by: row.created_by as string | null | undefined,
    created_by_name: row.created_by_name as string | null | undefined,
    created_at: String(row.created_at || new Date().toISOString()),
    read_at: row.read_at as string | null | undefined,
    completed_at: row.completed_at as string | null | undefined,
    metadata: row.metadata && typeof row.metadata === 'object'
      ? row.metadata as Record<string, unknown>
      : {},
  };
}

export async function getNotificationById(_id: string): Promise<AppNotification | null> {
  return null;
}

export async function createNotification(_payload: NotificationPayload): Promise<AppNotification | null> {
  return null;
}

export async function createBulkNotifications(_payloads: NotificationPayload[]): Promise<AppNotification[]> {
  return [];
}

export async function markNotificationRead(_id: string): Promise<boolean> {
  return true;
}

export async function markAllNotificationsRead(_filters: NotificationFilters = {}): Promise<boolean> {
  return true;
}

export async function getRecentNotifications(_filters: NotificationFilters = {}): Promise<AppNotification[]> {
  return [];
}

export async function getUnreadNotificationCount(_filters: NotificationFilters = {}): Promise<number> {
  return 0;
}

export function notifyEmployee(payload: NotificationPayload) {
  return createNotification(payload);
}

export function notifyRole(_role: string, payload: NotificationPayload) {
  return createNotification(payload);
}

export function notifyBranchManagers(payload: NotificationPayload) {
  return createNotification(payload);
}

export function notifyCustomerServiceResponsible(payload: NotificationPayload & { branch?: string | null }) {
  return createNotification(payload);
}
