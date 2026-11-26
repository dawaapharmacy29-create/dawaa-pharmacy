import { supabase } from '@/lib/supabase';

// «تحرير المخزون» (صاحب الصيدلية 2026-11-26): رأس المال اللي في المخزون، ونسبة نشاط الأصناف، والرواكد، واللي قرب ينتهي
// في ٦ شهور، والمنتهي على الرف وفي مخزن الإكسبير، ومين أكتر دكتور بيصرف الأصناف التقيلة. لكل صنف خطوة تحرّره، وخطة واحدة
// مترتبة بالفلوس اللي في خطر، وشريط بيعدّي بأهم حاجة لازم تتشاف. كله من آخر ملف رصيد (dawaa_stock_liberation_v1).

export type LibAction = 'pull' | 'return' | 'transfer' | 'push_now' | 'push' | 'ok';

export const ACTIONS: Record<LibAction, { label: string; hint: string; tone: string }> = {
  pull: {
    label: 'اسحبيه من الرف',
    hint: 'منتهي ولسه في المخزن: يتنقل لمخزن الإكسبير النهارده',
    tone: 'danger',
  },
  return: {
    label: 'مرتجع للمورد',
    hint: 'كلمي المورد وارجعيه قبل ما يفوت ميعاد المرتجع',
    tone: 'danger',
  },
  transfer: {
    label: 'حوّليه للفرع التاني',
    hint: 'الفرع التاني بيبيعه أسرع',
    tone: 'warning',
  },
  push_now: {
    label: 'صرف فوري',
    hint: 'أقل من شهرين: عرض أو خصم وأولوية صرف للدكاترة',
    tone: 'danger',
  },
  push: {
    label: 'أولوية صرف',
    hint: 'نبّهي الدكاترة يرشحوه، أو عرض صغير',
    tone: 'warning',
  },
  ok: { label: 'هيتباع في ميعاده', hint: 'معدل البيع بيخلّصه قبل ما يفضل له شهر', tone: 'success' },
};

export type LibCapital = {
  branch: string;
  store: string;
  kind: 'main' | 'doctor' | 'expiry' | 'office' | string;
  items: number;
  value: number;
  sale_value: number;
  near_expiry: number;
  expired: number;
};
export type LibActivity = {
  branch: string;
  items: number;
  value: number;
  active_items: number;
  active_value: number;
  slow_items: number;
  slow_value: number;
  dead_items: number;
  dead_value: number;
  new_items: number;
  new_value: number;
  over_items: number;
  over_value: number;
};
export type LibDead = {
  branch: string;
  code: string;
  name: string | null;
  company: string | null;
  status: 'dead' | 'slow';
  qty: number;
  doctor_qty: number;
  value: number;
  last_buy: string | null;
  last_sale: string | null;
  supplier: string | null;
  other_rate30: number;
  other_qty: number;
  action: LibAction;
};
export type LibNear = {
  branch: string;
  store: string;
  kind: string;
  code: string;
  name: string | null;
  qty: number;
  expiry: string;
  days: number;
  value: number;
  supplier: string | null;
  location: string | null;
  rate30: number;
  other_rate30: number;
  risk_qty: number;
  risk_value: number;
  action: LibAction;
};
export type LibExpired = {
  branch: string;
  store: string;
  kind: string;
  code: string;
  name: string | null;
  qty: number;
  value: number;
  expiry: string | null;
  supplier: string | null;
  action: LibAction;
};
export type LibDoctor = {
  branch: string;
  seller: string;
  value: number;
  near_value: number;
  heavy_value: number;
  qty: number;
  items: number;
  total: number;
  share: number;
  top: Array<{ code: string; name: string | null; qty: number; value: number }>;
};
export type LibTotalsServer = {
  near_rows: number;
  near_value: number;
  near_risk: number;
  near60_rows: number;
  near60_risk: number;
  expired_shelf_rows: number;
  expired_shelf: number;
};
export type Liberation = {
  empty?: boolean;
  today: string;
  upload: {
    day: string;
    kind: string;
    by: string | null;
    at: string | null;
    batches_day: string | null;
  };
  capital: LibCapital[];
  /** Every stock upload: capital (main + doctors' stores); dead / slow once the page was opened on that file. */
  trend: Array<{
    day: string;
    branch: string;
    value: number;
    expiry: number;
    dead?: number | null;
    slow?: number | null;
    active?: number | null;
  }>;
  activity: LibActivity[];
  dead: LibDead[];
  near_expiry: LibNear[];
  expired: LibExpired[];
  doctors: LibDoctor[];
  /** Over every batch (the lists stop at 600 near expiry / 400 expired). */
  totals?: LibTotalsServer | null;
};

