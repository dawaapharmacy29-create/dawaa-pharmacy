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

type DesktopCategory = keyof Omit<DesktopNotificationPreferences, 'enabled'>;

type DesktopDecision = {
  category: DesktopCategory;
  reason: string;
  sticky: boolean;
};

const SETTINGS_KEY = 'dawaa_desktop_notification_settings_v1';
const SHOWN_KEY = 'dawaa_desktop_notification_shown_v2';
const MAX_SHOWN_KEYS = 350;
const FRESH_WINDOW_MS = 15 * 60_000;

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
    return Array.isArray(value) ? value.map(String).slice(-MAX_SHOWN_KEYS) : [];
  } catch {
    return [];
  }
}

function rememberShown(keys: string[]) {
  const merged = [...new Set([...readShown(), ...keys])].slice(-MAX_SHOWN_KEYS);
  localStorage.setItem(SHOWN_KEY, JSON.stringify(merged));
}

function isUnread(item: AppNotification) {
  return !item.read && !item.is_read && !['read', 'completed', 'dismissed', 'closed'].includes(String(item.status || '').toLowerCase());
}

function textOf(item: AppNotification) {
  return `${item.metadata?.rawType || ''} ${item.type || ''} ${item.target_type || ''} ${item.title || ''} ${item.message || item.body || ''}`.toLowerCase();
}

