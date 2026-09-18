import { useEffect, useMemo, useState } from 'react';
import { Radio, RefreshCw, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';

export type WebPushPreferences = {
  enabled: boolean;
  reviews: boolean;
  followups: boolean;
  vip: boolean;
  tasks: boolean;
};

type PushState = 'checking' | 'unsupported' | 'denied' | 'disconnected' | 'registering' | 'connected' | 'error';

type PushBootstrap = {
  enabled?: boolean;
  publicKey?: string;
  subscriptions?: Array<{
    id?: string;
    endpoint?: string;
    enabled?: boolean;
    categories?: Record<string, boolean>;
  }>;
};

const SETTINGS_KEY = 'dawaa_desktop_notification_settings_v1';
const HEARTBEAT_KEY = 'dawaa_web_push_heartbeat_v1';
const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60_000;

function getPreferences(): WebPushPreferences {
  try {
    return {
      enabled: false,
      reviews: true,
      followups: true,
      vip: true,
      tasks: true,
      ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<WebPushPreferences>),
    };
  } catch {
    return { enabled: false, reviews: true, followups: true, vip: true, tasks: true };
  }
}

function categoryPayload(preferences: WebPushPreferences) {
  return {
    reviews: Boolean(preferences.reviews),
    followups: Boolean(preferences.followups),
    vip: Boolean(preferences.vip),
    tasks: Boolean(preferences.tasks),
  };
}

function pushSupported() {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

function base64UrlToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const normalized = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

function bytesToBase64Url(buffer: ArrayBuffer | null) {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function subscriptionKeys(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh || bytesToBase64Url(subscription.getKey('p256dh'));
  const auth = json.keys?.auth || bytesToBase64Url(subscription.getKey('auth'));
  if (!p256dh || !auth) throw new Error('subscription_keys_missing');
  return { p256dh, auth };
}

function deviceLabel() {
  const ua = navigator.userAgent || '';
  const os = /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Android/i.test(ua) ? 'Android' : /Linux/i.test(ua) ? 'Linux' : 'Device';
  const isBrave = Boolean((navigator as Navigator & { brave?: unknown }).brave);
  const browser = isBrave
    ? 'Brave'
    : /Edg\//i.test(ua)
      ? 'Edge'
      : /Chrome\//i.test(ua)
        ? 'Chromium'
        : /Firefox\//i.test(ua)
          ? 'Firefox'
          : 'Browser';
  return `${os} · ${browser}`;
}

async function bootstrap(): Promise<PushBootstrap> {
  const { data, error } = await supabase.rpc('get_notification_push_bootstrap_v1');
  if (error) throw error;
  return (data || {}) as PushBootstrap;
}

async function ensureServiceWorker() {
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  return registration;
}

async function registerSubscription(subscription: PushSubscription, preferences: WebPushPreferences) {
  const { p256dh, auth } = subscriptionKeys(subscription);
  const { data, error } = await supabase.rpc('register_notification_push_subscription_v1', {
    p_endpoint: subscription.endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: navigator.userAgent || null,
    p_device_label: deviceLabel(),
    p_categories: categoryPayload(preferences),
  });
  if (error) throw error;
  return data as string | null;
}

export async function connectCurrentBrowserPush(preferences = getPreferences()) {
  if (!pushSupported()) throw new Error('push_unsupported');
  if (Notification.permission !== 'granted') throw new Error('permission_not_granted');

  const registration = await ensureServiceWorker();
  const config = await bootstrap();
  const publicKey = String(config.publicKey || '').trim();
  if (!config.enabled || !publicKey) throw new Error('push_not_configured');

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    });
  }

  await registerSubscription(subscription, preferences);
  localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
  window.dispatchEvent(new CustomEvent('dawaa:web-push-status'));
  return subscription;
}

export async function syncCurrentBrowserPushPreferences(preferences: WebPushPreferences) {
  if (!preferences.enabled || !pushSupported() || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  await registerSubscription(subscription, preferences);
  window.dispatchEvent(new CustomEvent('dawaa:web-push-status'));
  return true;
}

export async function disconnectCurrentBrowserPush() {
  if (!pushSupported()) return false;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return false;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  const endpoint = subscription.endpoint;
  const { error } = await supabase.rpc('disable_notification_push_subscription_v1', {
    p_endpoint: endpoint,
    p_subscription_id: null,
  });
  if (error) throw error;

  const unsubscribed = await subscription.unsubscribe();
  localStorage.removeItem(HEARTBEAT_KEY);
  window.dispatchEvent(new CustomEvent('dawaa:web-push-status'));
  return unsubscribed;
}

async function touchExistingSubscription() {
  const preferences = getPreferences();
  if (!preferences.enabled || !pushSupported() || Notification.permission !== 'granted') return;
  const lastHeartbeat = Number(localStorage.getItem(HEARTBEAT_KEY) || 0);
  if (Number.isFinite(lastHeartbeat) && Date.now() - lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;

  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) {
    await connectCurrentBrowserPush(preferences);
    return;
  }
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    // Permission may have been granted on an older release that never created
    // the PushManager subscription. Repair it silently without prompting again.
    await connectCurrentBrowserPush(preferences);
    return;
  }

  const { error } = await supabase.rpc('touch_notification_push_subscription_v1', {
    p_endpoint: subscription.endpoint,
  });
  if (!error) localStorage.setItem(HEARTBEAT_KEY, String(Date.now()));
}

