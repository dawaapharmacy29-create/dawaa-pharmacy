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

export interface GmReviewCard {
  headline: string;
  chips: GmCardChip[];
  warning?: string;
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
const WALLET_KEYS = ['vodafone', 'insta', 'visa', 'other'];

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
      const list = rows(item.detail);
      const late = list.filter((r) => daysSince(r.last_day, now) > 1).length;
      return {
        headline: late ? `${num(late)} فرع ملفه ما وصلش` : 'ملف امبارح وصل',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: shortDay(r.last_day),
          note: 'آخر يوم',
          bad: daysSince(r.last_day, now) > 1,
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
      return {
        headline: pending ? `${num(pending)} مشوار أو أوردر محتاج قرار` : 'مشاوير امبارح اتعتمدت',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: num(n(r.pending_errands) + n(r.stuck)),
          note: `امبارح ${num(n(r.delivered))} اتسلم${n(r.failed) ? ` · ${num(n(r.failed))} فشل` : ''}`,
          bad: n(r.pending_errands) + n(r.stuck) > 0,
        })),
        warning: syncWarning(d.synced_at, 'تطبيق الدليفري', now),
      };
    }
    case 'collection_transfers': {
      const list = rows(d.branches);
      const variance = list.reduce((s, r) => s + n(r.variance), 0);
      return {
        headline: variance ? `${num(variance)} شيفت فيه فرق نقدية` : 'تحويلات امبارح',
        chips: list.map((r) => ({
          label: branchName(r.branch),
          value: n(r.shifts) ? money(WALLET_KEYS.reduce((s, key) => s + n(r[key]), 0)) : '—',
          note: n(r.shifts) ? `نقدي ${money(n(r.cash))}` : 'مفيش تسليمات',
          bad: n(r.variance) > 0 || !n(r.shifts),
        })),
        warning: syncWarning(d.synced_at, 'دواء وائل', now),
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
      return {
        headline: open ? `${num(open)} طلب مفتوح أكتر من يوم` : 'مفيش طلبات متأخرة',
        chips: [
          { label: 'طلبات مفتوحة', value: num(open), bad: open > 0 },
          { label: 'عملاء 500 ج امبارح', value: num(n(d.big_customers_yesterday)) },
        ],
      };
    }
    default:
      return { headline: '', chips: [] };
  }
}
