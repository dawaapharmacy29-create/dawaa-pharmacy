import type { NotificationLike } from './notificationDomain';
import { canonicalNotificationType, compareNotificationsOperationally } from './notificationDomain';

export type HeaderNotificationBucket = 'tasks' | 'customers' | 'reviews' | 'system' | 'other';

type IdentifiedNotification = NotificationLike & { id?: unknown };

export function headerNotificationBucket(item: NotificationLike): HeaderNotificationBucket {
  const rawType = String(item.type || item.target_type || '').trim().toLowerCase();
  const canonical = canonicalNotificationType(rawType);
  const text = `${rawType} ${item.title || ''} ${item.body || ''} ${item.message || ''}`.toLowerCase();

  if (canonical === 'staff_task' || /task|checklist|team[_ -]?alpha|daily_task_reminder|مهمة|تشيك/.test(text)) return 'tasks';
  if (canonical === 'conversation_review' || /تقييم محادثة/.test(text)) return 'reviews';
  if (
    ['customer_followup', 'customer_request', 'customer_data_review', 'welcome_task', 'vip_customer_silence'].includes(canonical)
    || /vip|customer_alert|daily_customer_attention|عميل|متابعة عميل/.test(text)
  ) return 'customers';
  if (canonical === 'system' || canonical === 'manager_alert' || /sync|branch_manager|مزامن|تنبيه نظام|تنبيه إداري/.test(text)) return 'system';
  return 'other';
}

export function selectHeaderNotifications<T extends IdentifiedNotification>(items: T[], limit = 10): T[] {
  const operational = [...items].sort(compareNotificationsOperationally);
  const newest = [...items].sort(
    (a, b) => new Date(String(b.created_at || 0)).getTime() - new Date(String(a.created_at || 0)).getTime()
  );
  const selected: T[] = [];
  const seen = new Set<string>();

  const add = (item: T) => {
    const id = String(item.id || '').trim();
    if (!id || seen.has(id) || selected.length >= limit) return false;
    seen.add(id);
    selected.push(item);
    return true;
  };

  const take = (bucket: HeaderNotificationBucket, count: number) => {
    let taken = 0;
    for (const item of operational) {
      if (taken >= count || selected.length >= limit) break;
      if (headerNotificationBucket(item) === bucket && add(item)) taken += 1;
    }
  };

  // Reserve capacity across operational families so one noisy producer cannot bury the rest.
  take('tasks', 2);
  take('customers', 3);
  take('reviews', 1);
  take('system', 2);
  take('other', 1);

  // Fill remaining capacity with the freshest unseen events.
  for (const item of newest) {
    if (selected.length >= limit) break;
    add(item);
  }

  return selected;
}
