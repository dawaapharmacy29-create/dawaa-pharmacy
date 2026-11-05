import { supabase } from '@/lib/supabase';
import { onDutyLabel, type OnDutyDoctor } from '@/lib/shiftHandoverCoverage';

// «مراجعتي اليومية» for the general manager (migration 20261031160000, sources 20261104120000). Every item
// turns green on its own once its data is clean; «راجعت» is for what the data can't see. Purchases, shifts,
// customer orders come from DawaaWael; riders from the delivery app. Stories are marked by each branch manager
// in «قائمة اليوم» (migration 20261104210000). v3 (20261105160000): the sales file must be uploaded today,
// «تحويلات التحصيل» is no longer sent (the key stays for old marks), customers carry per-branch coded counts.

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
  | 'customers'
  | 'stories';

export interface GmReviewItem {
  key: GmReviewKey;
  kind: 'auto' | 'external';
  ok: boolean;
  done: boolean;
  detail: unknown;
  data_day?: string | null;
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

const DAWAA_WAEL = 'https://dawaawael.base44.app';
const DELIVERY_APP = 'https://dawaa-pharmacy-delivery.vercel.app';

/** Where each item is worked: a page in this app (`link`) and/or the app its data comes from (`app`). */
export const GM_REVIEW_LABELS: Record<
  GmReviewKey,
  { title: string; question: string; link?: string; app?: { name: string; url: string } }
> = {
  sales_upload: {
    title: 'ملف المبيعات',
    question: 'ملف النهارده اترفع للفرعين؟',
    link: '/invoices',
  },
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
    question: 'فواتير الشراء اللي لسه «انتظار المراجعة» في دواء وائل',
    app: { name: 'دواء وائل', url: `${DAWAA_WAEL}/pending-invoices` },
  },
  shifts: {
    title: 'تسليم الشيفتات',
    question: 'كل فرع قفل الـ 3 شيفتات في ميعادها؟',
    link: '/shift-handovers',
    app: { name: 'دواء وائل', url: `${DAWAA_WAEL}/shift-delivery` },
  },
  delivery: {
    title: 'المناديب',
    question: 'مشاوير امبارح اتعتمدت ومفيش أوردر متعلق؟',
    app: { name: 'تطبيق الدليفري', url: `${DELIVERY_APP}/admin/trips` },
  },
  collection_transfers: {
    title: 'تحويلات التحصيل',
    question: 'فودافون وإنستا والفيزا ونقدي المحاسب في تسليمات امبارح',
    link: '/shift-handovers',
    app: { name: 'دواء وائل', url: `${DAWAA_WAEL}/shift-delivery` },
  },
  customers: {
    title: 'العملاء',
    question: 'طلبات الدورة المفتوحة وعملاء الـ 500 ج',
    link: '/customer-requests',
    app: { name: 'دواء وائل', url: `${DAWAA_WAEL}/customer-orders` },
  },
  stories: {
    title: 'الاستوريز',
    question: 'الفرعين نزّلوا استوريز النهارده؟',
    link: '/',
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
const WALLETS = [
  ['vodafone', 'فودافون'],
  ['insta', 'إنستا'],
  ['visa', 'فيزا'],
  ['other', 'أخرى'],
] as const;
const rows = (detail: unknown) => (Array.isArray(detail) ? (detail as Row[]) : []);

/** One short line per branch (or for the whole item) describing what the data says. */
export function gmReviewSummary(item: Pick<GmReviewItem, 'key' | 'detail'> & { data_day?: string | null }): string[] {
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
            Number(r.pending_errands)
              ? `${r.pending_errands} مشوار مستني اعتماد من ${shortDay(r.oldest_pending as string)}`
              : '',
            Number(r.stuck) ? `${r.stuck} أوردر لسه «متسجل» من قبل النهارده` : '',
          ].filter(Boolean);
          return `${String(r.branch).replace('فرع ', '')}: امبارح ${r.delivered} أوردر اتسلم · ${r.errands} مشوار${Number(r.failed) ? ` · ${r.failed} فشل` : ''}${issues.length ? ` · ${issues.join(' · ')}` : ''}`;
        }),
        ...syncWarning(d?.synced_at, 'تطبيق الدليفري'),
      ];
    case 'collection_transfers':
      return [
        ...rows(d?.branches).map((r) => {
          const name = BRANCH[String(r.branch)];
          if (!Number(r.shifts)) return `${name}: مفيش تسليمات امبارح`;
          const wallets = WALLETS.filter(([key]) => Number(r[key])).map(
            ([key, label]) => `${label} ${money(r[key])}`
          );
          const transfers = WALLETS.reduce((sum, [key]) => sum + Number(r[key] || 0), 0);
          return `${name}: تحويلات ${money(transfers)}${wallets.length ? ` (${wallets.join('، ')})` : ''} · نقدي للمحاسب ${money(r.cash)}${Number(r.variance) ? ` · ⚠️ ${r.variance} شيفت فيه فرق نقدية` : ''}`;
        }),
        ...syncWarning(d?.synced_at, 'دواء وائل'),
      ];
    case 'shifts': {
      const lines = rows(d?.branches).map((r) => {
        const label = (m: Row) => {
          const who = onDutyLabel(m.doctors as OnDutyDoctor[] | undefined);
          return `${SHIFT_DAY(m.day as string)} ${m.shift}${who ? ` (${who})` : ''}`;
        };
        // "امبارح" counts yesterday only; a shift still open from another day is said apart.
        const missing = rows(r.missing);
        const ofYesterday = missing.filter((m) => !item.data_day || m.day === item.data_day).map(label);
        const other = missing.filter((m) => item.data_day && m.day !== item.data_day).map(label);
        return `${BRANCH[String(r.branch)]}: امبارح ${r.yesterday_done}/3${ofYesterday.length ? ` · ما اتقفلش: ${ofYesterday.join('، ')}` : ''}${other.length ? ` · ناقص من يوم تاني: ${other.join('، ')}` : ''}`;
      });
      const synced = d?.synced_at ? new Date(String(d.synced_at)) : null;
      if (!synced || Date.now() - synced.getTime() > 3600e3) {
        lines.push(
          `⚠️ المزامنة مع دواء وائل متوقفة${synced ? ` من ${synced.toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}`
        );
      }
      return lines;
    }
    case 'stories':
      return rows(item.detail).map((r) => {
        const by = r.marked_by ? ` · ${r.marked_by}` : '';
        if (r.state === 'done') return `${BRANCH[String(r.branch)]}: نزلت ✓${by}`;
        if (r.state === 'issue')
          return `${BRANCH[String(r.branch)]}: فيه مشكلة — ${r.note ?? ''}${by}`;
        return `${BRANCH[String(r.branch)]}: لسه ما اتعلّمتش`;
      });
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

/** One invoice still «انتظار المراجعة» in دواء وائل (migration 20261105160000). */
export interface GmPendingPurchase {
  branch: string;
  invoice_date: string;
  total_value: number;
  system_invoice_number: string | null;
  supplier_invoice_number: string | null;
  supplier: string;
  entered_by: string | null;
  transaction_type: string | null;
  days_waiting: number;
}

export async function loadGmPendingPurchases(limit = 60): Promise<GmPendingPurchase[]> {
  const { data, error } = await supabase.rpc('get_gm_pending_purchases_v1', { p_limit: limit });
  if (error) throw error;
  return ((data as GmPendingPurchase[]) || []).map((row) => ({
    ...row,
    total_value: Number(row.total_value) || 0,
    days_waiting: Number(row.days_waiting) || 0,
  }));
}