export function useWebPushHeartbeat() {
  useEffect(() => {
    void touchExistingSubscription().catch((error) => {
      console.warn('[web-push] heartbeat failed', error);
    });
  }, []);
}

async function inspectPushState(): Promise<{ state: PushState; detail: string }> {
  if (!pushSupported()) return { state: 'unsupported', detail: 'المتصفح أو بيئة التشغيل لا تدعم Web Push.' };
  if (Notification.permission === 'denied') return { state: 'denied', detail: 'الإذن محظور من إعدادات المتصفح.' };
  if (Notification.permission !== 'granted') return { state: 'disconnected', detail: 'يحتاج سماح الإشعارات أولًا من زر التفعيل.' };

  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) return { state: 'disconnected', detail: 'Service Worker غير مسجل على هذا الجهاز.' };
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return { state: 'disconnected', detail: 'الإذن موجود لكن الجهاز غير مربوط كـ Push Subscription.' };

  try {
    const config = await bootstrap();
    const remote = (config.subscriptions || []).find((item) => item.endpoint === subscription.endpoint);
    if (!remote?.enabled) return { state: 'disconnected', detail: 'يوجد اشتراك بالمتصفح لكنه يحتاج إعادة تسجيل في Supabase.' };
    return { state: 'connected', detail: 'هذا الجهاز مربوط فعليًا وسيستقبل Web Push في الخلفية.' };
  } catch {
    return { state: 'error', detail: 'تعذر التحقق من حالة الربط في Supabase.' };
  }
}

export async function isCurrentBrowserPushConnected() {
  const result = await inspectPushState();
  return result.state === 'connected';
}

export function WebPushDeviceControls() {
  const [state, setState] = useState<PushState>('checking');
  const [detail, setDetail] = useState('جاري فحص ربط الجهاز...');

  const refresh = async () => {
    setState('checking');
    setDetail('جاري فحص ربط الجهاز...');
    try {
      const result = await inspectPushState();
      setState(result.state);
      setDetail(result.detail);
    } catch (error) {
      console.warn('[web-push] state inspection failed', error);
      setState('error');
      setDetail('فشل فحص حالة Web Push على هذا الجهاز.');
    }
  };

  useEffect(() => {
    void refresh();
    const onStatus = () => void refresh();
    window.addEventListener('dawaa:web-push-status', onStatus);
    return () => window.removeEventListener('dawaa:web-push-status', onStatus);
  }, []);

  const label = useMemo(() => {
    if (state === 'unsupported') return 'Push غير مدعوم';
    if (state === 'denied') return 'Permission denied';
    if (state === 'registering') return 'جاري التسجيل';
    if (state === 'connected') return 'الجهاز متصل';
    if (state === 'error') return 'فشل التسجيل';
    if (state === 'checking') return 'جاري التحقق';
    return 'الجهاز غير مربوط';
  }, [state]);

  const repair = async () => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      toast.error('اسمح بإشعارات الموقع أولًا من زر التفعيل.');
      return;
    }
    setState('registering');
    setDetail('جاري إنشاء وربط Push Subscription لهذا الجهاز...');
    try {
      await connectCurrentBrowserPush(getPreferences());
      toast.success('تم ربط هذا الجهاز بـ Web Push.');
      await refresh();
    } catch (error) {
      console.error('[web-push] registration failed', error);
      setState('error');
      setDetail('فشل تسجيل الجهاز. راجع الاتصال ثم جرّب الإصلاح مرة أخرى.');
      toast.error('فشل ربط Web Push على هذا الجهاز.');
    }
  };

  const unlink = async () => {
    setState('registering');
    setDetail('جاري إلغاء ربط هذا الجهاز...');
    try {
      await disconnectCurrentBrowserPush();
      toast.success('تم إلغاء ربط Web Push لهذا الجهاز.');
      await refresh();
    } catch (error) {
      console.error('[web-push] unlink failed', error);
      setState('error');
      setDetail('فشل إلغاء ربط الجهاز من Supabase.');
      toast.error('فشل إلغاء ربط هذا الجهاز.');
    }
  };

  const permissionGranted = typeof Notification !== 'undefined' && Notification.permission === 'granted';

  return (
    <div className="space-y-2 rounded-xl border border-[var(--dawaa-theme-border)] p-2">
      <div className="flex items-start gap-2">
        <Radio className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-black">Web Push الحقيقي</div>
          <div className="dawaa-header-muted mt-0.5 text-[10px] font-semibold">{label} · {detail}</div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={state === 'checking' || state === 'registering'} className="dawaa-header-icon-button rounded-lg border p-1.5" title="تحديث حالة الربط">
          <RefreshCw className={`h-3.5 w-3.5 ${state === 'checking' || state === 'registering' ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {permissionGranted && state !== 'connected' && state !== 'unsupported' && state !== 'denied' && (
        <button type="button" onClick={() => void repair()} disabled={state === 'registering'} className="dawaa-button dawaa-button--primary w-full px-3 py-2 text-xs font-black">
          إصلاح وربط إشعارات هذا الجهاز
        </button>
      )}

      {state === 'connected' && (
        <button type="button" onClick={() => void unlink()} className="dawaa-button w-full px-3 py-2 text-xs font-black">
          <Unplug className="h-3.5 w-3.5" /> إلغاء ربط هذا الجهاز
        </button>
      )}
    </div>
  );
}
