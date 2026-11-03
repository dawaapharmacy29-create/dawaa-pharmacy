import { supabase } from '@/lib/supabase';
import { onDutyLabel, type OnDutyDoctor } from '@/lib/shiftHandoverCoverage';

// «مراجعتي اليومية» for the general manager (migration 20261031160000). Items with data here turn green on
// their own; items worked in the purchasing and delivery apps open that app and are closed by hand.

export type GmReviewKey =
  | 'sales_upload'
  | 'attendance'
  | 'managers'
  | 'cleaning'
  | 'inventory'
  | 'purchases_handover'
  | 'shifts'
  | 'delivery'
  | 'collection_transfers'
  | 'customers';
export type GmReviewLinkKey = 'purchases_handover' | 'delivery' | 'collection_transfers';

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

export const GM_REVIEW_LABELS: Record<
  GmReviewKey,
  { title: string; question: string; link?: string }
> = {
  sales_upload: { title: 'ملف المبيعات', question: 'ملف امبارح وصل للفرعين؟', link: '/invoices' },
  attendance: {
    title: 'البصمات والحضور',
    question: 'مين غاب أو اتأخر أو ما بصمش امبارح؟',
    link: '/attendance-report',
  },
  managers: { title: 'مديرين الفروع', question: 'كل مدير قفل لفة الفرع امبارح؟', link: '/' },
  cleaning: {
    title: 'النظافة',
    question: 'النظافة اتقيمت امبارح في الفرعين؟',
    link: '/branch-checklist-review',
  },
  inventory: {
    title: 'الجرد الأسبوعي',
    question: 'جرد الأسبوع متخطط وماشي في ميعاده؟',
    link: '/inventory-counts',
  },
  purchases_handover: {
    title: 'المشتريات',
    question: 'فواتير دواء وائل اللي لسه «انتظار المراجعة»',
  },
  shifts: {
    title: 'تسليم الشيفتات',
    question: 'كل فرع قفل الـ 3 شيفتات في ميعادها؟',
    link: '/shift-handovers',
  },
  delivery: { title: 'المناديب', question: 'حركات دواء بيلز اتعتمدت ومفيش رحلة مفتوحة؟' },
  collection_transfers: {
    title: 'تحويلات التحصيل',
    question: 'فودافون وإنستا والفيزا اتحولوا للمحاسب واتأكدوا؟',
    link: '/consolidated-reports',
  },
  customers: {
    title: 'العملاء',
    question: 'طلبات الدورة المفتوحة وعملاء الـ 500 ج',
    link: '/customer-requests',
  },
};

const BRANCH = { shokry: 'شكري', elshamy: 'الشامي' } as Record<string, string>;
const money = (value: unknown) =>
  Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 }) + ' ج';
const syncWarning = (value: unknown, app: string) => {
  const synced = value ? new Date(String(value)) : null;
  if (synced && Date.now() - synced.getTime() <= 3600e3) return [];
  return [
    `⚠️ المزامنة مع ${app} متوقفة${synced ? ` من ${synced.toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}`,
  ];
};
const INVENTORY = {
  not_planned: 'ما اتخططش',
  late: 'متأخر',
  planned: 'متخطط',
  counting: 'شغال',
  submitted: 'مستني الاعتماد',
  closed: 'اتقفل',
} as Record<string, string>;
const shortDay = (value?: string | null) =>
  value
    ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG', {
        day: 'numeric',
        month: 'numeric',
      })
    : '—';

type Row = Record<string, unknown>;
const SHIFT_DAY = (value: string) =>
  new Date(`${value}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });
const rows = (detail: unknown) => (Array.isArray(detail) ? (detail as Row[]) : []);

