import { Bell, Menu, Sun, Moon, Waves, Crown, Leaf, Droplets, Volume2, VolumeX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth, getSafeCurrentUserId } from "@/hooks/useAuth";
import { useTheme, type PaletteId } from "@/hooks/useTheme";
import { getCurrentCycle, getRemainingDays } from "@/lib/pharmacy-cycle";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { fetchSyntheticAlerts, markAllSyntheticRead, markSyntheticRead, type FeedNotification } from "@/lib/notificationFeed";

interface NotifItem {
  id: string;
  user_id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  route?: string | null;
  details?: string | Record<string, unknown> | null;
  target_type?: string | null;
  target_id?: string | null;
  created_at: string;
}

interface HeaderProps {
  onMobileMenuOpen: () => void;
  title: string;
}

const SOUND_KEY = "dawaa_notif_sound";

function playNotificationBeep() {
  const mode = localStorage.getItem(SOUND_KEY) || "soft";
  if (mode === "off") return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = mode === "distinct" ? 880 : 520;
    g.gain.value = 0.08;
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, mode === "distinct" ? 220 : 140);
  } catch {
    /* ignore */
  }
}

const PALETTES: { id: PaletteId; label: string; icon: typeof Waves }[] = [
  { id: "aqua", label: "فيروزي", icon: Droplets },
  { id: "royal", label: "ملكي", icon: Crown },
  { id: "forest", label: "غابة", icon: Leaf },
];

const notifColors: Record<string, string> = {
  مكافأة: "bg-teal-500/15 border-teal-500/20",
  خصم: "bg-red-500/15 border-red-500/20",
  شكوى: "bg-amber-500/15 border-amber-500/20",
  تذكير: "bg-blue-500/15 border-blue-500/20",
  عام: "bg-slate-500/15 border-slate-500/20",
};

function parseDetailsRoute(details: NotifItem["details"]) {
  if (!details) return null;
  if (typeof details === "object" && typeof details.route === "string") return details.route;
  if (typeof details !== "string") return null;
  try {
    const parsed = JSON.parse(details) as { route?: unknown };
    return typeof parsed.route === "string" ? parsed.route : null;
  } catch {
    return null;
  }
}

function inferNotificationRoute(n: Partial<NotifItem & FeedNotification>) {
  if (n.route) return n.route;
  const detailsRoute = parseDetailsRoute(n.details);
  if (detailsRoute) return detailsRoute;

  const text = `${n.type || ""} ${n.title || ""} ${n.body || ""} ${n.target_type || ""}`.toLowerCase();
  if (text.includes("متابعة") || text.includes("follow")) return "/customer-service";
  if (text.includes("محادث") || text.includes("review")) return "/reviews";
  if (text.includes("نقاط") || text.includes("خصم") || text.includes("مكاف")) return "/points";
  if (text.includes("فاتور") || text.includes("invoice")) return "/invoices";
  if (text.includes("شيفت")) return "/shift-performance";
  if (text.includes("إذن") || text.includes("اذن") || text.includes("إجاز") || text.includes("اجاز")) return "/time-off";
  if (text.includes("راكد")) return "/stagnant-medicines";
  if (text.includes("حافز")) return "/incentive-medicines";
  if (text.includes("عميل")) return "/customers";
  return "/activity-log";
}

