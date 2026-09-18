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
  read?: unknown;
  is_read?: unknown;
  requires_action?: unknown;
  created_at?: unknown;
};

function textOf(item: NotificationLike) {
  return `${item.type || ''} ${item.title || ''} ${item.body || ''} ${item.message || ''}`.toLowerCase();
}

function boolMeta(item: NotificationLike, ...keys: string[]) {
  return String(notificationMetadataValue(item, ...keys) || '').toLowerCase() === 'true';
}

function numberMeta(item: NotificationLike, ...keys: string[]) {
  const raw = notificationMetadataValue(item, ...keys);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isHeaderUnread(item: IdentifiedNotification) {
  const status = String(item.action_status || item.status || '').trim().toLowerCase();
  return !Boolean(item.read) && !Boolean(item.is_read) && !['read', 'completed', 'dismissed', 'closed'].includes(status);
}

function isUrgent(item: NotificationLike) {
  return /urgent|critical|high|عاجل|حرج|خطر|مرتفع/i.test(String(item.priority || ''));
}

function isOverdue(item: NotificationLike) {
  return /متأخر|تأخر|overdue|تجاوز زمن|لم تتم|لم يبدأ|لم تنفذ|متأخرة/.test(textOf(item));
}

function requiresAction(item: IdentifiedNotification) {
  return Boolean(item.requires_action)
    || boolMeta(item, 'requiresAction', 'requires_action', 'requiresFollowup', 'requires_followup');
}

function isRoutineReference(item: NotificationLike) {
  const text = textOf(item);
  const status = String(item.action_status || item.status || '').toLowerCase();
  const tier = String(
    notificationMetadataValue(item, 'signalTier', 'signal_tier', 'attentionTier', 'attention_tier') || ''
  ).toLowerCase();
  const urgent = isUrgent(item);

  if (boolMeta(item, 'slaGenerated')) return true;
  if (['completed', 'dismissed', 'closed', 'read'].includes(status)) return true;
  if (/تمت استعادة مزامنة|استعادة المزامنة|sync-health-resolved/.test(text)) return true;

  // The top tray is a decision inbox, not an archive. Quiet summaries/reference rows stay
  // available in the Operations Center but do not occupy scarce header space.
  if (!urgent && ['digest', 'summary', 'info', 'reference'].includes(tier)) return true;
  if (!urgent && /ملخص|digest|summary|للعلم|مرجع sla|sla reference/.test(text)) return true;

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

function isActionableForHeader(item: IdentifiedNotification) {
  const bucket = headerNotificationBucket(item);
  const text = textOf(item);
  const urgent = isUrgent(item);
  const overdue = isOverdue(item);
  const action = requiresAction(item);
  const score = numberMeta(item, 'score', 'review_score', 'total_score');
  const points = numberMeta(item, 'points_impact', 'pointsImpact');
  const changePct = numberMeta(item, 'changePct', 'change_pct');
  const severeVip = /توقف عن الشراء|بدون شراء|مختفي|تراجع قوي|تراجع حاد|vip.*خطر/.test(text)
    || (changePct !== null && changePct <= -30);

  if (bucket === 'tasks') return true;

  if (bucket === 'reviews') {
    return urgent
      || (score !== null && score < 90)
      || (points !== null && points < 0)
      || /شكوى|خطأ حرج|مشكلة حرجة|سيئ|ضعيف/.test(text);
  }

  if (bucket === 'customers') {
    const vip = /vip|عميل مهم/.test(text) || canonicalNotificationType(item.type || item.target_type) === 'vip_customer_silence';
    if (vip) return severeVip || urgent || action;
    return urgent || overdue || action;
  }

  if (bucket === 'system') {
    const activeIncident = /توقف|متوقف|فشل|انقطاع|غير متصل|connection.*lost|sync.*failed/.test(text)
      && !/تمت استعادة|resolved|recovered/.test(text);
    return urgent || action || activeIncident;
  }

  return urgent || action;
}

function isFreshEnoughForHeader(item: IdentifiedNotification) {
  if (isUrgent(item) || isOverdue(item) || requiresAction(item)) return true;
  const created = new Date(String(item.created_at || '')).getTime();
  if (!Number.isFinite(created)) return true;
  // Quiet unread rows older than a day stay in the full center but stop crowding the top tray.
  return Date.now() - created <= 24 * 60 * 60 * 1000;
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
  const rowId = String(item.id || '').trim();

  // Sparse legacy rows may have only an id/type/priority. Never collapse those
  // into one generic signal just because the semantic identity fields are
  // absent; deduplication is safe only when there is an actual shared identity.
  const fallbackIdentity = title || rowId;

  if (bucket === 'tasks') return `task:${branch}:${staff}:${fallbackIdentity}`;
  if (bucket === 'customers') return `customer:${target || `${branch}:${fallbackIdentity}`}`;
  if (bucket === 'reviews') return `review:${staff || target || fallbackIdentity}`;
  if (bucket === 'system') {
    const text = textOf(item);
    const incident = /بصم|fingerprint/.test(text)
      ? 'fingerprint'
      : /طلب.*عميل|customer.*request/.test(text)
        ? 'customer-requests'
        : fallbackIdentity;
    return `system:${branch}:${incident}`;
  }
  return `${bucket}:${branch}:${fallbackIdentity}`;
}

export function selectHeaderNotifications<T extends IdentifiedNotification>(items: T[], limit = 10): T[] {
  const candidates = items
    // Once opened, useNotifications marks the row read. It remains in the full center/history
    // while disappearing from this compact decision tray.
    .filter(isHeaderUnread)
    .filter((item) => !isRoutineReference(item))
    .filter(isActionableForHeader)
    .filter(isFreshEnoughForHeader)
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

  // Header = smart decision inbox, not a copy of the historical center.
  // Balance operational categories first, then fill remaining slots by operational rank.
  take('tasks', 2);
  take('customers', 3);
  take('reviews', 2);
  take('system', 2);
  take('other', 1);

  for (const item of candidates) {
    if (selected.length >= limit) break;
    add(item);
  }

  return selected;
}