/** One short line per branch (or for the whole item) describing what the data says. */
export function gmReviewSummary(item: Pick<GmReviewItem, 'key' | 'detail'>): string[] {
  const d = item.detail as Row;
  switch (item.key) {
    case 'sales_upload':
      return rows(item.detail).map(
        (r) => `${BRANCH[String(r.branch)]}: آخر يوم ${shortDay(r.last_day as string)}`
      );
    case 'attendance':
      return rows(item.detail).map(
        (r) =>
          `${BRANCH[String(r.branch)]}: ${r.pending} مستني مراجعة · ${r.missing} بصمة ناقصة · ${r.late} متأخر`
      );
    case 'managers':
      return rows(item.detail).map(
        (r) =>
          `${BRANCH[String(r.branch)]}: ${r.checks_done}/${r.checks_total}${Number(r.issues) ? ` · ${r.issues} مشكلة` : ''}`
      );
    case 'cleaning':
      return rows(item.detail).map(
        (r) =>
          `${BRANCH[String(r.branch)]}: ${Number(r.ratings) ? 'اتقيمت' : `ما اتقيمتش (آخر تقييم ${shortDay(r.last_day as string)})`}`
      );
    case 'inventory':
      return rows(item.detail).map(
        (r) => `${BRANCH[String(r.branch)]}: ${INVENTORY[String(r.status)] ?? r.status}`
      );
    case 'purchases_handover':
      return [
        ...rows(d?.branches).map(
          (r) =>
            `${BRANCH[String(r.branch)]}: ${Number(r.pending) ? `${r.pending} فاتورة مستنية مراجعة (${money(r.value)}) من ${shortDay(r.oldest as string)}` : 'مفيش فواتير مستنية'} · امبارح ${r.yesterday} فاتورة`
        ),
        ...syncWarning(d?.synced_at, 'دواء وائل'),
      ];
    case 'delivery':
      return [
        ...rows(d?.branches).map((r) => {
          const issues = [
            Number(r.pending) ? `${r.pending} حركة مستنية اعتماد` : '',
            Number(r.open_trips) ? `${r.open_trips} رحلة مفتوحة` : '',
          ].filter(Boolean);
          return `${String(r.branch).replace('فرع ', '')}: امبارح ${r.orders} أوردر · ${r.errands} مشوار${issues.length ? ` · ${issues.join(' · ')}` : ''}`;
        }),
        ...syncWarning(d?.synced_at, 'دواء بيلز'),
      ];
    case 'collection_transfers':
      return [
        `لسه ما اتحولش للمحاسب: ${money(d?.balance)}`,
        Number(d?.pending)
          ? `${d?.pending} تحويل مستني تأكيد المحاسب (${money(d?.pending_amount)})${Number(d?.late) ? ` · ${d?.late} متأخر، أقدمهم ${d?.oldest_days} يوم` : ''}`
          : 'كل التحويلات اتأكدت',
        ...syncWarning(d?.synced_at, 'دواء بيلز'),
      ];
    case 'shifts': {
      const lines = rows(d?.branches).map((r) => {
        const missing = rows(r.missing).map((m) => {
          const who = onDutyLabel(m.doctors as OnDutyDoctor[] | undefined);
          return `${SHIFT_DAY(m.day as string)} ${m.shift}${who ? ` (${who})` : ''}`;
        });
        return `${BRANCH[String(r.branch)]}: امبارح ${r.yesterday_done}/3${missing.length ? ` · ما اتقفلش: ${missing.join('، ')}` : ''}`;
      });
      const synced = d?.synced_at ? new Date(String(d.synced_at)) : null;
      if (!synced || Date.now() - synced.getTime() > 3600e3) {
        lines.push(
          `⚠️ المزامنة مع تطبيق المشتريات متوقفة${synced ? ` من ${synced.toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}`
        );
      }
      return lines;
    }
    case 'customers':
      return [
        `${d?.open_requests ?? 0} طلب مفتوح أكتر من يوم · ${d?.big_customers_yesterday ?? 0} عميل اشترى بـ 500 ج امبارح`,
      ];
    default:
      return [];
  }
}

export function gmReviewErrorMessage(error: unknown) {
  const message = String((error as { message?: string })?.message ?? error ?? '');
  if (message.includes('not_authorized')) return 'الصفحة دي للمدير العام بس';
  if (message.includes('note_required')) return 'اكتب المشكلة في سطر';
  if (message.includes('invalid_url')) return 'الرابط لازم يبدأ بـ https://';
  if (message.includes('Could not find the function') || message.includes('PGRST202'))
    return 'المراجعة اليومية لسه مش متفعلة على قاعدة البيانات';
  return 'حصلت مشكلة، جرّب تاني';
}

export async function loadGmDailyReview() {
  const { data, error } = await supabase.rpc('get_gm_daily_review_v1');
  if (error) throw error;
  return data as GmDailyReview;
}

export async function markGmReviewItem(
  key: GmReviewKey,
  state: 'done' | 'issue' | 'clear',
  note?: string
) {
  const { error } = await supabase.rpc('mark_gm_daily_review_item_v1', {
    p_item_key: key,
    p_state: state,
    p_note: note ?? null,
  });
  if (error) throw error;
}

export async function setGmReviewLink(key: GmReviewLinkKey, url: string) {
  const { error } = await supabase.rpc('set_gm_daily_review_link_v1', {
    p_item_key: key,
    p_url: url,
  });
  if (error) throw error;
}
