import type { GmReviewItem } from '@/lib/gmDailyReview';

// The compact mobile card of one «مراجعتي اليومية» item: one status sentence, one chip per branch with a
// big number, and an optional warning line (e.g. a stopped sync). Built from the same `detail` the server
// sends; `gmReviewSummary` keeps the long one-line-per-branch text.

export interface GmCardChip {
  label: string;
  value: string;
  note?: string;
  bad?: boolean;
}

/** A small table under the chips, e.g. today / cycle counts per branch. */
export interface GmCardTable {
  head: string[];
  rows: string[][];
}

export interface GmReviewCard {
  headline: string;
  chips: GmCardChip[];
  warning?: string;
  /** Extra short lines under the chips. */
  lines?: string[];
  table?: GmCardTable;
}

type Row = Record<string, unknown>;
const rows = (detail: unknown) => (Array.isArray(detail) ? (detail as Row[]) : []);
const n = (value: unknown) => Number(value) || 0;
const BRANCH: Record<string, string> = { shokry: 'شكري', elshamy: 'الشامي' };
const branchName = (value: unknown) => {
  const text = String(value ?? '');
  return BRANCH[text] ?? text.replace(/^فرع\s*/, '');
};
const num = (value: number) => value.toLocaleString('ar-EG');
const money = (value: number) => `${Math.round(value).toLocaleString('ar-EG')} ج`;
const shortDay = (value: unknown) =>
  value
    ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('ar-EG', {
        day: 'numeric',
        month: 'numeric',
      })
    : '—';
const cairoDay = (value: unknown) =>
  value
    ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(String(value)))
    : '';