export async function loadLiberation(branch: string | null): Promise<Liberation> {
  const { data, error } = await supabase.rpc('dawaa_stock_liberation_v1', { p_branch: branch });
  if (error) {
    const m = error.message ?? '';
    if (/not_allowed|permission|forbidden/i.test(m)) throw new Error('الصفحة دي للإدارة بس');
    throw new Error('تعذّر تحميل المخزون، جرّب تاني');
  }
  const d = (data ?? {}) as Partial<Liberation>;
  return {
    empty: !!d.empty,
    today: d.today ?? '',
    upload: d.upload ?? { day: '', kind: '', by: null, at: null, batches_day: null },
    capital: d.capital ?? [],
    trend: d.trend ?? [],
    activity: d.activity ?? [],
    dead: d.dead ?? [],
    near_expiry: d.near_expiry ?? [],
    expired: d.expired ?? [],
    doctors: d.doctors ?? [],
    totals: d.totals ?? null,
  };
}

const sum = <T>(list: T[], f: (x: T) => number) =>
  list.reduce((t, x) => t + (Number(f(x)) || 0), 0);

/** The numbers at the top: capital, how much of it moves, and how much is stuck or at risk. */
export function libTotals(d: Liberation) {
  const capital = sum(
    d.capital.filter((c) => c.kind !== 'expiry'),
    (c) => c.value
  );
  const sellValue = sum(d.activity, (a) => a.value);
  const active = sum(d.activity, (a) => a.active_value);
  const dead = sum(d.activity, (a) => a.dead_value);
  const slow = sum(d.activity, (a) => a.slow_value);
  const over = sum(d.activity, (a) => a.over_value);
  const items = sum(d.activity, (a) => a.items);
  const activeItems = sum(d.activity, (a) => a.active_items);
  const nearValue = d.totals?.near_value ?? sum(d.near_expiry, (x) => x.value);
  const nearRisk = d.totals?.near_risk ?? sum(d.near_expiry, (x) => x.risk_value);
  const onShelf = d.expired.filter((x) => x.kind !== 'expiry');
  const expiredShelf = d.totals?.expired_shelf ?? sum(onShelf, (x) => x.value);
  const expiryStore = sum(
    d.capital.filter((c) => c.kind === 'expiry'),
    (c) => c.value
  );
  return {
    capital,
    activeShare: sellValue > 0 ? active / sellValue : 0,
    activeItemShare: items > 0 ? activeItems / items : 0,
    dead,
    slow,
    over,
    nearValue,
    nearRisk,
    expiredShelf,
    expiryStore,
    /** Money that can be freed: dead + slow + overstock excess + near-expiry at risk + expired. */
    stuck: dead + slow + over + nearRisk + expiredShelf + expiryStore,
  };
}

export type PlanRow = {
  key: string;
  branch: string;
  code: string;
  name: string;
  why: string;
  value: number;
  action: LibAction;
  /** Higher first: expired on the shelf, then what expires soonest, then the biggest money. */
  urgency: number;
  supplier: string | null;
};

const money = (v: number) => `${Math.round(v).toLocaleString('ar-EG')} ج`;

