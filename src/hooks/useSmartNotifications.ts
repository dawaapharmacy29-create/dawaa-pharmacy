/**
 * useSmartNotifications.ts
 * Generates client-side smart notifications from existing DB data.
 * Merges follow-ups due today + stagnant medicines expiring soon.
 * No new DB table required — reads from tables already in use.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { AppNotification } from '@/lib/notificationService';
import { isOpenStatus, rowDate, safeNumber, safeRows, safeText } from '@/lib/safeSupabase';

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

function warnDevelopment(source: string, error: string | null) {
  if (error && import.meta.env.DEV) console.warn(`[smart-notifications] ${source}: ${error}`);
}

async function fetchSmartNotifications(options: {
  branch?: string | null;
  role?: string | null;
}): Promise<AppNotification[]> {
  if (!isSupabaseConfigured) return [];

  const notifications: AppNotification[] = [];
  const today = todayISO();
  const isAdmin = /مدير عام|admin|أدمن/i.test(options.role || '');

  // ── 1. Follow-ups due today ──────────────────────────────────────────────
  try {
    let q = supabase
      .from('daily_followups')
      .select(
        'id,customer_name,customer_phone,responsible_name,branch,followup_status,status,followup_date,next_followup_date,created_at'
      )
      .limit(30);

    if (!isAdmin && options.branch) {
      q = q.eq('branch', options.branch);
    }

    const { data: followups } = await q;
    const todayFollowups = (followups || []).filter((row) => {
      const dateStr = String(
        row.followup_date || row.next_followup_date || row.created_at || ''
      ).slice(0, 10);
      const isDue = dateStr === today;
      const notDone = !['تم', 'تم التواصل', 'تم الشراء بعد المتابعة', 'completed'].includes(
        String(row.followup_status || row.status || '')
      );
      return isDue && notDone;
    });

    if (todayFollowups.length > 0) {
      notifications.push({
        id: makeId('followup_summary', today),
        title: `متابعات اليوم: ${todayFollowups.length} عميل`,
        message: `${todayFollowups.length} متابعة مجدولة اليوم لم تكتمل بعد`,
        body: `${todayFollowups.length} متابعة مجدولة اليوم لم تكتمل بعد`,
        type: 'followup',
        priority: 'high',
        is_read: false,
        read: false,
        route: '/customer-service',
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
      .from('stagnant_medicines')
      .select('id,medicine_name,nearest_expiry_date,expiry_date,branch,status,priority')
      .lte('nearest_expiry_date', in30Days)
      .limit(50);

    if (!isAdmin && options.branch) {
      q = q.eq('branch', options.branch);
    }

    const { data: medicines } = await q;
    const active = (medicines || []).filter((m) => {
      const s = String(m.status || '').toLowerCase();
      return !['dispensed', 'صرف', 'صُرف', 'completed'].includes(s) && m.nearest_expiry_date;
    });

    if (active.length > 0) {
      const expiredCount = active.filter((m) => {
        const exp = String(m.nearest_expiry_date || '').slice(0, 10);
        return exp < today;
      }).length;
      const soonCount = active.length - expiredCount;

      if (expiredCount > 0) {
        notifications.push({
          id: makeId('expired_medicines', today),
          title: `⚠️ أدوية منتهية الصلاحية: ${expiredCount}`,
          message: `${expiredCount} دواء راكد انتهت صلاحيته — يتطلب إجراء فورياً`,
          body: `${expiredCount} دواء راكد انتهت صلاحيته — يتطلب إجراء فورياً`,
          type: 'stagnant_item',
          priority: 'urgent',
          is_read: false,
          read: false,
          route: '/stagnant-medicines',
          branch: options.branch || null,
          created_at: new Date().toISOString(),
        });
      }

      if (soonCount > 0) {
        notifications.push({
          id: makeId('expiring_medicines', today),
          title: `أدوية تنتهي خلال 30 يوم: ${soonCount}`,
          message: `${soonCount} دواء راكد سينتهي خلال 30 يوماً — راجع قسم الرواكد`,
          body: `${soonCount} دواء راكد سينتهي خلال 30 يوماً — راجع قسم الرواكد`,
          type: 'inventory',
          priority: 'high',
          is_read: false,
          read: false,
          route: '/stagnant-medicines',
          branch: options.branch || null,
          created_at: new Date().toISOString(),
        });
      }
    }
  } catch {
    // silent
  }

  const addCountNotification = (
    key: string,
    count: number,
    title: string,
    message: string,
    route: string,
    type: AppNotification['type'],
    priority: AppNotification['priority'] = 'high'
  ) => {
    if (!count) return;
    notifications.push({
      id: makeId(key, today),
      title: `${title}: ${count}`,
      message,
      body: message,
      type,
      priority,
      is_read: false,
      read: false,
      route,
      branch: options.branch || null,
      created_at: new Date().toISOString(),
    });
  };

  // Each source is isolated by safeRows. A missing table never prevents the
  // remaining notifications from loading.
  const [complaints, reviews, shortages, delivery, approvals, vipCustomers, refills, expiryItems] =
    await Promise.all([
      safeRows<Record<string, unknown>>('customer_requests', (q) => q.limit(200)),
      safeRows<Record<string, unknown>>('conversation_sales_reviews', (q) => q.limit(200)),
      safeRows<Record<string, unknown>>('shortages', (q) => q.limit(200)),
      safeRows<Record<string, unknown>>('delivery_orders', (q) => q.limit(200)),
      safeRows<Record<string, unknown>>('employee_transactions', (q) => q.limit(200)),
      safeRows<Record<string, unknown>>('customers', (q) => q.limit(500)),
      safeRows<Record<string, unknown>>('customer_medication_cycles', (q) => q.limit(200)),
      safeRows<Record<string, unknown>>('expiry_discount_items', (q) => q.limit(200)),
    ]);
  [complaints, reviews, shortages, delivery, approvals, vipCustomers, refills, expiryItems].forEach(
    (result, index) =>
      warnDevelopment(
        [
          'customer_requests',
          'conversation_sales_reviews',
          'shortages',
          'delivery_orders',
          'employee_transactions',
          'customers',
          'customer_medication_cycles',
          'expiry_discount_items',
        ][index],
        result.error
      )
  );

  addCountNotification(
    'complaints',
    complaints.rows.filter(
      (r) => /complaint|شكوى/i.test(safeText(r.type ?? r.request_type)) && isOpenStatus(r.status)
    ).length,
    'شكاوى مفتوحة',
    'شكاوى عملاء تحتاج متابعة وإغلاق',
    '/customer-requests',
    'customer_alert',
    'urgent'
  );
  addCountNotification(
    'weak_reviews',
    reviews.rows.filter(
      (r) =>
        safeNumber(r.final_score ?? r.score ?? r.percentage) > 0 &&
        safeNumber(r.final_score ?? r.score ?? r.percentage) < 70
    ).length,
    'تقييمات محادثات ضعيفة',
    'تقييمات أقل من 70% تحتاج مراجعة وتوصية تدريبية',
    '/reviews',
    'conversation_review',
    'high'
  );
  addCountNotification(
    'shortages',
    shortages.rows.filter((r) => isOpenStatus(r.status ?? r.review_status)).length,
    'نواقص لم تراجع',
    'أصناف ناقصة تحتاج مراجعة تشغيلية',
    '/shortages',
    'inventory',
    'high'
  );
  addCountNotification(
    'delivery',
    delivery.rows.filter((r) => isOpenStatus(r.status)).length,
    'طلبات دليفري معلقة',
    'طلبات توصيل لم تكتمل بعد',
    '/delivery',
    'delivery',
    'high'
  );
  addCountNotification(
    'approvals',
    approvals.rows.filter((r) =>
      /pending|معلق|بانتظار/i.test(safeText(r.status ?? r.approval_status))
    ).length,
    'نقاط أو خصومات تحتاج اعتماد',
    'معاملات موظفين ما زالت في انتظار اعتماد المدير',
    '/penalty-incentive',
    'manager_alert',
    'high'
  );
  addCountNotification(
    'vip',
    vipCustomers.rows.filter(
      (r) =>
        /vip/i.test(safeText(r.segment ?? r.customer_type ?? r.loyalty_tier)) &&
        (!safeText(r.last_contact_at) || rowDate(r, ['last_contact_at']) < futureISO(-30))
    ).length,
    'عملاء VIP يحتاجون متابعة',
    'عملاء مهمون لم يسجل لهم تواصل حديث',
    '/customers',
    'customer_alert',
    'high'
  );
  addCountNotification(
    'refills',
    refills.rows.filter((r) => {
      const date = rowDate(r, ['next_refill_date']);
      if (!date || safeText(r.status, 'active') !== 'active') return false;
      const alertDate = new Date(`${date}T12:00:00`);
      alertDate.setDate(alertDate.getDate() - safeNumber(r.reminder_days_before || 5));
      return alertDate <= new Date();
    }).length,
    'مواعيد إعادة صرف اقتربت',
    'عملاء علاج شهري يحتاجون تواصلًا قبل موعد الصرف',
    '/refill-reminders',
    'followup',
    'high'
  );
  addCountNotification(
    'expiry_manual',
    expiryItems.rows.filter((r) => {
      const date = rowDate(r, ['expiry_date']);
      return date && date <= futureISO(30) && isOpenStatus(r.status);
    }).length,
    'أصناف قريبة الانتهاء',
    'راجع الخصومات المقترحة للأصناف القريبة من انتهاء الصلاحية',
    '/expiry-discounts',
    'inventory',
    'urgent'
  );

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

    const interval = setInterval(() => {
      void run();
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.branch, options.role, options.enabled]);

  return smartNotifs;
}
