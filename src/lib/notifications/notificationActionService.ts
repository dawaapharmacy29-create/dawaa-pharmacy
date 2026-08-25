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
  if (error) throw error;
  return Boolean(data);
}

export const startNotificationAction = (id: string) => transitionNotificationAction(id, 'in_progress');
export const completeNotificationAction = (id: string) => transitionNotificationAction(id, 'completed');
export const dismissNotificationAction = (id: string) => transitionNotificationAction(id, 'dismissed');
export const escalateNotificationAction = (id: string) => transitionNotificationAction(id, 'escalated');