function numberMeta(item: AppNotification, ...keys: string[]) {
  const raw = notificationMetadataValue(item, ...keys);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function boolMeta(item: AppNotification, ...keys: string[]) {
  const raw = notificationMetadataValue(item, ...keys);
  if (typeof raw === 'boolean') return raw;
  return String(raw || '').toLowerCase() === 'true';
}

function importantPriority(item: AppNotification) {
  return /high|urgent|critical|عاجل|حرج|خطر|مرتفع/i.test(String(item.priority || ''));
}

function isDigestOrReference(item: AppNotification) {
  const tier = String(notificationMetadataValue(item, 'signalTier', 'signal_tier', 'attentionTier', 'attention_tier') || '').toLowerCase();
  const text = textOf(item);
  return ['digest', 'summary', 'info', 'reference'].includes(tier)
    || /ملخص|تقرير حركة|digest|summary|للعلم|مرجع sla|sla reference/.test(text);
}

function desktopDecision(item: AppNotification): DesktopDecision | null {
  const canonical = canonicalNotificationType(item.type || item.target_type);
  const text = textOf(item);
  const entity = String(item.target_type || notificationMetadataValue(item, 'entity_type') || '').toLowerCase();
  const score = numberMeta(item, 'score', 'review_score', 'total_score');
  const points = numberMeta(item, 'points_impact', 'pointsImpact');
  const changePct = numberMeta(item, 'changePct', 'change_pct');
  const requiresAction = Boolean(item.requires_action) || boolMeta(item, 'requiresFollowup', 'requires_followup');
  const overdue = /متأخر|تأخر|overdue|تجاوز زمن|لم تتم|لم يبدأ|لم تنفذ/.test(text);
  const escalated = /تصعيد|escalat/.test(text);
  const severeVip = /توقف عن الشراء|بدون شراء|مختفي|تراجع قوي|تراجع حاد|vip.*خطر/.test(text)
    || (changePct !== null && changePct <= -30);

  const review = canonical === 'conversation_review' || /تقييم محادثة|conversation.*review|chat_evaluation/.test(text);
  if (review) {
    const criticalReview = importantPriority(item)
      || (score !== null && score < 90)
      || (points !== null && points < 0)
      || /خطأ حرج|مشكلة حرجة|شكوى|سيئ|ضعيف/.test(text);
    if (!criticalReview) return null;
    return {
      category: 'reviews',
      reason: score !== null && score < 90 ? `تقييم منخفض ${score}/100` : points !== null && points < 0 ? 'تأثير سلبي على النقاط' : 'تقييم يحتاج تدخلًا',
      sticky: importantPriority(item) || (score !== null && score < 80),
    };
  }

  const task = canonical === 'staff_task' || /task|مهمة/.test(`${text} ${entity}`);
  if (task) {
    if (/تم التنفيذ|مكتمل|completed|closed|تم إغلاق/.test(text)) return null;
    return {
      category: 'tasks',
      reason: overdue ? 'مهمة متأخرة' : escalated ? 'مهمة تم تصعيدها' : 'مهمة جديدة تحتاج تنفيذ',
      sticky: importantPriority(item) || overdue || escalated,
    };
  }

  const vip = canonical === 'vip_customer_silence' || /vip|عميل مهم/.test(text);
  if (vip) {
    if (!severeVip && !importantPriority(item) && !requiresAction) return null;
    if (isDigestOrReference(item) && !severeVip) return null;
    return {
      category: 'vip',
      reason: severeVip ? 'عميل VIP يحتاج تدخلًا سريعًا' : 'حالة VIP تحتاج متابعة',
      sticky: severeVip || importantPriority(item),
    };
  }

  const followup = canonical === 'customer_followup' || /followup|متابعة/.test(`${text} ${entity}`);
  if (followup) {
    if (isDigestOrReference(item) && !overdue && !importantPriority(item)) return null;
    if (!requiresAction && !overdue && !importantPriority(item)) return null;
    return {
      category: 'followups',
      reason: overdue ? 'متابعة عميل متأخرة' : 'متابعة عميل تحتاج إجراء',
      sticky: overdue || importantPriority(item),
    };
  }

  return null;
}

function popupKey(item: AppNotification, decision: DesktopDecision) {
  const entityId = item.target_id || notificationMetadataValue(item, 'entity_id', 'customerCode', 'review_id', 'task_id') || item.id;
  const state = String(item.action_status || item.status || '').toLowerCase();
  const priority = String(item.priority || '').toLowerCase();
  return [decision.category, entityId, state, priority, decision.reason]
    .map((value) => String(value || '').trim().toLowerCase())
    .join('|');
}

function shouldShow(item: AppNotification, preferences: DesktopNotificationPreferences) {
  if (!preferences.enabled || !isUnread(item)) return null;
  const decision = desktopDecision(item);
  if (!decision || !preferences[decision.category]) return null;
  const created = new Date(item.created_at || 0).getTime();
  if (!Number.isFinite(created) || created > Date.now() + 60_000 || Date.now() - created > FRESH_WINDOW_MS) return null;
  return decision;
}

function notificationBody(item: AppNotification, decision: DesktopDecision) {
  const body = String(item.message || item.body || '').trim();
  const branch = String(item.branch || '').trim();
  const prefix = branch ? `${branch} — ` : '';
  return `${decision.reason}\n${prefix}${body}`.slice(0, 260);
}

export function DesktopNotificationRuntime({ notifications, onOpen }: { notifications: AppNotification[]; onOpen: (item: AppNotification) => void }) {
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
    const candidates = notifications
      .filter((item) => !seenThisSession.current.has(item.id))
      .map((item) => ({ item, decision: shouldShow(item, preferences) }))
      .filter((entry): entry is { item: AppNotification; decision: DesktopDecision } => Boolean(entry.decision))
      .filter((entry) => !persistedShown.has(popupKey(entry.item, entry.decision)))
      .sort((a, b) => {
        if (a.decision.sticky !== b.decision.sticky) return a.decision.sticky ? -1 : 1;
        return new Date(b.item.created_at || 0).getTime() - new Date(a.item.created_at || 0).getTime();
      })
      .slice(0, 3);

    notifications.forEach((item) => seenThisSession.current.add(item.id));
    if (!candidates.length) return;
    rememberShown(candidates.map(({ item, decision }) => popupKey(item, decision)));

    candidates.forEach(({ item, decision }) => {
      try {
        const popup = new Notification(item.title || 'صيدليات دواء', {
          body: notificationBody(item, decision),
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: `dawaa-${popupKey(item, decision)}`,
          requireInteraction: decision.sticky,
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
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

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

  const sendTest = () => {
    if (typeof Notification === 'undefined') {
      toast.error('هذا المتصفح لا يدعم إشعارات سطح المكتب');
      return;
    }
    if (Notification.permission !== 'granted') {
      toast.error('لازم تسمح بإشعارات الموقع الأول');
      return;
    }
    try {
      const test = new Notification('اختبار إشعارات صيدليات دواء', {
        body: 'لو الرسالة دي ظهرت أسفل يمين الشاشة، إذن إشعارات اللاب تعمل بشكل صحيح ✅',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `dawaa-test-${Date.now()}`,
        requireInteraction: true,
        silent: false,
      });
      test.onclick = () => {
        window.focus();
        test.close();
      };
      toast.success('تم إرسال إشعار اختبار للنظام');
    } catch {
      toast.error('المتصفح سمح بالإشعارات لكن النظام لم يعرضها. راجع إعدادات إشعارات Windows أو عدم الإزعاج.');
    }
  };

  const enable = async () => {
    if (typeof Notification === 'undefined') return toast.error('هذا المتصفح لا يدعم إشعارات سطح المكتب');
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      update({ enabled: true });
      toast.success('تم تفعيل إشعارات سطح المكتب المهمة');
      setTimeout(sendTest, 250);
    } else if (result === 'denied') {
      update({ enabled: false });
      toast.error('المتصفح حظر الإشعارات. اسمح بها من إعدادات الموقع في المتصفح.');
    }
  };

  const categories: Array<[DesktopCategory, string, string]> = [
    ['reviews', 'تقييمات المحادثات المهمة', 'الدرجات الضعيفة، التأثير السلبي أو الحالات الحرجة فقط'],
    ['followups', 'متابعات العملاء', 'المتابعات المطلوبة أو المتأخرة فقط'],
    ['vip', 'عملاء VIP', 'التوقف عن الشراء أو التراجع القوي والحالات التي تحتاج تدخل'],
    ['tasks', 'المهام', 'المهمة الجديدة أو المتأخرة أو المصعّدة — بدون إشعارات الإغلاق'],
  ];

  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-[var(--dawaa-theme-border)] p-3">
      <div className="flex items-start gap-2">
        <MonitorUp className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="dawaa-header-title text-xs font-black">إشعارات سطح المكتب الذكية</div>
          <div className="dawaa-header-muted mt-1 text-[11px] font-semibold">مثل واتساب ويب — لكن بعد فلترة الإشارات المهمة فقط حتى لا تتحول إلى ضوضاء.</div>
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

      {permission === 'granted' && (
        <div className="space-y-1 rounded-xl border border-[var(--dawaa-theme-border)] p-2">
          <button type="button" onClick={sendTest} className="dawaa-button dawaa-button--primary w-full px-3 py-2 text-xs font-black">إرسال إشعار اختبار الآن</button>
          <div className="dawaa-header-muted text-[10px] font-semibold">لو الاختبار لم يظهر رغم أن الحالة «مفعلة»، راجع إشعارات Windows وعدم الإزعاج/Focus Assist للمتصفح.</div>
        </div>
      )}

      {categories.map(([key, label, description]) => (
        <label key={key} className="dawaa-header-settings-row flex items-center justify-between gap-3 rounded-xl border p-2 text-xs font-bold">
          <span className="min-w-0"><span className="block">{label}</span><span className="dawaa-header-muted mt-0.5 block text-[10px] font-semibold">{description}</span></span>
          <input type="checkbox" disabled={permission !== 'granted'} checked={preferences[key]} onChange={(event) => update({ [key]: event.target.checked })} />
        </label>
      ))}
    </div>
  );
}
