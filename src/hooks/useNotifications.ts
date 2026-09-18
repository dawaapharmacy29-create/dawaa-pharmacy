import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useOptionalNavigationGuard } from '@/contexts/NavigationGuardContext';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  getNotificationById,
  getRecentNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AppNotification,
} from '@/lib/notificationService';
import {
  canonicalNotificationRoute,
  canonicalNotificationType,
  notificationPreferenceCategory,
} from '@/lib/notifications/notificationDomain';

type NotificationRuntimeState = {
  ownerKey: string | null;
  generation: number;
  refreshPromise: Promise<AppNotification[]> | null;
  lastRefreshAt: number;
  subscribers: number;
  rows: AppNotification[];
  available: boolean;
  loading: boolean;
  timer: number | null;
  channel: ReturnType<typeof supabase.channel> | null;
};

const notificationRuntime = ((globalThis as typeof globalThis & {
  __dawaaNotificationRuntime?: NotificationRuntimeState;
}).__dawaaNotificationRuntime ??= {
  ownerKey: null,
  generation: 0,
  refreshPromise: null,
  lastRefreshAt: 0,
  subscribers: 0,
  rows: [],
  available: true,
  loading: true,
  timer: null,
  channel: null,
});
// Keep hot-reload sessions compatible when the runtime shape gains fields.
notificationRuntime.ownerKey ??= null;
notificationRuntime.generation ??= 0;

const NOTIFICATION_CACHE_TTL_MS = 30_000;
const NOTIFICATION_POLL_INTERVAL_MS = 120_000;

export type NotificationSettings = {
  customerService: boolean;
  delivery: boolean;
  inventory: boolean;
  reviews: boolean;
  attendance: boolean;
  targets: boolean;
  highPriorityOnly: boolean;
  sound: 'off' | 'soft' | 'distinct';
  retentionDays: number;
};

const SETTINGS_KEY = 'dawaa_notification_settings_v1';
const DEFAULT_SETTINGS: NotificationSettings = {
  customerService: true,
  delivery: false,
  inventory: true,
  reviews: true,
  attendance: true,
  targets: true,
  highPriorityOnly: false,
  sound: 'soft',
  retentionDays: 30,
};

function readSettings(): NotificationSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<NotificationSettings>;
    // تطبيق الإدارة لا يملك مسار تشغيل الدليفري؛ حتى الإعدادات القديمة لا تعيد تفعيله.
    return { ...DEFAULT_SETTINGS, ...parsed, delivery: false };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveNotificationSettings(settings: NotificationSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, delivery: false }));
  window.dispatchEvent(new CustomEvent('dawaa:notification-settings'));
}

export function notificationRoute(notification: AppNotification) {
  const type = canonicalNotificationType(notification.type || notification.target_type);
  const explicit = String(
    notification.route || notification.target_route || notification.metadata?.route || ''
  ).trim();
  const id =
    notification.target_id ||
    String(
      notification.metadata?.entity_id ||
        notification.metadata?.review_id ||
        notification.metadata?.source_review_id ||
        notification.metadata?.id ||
        ''
    );

  // Review notifications should always open the exact saved review. Older rows can
  // carry a legacy doctor-dashboard route, so ignore that stale route for this type.
  const explicitRoute = type === 'conversation_review' ? '' : explicit;

  return canonicalNotificationRoute({
    type,
    entityId: id,
    explicitRoute,
    recipientStaffId: notification.recipient_staff_id || undefined,
  });
}

export function isNotificationUnread(notification: AppNotification) {
  return (
    !notification.read &&
    !notification.is_read &&
    !['read', 'completed', 'dismissed'].includes(String(notification.status || '').trim().toLowerCase())
  );
}

