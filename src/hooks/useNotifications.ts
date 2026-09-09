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
  notificationPreferenceCategory,
} from '@/lib/notifications/notificationDomain';

type NotificationRuntimeState = {
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
  refreshPromise: null,
  lastRefreshAt: 0,
  subscribers: 0,
  rows: [],
  available: true,
  loading: true,
  timer: null,
  channel: null,
});

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
  delivery: true,
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
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveNotificationSettings(settings: NotificationSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent('dawaa:notification-settings'));
}

export function notificationRoute(notification: AppNotification) {
  const explicit = String(
    notification.route || notification.target_route || notification.metadata?.route || ''
  ).trim();
  const id =
    notification.target_id ||
    String(
      notification.metadata?.entity_id ||
        notification.metadata?.review_id ||
        notification.metadata?.id ||
        ''
    );

  return canonicalNotificationRoute({
    type: notification.type || notification.target_type,
    entityId: id,
    explicitRoute: explicit,
    recipientStaffId: notification.recipient_staff_id || undefined,
  });
}

function isUnread(notification: AppNotification) {
  return (
    !notification.read &&
    !notification.is_read &&
    !['read', 'completed', 'dismissed'].includes(String(notification.status || ''))
  );
}

function allowedBySettings(notification: AppNotification, settings: NotificationSettings) {
  if (
    settings.highPriorityOnly &&
    !/high|urgent|critical|عاجل|حرج/i.test(String(notification.priority || ''))
  ) return false;

  const category = notificationPreferenceCategory(notification.type || notification.target_type);
  if (category === 'customerService') return settings.customerService;
  if (category === 'delivery') return settings.delivery;
  if (category === 'inventory') return settings.inventory;
  if (category === 'reviews') return settings.reviews;
  if (category === 'attendance') return settings.attendance;
  if (category === 'targets') return settings.targets;
  return true;
}

export function useNotifications() {
  const navigate = useNavigate();
  const navigationGuard = useOptionalNavigationGuard();
  const { user } = useAuth();
  const [rows, setRows] = useState<AppNotification[]>(notificationRuntime.rows);
  const [loading, setLoading] = useState(notificationRuntime.loading);
  const [available, setAvailable] = useState(notificationRuntime.available);
  const [settings, setSettings] = useState(readSettings);
  const mountedRef = useRef(true);

  const refreshNotifications = useCallback(async (force = false) => {
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

    notificationRuntime.refreshPromise = (async () => {
      try {
        const result = await getRecentNotifications({ limit: 100 });
        const unique = new Map<string, AppNotification>();
        for (const item of result) {
          const normalized = { ...item, route: notificationRoute(item) };
          const semanticKey = [
            normalized.type,
            normalized.target_type,
            normalized.target_id || normalized.metadata?.entity_id,
            normalized.recipient_staff_id,
            normalized.branch || normalized.metadata?.branch,
            normalized.title,
          ]
            .map((value) => String(value || '').trim().toLowerCase())
            .join('|');
          if (!unique.has(semanticKey)) unique.set(semanticKey, normalized);
        }

        const resolvedRows = [...unique.values()];
        notificationRuntime.rows = resolvedRows;
        notificationRuntime.available = true;
        notificationRuntime.lastRefreshAt = Date.now();
        return resolvedRows;
      } catch (error) {
        console.warn('[notifications] canonical read source unavailable', error);
        notificationRuntime.rows = [];
        notificationRuntime.available = false;
        return [] as AppNotification[];
      } finally {
        notificationRuntime.refreshPromise = null;
      }
    })();

    const nextRows = await notificationRuntime.refreshPromise;
    if (!mountedRef.current) return;
    setRows(nextRows);
    setAvailable(notificationRuntime.available);
    setLoading(false);
  }, []);

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
    if (!user) return [];
    const retentionStart = Date.now() - settings.retentionDays * 86400000;
    return rows.filter((item) => new Date(item.created_at).getTime() >= retentionStart);
  }, [rows, settings.retentionDays, user?.id]);

  const notifications = useMemo(
    () => allNotifications.filter((item) => allowedBySettings(item, settings)),
    [allNotifications, settings]
  );

  const unreadCount = useMemo(() => notifications.filter(isUnread).length, [notifications]);

  const markAsRead = useCallback(async (id: string) => {
    const previous = rows;
    const readAt = new Date().toISOString();
    setRows((current) => current.map((item) => item.id === id ? { ...item, read: true, is_read: true, status: 'read', read_at: readAt } : item));

    const ok = await markNotificationRead(id);
    if (!ok) {
      setRows(previous);
      return false;
    }
    notificationRuntime.rows = notificationRuntime.rows.map((item) => item.id === id ? { ...item, read: true, is_read: true, status: 'read', read_at: readAt } : item);
    return true;
  }, [rows]);

  const markAllAsRead = useCallback(async () => {
    const ids = notifications.filter(isUnread).map((item) => item.id);
    if (!ids.length) return true;
    const previous = rows;
    const readAt = new Date().toISOString();
    setRows((current) => current.map((item) => ids.includes(item.id) ? { ...item, read: true, is_read: true, status: 'read', read_at: readAt } : item));

    const ok = await markAllNotificationsRead();
    if (!ok) {
      setRows(previous);
      void refreshNotifications(true);
      return false;
    }
    notificationRuntime.rows = notificationRuntime.rows.map((item) => ids.includes(item.id) ? { ...item, read: true, is_read: true, status: 'read', read_at: readAt } : item);
    return true;
  }, [notifications, refreshNotifications, rows]);

  const handleNotificationClick = useCallback((notification: AppNotification) => {
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