import type { GmDailyReview, GmReviewItem } from '@/lib/gmDailyReview';
import type { GmReviewCard } from '@/lib/gmReviewCard';
import {
  DUE_SOON_DAYS,
  PURCHASE_BRANCHES,
  cashPlan,
  supplierBalances,
  uploadFreshness,
  type PurchaseReviewData,
} from './ledger';

// Two cards of «مراجعتي اليومية» fed by «مراجعة المشتريات»: «مراجعة المشتريات» (what the suppliers are owed
// overdue and this week per branch; clean when nothing is overdue) and «ملفات المشتريات» (the four stores'
// ePlus purchase reports; clean when every one reaches yesterday).

export interface PurchaseReviewDaily {
  overdue: number;
  dueSoon: number;
  running: number;
  owed: number;
  branches: { branch: string; overdue: number; dueSoon: number; owed: number }[];
  stale: { store: string; last_day: string | null }[];
  stores: { store: string; branch: string; last_day: string | null; behind: boolean }[];
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
  const stores = uploadFreshness(data.uploads, data.today).map((s) => ({
    store: s.store,
    branch: s.branch,
    last_day: s.upload?.last_day ?? null,
    behind: s.daysBehind == null || s.daysBehind > 1,
  }));
  const stale = stores
    .filter((s) => s.behind)
    .map((s) => ({ store: s.store, last_day: s.last_day }));
  const first = plan.calendar[0];
  return {
    overdue: plan.overdue,
    dueSoon: plan.dueSoon,
    running: plan.running,
    owed: plan.owed,
    branches,
    stale,
    stores,
    next: first
      ? { due: first.due, amount: first.amount, top: first.suppliers[0]?.name ?? null }
      : null,
  };
}

/** Puts the purchase review in place of the old «انتظار المراجعة» purchases item, and adds «ملفات المشتريات»
 * right after it. */
export function withPurchaseReview(
  review: GmDailyReview,
  daily: PurchaseReviewDaily | null
): GmDailyReview {
  if (!daily) return review;
  const uploaded = daily.stale.length === 0;
  const upload: GmReviewItem = {
    key: 'purchases_upload',
    kind: 'auto',
    ok: uploaded,
    done: uploaded,
    detail: { review: daily },
    data_day: null,
    state: null,
    note: null,
    marked_by: null,
    marked_at: null,
  };
  const items = review.items
    .filter((item) => item.key !== 'purchases_upload')
    .flatMap((item) => {
      if (item.key !== 'purchases_handover') return [item];
      const ok = daily.overdue < 0.5;
      return [
        {
          ...item,
          ok,
          done: item.state === 'done' || (item.state !== 'issue' && ok),
          detail: { review: daily },
        },
        upload,
      ];
    });
  if (!items.includes(upload)) items.push(upload);
  return { ...review, items, total: items.length, done: items.filter((i) => i.done).length };
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
  };
}

/** «ملفات المشتريات»: how far each store's ePlus purchase report reaches; a store behind yesterday is red. */
export function purchaseUploadCard(d: PurchaseReviewDaily): GmReviewCard {
  return {
    headline: d.stale.length
      ? `${d.stale.length.toLocaleString('ar-EG')} من ٤ مخازن ملفات مشترياتها مش واصلة لامبارح`
      : 'ملفات المشتريات للمخازن الأربعة واصلة لحد امبارح ✓',
    chips: d.stores.map((s) => ({
      label: s.store,
      value: s.last_day ? `لحد ${day(s.last_day)}` : 'ما اترفعش',
      note: s.branch.replace(/^فرعs*/, ''),
      bad: s.behind,
    })),
  };
}