function allowedBySettings(notification: AppNotification, settings: NotificationSettings) {
  if (
    settings.highPriorityOnly &&
    !/high|urgent|critical|عاجل|حرج/i.test(String(notification.priority || ''))
  ) return false;

  const category = notificationPreferenceCategory(notification.type || notification.target_type);
  if (category === 'customerService') return settings.customerService;
  if (category === 'delivery') return false;
  if (category === 'inventory') return settings.inventory;
  if (category === 'reviews') return settings.reviews;
  if (category === 'attendance') return settings.attendance;
  if (category === 'targets') return settings.targets;
  return true;
}

function markRowsRead(rows: AppNotification[], ids: Set<string>, readAt: string) {
  return rows.map((item) =>
    ids.has(item.id)
      ? { ...item, read: true, is_read: true, status: 'read', read_at: readAt }
      : item
  );
}

function burstDedupeKey(notification: AppNotification) {
  // Keep genuinely recurring alerts (daily digests, repeated VIP/customer warnings, etc.)
  // visible across time. Only collapse producer duplicates emitted for the same semantic
  // event in the same minute. The previous key had no time component and accidentally
  // made recurring operational notifications look frozen.
  const minuteBucket = String(notification.created_at || '').slice(0, 16);
  return [
    canonicalNotificationType(notification.type || notification.target_type),
    notification.target_type,
    notification.target_id || notification.metadata?.entity_id,
    notification.recipient_staff_id,
    notification.recipient_role,
    notification.branch || notification.metadata?.branch,
    notification.title,
    minuteBucket,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .join('|');
}

export function useNotifications() {
  const navigate = useNavigate();
  const navigationGuard = useOptionalNavigationGuard();
  const { user } = useAuth();
  const ownerKey = user?.id ? String(user.id) : null;
  const ownsRuntime = Boolean(ownerKey && notificationRuntime.ownerKey === ownerKey);
  const [rows, setRows] = useState<AppNotification[]>(ownsRuntime ? notificationRuntime.rows : []);
  const [loading, setLoading] = useState(ownsRuntime ? notificationRuntime.loading : Boolean(ownerKey));
  const [available, setAvailable] = useState(ownsRuntime ? notificationRuntime.available : true);
  const [settings, setSettings] = useState(readSettings);
  const mountedRef = useRef(true);

  const refreshNotifications = useCallback(async (force = false) => {
    if (!ownerKey) {
      notificationRuntime.ownerKey = null;
      notificationRuntime.generation += 1;
      notificationRuntime.refreshPromise = null;
      notificationRuntime.rows = [];
      notificationRuntime.lastRefreshAt = 0;
      notificationRuntime.available = true;
      notificationRuntime.loading = false;
      if (mountedRef.current) {
        setRows([]);
        setAvailable(true);
        setLoading(false);
      }
      return;
    }

    if (notificationRuntime.ownerKey !== ownerKey) {
      // The shared runtime must never carry one staff account's inbox into the
      // next account on the same browser. Incrementing the generation also makes
      // an older in-flight request unable to publish its result after logout/login.
      notificationRuntime.ownerKey = ownerKey;
      notificationRuntime.generation += 1;
      notificationRuntime.refreshPromise = null;
      notificationRuntime.rows = [];
      notificationRuntime.lastRefreshAt = 0;
      notificationRuntime.available = true;
      notificationRuntime.loading = true;
      if (mountedRef.current) {
        setRows([]);
        setAvailable(true);
        setLoading(true);
      }
    }

    if (!isSupabaseConfigured) {
      notificationRuntime.available = false;
      notificationRuntime.loading = false;
      setAvailable(false);
      setLoading(false);
      return;
    }

    const cacheIsFresh =
      !force &&
      notificationRuntime.lastRefreshAt > 0 &&
      Date.now() - notificationRuntime.lastRefreshAt < NOTIFICATION_CACHE_TTL_MS;
    if (cacheIsFresh) {
      if (mountedRef.current) {
        setRows(notificationRuntime.rows);
        setAvailable(notificationRuntime.available);
        setLoading(false);
      }
      return;
    }

    if (notificationRuntime.refreshPromise) {
      const sharedRows = await notificationRuntime.refreshPromise;
      if (mountedRef.current) {
        setRows(sharedRows);
        setAvailable(notificationRuntime.available);
        setLoading(false);
      }
      return;
    }

    const refreshGeneration = notificationRuntime.generation;
    notificationRuntime.refreshPromise = (async () => {
      try {
        // 500 keeps the operational center complete across a busy multi-branch week
        // without loading the entire historical audit log on every refresh.
        const result = await getRecentNotifications({ limit: 500 });
        const unique = new Map<string, AppNotification>();
        for (const item of result) {
          const normalized = { ...item, route: notificationRoute(item) };
          const key = burstDedupeKey(normalized);
          if (!unique.has(key)) unique.set(key, normalized);
        }

        const resolvedRows = [...unique.values()];
        if (
          notificationRuntime.ownerKey !== ownerKey ||
          notificationRuntime.generation !== refreshGeneration
        ) return notificationRuntime.rows;

        notificationRuntime.rows = resolvedRows;
        notificationRuntime.available = true;
        notificationRuntime.lastRefreshAt = Date.now();
        return resolvedRows;
      } catch (error) {
        console.warn('[notifications] canonical read source unavailable', error);
        if (
          notificationRuntime.ownerKey === ownerKey &&
          notificationRuntime.generation === refreshGeneration
        ) notificationRuntime.available = false;
        // Preserve the last known-good rows. A temporary outage must not look
        // like an empty inbox or clear the decision tray.
        return notificationRuntime.rows;
      } finally {
        if (notificationRuntime.generation === refreshGeneration) {
          notificationRuntime.refreshPromise = null;
        }
      }
    })();

    const nextRows = await notificationRuntime.refreshPromise;
    if (
      !mountedRef.current ||
      notificationRuntime.ownerKey !== ownerKey ||
      notificationRuntime.generation !== refreshGeneration
    ) return;
    setRows(nextRows);
    setAvailable(notificationRuntime.available);
    setLoading(false);
  }, [ownerKey]);

  const ensureNotificationLoaded = useCallback(async (id: string) => {
    if (!id) return null;
    const existing = notificationRuntime.rows.find((item) => item.id === id);
    if (existing) {
      if (mountedRef.current) setRows(notificationRuntime.rows);
      return existing;
    }

    const loaded = await getNotificationById(id);
    if (!loaded) return null;
    const normalized = { ...loaded, route: notificationRoute(loaded) };
    notificationRuntime.rows = [normalized, ...notificationRuntime.rows.filter((item) => item.id !== normalized.id)];
    if (mountedRef.current) setRows(notificationRuntime.rows);
    return normalized;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    notificationRuntime.subscribers += 1;
    if (notificationRuntime.rows.length > 0 || notificationRuntime.lastRefreshAt > 0) {
      setRows(notificationRuntime.rows);
      setAvailable(notificationRuntime.available);
      setLoading(false);
    }

    void refreshNotifications();

    const onSettings = () => setSettings(readSettings());
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshNotifications();
    };
    window.addEventListener('dawaa:notification-settings', onSettings);
    document.addEventListener('visibilitychange', onVisibility);

    if (notificationRuntime.subscribers === 1) {
      if (notificationRuntime.timer) window.clearInterval(notificationRuntime.timer);
      notificationRuntime.timer = window.setInterval(
        () => void refreshNotifications(true),
        NOTIFICATION_POLL_INTERVAL_MS
      );

      if (isSupabaseConfigured) {
        try {
          const channelName = `app-notifications-live-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const channel = supabase
            .channel(channelName)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => void refreshNotifications(true));

          channel.subscribe((status) => {
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
              console.warn('[notifications] realtime unavailable; polling remains active', status);
            }
          });
          notificationRuntime.channel = channel;
        } catch (error) {
          console.warn('[notifications] realtime setup failed; polling remains active', error);
          notificationRuntime.channel = null;
        }
      }
    }

    return () => {
      mountedRef.current = false;
      notificationRuntime.subscribers = Math.max(0, notificationRuntime.subscribers - 1);
      window.removeEventListener('dawaa:notification-settings', onSettings);
      document.removeEventListener('visibilitychange', onVisibility);

      if (notificationRuntime.subscribers === 0) {
        if (notificationRuntime.timer) {
          window.clearInterval(notificationRuntime.timer);
          notificationRuntime.timer = null;
        }
        if (notificationRuntime.channel) {
          try {
            void supabase.removeChannel(notificationRuntime.channel);
          } catch (error) {
            console.warn('[notifications] realtime cleanup failed', error);
          }
          notificationRuntime.channel = null;
        }
      }
    };
  }, [refreshNotifications]);

  const allNotifications = useMemo(() => {
    if (!ownerKey) return [];
    const retentionStart = Date.now() - settings.retentionDays * 86400000;
    return rows.filter((item) => new Date(item.created_at).getTime() >= retentionStart);
  }, [ownerKey, rows, settings.retentionDays]);

  const notifications = useMemo(
    () => allNotifications.filter((item) => allowedBySettings(item, settings)),
    [allNotifications, settings]
  );

  const unreadCount = useMemo(() => notifications.filter(isNotificationUnread).length, [notifications]);

  const markAsRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString();
    const previousRuntime = notificationRuntime.rows;
    const ids = new Set([id]);
    const nextRuntime = markRowsRead(previousRuntime.length ? previousRuntime : rows, ids, readAt);

    // حدّث المصدر المشترك قبل الانتقال للصفحة؛ وإلا إعادة تركيب Header تعيد العداد القديم.
    notificationRuntime.rows = nextRuntime;
    notificationRuntime.lastRefreshAt = Date.now();
    setRows(nextRuntime);

    try {
      const ok = await markNotificationRead(id);
      if (!ok) throw new Error('notification read update rejected');
      return true;
    } catch (error) {
      notificationRuntime.rows = previousRuntime;
      notificationRuntime.lastRefreshAt = 0;
      if (mountedRef.current) setRows(previousRuntime);
      void refreshNotifications(true);
      console.warn('[notifications] failed to mark notification as read', error);
      return false;
    }
  }, [refreshNotifications, rows]);

  const markAllAsRead = useCallback(async () => {
    const ids = new Set(notifications.filter(isNotificationUnread).map((item) => item.id));
    if (!ids.size) return true;
    const readAt = new Date().toISOString();
    const previousRuntime = notificationRuntime.rows;
    const nextRuntime = markRowsRead(previousRuntime.length ? previousRuntime : rows, ids, readAt);

    notificationRuntime.rows = nextRuntime;
    notificationRuntime.lastRefreshAt = Date.now();
    setRows(nextRuntime);

    try {
      const ok = await markAllNotificationsRead();
      if (!ok) throw new Error('mark all notifications read rejected');
      return true;
    } catch (error) {
      notificationRuntime.rows = previousRuntime;
      notificationRuntime.lastRefreshAt = 0;
      if (mountedRef.current) setRows(previousRuntime);
      void refreshNotifications(true);
      console.warn('[notifications] failed to mark all notifications as read', error);
      return false;
    }
  }, [notifications, refreshNotifications, rows]);

  const handleNotificationClick = useCallback((notification: AppNotification) => {
    // القراءة تحدث فورًا حتى لو NavigationGuard طلب تأكيد حفظ تغييرات الصفحة الحالية.
    void markAsRead(notification.id);
    const route = notificationRoute(notification);
    const target = route.startsWith('/') ? route : '/operations-center';
    if (navigationGuard) navigationGuard.requestNavigation(target);
    else navigate(target);
  }, [markAsRead, navigate, navigationGuard]);

  return {
    notifications,
    allNotifications,
    unreadCount,
    loading,
    available,
    settings,
    refreshNotifications,
    ensureNotificationLoaded,
    markAsRead,
    markAllAsRead,
    handleNotificationClick,
  };
}
