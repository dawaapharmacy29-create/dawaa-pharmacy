/**
 * useSmartNotifications.ts
 * Generates client-side smart notifications from existing DB data.
 * Merges follow-ups due today + stagnant medicines expiring soon.
 * No new DB table required — reads from tables already in use.
 */

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { AppNotification } from "@/lib/notificationService";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // refresh every 5 minutes

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function futureISO(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function makeId(prefix: string, id: unknown): string {
  return `smart_${prefix}_${String(id || Math.random()).slice(0, 12)}`;
}

async function fetchSmartNotifications(options: {
  branch?: string | null;
  role?: string | null;
}): Promise<AppNotification[]> {
  if (!isSupabaseConfigured) return [];

  const notifications: AppNotification[] = [];
  const today = todayISO();
  const isAdmin = /مدير عام|admin|أدمن/i.test(options.role || "");

  // ── 1. Follow-ups due today ──────────────────────────────────────────────
  try {
    let q = supabase
      .from("daily_followups")
      .select("id,customer_name,customer_phone,responsible_name,branch,followup_status,status,followup_date,next_followup_date,created_at")
      .limit(30);

    if (!isAdmin && options.branch) {
      q = q.eq("branch", options.branch);
    }

    const { data: followups } = await q;
    const todayFollowups = (followups || []).filter((row) => {
      const dateStr = String(row.followup_date || row.next_followup_date || row.created_at || "").slice(0, 10);
      const isDue = dateStr === today;
      const notDone = !["تم", "تم التواصل", "تم الشراء بعد المتابعة", "completed"].includes(
        String(row.followup_status || row.status || "")
      );
      return isDue && notDone;
    });

    if (todayFollowups.length > 0) {
      notifications.push({
        id: makeId("followup_summary", today),
        title: `متابعات اليوم: ${todayFollowups.length} عميل`,
        message: `${todayFollowups.length} متابعة مجدولة اليوم لم تكتمل بعد`,
        body: `${todayFollowups.length} متابعة مجدولة اليوم لم تكتمل بعد`,
        type: "followup",
        priority: "high",
        is_read: false,
        read: false,
        route: "/customer-service",
        branch: options.branch || null,
        created_at: new Date().toISOString(),
      });
    }
  } catch {
    // silent — smart notifs are best-effort
  }

  // ── 2. Stagnant medicines expiring within 30 days ──────────────────────
  try {
    const in30Days = futureISO(30);
    let q = supabase
      .from("stagnant_medicines")
      .select("id,medicine_name,nearest_expiry_date,expiry_date,branch,status,priority")
      .lte("nearest_expiry_date", in30Days)
      .limit(50);

    if (!isAdmin && options.branch) {
      q = q.eq("branch", options.branch);
    }

    const { data: medicines } = await q;
    const active = (medicines || []).filter((m) => {
      const s = String(m.status || "").toLowerCase();
      return !["dispensed", "صرف", "صُرف", "completed"].includes(s) && m.nearest_expiry_date;
    });

    if (active.length > 0) {
      const expiredCount = active.filter((m) => {
        const exp = String(m.nearest_expiry_date || "").slice(0, 10);
        return exp < today;
      }).length;
      const soonCount = active.length - expiredCount;

      if (expiredCount > 0) {
        notifications.push({
          id: makeId("expired_medicines", today),
          title: `⚠️ أدوية منتهية الصلاحية: ${expiredCount}`,
          message: `${expiredCount} دواء راكد انتهت صلاحيته — يتطلب إجراء فورياً`,
          body: `${expiredCount} دواء راكد انتهت صلاحيته — يتطلب إجراء فورياً`,
          type: "stagnant_item",
          priority: "urgent",
          is_read: false,
          read: false,
          route: "/stagnant-medicines",
          branch: options.branch || null,
          created_at: new Date().toISOString(),
        });
      }

      if (soonCount > 0) {
        notifications.push({
          id: makeId("expiring_medicines", today),
          title: `أدوية تنتهي خلال 30 يوم: ${soonCount}`,
          message: `${soonCount} دواء راكد سينتهي خلال 30 يوماً — راجع قسم الرواكد`,
          body: `${soonCount} دواء راكد سينتهي خلال 30 يوماً — راجع قسم الرواكد`,
          type: "inventory",
          priority: "high",
          is_read: false,
          read: false,
          route: "/stagnant-medicines",
          branch: options.branch || null,
          created_at: new Date().toISOString(),
        });
      }
    }
  } catch {
    // silent
  }

  return notifications;
}

/** Hook: returns smart notifications generated from live DB data. */
export function useSmartNotifications(options: {
  branch?: string | null;
  role?: string | null;
  enabled?: boolean;
}): AppNotification[] {
  const [smartNotifs, setSmartNotifs] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (options.enabled === false) return;

    let cancelled = false;

    const run = async () => {
      const result = await fetchSmartNotifications({
        branch: options.branch,
        role: options.role,
      });
      if (!cancelled) setSmartNotifs(result);
    };

    void run();

    const interval = setInterval(() => { void run(); }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.branch, options.role, options.enabled]);

  return smartNotifs;
}
