import { supabase } from '@/lib/supabase';

export type StaffNotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export type StaffNotification = {
  id: string;
  recipientStaffId: string;
  type: string;
  title: string;
  message: string;
  priority: StaffNotificationPriority;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
  metadata: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
};

type RawRow = Record<string, unknown>;

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function priority(value: unknown): StaffNotificationPriority {
  const candidate = text(value);
  return candidate === 'low' || candidate === 'high' || candidate === 'urgent' ? candidate : 'normal';
}

function mapRow(row: RawRow): StaffNotification {
  return {
    id: text(row.id),
    recipientStaffId: text(row.recipient_staff_id),
    type: text(row.notification_type || row.type || 'general'),
    title: text(row.title || 'إشعار'),
    message: text(row.message || row.body || row.description),
    priority: priority(row.priority),
    entityType: text(row.entity_type) || undefined,
    entityId: text(row.entity_id) || undefined,
    actionUrl: text(row.action_url || row.target_route || row.route) || undefined,
    metadata: (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>,
    isRead: Boolean(row.is_read ?? row.read ?? row.status === 'read'),
    createdAt: text(row.created_at),
  };
}

export async function listStaffNotifications(staffId: string, limit = 100): Promise<StaffNotification[]> {
  if (!staffId) return [];

  const personal = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_staff_id', staffId)
    .order('created_at', { ascending: false })
    .limit(limit);

  const global = await supabase
    .from('notifications')
    .select('*')
    .eq('is_global', true)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 30));

  const unique = new Map<string, StaffNotification>();
  [...(personal.data || []), ...(global.data || [])]
    .map((row) => mapRow(row as RawRow))
    .filter((row) => row.id)
    .forEach((row) => unique.set(row.id, row));

  return [...unique.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

export async function markStaffNotificationRead(notificationId: string): Promise<void> {
  if (!notificationId) return;
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId);
  if (error) throw error;
}

export async function markAllStaffNotificationsRead(staffId: string): Promise<void> {
  if (!staffId) return;
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('recipient_staff_id', staffId)
    .eq('is_read', false);
  if (error) throw error;
}

export function subscribeToStaffNotifications(staffId: string, onChange: () => void) {
  if (!staffId) return () => undefined;

  const channel = supabase
    .channel(`staff-notifications:${staffId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_staff_id=eq.${staffId}`,
      },
      onChange,
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
