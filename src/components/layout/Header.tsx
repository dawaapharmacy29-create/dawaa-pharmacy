import { Bell, Menu, Sun, Moon, Volume2, VolumeX, CheckCheck, ExternalLink, Settings2, Fingerprint } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getSafeCurrentUserId, useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { getCurrentCycle, getRemainingDays } from '@/lib/pharmacy-cycle';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { AppNotification } from '@/lib/notificationService';
import { saveNotificationSettings, useNotifications } from '@/hooks/useNotifications';
import { normalizeRole } from '@/lib/core/permissionSystem';
import { normalizeBranchName } from '@/lib/branch';

interface NotifItem {
  id: string;
  user_id?: string | null;
  recipient_user_id?: string | null;
  recipient_staff_id?: string | null;
  recipient_role?: string | null;
  title?: string | null;
  body?: string | null;
  message?: string | null;
  description?: string | null;
  type?: string | null;
  priority?: string | null;
  read?: boolean | null;
  is_read?: boolean | null;
  status?: string | null;
  route?: string | null;
  target_route?: string | null;
  details?: string | Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  target_type?: string | null;
  target_id?: string | null;
  branch?: string | null;
  created_at: string;
}

interface HeaderProps {
  onMobileMenuOpen: () => void;
  title: string;
}

const SOUND_KEY = 'dawaa_notif_sound';

