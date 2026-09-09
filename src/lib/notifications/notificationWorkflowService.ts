import { logActivity } from '@/lib/activityLog';
import { supabase } from '@/lib/supabase';
import type { NotificationActionState } from './notificationDomain';

export type NotificationWorkflowActor = {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  branch?: string | null;
};

export type NotificationWorkflowContext = {
  notificationType?: string | null;
  notificationTitle?: string | null;
};

export async function transitionNotificationWorkflow(input: {
  notificationId: string;
  nextState: Exclude<NotificationActionState, 'new'>;
  note?: string | null;
  actor?: NotificationWorkflowActor | null;
  context?: NotificationWorkflowContext | null;
}): Promise<{ ok: boolean; error: string | null }> {
  const notificationId = String(input.notificationId || '').trim();
  if (!notificationId) return { ok: false, error: 'معرّف التنبيه غير صالح' };

  const note = String(input.note || '').trim();
  const { data: ok, error } = await supabase.rpc('transition_notification_action_with_note_v1', {
    p_notification_id: notificationId,
    p_next_state: input.nextState,
    p_note: note || null,
  });

  if (error || !ok) {
    return { ok: false, error: error?.message || 'تعذر تسجيل إجراء التنبيه' };
  }

  await logActivity({
    action: `notification_${input.nextState}`,
    module: 'notifications',
    target_type: 'notification',
    target_id: notificationId,
    user_id: input.actor?.id || undefined,
    user_name: input.actor?.name || undefined,
    user_role: input.actor?.role || undefined,
    branch_name: input.actor?.branch || undefined,
    route_path: '/operations-center',
    details: {
      note: note || null,
      notification_type: input.context?.notificationType || null,
      notification_title: input.context?.notificationTitle || null,
      workflow_state: input.nextState,
    },
  }).catch(() => undefined);

  return { ok: true, error: null };
}
