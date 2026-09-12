import type { NotificationLike } from './notificationDomain';
import {
  canonicalNotificationType,
  compareNotificationsOperationally,
  notificationMetadataValue,
} from './notificationDomain';

export type HeaderNotificationBucket = 'tasks' | 'customers' | 'reviews' | 'system' | 'other';

type IdentifiedNotification = NotificationLike & {
  id?: unknown;
  branch?: unknown;
  recipient_staff_id?: unknown;
  target_id?: unknown;
  entity_id?: unknown;
};

function textOf(item: NotificationLike) {
  return `${item.type || ''} ${item.title || ''} ${item.body || ''} ${item.message || ''}`.toLowerCase();
}

function boolMeta(item: NotificationLike, ...keys: string[]) {
  return String(notificationMetadataValue(item, ...keys) || '').toLowerCase() === 'true';
}

function isRoutineReference(item: NotificationLike) {
  const text = textOf(item);
  const status = String(item.action_status || item.status || '').toLowerCase();
  if (boolMeta(item, 'slaGenerated')) return true;
  if (['completed', 'dismissed'].includes(status)) return true;
  if (/تمت استعادة مزامنة|استعادة المزامنة|sync-health-resolved/.test(text)) return true;
  return false;
}

export function headerNotificationBucket(item: NotificationLike): HeaderNotificationBucket {
  const rawType = String(item.type || item.target_type || '').trim().toLowerCase();
  const canonical = canonicalNotificationType(rawType);
  const text = textOf(item);

  if (canonical === 'staff_task' || /task|checklist|team[_ -]?alpha|daily_task_reminder|مهمة|تشيك/.test(text)) return 'tasks';
  if (canonical === 'conversation_review' || /تقييم محادثة/.test(text)) return 'reviews';
  if (
    ['customer_followup', 'customer_request', 'customer_data_review', 'welcome_task', 'vip_customer_silence'].includes(canonical)
    || /vip|customer_alert|daily_customer_attention|عميل|متابعة عميل/.test(text)
  ) return 'customers';
  if (canonical === 'system' || canonical === 'manager_alert' || /sync|branch_manager|مزامن|تنبيه نظام|تنبيه إداري/.test(text)) return 'system';
  return 'other';
}

function normalizedTitle(item: NotificationLike) {
  return String(item.title || '')
    .toLowerCase()
    .replace(/^مهمة (?:فرع )?متأخرة:\s*/i, '')
    .replace(/^تنبيه:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticKey(item: IdentifiedNotification) {
  const bucket = headerNotificationBucket(item);
  const branch = String(item.branch || notificationMetadataValue(item, 'branch') || '').trim();
  const staff = String(
    item.recipient_staff_id
      || notificationMetadataValue(item, 'staffId', 'staff_id', 'recipientStaffId')
      || ''
  ).trim();
  const target = String(
    item.target_id
      || item.entity_id
      || notificationMetadataValue(item, 'customerId', 'customer_id', 'reviewId', 'review_id')
      || ''
  ).trim();
  const title = normalizedTitle(item);

  if (bucket === 'tasks') return `task:${branch}:${staff}:${title}`;
  if (bucket === 'customers') return `customer:${target || `${branch}:${title}`}`;
  if (bucket === 'reviews') return `review:${staff || target || title}`;
  if (bucket === 'system') {
    const text = textOf(item);
    const incident = /بصم|fingerprint/.test(text)
      ? 'fingerprint'
      : /طلب.*عميل|customer.*request/.test(text)
        ? 'customer-requests'
        : title;
    return `system:${branch}:${incident}`;
  }
  return `${bucket}:${branch}:${title}`;
}

export function selectHeaderNotifications<T extends IdentifiedNotification>(items: T[], limit = 10): T[] {
  const candidates = items
    .filter((item) => !isRoutineReference(item))
    .sort(compareNotificationsOperationally);
  const selected: T[] = [];
  const seenIds = new Set<string>();
  const seenSignals = new Set<string>();

  const add = (item: T) => {
    const id = String(item.id || '').trim();
    const signal = semanticKey(item);
    if (!id || seenIds.has(id) || seenSignals.has(signal) || selected.length >= limit) return false;
    seenIds.add(id);
    seenSignals.add(signal);
    selected.push(item);
    return true;
  };

  const take = (bucket: HeaderNotificationBucket, count: number) => {
    let taken = 0;
    for (const item of candidates) {
      if (taken >= count || selected.length >= limit) break;
      if (headerNotificationBucket(item) === bucket && add(item)) taken += 1;
    }
  };

  // Header = executive snapshot, not a copy of the full notification table.
  // Keep a balanced mix and let the Operations Center carry the full workflow.
  take('tasks', 1);
  take('customers', 2);
  take('reviews', 1);
  take('system', 2);
  take('other', 1);

  for (const item of candidates) {
    if (selected.length >= limit) break;
    add(item);
  }

  return selected;
}
