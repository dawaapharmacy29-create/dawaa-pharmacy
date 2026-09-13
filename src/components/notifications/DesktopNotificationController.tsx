import { useEffect, useMemo, useRef, useState } from 'react';
import { MonitorUp, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { AppNotification } from '@/lib/notificationService';
import { canonicalNotificationType, notificationMetadataValue } from '@/lib/notifications/notificationDomain';

export type DesktopNotificationPreferences = {
  enabled: boolean;
  reviews: boolean;
  followups: boolean;
  vip: boolean;
  tasks: boolean;
};

const SETTINGS_KEY = 'dawaa_desktop_notification_settings_v1';
const SHOWN_KEY = 'dawaa_desktop_notification_shown_v1';
const MAX_SHOWN_IDS = 250;
const FRESH_WINDOW_MS = 10 * 60_000;

const DEFAULTS: DesktopNotificationPreferences = {
  enabled: false,
  reviews: true,
  followups: true,
  vip: true,
  tasks: true,
};

function readPreferences(): DesktopNotificationPreferences {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<DesktopNotificationPreferences>) };
  } catch {
    return DEFAULTS;
  }
}

function savePreferences(next: DesktopNotificationPreferences) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('dawaa:desktop-notification-settings'));
}

function readShown(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(SHOWN_KEY) || '[]');
    return Array.isArray(value) ? value.map(String).slice(-MAX_SHOWN_IDS) : [];
  } catch {
    return [];
  }
}

function rememberShown(ids: string[]) {
  const merged = [...new Set([...readShown(), ...ids])].slice(-MAX_SHOWN_IDS);
  localStorage.setItem(SHOWN_KEY, JSON.stringify(merged));
}

function isUnread(item: AppNotification) {
  return !item.read && !item.is_read && !['read', 'completed', 'dismissed'].includes(String(item.status || '').toLowerCase());
}

function desktopCategory(item: AppNotification): keyof Omit<DesktopNotificationPreferences, 'enabled'> | null {
  const canonical = canonicalNotificationType(item.type || item.target_type);
  const raw = String(item.metadata?.rawType || item.type || item.target_type || '').toLowerCase();
  const text = `${raw} ${item.title || ''} ${item.message || item.body || ''}`.toLowerCase();
  const entity = String(item.target_type || notificationMetadataValue(item, 'entity_type') || '').toLowerCase();

  if (canonical === 'conversation_review' || /تقييم محادثة|conversation.*review|chat_evaluation/.test(text)) return 'reviews';
  if (canonical === 'staff_task' || /task|مهمة/.test(`${raw} ${entity}`)) return 'tasks';
  if (canonical === 'vip_customer_silence' || /vip|عميل مهم|توقف عن الشراء|تراجع قوي/.test(text)) return 'vip';
  if (canonical === 'customer_followup' || /followup|متابعة/.test(`${raw} ${entity} ${text}`)) return 'followups';
  return null;
}

function shouldShow(item: AppNotification, preferences: DesktopNotificationPreferences) {
  if (!preferences.enabled || !isUnread(item)) return false;
  const category = desktopCategory(item);
  if (!category || !preferences[category]) return false;
  const created = new Date(item.created_at || 0).getTime();
  if (!Number.isFinite(created) || Date.now() - created > FRESH_WINDOW_MS) return false;
  return true;
}

function notificationBody(item: AppNotification) {
  const body = String(item.message || item.body || '').trim();
  const branch = String(item.branch || '').trim();
  const prefix = branch ? `${branch} — ` : '';
  return `${prefix}${body}`.slice(0, 220);
}

