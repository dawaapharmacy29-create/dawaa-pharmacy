import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOptionalNavigationGuard } from '@/contexts/NavigationGuardContext';
import type { AppNotification } from '@/lib/notificationService';
import {
  canonicalNotificationRoute,
  canonicalNotificationType,
} from '@/lib/notifications/notificationDomain';

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
  customerService: false,
  delivery: false,
  inventory: false,
  reviews: false,
  attendance: false,
  targets: false,
  highPriorityOnly: false,
  sound: 'off',
  retentionDays: 0,
};

function readSettings(): NotificationSettings {
  return DEFAULT_SETTINGS;
}

export function saveNotificationSettings(settings: NotificationSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, delivery: false, sound: 'off' }));
  } catch {
    // Notification settings are non-critical while notifications are paused.
  }
}

export function notificationRoute(notification: AppNotification) {
  const type = canonicalNotificationType(notification.type || notification.target_type);
  const explicit = String(notification.route || notification.target_route || notification.metadata?.route || '').trim();
  const id = notification.target_id || String(
    notification.metadata?.entity_id ||
    notification.metadata?.review_id ||
    notification.metadata?.source_review_id ||
    notification.metadata?.id ||
    ''
  );
  return canonicalNotificationRoute({
    type,
    entityId: id,
    explicitRoute: type === 'conversation_review' ? '' : explicit,
    recipientStaffId: notification.recipient_staff_id || undefined,
  });
}

export function isNotificationUnread(_notification: AppNotification) {
  return false;
}

export function useNotifications() {
  const navigate = useNavigate();
  const navigationGuard = useOptionalNavigationGuard();
  const [settings] = useState<NotificationSettings>(readSettings);

  const refreshNotifications = useCallback(async (_force = false) => undefined, []);
  const loadMoreNotifications = useCallback(async () => undefined, []);
  const ensureNotificationLoaded = useCallback(async (_id: string): Promise<AppNotification | null> => null, []);
  const markAsRead = useCallback(async (_id: string) => true, []);
  const markAllAsRead = useCallback(async () => true, []);
  const handleNotificationClick = useCallback((notification: AppNotification) => {
    const route = notificationRoute(notification);
    if (!route) return;
    const target = route.startsWith('/') ? route : '/operations-center';
    if (navigationGuard) navigationGuard.requestNavigation(target);
    else navigate(target);
  }, [navigate, navigationGuard]);

  return {
    notifications: [] as AppNotification[],
    allNotifications: [] as AppNotification[],
    unreadCount: 0,
    loading: false,
    hasMoreNotifications: false,
    loadingMoreNotifications: false,
    available: true,
    settings,
    refreshNotifications,
    loadMoreNotifications,
    ensureNotificationLoaded,
    markAsRead,
    markAllAsRead,
    handleNotificationClick,
  };
}
