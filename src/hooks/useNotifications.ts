import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useOptionalNavigationGuard } from '@/contexts/NavigationGuardContext';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { normalizeNotification, type AppNotification } from '@/lib/notificationService';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { normalizeBranchName } from '@/lib/branch';

type NotificationTable = 'notifications' | 'app_notifications';

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

function routeWithId(base: string, key: string, id?: string | null) {
  if (!id) return base;
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${key}=${encodeURIComponent(id)}`;
}

function employeeTaskRoute(notification: AppNotification) {
  const taskId =
    notification.target_id ||
    String(notification.metadata?.task_id || notification.metadata?.entity_id || '');
  const staffId = String(
    notification.recipient_staff_id ||
      notification.metadata?.staff_id ||
      notification.metadata?.staffId ||
      ''
  );
  const type = String(notification.type || notification.target_type || '').toLowerCase();
  if (type === 'staff_task' && staffId)
    return `/staff/${encodeURIComponent(staffId)}?tab=operating-system`;
  if (type === 'cleaning_task') return '/employee-operating-system?role=cleaning';
  if (type === 'branch_manager_task') return '/employee-operating-system?role=branch_manager';
  return routeWithId('/employee-operating-system', 'taskId', taskId);
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
  if (explicit.startsWith('/')) {
    if (/^\/reviews\/?(?:\?.*)?$/.test(explicit) && id && !/[?&]id=/.test(explicit)) {
      return routeWithId(explicit, 'id', id);
    }
    if (
      /^\/customer-service\/?(?:\?.*)?$/.test(explicit) &&
      id &&
      !/[?&]followupId=/.test(explicit) &&
      !/[?&]quickFollowup=/.test(explicit) &&
      !/[?&]code=/.test(explicit)
    ) {
      return routeWithId(explicit, 'followupId', id);
    }
    return explicit;
  }
  const rawType = String(notification.type || notification.target_type || '')
    .trim()
    .toLowerCase();
  const typeAliases: Record<string, string> = {
    'تقييم محادثة': 'conversation_review',
    'تقييم المحادثة': 'conversation_review',
    conversation_sales_review: 'conversation_review',
    متابعة: 'customer_followup',
    'متابعة عميل': 'customer_followup',
    'طلب متابعة': 'customer_followup',
    'طلب عميل': 'customer_request',
  };
  const type = typeAliases[rawType] || rawType;
  const routes: Record<string, () => string> = {
    customer_followup: () =>
      routeWithId('/customer-service?tab=today&openDetails=1&mode=edit', 'followupId', id),
    followup: () =>
      routeWithId('/customer-service?tab=today&openDetails=1&mode=edit', 'followupId', id),
    customer_request: () => routeWithId('/customer-service?tab=requests', 'requestId', id),
    conversation_review: () => routeWithId('/reviews', 'id', id),
    delivery_order: () => routeWithId('/delivery', 'orderId', id),
    delivery: () => routeWithId('/delivery', 'orderId', id),
    low_stock: () => routeWithId('/shortages', 'itemId', id),
    stock_alert: () => routeWithId('/shortages', 'itemId', id),
    inventory: () => routeWithId('/shortages', 'itemId', id),
    expiry_alert: () => routeWithId('/expiry-discounts', 'itemId', id),
    attendance: () => routeWithId('/attendance-report', 'staffId', id),
    shift_issue: () => routeWithId('/shift-notes', 'shiftId', id),
    sales_target: () => '/daily-target',
    customer_data_review: () => '/customer-service?tab=data-review',
    welcome_task: () => routeWithId('/customer-service?tab=welcome', 'taskId', id),
    employee_task: () => employeeTaskRoute(notification),
    staff_task: () => employeeTaskRoute(notification),
    cleaning_task: () => employeeTaskRoute(notification),
    branch_manager_task: () => employeeTaskRoute(notification),
    manager_alert: () => '/daily-command',
  };
  return routes[type]?.() || '/operations-center';
}

function isUnread(notification: AppNotification) {
  return (
    !notification.read &&
    !notification.is_read &&
    !['read', 'completed', 'dismissed'].includes(String(notification.status || ''))
  );
}

function isGeneralManager(role: string) {
  return ['general_manager', 'executive_manager', 'branches_manager'].includes(normalizeRole(role));
}

function visibleToUser(
  notification: AppNotification,
  user: { id: string; staffId?: string; role: string; branch: string }
) {
  if (isGeneralManager(user.role)) return true;
  const targetUser = notification.recipient_user_id || notification.user_id;
  if (targetUser && targetUser !== user.id) return false;
  if (notification.recipient_staff_id && notification.recipient_staff_id !== user.staffId)
    return false;
  if (
    notification.recipient_role &&
    normalizeRole(notification.recipient_role) !== normalizeRole(user.role)
  )
    return false;
  if (
    notification.branch &&
    normalizeBranchName(notification.branch) !== normalizeBranchName(user.branch)
  )
    return false;
  const hasTarget = Boolean(
    targetUser ||
    notification.recipient_staff_id ||
    notification.recipient_role ||
    notification.branch
  );
  return (
    hasTarget ||
    (!targetUser &&
      !notification.recipient_staff_id &&
      !notification.recipient_role &&
      !notification.branch)
  );
}

function allowedBySettings(notification: AppNotification, settings: NotificationSettings) {
  const type = String(notification.type || notification.target_type || '');
  if (
    settings.highPriorityOnly &&
    !/high|urgent|critical|عاجل|حرج/i.test(String(notification.priority || ''))
  )
    return false;
  if (/followup|customer|welcome|manager/.test(type) && !settings.customerService) return false;
  if (/delivery/.test(type) && !settings.delivery) return false;
  if (/inventory|stock|expiry/.test(type) && !settings.inventory) return false;
  if (/review/.test(type) && !settings.reviews) return false;
  if (/attendance|shift/.test(type) && !settings.attendance) return false;
  if (/target|sales/.test(type) && !settings.targets) return false;
  return true;
}

async function fetchTable(table: NotificationTable) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data || []).map((row) => normalizeNotification(row as Record<string, unknown>));
}

export function useNotifications() {
  const navigate = useNavigate();
  const navigationGuard = useOptionalNavigationGuard();
  const { user } = useAuth();
  const [rows, setRows] = useState<AppNotification[]>(notificationRuntime.rows);
  const [loading, setLoading] = useState(notificationRuntime.loading);
  const [available, setAvailable] = useState(notificationRuntime.available);
  const [settings, setSettings] = useState(readSettings);
  const tableRef = useRef<NotificationTable>('notifications');
  const mountedRef = useRef(true);

  const refreshNotifications = useCallback(async () => {
    if (!isSupabaseConfigured) {
      notificationRuntime.available = false;
      notificationRuntime.loading = false;
      setAvailable(false);
      setLoading(false);
      return;
    }

    if (notificationRuntime.refreshPromise && Date.now() - notificationRuntime.lastRefreshAt < 15_000) {
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
        let result: AppNotification[];
        try {
          result = await fetchTable('notifications');
          tableRef.current = 'notifications';
        } catch (primaryError) {
          if (import.meta.env.DEV)
            console.warn('[notifications] primary table unavailable', primaryError);
          result = await fetchTable('app_notifications');
          tableRef.current = 'app_notifications';
        }

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
            .map((value) =>
              String(value || '')
                .trim()
                .toLowerCase()
            )
            .join('|');
          if (!unique.has(semanticKey)) unique.set(semanticKey, normalized);
        }

        const resolvedRows = [...unique.values()];
        notificationRuntime.rows = resolvedRows;
        notificationRuntime.available = true;
        notificationRuntime.lastRefreshAt = Date.now();
        return resolvedRows;
      } catch (error) {
        console.warn('[notifications] database source unavailable', error);
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
      notificationRuntime.timer = window.setInterval(() => void refreshNotifications(), 120_000);

      if (isSupabaseConfigured) {
        try {
          const channelName = `app-notifications-live-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const channel = supabase
            .channel(channelName)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'notifications' },
              () => void refreshNotifications()
            );

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

  const notifications = useMemo(() => {
    if (!user) return [];
    const retentionStart = Date.now() - settings.retentionDays * 86400000;
    return rows.filter(
      (item) =>
        visibleToUser(item, user) &&
        allowedBySettings(item, settings) &&
        new Date(item.created_at).getTime() >= retentionStart
    );
  }, [rows, settings, user?.id, user?.staffId, user?.role, user?.branch]);

  const unreadCount = useMemo(() => notifications.filter(isUnread).length, [notifications]);

  const markAsRead = useCallback(
    async (id: string) => {
      const previous = rows;
      setRows((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                read: true,
                is_read: true,
                status: 'read',
                read_at: new Date().toISOString(),
              }
            : item
        )
      );
      try {
        const { error } = await supabase
          .from(tableRef.current)
          .update({ read: true, is_read: true, status: 'read', read_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
      } catch (error) {
        console.warn('[notifications] mark as read failed', error);
        setRows(previous);
      }
    },
    [rows]
  );

  const markAllAsRead = useCallback(async () => {
    const ids = notifications.filter(isUnread).map((item) => item.id);
    if (!ids.length) return;
    setRows((current) =>
      current.map((item) =>
        ids.includes(item.id)
          ? {
              ...item,
              read: true,
              is_read: true,
              status: 'read',
              read_at: new Date().toISOString(),
            }
          : item
      )
    );
    try {
      const { error } = await supabase
        .from(tableRef.current)
        .update({ read: true, is_read: true, status: 'read', read_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
    } catch (error) {
      console.warn('[notifications] mark all as read failed', error);
      void refreshNotifications();
    }
  }, [notifications, refreshNotifications]);

  const handleNotificationClick = useCallback(
    (notification: AppNotification) => {
      void markAsRead(notification.id);
      const route = notificationRoute(notification);
      const target = route.startsWith('/') ? route : '/operations-center';
      if (navigationGuard) navigationGuard.requestNavigation(target);
      else navigate(target);
    },
    [markAsRead, navigate, navigationGuard]
  );

  return {
    notifications,
    unreadCount,
    loading,
    available,
    settings,
    refreshNotifications,
    markAsRead,
    markAllAsRead,
    handleNotificationClick,
  };
}