export function DesktopNotificationRuntime({
  notifications,
  onOpen,
}: {
  notifications: AppNotification[];
  onOpen: (item: AppNotification) => void;
}) {
  const initialized = useRef(false);
  const seenThisSession = useRef<Set<string>>(new Set());
  const [preferences, setPreferences] = useState(readPreferences);

  useEffect(() => {
    const sync = () => setPreferences(readPreferences());
    window.addEventListener('dawaa:desktop-notification-settings', sync);
    return () => window.removeEventListener('dawaa:desktop-notification-settings', sync);
  }, []);

  useEffect(() => {
    if (!notifications.length) return;
    if (!initialized.current) {
      notifications.forEach((item) => seenThisSession.current.add(item.id));
      initialized.current = true;
      return;
    }
    if (!preferences.enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const persistedShown = new Set(readShown());
    const fresh = notifications
      .filter((item) => !seenThisSession.current.has(item.id))
      .filter((item) => !persistedShown.has(item.id))
      .filter((item) => shouldShow(item, preferences))
      .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
      .slice(-3);

    notifications.forEach((item) => seenThisSession.current.add(item.id));
    if (!fresh.length) return;
    rememberShown(fresh.map((item) => item.id));

    fresh.forEach((item) => {
      try {
        const popup = new Notification(item.title || 'صيدليات دواء', {
          body: notificationBody(item),
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `dawaa-${item.id}`,
          requireInteraction: /urgent|critical|high|عاجل|حرج|خطر/i.test(String(item.priority || '')),
          silent: false,
        });
        popup.onclick = () => {
          window.focus();
          popup.close();
          onOpen(item);
        };
      } catch (error) {
        console.warn('[desktop-notifications] native popup failed', error);
      }
    });
  }, [notifications, onOpen, preferences]);

  return null;
}

export function DesktopNotificationSettingsPanel() {
  const [preferences, setPreferences] = useState(readPreferences);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );

  useEffect(() => {
    const sync = () => setPreferences(readPreferences());
    window.addEventListener('dawaa:desktop-notification-settings', sync);
    return () => window.removeEventListener('dawaa:desktop-notification-settings', sync);
  }, []);

  const permissionLabel = useMemo(() => {
    if (permission === 'granted') return 'مفعلة على هذا الكمبيوتر';
    if (permission === 'denied') return 'محظورة من إعدادات المتصفح';
    if (permission === 'unsupported') return 'المتصفح لا يدعم إشعارات سطح المكتب';
    return 'تحتاج سماح من المتصفح مرة واحدة';
  }, [permission]);

  const update = (patch: Partial<DesktopNotificationPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    savePreferences(next);
  };

  const enable = async () => {
    if (typeof Notification === 'undefined') {
      toast.error('هذا المتصفح لا يدعم إشعارات سطح المكتب');
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      update({ enabled: true });
      toast.success('تم تفعيل إشعارات سطح المكتب المهمة');
      try {
        const test = new Notification('تم تفعيل إشعارات صيدليات دواء', {
          body: 'ستظهر هنا فقط الأنواع التي اخترتها من الإشعارات المهمة.',
          icon: '/icon-192.png',
          tag: 'dawaa-desktop-enabled',
        });
        setTimeout(() => test.close(), 5000);
      } catch {
        // Permission is granted; a browser may still suppress the test popup.
      }
    } else if (result === 'denied') {
      update({ enabled: false });
      toast.error('المتصفح حظر الإشعارات. يمكن السماح بها من إعدادات الموقع في المتصفح.');
    }
  };

  const categories: Array<[keyof Omit<DesktopNotificationPreferences, 'enabled'>, string]> = [
    ['reviews', 'تقييمات المحادثات'],
    ['followups', 'متابعات العملاء'],
    ['vip', 'عملاء VIP'],
    ['tasks', 'المهام'],
  ];

  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-[var(--dawaa-theme-border)] p-3">
      <div className="flex items-start gap-2">
        <MonitorUp className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="dawaa-header-title text-xs font-black">إشعارات سطح المكتب</div>
          <div className="dawaa-header-muted mt-1 text-[11px] font-semibold">مثل واتساب ويب — تظهر أسفل يمين الشاشة عند وصول إشعار جديد مهم.</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl bg-[var(--dawaa-theme-soft)] px-3 py-2 text-[11px] font-bold">
        <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> {permissionLabel}</span>
        {permission !== 'granted' ? (
          <button type="button" onClick={() => void enable()} className="dawaa-button dawaa-button--primary px-2 py-1 text-[11px]">تفعيل</button>
        ) : (
          <input type="checkbox" checked={preferences.enabled} onChange={(event) => update({ enabled: event.target.checked })} aria-label="تشغيل إشعارات سطح المكتب" />
        )}
      </div>

      {categories.map(([key, label]) => (
        <label key={key} className="dawaa-header-settings-row flex items-center justify-between gap-3 rounded-xl border p-2 text-xs font-bold">
          <span>{label}</span>
          <input type="checkbox" disabled={permission !== 'granted'} checked={preferences[key]} onChange={(event) => update({ [key]: event.target.checked })} />
        </label>
      ))}
    </div>
  );
}
