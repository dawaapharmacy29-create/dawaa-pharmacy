import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type FeedNotification = {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  created_at: string;
  route?: string | null;
  synthetic?: boolean;
};

const READ_KEY = 'dawaa_synth_notif_read_ids';

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function markSyntheticRead(id: string) {
  const s = loadReadIds();
  s.add(id);
  localStorage.setItem(READ_KEY, JSON.stringify([...s]));
}

export function markAllSyntheticRead(ids: string[]) {
  const s = loadReadIds();
  ids.forEach((id) => s.add(id));
  localStorage.setItem(READ_KEY, JSON.stringify([...s]));
}

function todayStartISO() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function todayEndISO() {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export async function fetchSyntheticAlerts(): Promise<FeedNotification[]> {
  if (!isSupabaseConfigured) return [];

  const alerts: FeedNotification[] = [];
  const readIds = loadReadIds();
  const nowH = new Date().getHours();

  try {
    const { data: fu, error: fuErr } = await supabase
      .from('daily_followups')
      .select('id, status, created_at')
      .gte('created_at', todayStartISO())
      .lte('created_at', todayEndISO());

    if (!fuErr && fu?.length) {
      const pending = fu.filter(
        (r: { status?: string | null }) => r.status === 'معلق' || r.status === 'pending'
      );
      if (pending.length > 0 && nowH >= 14) {
        const id = 'synth-followup-pending';
        alerts.push({
          id,
          title: 'قائمة المتابعة اليومية',
          body: `لا يزال ${pending.length} عميلًا في حالة معلق ولم تُسجل نتيجة متابعتهم اليوم.`,
          type: 'تذكير',
          read: readIds.has(id),
          created_at: new Date().toISOString(),
          route: '/customer-service',
          synthetic: true,
        });
      }
    }
  } catch {
    /* ignore optional table errors */
  }

  try {
    const { data: cmp, error: cErr } = await supabase
      .from('complaints')
      .select('id, status, customer_name, branch')
      .in('status', ['مفتوحة', 'جارية', 'قيد المعالجة', 'open', 'pending'])
      .limit(25);

    if (!cErr && cmp?.length) {
      const id = 'synth-complaints-open';
      alerts.push({
        id,
        title: 'شكاوى تحتاج متابعة',
        body: `${cmp.length} شكوى مسجلة بحالة مفتوحة. راجع خدمة العملاء لمتابعة الحالات.`,
        type: 'شكوى',
        read: readIds.has(id),
        created_at: new Date().toISOString(),
        route: '/customer-service',
        synthetic: true,
      });
    }
  } catch {
    /* ignore optional table errors */
  }

  try {
    const { data: reviews, error: rErr } = await supabase
      .from('conversation_sales_reviews')
      .select('id, final_score, staff_name, branch, created_at')
      .lte('final_score', 69)
      .gte('created_at', daysAgoISO(5))
      .order('created_at', { ascending: false })
      .limit(10);

    if (!rErr && reviews?.length) {
      const id = 'synth-low-reviews';
      alerts.push({
        id,
        title: 'تقييمات محادثات ضعيفة',
        body: `يوجد ${reviews.length} تقييمًا أقل من 70% مؤخرًا. راجع صفحة تقييم المحادثات.`,
        type: 'تذكير',
        read: readIds.has(id),
        created_at: new Date().toISOString(),
        route: `/reviews?id=${reviews[0]?.id || ''}`,
        synthetic: true,
      });
    }
  } catch {
    /* ignore optional table errors */
  }

  try {
    const soon = new Date();
    soon.setDate(soon.getDate() + 90);
    const { data: stagnant, error: stErr } = await supabase
      .from('stagnant_medicines')
      .select(
        'id, medicine_name, expiry_date, quantity_available, dispensed_quantity, responsible_doctor'
      )
      .lte('expiry_date', soon.toISOString().slice(0, 10))
      .order('expiry_date', { ascending: true })
      .limit(25);

    if (!stErr && stagnant?.length) {
      const urgent = stagnant.filter(
        (row: { quantity_available?: number | null; dispensed_quantity?: number | null }) =>
          Number(row.quantity_available || 0) > Number(row.dispensed_quantity || 0)
      );
      if (urgent.length) {
        const id = 'synth-stagnant-expiry';
        alerts.push({
          id,
          title: 'رواكد قريبة الانتهاء',
          body: `${urgent.length} صنف راكد له تاريخ صلاحية قريب أو كمية متبقية. راجع صفحة الرواكد وتوزيع الدكاترة.`,
          type: 'تذكير',
          read: readIds.has(id),
          created_at: new Date().toISOString(),
          route: `/stagnant-medicines?id=${urgent[0]?.id || ''}`,
          synthetic: true,
        });
      }
    }
  } catch {
    /* ignore optional table errors */
  }

  try {
    const { data: risky, error: rkErr } = await supabase
      .from('daily_followups')
      .select('id, customer_name')
      .not('status', 'in', '("completed","closed","done","مكتمل","تم","مغلق")')
      .limit(40);

    if (!rkErr && risky && risky.length >= 5) {
      const id = 'synth-customer-risk';
      alerts.push({
        id,
        title: 'عملاء يحتاجون متابعة إضافية',
        body: `يوجد ${risky.length}+ عميل بحالة خطر أو مهدد. راجع التحليلات وقائمة العملاء.`,
        type: 'تذكير',
        read: readIds.has(id),
        created_at: new Date().toISOString(),
        route: '/analytics',
        synthetic: true,
      });
    }
  } catch {
    /* ignore optional table errors */
  }

  return alerts;
}