const uploadLabel = (value: unknown) =>
  value
    ? new Date(String(value)).toLocaleString('ar-EG', {
        timeZone: 'Africa/Cairo',
        day: 'numeric',
        month: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';
const percent = (part: number, total: number) =>
  total ? `${Math.round((part / total) * 100)}%` : '—';
const daysSince = (value: unknown, now: Date) => {
  if (!value) return 0;
  const then = new Date(`${String(value).slice(0, 10)}T12:00:00`).getTime();
  return Math.max(0, Math.round((now.getTime() - then) / 86400e3));
};
const INVENTORY: Record<string, string> = {
  not_planned: 'ما اتخططش',
  late: 'متأخر',
  planned: 'متخطط',
  counting: 'شغال',
  submitted: 'مستني',
  closed: 'اتقفل',
};

function syncWarning(value: unknown, app: string, now: Date) {
  const synced = value ? new Date(String(value)) : null;
  if (synced && now.getTime() - synced.getTime() <= 3600e3) return undefined;
  return `⚠️ المزامنة مع ${app} متوقفة${
    synced
      ? ` من ${synced.toLocaleString('ar-EG', { day: 'numeric', month: 'numeric', hour: 'numeric', minute: '2-digit' })}`
      : ''
  }`;
}

export function gmReviewCard(
  item: Pick<GmReviewItem, 'key' | 'detail' | 'done'>,
  now = new Date()
): GmReviewCard {
  const d = (item.detail ?? {}) as Row;
  switch (item.key) {
    case 'sales_upload': {
      // Done only when the file was uploaded today (Cairo).
      const list = rows(item.detail);
      const today = cairoDay(now);
      const missing = list.filter((r) => cairoDay(r.uploaded_at) !== today).length;
      return {
        headline: missing
          ? `ملف النهارده لسه ما اترفعش (${num(missing)} فرع)`
          : 'ملف النهارده اترفع',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: cairoDay(r.uploaded_at) === today ? 'اترفع ✓' : 'لسه',
          note: `آخر رفع ${uploadLabel(r.uploaded_at)}`,
          bad: cairoDay(r.uploaded_at) !== today,
        })),
      };
    }
    case 'attendance': {
      const list = rows(item.detail);
      const pending = list.reduce((s, r) => s + n(r.pending), 0);
      return {
        headline: pending ? `${num(pending)} يوم حضور مستني مراجعة` : 'الحضور متراجع',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: num(n(r.pending)),
          note: `${num(n(r.missing))} ناقصة · ${num(n(r.late))} متأخر`,
          bad: n(r.pending) > 0,
        })),
      };
    }
    case 'managers': {
      const list = rows(item.detail);
      const open = list.filter((r) => n(r.checks_done) < n(r.checks_total)).length;
      return {
        headline: open ? `${num(open)} مدير ما قفلش لفة الفرع` : 'المديرين قفلوا اللفة',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: `${num(n(r.checks_done))}/${num(n(r.checks_total))}`,
          note: n(r.issues) ? `${num(n(r.issues))} مشكلة` : undefined,
          bad: n(r.checks_done) < n(r.checks_total) || n(r.issues) > 0,
        })),
      };
    }
    case 'cleaning': {
      const list = rows(item.detail);
      const missing = list.filter((r) => !n(r.ratings)).length;
      return {
        headline: missing ? `${num(missing)} فرع ما اتقيمش امبارح` : 'النظافة اتقيمت',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: n(r.ratings) ? 'اتقيمت' : 'لأ',
          note: n(r.ratings) ? undefined : `آخر تقييم ${shortDay(r.last_day)}`,
          bad: !n(r.ratings),
        })),
      };
    }
    case 'inventory': {
      const list = rows(item.detail);
      const late = list.filter((r) => ['not_planned', 'late'].includes(String(r.status))).length;
      return {
        headline: late ? `${num(late)} فرع جرده متأخر` : 'الجرد ماشي',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: INVENTORY[String(r.status)] ?? String(r.status ?? '—'),
          bad: ['not_planned', 'late'].includes(String(r.status)),
        })),
      };
    }
    case 'purchases_handover': {
      const list = rows(d.branches);
      const pending = list.reduce((s, r) => s + n(r.pending), 0);
      const oldest = Math.max(
        0,
        ...list.filter((r) => n(r.pending)).map((r) => daysSince(r.oldest, now))
      );
      return {
        headline: pending
          ? `${num(pending)} فاتورة مستنية مراجعة${oldest ? ` · أقدمها من ${num(oldest)} يوم` : ''}`
          : 'مفيش فواتير مستنية',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: num(n(r.pending)),
          note: n(r.pending) ? money(n(r.value)) : `امبارح ${num(n(r.yesterday))} فاتورة`,
          bad: n(r.pending) > 0,
        })),
        warning: syncWarning(d.synced_at, 'دواء وائل', now),
      };
    }
    case 'delivery': {
      const list = rows(d.branches);
      const pending = list.reduce((s, r) => s + n(r.pending_errands) + n(r.stuck), 0);
      const sync = (d.invoice_sync ?? null) as Row | null;
      const syncLine = sync?.last_error
        ? `⚠️ مطابقة الأوردرات بفواتير المبيعات واقفة من ${uploadLabel(sync.last_success_at)}`
        : sync?.last_success_at
          ? `مطابقة الأوردرات بالفواتير: آخر تحديث ${uploadLabel(sync.last_success_at)}`
          : undefined;
      return {
        headline: pending
          ? `${num(pending)} مشوار أو أوردر معلّق`
          : 'مفيش مشاوير ولا أوردرات معلّقة',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: num(n(r.pending_errands) + n(r.stuck)),
          note: `${num(n(r.pending_errands))} مشوار · ${num(n(r.stuck))} أوردر متعلّق`,
          bad: n(r.pending_errands) + n(r.stuck) > 0,
        })),
        table: list.some((r) => r.cycle_delivered !== undefined)
          ? {
              head: ['', 'النهارده', 'الدورة', 'من غير فاتورة'],
              rows: list.map((r) => [
                branchName(r.branch),
                `${num(n(r.today_delivered))} أوردر · ${num(n(r.today_errands))} مشوار`,
                `${num(n(r.cycle_delivered))} أوردر · ${num(n(r.cycle_errands))} مشوار`,
                num(n(r.unmatched)),
              ]),
            }
          : undefined,
        lines: syncLine ? [syncLine] : undefined,
        warning: syncWarning(d.synced_at, 'تطبيق الدليفري', now),
      };
    }
    case 'shifts': {
      const list = rows(d.branches);
      const missing = list.reduce((s, r) => s + rows(r.missing).length, 0);
      return {
        headline: missing ? `${num(missing)} شيفت ما اتقفلش` : 'الشيفتات اتقفلت',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: `${num(n(r.yesterday_done))}/٣`,
          note: rows(r.missing).length ? `${num(rows(r.missing).length)} ناقص` : undefined,
          bad: rows(r.missing).length > 0,
        })),
        warning: syncWarning(d.synced_at, 'دواء وائل', now),
      };
    }
    case 'stories': {
      const list = rows(item.detail);
      const left = list.filter((r) => r.state !== 'done').length;
      return {
        headline: left ? `${num(left)} فرع لسه ما نزّلش` : 'الفرعين نزّلوا',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: r.state === 'done' ? 'نزلت ✓' : r.state === 'issue' ? 'مشكلة' : 'لسه',
          note:
            r.state === 'issue'
              ? String(r.note ?? '')
              : r.marked_by
                ? String(r.marked_by)
                : undefined,
          bad: r.state !== 'done',
        })),
      };
    }
    case 'customers': {
      const open = n(d.open_requests);
      const list = rows(d.branches);
      const fresh = list.reduce((s, r) => s + n(r.new_yesterday), 0);
      const daysDone = n(d.days_done);
      const cycleDays = n(d.cycle_days);
      const pace = (value: number) => (daysDone ? Math.round((value / daysDone) * cycleDays) : 0);
      return {
        headline: `${num(fresh)} عميل اتكوّد جديد امبارح${open ? ` · ${num(open)} طلب مفتوح` : ''}`,
        chips: list.length
          ? list.map((r) => ({
              label: branchName(r.branch),
              value: num(n(r.new_yesterday)),
              note: `جديد · اشترى ${num(n(r.buyers_yesterday))} عميل`,
            }))
          : [
              { label: 'طلبات مفتوحة', value: num(open), bad: open > 0 },
              { label: 'عملاء 500 ج امبارح', value: num(n(d.big_customers_yesterday)) },
            ],
        table: list.length
          ? {
              head: ['', 'جداد الدورة', 'لو كمّلنا كده', 'اشتروا الدورة', 'فواتير مكوّدة امبارح'],
              rows: list.map((r) => [
                branchName(r.branch),
                num(n(r.new_cycle)),
                num(pace(n(r.new_cycle))),
                num(n(r.buyers_cycle)),
                percent(n(r.coded_invoices_yesterday), n(r.invoices_yesterday)),
              ]),
            }
          : undefined,
        lines: list.length
          ? [
              `${num(open)} طلب عميل مفتوح أكتر من يوم · ${num(n(d.big_customers_yesterday))} فاتورة 500 ج أو أكتر امبارح`,
              daysDone ? `عدّى ${num(daysDone)} يوم من ${num(cycleDays)} في الدورة` : '',
            ].filter(Boolean)
          : undefined,
      };
    }
    default:
      return { headline: '', chips: [] };
  }
}