export default function Header({ onMobileMenuOpen, title }: HeaderProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { theme, setTheme, palette, setPalette } = useTheme();
  const [showNotifs, setShowNotifs] = useState(false);
  const [soundMode, setSoundMode] = useState<"off" | "soft" | "distinct">(() => (localStorage.getItem(SOUND_KEY) as "off" | "soft" | "distinct") || "soft");
  const cycle = getCurrentCycle();
  const remaining = getRemainingDays();
  const prevUnread = useRef<number | null>(null);

  const { data: notifications, refetch } = useSupabaseQuery<NotifItem>({
    table: "notifications",
    orderBy: { column: "created_at", ascending: false },
    limit: 40,
    realtimeEnabled: true,
  });

  const [synthetic, setSynthetic] = useState<FeedNotification[]>([]);

  const loadSynthetic = useCallback(async () => {
    const s = await fetchSyntheticAlerts();
    setSynthetic(s);
  }, []);

  useEffect(() => {
    loadSynthetic();
    const t = window.setInterval(loadSynthetic, 120000);
    return () => window.clearInterval(t);
  }, [loadSynthetic]);

  const userNotifs = useMemo(
    () => notifications.filter((n) => n.user_id === user?.id || n.user_id === getSafeCurrentUserId()),
    [notifications, user?.id],
  );

  const merged = useMemo(() => {
    const dbMapped: FeedNotification[] = userNotifs.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      type: n.type,
      read: n.read,
      created_at: n.created_at,
      route: inferNotificationRoute(n),
      synthetic: false,
    }));
    const byId = new Map<string, FeedNotification>();
    [...synthetic, ...dbMapped].forEach((item) => {
      byId.set(item.id, item);
    });
    return [...byId.values()].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [userNotifs, synthetic]);

  const unreadCount = useMemo(
    () => merged.filter((n) => !n.read).length,
    [merged],
  );

  useEffect(() => {
    if (prevUnread.current === null) {
      prevUnread.current = unreadCount;
      return;
    }
    if (unreadCount > prevUnread.current) playNotificationBeep();
    prevUnread.current = unreadCount;
  }, [unreadCount]);

  const markAllRead = async () => {
    if (isSupabaseConfigured && user?.id) {
      const safeUserId = getSafeCurrentUserId();
      const orCondition = safeUserId 
        ? `user_id.eq.${user.id},user_id.eq.${safeUserId}`
        : `user_id.eq.${user.id}`;
      await supabase
        .from("notifications")
        .update({ read: true })
        .or(orCondition)
        .eq("read", false);
    }
    markAllSyntheticRead(synthetic.map((s) => s.id));
    refetch();
    await loadSynthetic();
  };

  const markOneRead = async (n: FeedNotification) => {
    if (n.synthetic) {
      markSyntheticRead(n.id);
      await loadSynthetic();
      return;
    }
    if (isSupabaseConfigured) {
      await supabase.from("notifications").update({ read: true }).eq("id", n.id);
      refetch();
    }
  };

  const openNotification = async (n: FeedNotification) => {
    await markOneRead(n);
    setShowNotifs(false);
    navigate(n.route || inferNotificationRoute(n));
  };

  const setSound = (m: "off" | "soft" | "distinct") => {
    localStorage.setItem(SOUND_KEY, m);
    setSoundMode(m);
  };

  return (
    <header className="h-14 bg-[#151f34]/95 backdrop-blur border-b border-[#2d4063] flex items-center px-4 gap-3 sticky top-0 z-30">
      <button type="button" onClick={onMobileMenuOpen} className="lg:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">
        <Menu size={20} />
      </button>
      <h1 className="text-white font-bold text-base flex-1 truncate">{title}</h1>

      {!isSupabaseConfigured && (
        <div className="hidden sm:flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-amber-300 text-xs font-medium">وضع تجريبي بدون قاعدة بيانات</span>
        </div>
      )}

      <div className="hidden md:flex items-center gap-2 bg-teal-500/10 border border-teal-500/20 rounded-xl px-3 py-1.5">
        <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse-soft" />
        <span className="text-teal-300 text-xs font-medium">{cycle.shortLabel}</span>
        <span className="text-slate-400 text-xs">({remaining} يوم)</span>
      </div>

      <div className="hidden sm:flex items-center gap-0.5 rounded-xl border border-[#2d4063] bg-white/5 p-1" title="لوحة الألوان">
        {PALETTES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setPalette(id)}
            className={cn(
              "flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold transition-all",
              palette === id ? "bg-white/15 text-white border border-white/10" : "text-slate-500 hover:text-slate-200",
            )}
            aria-pressed={palette === id}
          >
            <Icon size={12} />
            <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
      </div>

      <div className="theme-switcher flex items-center gap-1 rounded-xl border border-[#2d4063] bg-white/5 p-1">
        <button
          type="button"
          onClick={() => setTheme("light")}
          className={cn("theme-option", theme === "light" && "theme-option-active")}
          title="الوضع الفاتح"
          aria-pressed={theme === "light"}
        >
          <Sun size={15} />
          <span className="hidden sm:inline">فاتح</span>
        </button>
        <button
          type="button"
          onClick={() => setTheme("dark")}
          className={cn("theme-option", theme === "dark" && "theme-option-active")}
          title="الوضع الغامق"
          aria-pressed={theme === "dark"}
        >
          <Moon size={15} />
          <span className="hidden sm:inline">غامق</span>
        </button>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setShowNotifs(!showNotifs)}
          className="relative p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-all"
          aria-label="الإشعارات"
        >
          <Bell size={18} />
          {merged.length > 0 && (
            <span
              className={cn(
                "absolute -top-0.5 -right-0.5 text-navy-900 text-[10px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center border border-[#0f1923]",
                unreadCount > 0 ? "bg-teal-400" : "bg-slate-500 text-white",
              )}
            >
              {unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : merged.length > 99 ? "99+" : merged.length}
            </span>
          )}
        </button>

        {showNotifs && (
          <div className="absolute left-0 top-12 w-80 sm:w-96 bg-[#1B2B4B] border border-[#2d4063] rounded-2xl shadow-2xl shadow-black/40 z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d4063] gap-2 flex-wrap">
              <span className="text-white font-semibold text-sm">الإشعارات</span>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 rounded-lg border border-[#2d4063] p-0.5">
                  <button
                    type="button"
                    className={cn("p-1.5 rounded-md", soundMode === "off" && "bg-white/10")}
                    title="بدون صوت"
                    onClick={() => setSound("off")}
                  >
                    <VolumeX size={14} />
                  </button>
                  <button
                    type="button"
                    className={cn("p-1.5 rounded-md", soundMode === "soft" && "bg-white/10")}
                    title="تنبيه خفيف"
                    onClick={() => setSound("soft")}
                  >
                    <Volume2 size={14} className="opacity-70" />
                  </button>
                  <button
                    type="button"
                    className={cn("p-1.5 rounded-md", soundMode === "distinct" && "bg-white/10")}
                    title="نغمة أوضح"
                    onClick={() => {
                      setSound("distinct");
                      playNotificationBeep();
                    }}
                  >
                    <Volume2 size={14} />
                  </button>
                </div>
                {unreadCount > 0 && (
                  <button type="button" onClick={markAllRead} className="text-teal-400 text-xs font-semibold">
                    قراءة الكل
                  </button>
                )}
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {merged.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-sm">لا توجد إشعارات مسجلة حاليًا</div>
              ) : (
                merged.slice(0, 14).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => void openNotification(n)}
                    className={cn(
                      "w-full text-right px-4 py-3 border-b border-[#2d4063]/50 last:border-0 hover:bg-white/5 transition-colors",
                      !n.read ? "bg-teal-500/5" : "",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full border mt-0.5 shrink-0", notifColors[n.type] || notifColors["عام"])}>{n.type}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-xs font-semibold">{n.title}</div>
                        <div className="text-slate-400 text-xs mt-0.5 leading-relaxed">{n.body}</div>
                      </div>
                      {!n.read && <div className="w-2 h-2 rounded-full bg-teal-400 mt-1 flex-shrink-0" />}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {showNotifs && <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} aria-hidden />}
    </header>
  );
}
