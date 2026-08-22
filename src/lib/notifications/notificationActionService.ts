import { supabase } from '@/lib/supabase';
import type { NotificationActionState } from '@/lib/notifications/notificationDomain';

export type NotificationActionTransition = Exclude<NotificationActionState, 'new'>;

export async function transitionNotificationAction(
  notificationId: string,
  nextState: NotificationActionTransition
): Promise<boolean> {
  if (!notificationId) return false;

  const { data, error } = await supabase.rpc('transition_staff_notification_action', {
    p_notification_id: notificationId,
    p_next_state: nextState,
  });
  if (!error) return Boolean(data);

  // Compatibility fallback until the lifecycle RPC is deployed everywhere.
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    action_status: nextState,
    is_read: true,
    read: true,
    read_at: now,
  };
  if (nextState === 'completed') {
    patch.status = 'completed';
    patch.completed_at = now;
  } else if (nextState === 'dismissed') {
    patch.status = 'dismissed';
  } else if (nextState === 'escalated') {
    patch.status = 'escalated';
    patch.priority = 'urgent';
  } else {
    // Reading and acting are separate. in_progress means the doctor opened the
    // operational path and acknowledged ownership, not that the work is done.
    patch.status = 'read';
  }

  const result = await supabase.from('notifications').update(patch).eq('id', notificationId);
  return !result.error;
}

export const startNotificationAction = (id: string) => transitionNotificationAction(id, 'in_progress');
export const completeNotificationAction = (id: string) => transitionNotificationAction(id, 'completed');
export const dismissNotificationAction = (id: string) => transitionNotificationAction(id, 'dismissed');
export const escalateNotificationAction = (id: string) => transitionNotificationAction(id, 'escalated');