/** One list for the whole pharmacy, ordered by what to do first. */
export function liberationPlan(d: Liberation): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const x of d.expired)
    rows.push({
      key: `e|${x.branch}|${x.store}|${x.code}`,
      branch: x.branch,
      code: x.code,
      name: x.name ?? x.code,
      why: x.kind === 'expiry' ? `في ${x.store}` : `منتهي من ${x.expiry ?? '—'} ولسه في ${x.store}`,
      value: x.value,
      action: x.action,
      urgency: (x.kind === 'expiry' ? 3_000_000 : 5_000_000) + x.value,
      supplier: x.supplier,
    });
  for (const x of d.near_expiry)
    if (x.action !== 'ok')
      rows.push({
        key: `n|${x.branch}|${x.store}|${x.code}|${x.expiry}`,
        branch: x.branch,
        code: x.code,
        name: x.name ?? x.code,
        why: `ينتهي بعد ${x.days} يوم · هيفضل منه ${x.risk_qty.toLocaleString('ar-EG')} لو البيع فضل كده`,
        value: x.risk_value,
        action: x.action,
        urgency: 4_000_000 - x.days * 10_000 + Math.min(x.risk_value, 9_999),
        supplier: x.supplier,
      });
  for (const x of d.dead)
    rows.push({
      key: `d|${x.branch}|${x.code}`,
      branch: x.branch,
      code: x.code,
      name: x.name ?? x.code,
      why:
        x.status === 'dead'
          ? `ماتباعش ولا مرة في ٩٠ يوم${x.other_rate30 ? ` · الفرع التاني بيبيع ${x.other_rate30} في الشهر` : ''}`
          : `بطيء: آخر بيع ${x.last_sale ?? '—'}`,
      value: x.value,
      action: x.action,
      urgency: 1_000_000 + x.value,
      supplier: x.supplier,
    });
  return rows.sort((a, b) => b.urgency - a.urgency);
}

/** The ticker: the few things worth a look right now, most money first. */
export function liberationTicker(d: Liberation): string[] {
  const t = libTotals(d);
  const out: string[] = [];
  const short = (b: string) => b.replace(/^فرع\s*/, '');
  if (t.expiredShelf > 0)
    out.push(`⛔ منتهي لسه على الرف بقيمة ${money(t.expiredShelf)}: يتسحب النهارده`);
  const soon = d.near_expiry.filter((x) => x.days <= 60 && x.risk_value > 0);
  const soonRows = d.totals?.near60_rows ?? soon.length;
  const soonRisk = d.totals?.near60_risk ?? sum(soon, (x) => x.risk_value);
  if (soonRows)
    out.push(
      `⏳ ${soonRows.toLocaleString('ar-EG')} تشغيلة بتنتهي خلال شهرين ومش هتتباع في ميعادها: ${money(soonRisk)}`
    );
  for (const x of [...d.near_expiry].sort((a, b) => b.risk_value - a.risk_value).slice(0, 3))
    if (x.risk_value > 0)
      out.push(
        `⏳ ${x.name ?? x.code} (${short(x.branch)}) ينتهي بعد ${x.days} يوم · ${money(x.risk_value)} في خطر · ${ACTIONS[x.action].label}`
      );
  for (const x of d.dead.filter((r) => r.status === 'dead').slice(0, 5))
    out.push(
      `🧊 راكد: ${x.name ?? x.code} (${short(x.branch)}) ${money(x.value)} · ${ACTIONS[x.action].label}${x.action === 'transfer' ? ` (بيبيع ${x.other_rate30} في الشهر هناك)` : ''}`
    );
  out.push(
    `📦 رأس المال في المخزون ${money(t.capital)} · ${Math.round(t.activeShare * 100)}% منه اتحرك آخر ٣٠ يوم`
  );
  if (t.over > 0) out.push(`📈 زيادة فوق احتياج شهرين في الأصناف الأوفر ستوك: ${money(t.over)}`);
  if (t.expiryStore > 0) out.push(`🗃️ مخزن الإكسبير فيه ${money(t.expiryStore)}: رجّعوه للموردين`);
  const best = d.doctors[0];
  if (best)
    out.push(
      `🏅 ${best.seller} (${short(best.branch)}) أكتر واحد صرف أصناف تقيلة آخر ٣٠ يوم: ${money(best.value)}`
    );
  const worstBranch = [...d.activity].sort((a, b) => b.dead_value - a.dead_value)[0];
  if (worstBranch && worstBranch.dead_value > 0)
    out.push(`🏬 ${short(worstBranch.branch)} عنده أكبر رواكد: ${money(worstBranch.dead_value)}`);
  return out;
}
