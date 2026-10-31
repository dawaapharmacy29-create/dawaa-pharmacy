import { supabase } from '@/lib/supabase';

// «مراجعتي اليومية» for the general manager (migration 20261031160000). Items with data here turn green on
// their own; items worked in the purchasing and delivery apps open that app and are closed by hand.

export type GmReviewKey =
  | 'sales_upload' | 'attendance' | 'managers' | 'cleaning' | 'inventory'
  | 'purchases_handover' | 'delivery' | 'customers';

export interface GmReviewItem {
  key: GmReviewKey;
  kind: 'auto' | 'external';
  ok: boolean;
  done: boolean;
  detail: unknown;
  data_day?: string | null;
  url?: string | null;
  state: 'done' | 'issue' | null;
  note: string | null;
  marked_by: string | null;
  marked_at: string | null;
}

export interface GmDailyReview {
  day: string;
  yesterday: string;
  items: GmReviewItem[];
  done: number;
  total: number;
  history: Array<{ day: string; marked: number }>;
}

export const GM_REVIEW_LABELS: Record<GmReviewKey, { title: string; question: string; link?: string }> = {
  sales_upload: { title: 'ملف المبيعات', question: 'ملف امبارح وصل للفرعين؟', link: '/invoices' },
  attendance: { title: 'البصمات والحضور', question: 'مين غاب أو اتأخر أو ما بصمش امبارح؟', link: '/attendance-report' },
  managers: { title: 'مديرين الفروع', question: 'كل مدير قفل لفة الفرع امبارح؟', link: '/' },
  cleaning: { title: 'النظافة', question: 'النظافة اتقيمت امبارح في الفرعين؟', link: '/branch-checklist-review' },
  inventory: { title: 'الجرد الأسبوعي', question: 'جرد الأسبوع متخطط وماشي في ميعاده؟', link: '/inventory-counts' },
  purchases_handover: { title: 'المشتريات وتسليم الشيفتات', question: 'ابعت ملف المطابقة وراجع الفواتير وتسليم الشيفتات' },
  delivery: { title: 'المناديب', question: 'ارفع الفواتير وراجع المشاوير واعتمد الأوردرات' },
  customers: { title: 'العملاء', question: 'طلبات الدورة المفتوحة وعملاء الـ 500 ج', link: '/customer-requests' },
};

const BRANCH = { shokry: 'شكري', elshamy: 'الشامي' } as Record<string, string>;
const INVENTORY = {
  not_planned: 'ما اتخططش', late: 'متأخر', planned: 'متخطط', counting: 'شغال', submitted: 'مستني الاعتماد', closed: 'اتقفل',
} as Record<string, string>;
const shortDay = (value?: string | null) =>
  value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' }) : '—';

type Row = Record<string, unknown>;
const rows = (detail: unknown) => (Array.isArray(detail) ? (detail as Row[]) : []);

/** One short line per branch (or for the whole item) describing what the data says. */
export function gmReviewSummary(item: Pick<GmReviewItem, 'key' | 'detail'>): string[] {
  const d = item.detail as Row;
  switch (item.key) {
    case 'sales_upload':
      return rows(item.detail).map((r) => `${BRANCH[String(r.branch)]}: آخر يوم ${shortDay(r.last_day as string)}`);
    case 'attendance':
      return rows(item.detail).map((r) => `${BRANCH[String(r.branch)]}: ${r.pending} مستني مراجعة · ${r.missing} بصمة ناقصة · ${r.late} متأخر`);
    case 'managers':
      return rows(item.detail).map((r) => `${BRANCH[String(r.branch)]}: ${r.checks_done}/${r.checks_total}${Number(r.issues) ? ` · ${r.issues} مشكلة` : ''}`);
    case 'cleaning':
      return rows(item.detail).map((r) => `${BRANCH[String(r.branch)]}: ${Number(r.ratings) ? 'اتقيمت' : `ما اتقيمتش (آخر تقييم ${shortDay(r.last_day as string)})`}`);
    case 'inventory':
      return rows(item.detail).map((r) => `${BRANCH[String(r.branch)]}: ${INVENTORY[String(r.status)] ?? r.status}`);
    case 'purchases_handover':
      return [
        `${d?.unreviewed_yesterday ?? 0} فاتورة مشتريات امبارح من غير مراجعة هنا`,
        `آخر تسليم شيفت وصل هنا: ${shortDay(d?.last_handover as string)}`,
      ];
    case 'customers':
      return [`${d?.open_requests ?? 0} طلب مفتوح أكتر من يوم · ${d?.big_customers_yesterday ?? 0} عميل اشترى بـ 500 ج امبارح`];
    default:
      return [];
  }
}

export function gmReviewErrorMessage(error: unknown) {
  const message = String((error as { message?: string })?.message ?? error ?? '');
  if (message.includes('not_authorized')) return 'الصفحة دي للمدير العام بس';
  if (message.includes('note_required')) return 'اكتب المشكلة في سطر';
  if (message.includes('invalid_url')) return 'الرابط لازم يبدأ بـ https://';
  if (message.includes('Could not find the function') || message.includes('PGRST202')) return 'المراجعة اليومية لسه مش متفعلة على قاعدة البيانات';
  return 'حصلت مشكلة، جرّب تاني';
}

export async function loadGmDailyReview() {
  const { data, error } = await supabase.rpc('get_gm_daily_review_v1');
  if (error) throw error;
  return data as GmDailyReview;
}

export async function markGmReviewItem(key: GmReviewKey, state: 'done' | 'issue' | 'clear', note?: string) {
  const { error } = await supabase.rpc('mark_gm_daily_review_item_v1', { p_item_key: key, p_state: state, p_note: note ?? null });
  if (error) throw error;
}

export async function setGmReviewLink(key: 'purchases_handover' | 'delivery', url: string) {
  const { error } = await supabase.rpc('set_gm_daily_review_link_v1', { p_item_key: key, p_url: url });
  if (error) throw error;
}
