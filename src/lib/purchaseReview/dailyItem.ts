import type { GmDailyReview } from '@/lib/gmDailyReview';
import type { GmReviewCard } from '@/lib/gmReviewCard';
import {
  DUE_SOON_DAYS,
  PURCHASE_BRANCHES,
  cashPlan,
  supplierBalances,
  uploadFreshness,
  type PurchaseReviewData,
} from './ledger';

// The «المشتريات» card of «مراجعتي اليومية», now fed by «مراجعة المشتريات»: what the suppliers are owed
// overdue and this week per branch, and whether every store's ePlus report is up to date. It is clean
// when the four reports reach yesterday and nothing is overdue.

export interface PurchaseReviewDaily {
  overdue: number;
  dueSoon: number;
  running: number;
  owed: number;
  branches: { branch: string; overdue: number; dueSoon: number; owed: number }[];
  stale: { store: string; last_day: string | null }[];
  next: { due: string; amount: number; top: string | null } | null;
}

export function purchaseReviewDaily(data: PurchaseReviewData): PurchaseReviewDaily {
  const balances = supplierBalances(data);
  const plan = cashPlan(balances, data.today);
  const branches = PURCHASE_BRANCHES.map((branch) => {
    const own = balances.filter((b) => b.branch === branch);
    return {
      branch,
      overdue: own.reduce((s, b) => s + b.overdue, 0),
      dueSoon: own.reduce((s, b) => s + b.dueSoon, 0),
      owed: own.reduce((s, b) => s + Math.max(0, b.balance), 0),
    };
  });
  const stale = uploadFreshness(data.uploads, data.today)
    .filter((s) => s.daysBehind == null || s.daysBehind > 1)
    .map((s) => ({ store: s.store, last_day: s.upload?.last_day ?? null }));
  const first = plan.calendar[0];
  return {
    overdue: plan.overdue,
    dueSoon: plan.dueSoon,
    running: plan.running,
    owed: plan.owed,
    branches,
    stale,
    next: first
      ? { due: first.due, amount: first.amount, top: first.suppliers[0]?.name ?? null }
      : null,
  };
}

/** Puts the purchase review in place of the old «انتظار المراجعة» purchases item. */
export function withPurchaseReview(
  review: GmDailyReview,
  daily: PurchaseReviewDaily | null
): GmDailyReview {
  if (!daily) return review;
  const items = review.items.map((item) => {
    if (item.key !== 'purchases_handover') return item;
    const ok = daily.overdue < 0.5 && daily.stale.length === 0;
    return {
      ...item,
      ok,
      done: item.state === 'done' || (item.state !== 'issue' && ok),
      detail: { review: daily },
    };
  });
  return { ...review, items, done: items.filter((i) => i.done).length };
}

const money = (value: number) => `${Math.round(value).toLocaleString('ar-EG')} ج`;
const day = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('ar-EG', {
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
  });

export function purchaseReviewCard(d: PurchaseReviewDaily): GmReviewCard {
  const needNow = d.overdue + d.dueSoon;
  return {
    headline:
      d.overdue > 0.5
        ? `${money(d.overdue)} متأخر للموردين · ${money(needNow)} لحد ${DUE_SOON_DAYS} أيام`
        : needNow > 0.5
          ? `مطلوب ${money(needNow)} للموردين خلال ${DUE_SOON_DAYS} أيام`
          : 'مفيش دفعات موردين مستحقة الأسبوع ده',
    chips: d.branches.map((b) => ({
      label: b.branch.replace(/^فرع\s*/, ''),
      value: money(b.overdue + b.dueSoon),
      note: b.overdue > 0.5 ? `منهم ${money(b.overdue)} متأخر` : `علينا ${money(b.owed)}`,
      bad: b.overdue > 0.5,
    })),
    lines: d.next
      ? [
          `الدفعة الجاية ${day(d.next.due)}: ${money(d.next.amount)}${d.next.top ? ` (أكبرها ${d.next.top})` : ''}`,
        ]
      : undefined,
    warning: d.stale.length
      ? `⚠️ ملفات ePlus ناقصة: ${d.stale.map((s) => `${s.store}${s.last_day ? ` (لحد ${day(s.last_day)})` : ''}`).join('، ')}`
      : undefined,
  };
}