let sharedAudioContext: AudioContext | null = null;
function ensureAudioUnlocked() {
  if (sharedAudioContext) {
    if (sharedAudioContext.state === 'suspended') void sharedAudioContext.resume();
    return;
  }
  try {
    sharedAudioContext = new AudioContext();
  } catch {
    // Browser audio unavailable.
  }
}
if (typeof window !== 'undefined') {
  const unlock = () => {
    ensureAudioUnlocked();
    window.removeEventListener('click', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('click', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

const notificationTone: Record<string, string> = {
  reward: 'dawaa-badge--success',
  deduction: 'dawaa-badge--danger',
  task: 'dawaa-badge--info',
  followup: 'dawaa-badge--info',
  conversation_review: 'dawaa-badge--info',
  customer_alert: 'dawaa-badge--warning',
  delivery: 'dawaa-badge--info',
  attendance: 'dawaa-badge--success',
  system: 'dawaa-badge--info',
};

function playNotificationBeep() {
  const mode = localStorage.getItem(SOUND_KEY) || 'soft';
  if (mode === 'off') return;
  try {
    ensureAudioUnlocked();
    const ctx = sharedAudioContext;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = mode === 'distinct' ? 880 : 520;
    gain.gain.value = 0.08;
    oscillator.start();
    setTimeout(() => oscillator.stop(), mode === 'distinct' ? 220 : 140);
  } catch {
    // Browser audio may be blocked until user interaction.
  }
}

function parseDetailsRoute(details: NotifItem['details'] | AppNotification['metadata']) {
  if (!details) return null;
  if (typeof details === 'object' && typeof details.route === 'string') return details.route;
  if (typeof details !== 'string') return null;
  try {
    const parsed = JSON.parse(details) as { route?: unknown };
    return typeof parsed.route === 'string' ? parsed.route : null;
  } catch {
    return null;
  }
}

function inferNotificationRoute(n: Partial<NotifItem & AppNotification>) {
  if (n.target_route) return n.target_route;
  if (n.route) return n.route;
  const detailsRoute = parseDetailsRoute(n.details) || parseDetailsRoute(n.metadata);
  if (detailsRoute) return detailsRoute;

  const text = `${n.type || ''} ${n.title || ''} ${n.body || ''} ${n.message || ''} ${n.target_type || ''}`.toLowerCase();
  if (text.includes('attendance') || text.includes('حضور') || text.includes('انصراف')) return '/attendance-report';
  if (text.includes('follow') || text.includes('متابعة')) return '/customer-service';
  if (text.includes('review') || text.includes('تقييم')) return '/reviews';
  if (text.includes('deduction') || text.includes('reward') || text.includes('خصم') || text.includes('مكاف')) return '/points';
  if (text.includes('invoice') || text.includes('فاتور')) return '/invoices';
  if (text.includes('shift') || text.includes('شيفت')) return '/shift-performance';
  if (text.includes('stagnant') || text.includes('راكد')) return '/stagnant-medicines';
  if (text.includes('delivery') || text.includes('دليفري') || text.includes('توصيل')) return '/delivery';
  if (text.includes('customer') || text.includes('عميل')) return '/customers';
  return '/operations-center';
}

function canSeeNotification(item: AppNotification, user: ReturnType<typeof useAuth>['user']) {
  if (!user) return false;
  const safeUserId = getSafeCurrentUserId();
  const role = normalizeRole(user.role);
  const userBranch = normalizeBranchName(user.branch || '');
  const isAdmin = ['general_manager', 'executive_manager', 'branches_manager'].includes(role);
  const isBranchManager = ['branch_manager', 'customer_service_manager', 'shift_supervisor_morning', 'shift_supervisor_evening'].includes(role);

  if (isAdmin) return true;
  if (item.user_id && (item.user_id === user.id || item.user_id === safeUserId)) return true;
  if (item.recipient_user_id && (item.recipient_user_id === user.id || item.recipient_user_id === safeUserId)) return true;
  if (item.recipient_staff_id && item.recipient_staff_id === user.staffId) return true;
  if (item.recipient_role && normalizeRole(item.recipient_role) === role) return true;
  if (isBranchManager && item.branch && normalizeBranchName(item.branch) === userBranch) return true;
  return (
    !item.user_id &&
    !item.recipient_user_id &&
    !item.recipient_staff_id &&
    !item.recipient_role &&
    (!item.branch || normalizeBranchName(item.branch) === userBranch)
  );
}

function formatNotificationDate(value: string | number | null | undefined) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'غير متاح';
  return date.toLocaleString('ar-EG', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isUrgent(item: AppNotification) {
  return /urgent|critical|high|عاجل|حرج|خطر|مرتفع/i.test(String(item.priority || item.type || ''));
}

export default function Header({ onMobileMenuOpen, title }: HeaderProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const [showNotifs, setShowNotifs] = useState(false);
  const [showNotifSettings, setShowNotifSettings] = useState(false);
  const [soundMode, setSoundMode] = useState<'off' | 'soft' | 'distinct'>(
    () => (localStorage.getItem(SOUND_KEY) as 'off' | 'soft' | 'distinct') || 'soft'
  );
  const cycle = getCurrentCycle();
  const remaining = getRemainingDays();
  const prevUnread = useRef<number | null>(null);

  const {
    notifications: merged,
    unreadCount,
    loading: notificationsLoading,
    available: notificationsAvailable,
    settings: notificationSettings,
    markAllAsRead,
    handleNotificationClick,
  } = useNotifications();

  const visibleNotifications = useMemo(
    () => merged.filter((item) => canSeeNotification(item, user)),
    [merged, user]
  );
  const visibleUnreadCount = visibleNotifications.filter((item) => !item.read && !item.is_read).length;

  useEffect(() => {
    if (prevUnread.current === null) {
      prevUnread.current = visibleUnreadCount;
      return;
    }
    const newest = visibleNotifications[0];
    if (visibleUnreadCount > prevUnread.current && newest) playNotificationBeep();
    prevUnread.current = visibleUnreadCount;
  }, [visibleNotifications, visibleUnreadCount]);

  const markAllRead = async () => {
    await markAllAsRead();
  };

  const openNotification = (n: AppNotification) => {
    setShowNotifs(false);
    handleNotificationClick(n);
  };

  const setSound = (mode: 'off' | 'soft' | 'distinct') => {
    localStorage.setItem(SOUND_KEY, mode);
    setSoundMode(mode);
    saveNotificationSettings({ ...notificationSettings, sound: mode });
  };

  return (
    <header className="dawaa-header sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur" dir="rtl">
      <button type="button" onClick={onMobileMenuOpen} className="dawaa-header-icon-button rounded-lg p-2 transition lg:hidden">
        <Menu size={20} />
      </button>
      <h1 className="dawaa-header-title flex-1 truncate text-base font-black">{title}</h1>

      <button
        type="button"
        onClick={() => navigate('/attendance-report')}
        className="dawaa-button dawaa-button--primary px-3 py-2 text-xs font-black"
        title="تسجيل حضور / انصراف"
      >
        <Fingerprint size={16} />
        <span className="hidden sm:inline">تسجيل حضور</span>
      </button>

      {!isSupabaseConfigured && (
        <div className="dawaa-status-warning hidden items-center gap-2 rounded-xl border px-3 py-1.5 sm:flex">
          <span className="h-2 w-2 rounded-full currentColor" />
          <span className="text-xs font-bold">قاعدة البيانات غير مفعلة</span>
        </div>
      )}

      <div className="dawaa-header-cycle hidden items-center gap-2 rounded-xl px-3 py-1.5 md:flex">
        <span className="h-2 w-2 rounded-full bg-current" />
        <span className="text-xs font-black">{cycle.shortLabel}</span>
        <span className="dawaa-header-muted text-xs">({remaining} يوم)</span>
      </div>

      <div className="theme-switcher flex items-center gap-1 rounded-xl border p-1">
        <button type="button" onClick={() => setTheme('light')} className={cn('theme-option', theme === 'light' && 'theme-option-active')} title="الوضع الفاتح" aria-pressed={theme === 'light'}>
          <Sun size={15} /><span className="hidden sm:inline">فاتح</span>
        </button>
        <button type="button" onClick={() => setTheme('dark')} className={cn('theme-option', theme === 'dark' && 'theme-option-active')} title="الوضع الغامق" aria-pressed={theme === 'dark'}>
          <Moon size={15} /><span className="hidden sm:inline">غامق</span>
        </button>
      </div>

      <div className="relative">
        <button type="button" onClick={() => setShowNotifs((value) => !value)} className="dawaa-header-icon-button relative rounded-lg p-2 transition" aria-label="الإشعارات">
          <Bell size={18} />
          {visibleUnreadCount > 0 && (
            <span className="dawaa-header-unread-count absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border px-1 text-[10px] font-black">
              {visibleUnreadCount > 99 ? '99+' : visibleUnreadCount}
            </span>
          )}
        </button>

        {showNotifs && (
          <div className="dawaa-header-popover absolute left-0 top-12 z-50 w-80 overflow-hidden rounded-2xl sm:w-96">
            <div className="dawaa-header-popover-divider flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
              <div>
                <div className="dawaa-header-title text-sm font-black">الإشعارات</div>
                <div className="dawaa-header-muted text-xs font-semibold">{visibleUnreadCount} غير مقروء</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="dawaa-header-toggle-group flex items-center gap-1 rounded-lg p-0.5">
                  <button type="button" className={cn('dawaa-header-toggle rounded-md p-1.5', soundMode === 'off' && 'is-active')} title="بدون صوت" onClick={() => setSound('off')}><VolumeX size={14} /></button>
                  <button type="button" className={cn('dawaa-header-toggle rounded-md p-1.5', soundMode === 'soft' && 'is-active')} title="تنبيه خفيف" onClick={() => setSound('soft')}><Volume2 size={14} className="opacity-70" /></button>
                  <button type="button" className={cn('dawaa-header-toggle rounded-md p-1.5', soundMode === 'distinct' && 'is-active')} title="نغمة أوضح" onClick={() => { setSound('distinct'); playNotificationBeep(); }}><Volume2 size={14} /></button>
                </div>
                {visibleUnreadCount > 0 && <button type="button" onClick={markAllRead} className="dawaa-header-brand inline-flex items-center gap-1 text-xs font-black"><CheckCheck size={14} /> قراءة الكل</button>}
                <button type="button" onClick={() => setShowNotifSettings((value) => !value)} className="dawaa-header-icon-button rounded-lg border p-1.5" title="إعدادات الإشعارات"><Settings2 size={14} /></button>
              </div>
            </div>
            {showNotifSettings ? (
              <NotificationSettingsPanel settings={notificationSettings} onChange={saveNotificationSettings} />
            ) : (
              <div className="max-h-96 overflow-y-auto">
                {notificationsLoading ? (
                  <div className="dawaa-header-muted py-8 text-center text-sm font-bold">جاري تحميل الإشعارات...</div>
                ) : !notificationsAvailable ? (
                  <div className="dawaa-header-muted py-8 text-center text-sm font-bold">نظام الإشعارات يحتاج تفعيل قاعدة البيانات</div>
                ) : visibleNotifications.length === 0 ? (
                  <div className="dawaa-header-muted py-8 text-center text-sm font-bold">لا توجد إشعارات مسجلة حاليًا</div>
                ) : visibleNotifications.slice(0, 10).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => void openNotification(n)}
                    className={cn('dawaa-header-notification-row w-full border-b px-4 py-3 text-right transition last:border-0', !n.read && !n.is_read && 'is-unread')}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className={cn('dawaa-badge mt-0.5 shrink-0 px-2 py-0.5 text-xs font-black', isUrgent(n) ? 'dawaa-badge--danger' : notificationTone[String(n.type)] || notificationTone.system)}>
                        {String(n.priority || n.type || 'تنبيه')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="dawaa-header-title flex items-center gap-1 text-xs font-black">
                          <span className="truncate">{n.title}</span>
                          <ExternalLink size={12} className="dawaa-header-muted shrink-0" />
                        </div>
                        <div className="dawaa-header-muted mt-1 flex items-center justify-between gap-2 text-[10px]">
                          <span>{String(n.type || 'نوع غير محدد')}</span>
                          <span>{formatNotificationDate(n.created_at)}</span>
                        </div>
                        <div className="dawaa-header-muted mt-1 line-clamp-2 text-xs leading-relaxed">{n.body || n.message}</div>
                      </div>
                      {!n.read && !n.is_read && <span className="dawaa-header-unread-dot mt-1 h-2 w-2 shrink-0 rounded-full" />}
                    </div>
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => { setShowNotifs(false); navigate('/operations-center'); }} className="dawaa-header-footer-action w-full border-t px-4 py-3 text-center text-xs font-black">فتح مركز التنبيهات</button>
          </div>
        )}
      </div>

      {showNotifs && <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} aria-hidden />}
    </header>
  );
}

function NotificationSettingsPanel({ settings, onChange }: { settings: ReturnType<typeof useNotifications>['settings']; onChange: typeof saveNotificationSettings }) {
  const options: Array<[keyof typeof settings, string]> = [
    ['customerService', 'إشعارات خدمة العملاء'],
    ['delivery', 'إشعارات الدليفري'],
    ['inventory', 'إشعارات المخزون والصلاحية'],
    ['reviews', 'إشعارات التقييمات'],
    ['attendance', 'إشعارات الحضور والشيفت'],
    ['targets', 'إشعارات الأهداف والمبيعات'],
    ['highPriorityOnly', 'إظهار عالية الأهمية فقط'],
  ];
  return <div className="max-h-96 space-y-2 overflow-y-auto p-4">
    <div className="dawaa-header-title mb-3 text-xs font-black">إعدادات الإشعارات</div>
    {options.map(([key, label]) => <label key={key} className="dawaa-header-settings-row flex items-center justify-between gap-3 rounded-xl border p-2 text-xs font-bold"><span>{label}</span><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => onChange({ ...settings, [key]: event.target.checked })} /></label>)}
    <label className="dawaa-header-title block text-xs font-bold">مدة الاحتفاظ
      <select value={settings.retentionDays} onChange={(event) => onChange({ ...settings, retentionDays: Number(event.target.value) })} className="dawaa-input mt-1 w-full">
        <option value={7}>7 أيام</option><option value={30}>30 يومًا</option><option value={90}>90 يومًا</option>
      </select>
    </label>
  </div>;
}
