import { Bell, Menu, Sun, Moon, Volume2, VolumeX, CheckCheck, ExternalLink, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getSafeCurrentUserId, useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { getCurrentCycle, getRemainingDays } from '@/lib/pharmacy-cycle';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { AppNotification } from '@/lib/notificationService';
import { saveNotificationSettings, useNotifications } from '@/hooks/useNotifications';

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

const notifColors: Record<string, string> = {
  reward: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  deduction: 'bg-red-50 border-red-200 text-red-700',
  task: 'bg-blue-50 border-blue-200 text-blue-700',
  followup: 'bg-teal-50 border-teal-200 text-teal-700',
  conversation_review: 'bg-purple-50 border-purple-200 text-purple-700',
  customer_alert: 'bg-amber-50 border-amber-200 text-amber-700',
  delivery: 'bg-cyan-50 border-cyan-200 text-cyan-700',
  system: 'bg-slate-50 border-slate-200 text-slate-700',
};

function playNotificationBeep() {
  const mode = localStorage.getItem(SOUND_KEY) || 'soft';
  if (mode === 'off') return;
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = mode === 'distinct' ? 880 : 520;
    gain.gain.value = 0.08;
    oscillator.start();
    setTimeout(
      () => {
        oscillator.stop();
        ctx.close();
      },
      mode === 'distinct' ? 220 : 140
    );
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

  const text =
    `${n.type || ''} ${n.title || ''} ${n.body || ''} ${n.message || ''} ${n.target_type || ''}`.toLowerCase();
  if (text.includes('follow') || text.includes('متابعة')) return '/customer-service';
  if (text.includes('review') || text.includes('تقييم')) return '/reviews';
  if (
    text.includes('deduction') ||
    text.includes('reward') ||
    text.includes('خصم') ||
    text.includes('مكاف')
  )
    return '/points';
  if (text.includes('invoice') || text.includes('فاتور')) return '/invoices';
  if (text.includes('shift') || text.includes('شيفت')) return '/shift-performance';
  if (text.includes('stagnant') || text.includes('راكد')) return '/stagnant-medicines';
  if (text.includes('delivery') || text.includes('دليفري') || text.includes('توصيل'))
    return '/delivery';
  if (text.includes('customer') || text.includes('عميل')) return '/customers';
  return '/operations-center';
}

function canSeeNotification(item: AppNotification, user: ReturnType<typeof useAuth>['user']) {
  if (!user) return false;
  const safeUserId = getSafeCurrentUserId();
  const role = user.role || '';
  const isAdmin = ['مدير عام', 'المدير العام', 'admin', 'أدمن'].includes(role);
  const isBranchManager = role === 'مدير فرع';

  if (isAdmin) return true;
  if (item.user_id && (item.user_id === user.id || item.user_id === safeUserId)) return true;
  if (
    item.recipient_user_id &&
    (item.recipient_user_id === user.id || item.recipient_user_id === safeUserId)
  )
    return true;
  if (item.recipient_staff_id && item.recipient_staff_id === user.staffId) return true;
  if (item.recipient_role && item.recipient_role === role) return true;
  if (isBranchManager && item.branch && item.branch === user.branch) return true;
  return (
    !item.user_id &&
    !item.recipient_user_id &&
    !item.recipient_staff_id &&
    !item.recipient_role &&
    (!item.branch || item.branch === user.branch)
  );
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
    available: notificationsAvailable,
    settings: notificationSettings,
    markAllAsRead,
    handleNotificationClick,
  } = useNotifications();

  useEffect(() => {
    if (prevUnread.current === null) {
      prevUnread.current = unreadCount;
      return;
    }
    const newest = merged[0];
    if (unreadCount > prevUnread.current && newest && isUrgent(newest)) playNotificationBeep();
    prevUnread.current = unreadCount;
  }, [merged, unreadCount]);

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
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur"
      dir="rtl"
    >
      <button
        type="button"
        onClick={onMobileMenuOpen}
        className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 lg:hidden"
      >
        <Menu size={20} />
      </button>
      <h1 className="flex-1 truncate text-base font-black text-slate-950">{title}</h1>

      {!isSupabaseConfigured && (
        <div className="hidden items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 sm:flex">
          <span className="h-2 w-2 rounded-full bg-amber-400" />
          <span className="text-xs font-bold text-amber-700">قاعدة البيانات غير مفعلة</span>
        </div>
      )}

      <div className="hidden items-center gap-2 rounded-xl border border-teal-100 bg-teal-50 px-3 py-1.5 md:flex">
        <span className="h-2 w-2 rounded-full bg-teal-500" />
        <span className="text-xs font-black text-teal-700">{cycle.shortLabel}</span>
        <span className="text-xs text-slate-500">({remaining} يوم)</span>
      </div>
      <div className="theme-switcher flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => setTheme('light')}
          className={cn('theme-option', theme === 'light' && 'theme-option-active')}
          title="الوضع الفاتح"
          aria-pressed={theme === 'light'}
        >
          <Sun size={15} />
          <span className="hidden sm:inline">فاتح</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme('dark')}
          className={cn('theme-option', theme === 'dark' && 'theme-option-active')}
          title="الوضع الغامق"
          aria-pressed={theme === 'dark'}
        >
          <Moon size={15} />
          <span className="hidden sm:inline">غامق</span>
        </button>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowNotifs((value) => !value)}
          className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
          aria-label="الإشعارات"
        >
          <Bell size={18} />
          {unreadCount > 0 && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white px-1 text-[10px] font-black',
                'bg-teal-500 text-white'
              )}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {showNotifs && (
          <div className="absolute left-0 top-12 z-50 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-200/80 sm:w-96">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div>
                <div className="text-sm font-black text-slate-950">الإشعارات</div>
                <div className="text-xs font-semibold text-slate-500">{unreadCount} غير مقروء</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  <button
                    type="button"
                    className={cn(
                      'rounded-md p-1.5 text-slate-500',
                      soundMode === 'off' && 'bg-white text-slate-900 shadow-sm'
                    )}
                    title="بدون صوت"
                    onClick={() => setSound('off')}
                  >
                    <VolumeX size={14} />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded-md p-1.5 text-slate-500',
                      soundMode === 'soft' && 'bg-white text-slate-900 shadow-sm'
                    )}
                    title="تنبيه خفيف"
                    onClick={() => setSound('soft')}
                  >
                    <Volume2 size={14} className="opacity-70" />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      'rounded-md p-1.5 text-slate-500',
                      soundMode === 'distinct' && 'bg-white text-slate-900 shadow-sm'
                    )}
                    title="نغمة أوضح"
                    onClick={() => {
                      setSound('distinct');
                      playNotificationBeep();
                    }}
                  >
                    <Volume2 size={14} />
                  </button>
                </div>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="inline-flex items-center gap-1 text-xs font-black text-teal-700"
                  >
                    <CheckCheck size={14} /> قراءة الكل
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowNotifSettings((value) => !value)}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                  title="إعدادات الإشعارات"
                >
                  <Settings2 size={14} />
                </button>
              </div>
            </div>
            {showNotifSettings ? (
              <NotificationSettingsPanel
                settings={notificationSettings}
                onChange={saveNotificationSettings}
              />
            ) : <div className="max-h-96 overflow-y-auto">
              {merged.length === 0 ? (
                <div className="py-8 text-center text-sm font-bold text-slate-500">
                  {notificationsAvailable ? 'لا توجد إشعارات مسجلة حاليًا' : 'نظام الإشعارات يحتاج تفعيل قاعدة البيانات'}
                </div>
              ) : (
                merged.slice(0, 10).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => void openNotification(n)}
                    className={cn(
                      'w-full border-b border-slate-100 px-4 py-3 text-right transition last:border-0 hover:bg-slate-50',
                      !n.read && !n.is_read ? 'bg-teal-50/50' : ''
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          'mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs font-black',
                          isUrgent(n)
                            ? 'border-red-200 bg-red-50 text-red-700'
                            : notifColors[String(n.type)] || notifColors.system
                        )}
                      >
                        {String(n.priority || n.type || 'تنبيه')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-xs font-black text-slate-950">
                          <span className="truncate">{n.title}</span>
                          <ExternalLink size={12} className="shrink-0 text-slate-400" />
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500">
                          {n.body || n.message}
                        </div>
                      </div>
                      {!n.read && !n.is_read && (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-teal-500" />
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>}
            <button
              type="button"
              onClick={() => {
                setShowNotifs(false);
                navigate('/operations-center');
              }}
              className="w-full border-t border-slate-100 bg-slate-50 px-4 py-3 text-center text-xs font-black text-teal-700 hover:bg-teal-50"
            >
              فتح مركز التنبيهات
            </button>
          </div>
        )}
      </div>

      {showNotifs && (
        <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} aria-hidden />
      )}
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
    <div className="mb-3 text-xs font-black text-slate-900">إعدادات الإشعارات</div>
    {options.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-2 text-xs font-bold text-slate-700"><span>{label}</span><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => onChange({ ...settings, [key]: event.target.checked })} /></label>)}
    <label className="block text-xs font-bold text-slate-700">مدة الاحتفاظ
      <select value={settings.retentionDays} onChange={(event) => onChange({ ...settings, retentionDays: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-slate-200 p-2">
        <option value={7}>7 أيام</option><option value={30}>30 يومًا</option><option value={90}>90 يومًا</option>
      </select>
    </label>
  </div>;
}
