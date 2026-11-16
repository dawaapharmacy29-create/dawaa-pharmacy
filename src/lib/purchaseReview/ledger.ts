import type { PurchaseBranch } from './ePlusReport';

// «مراجعة المشتريات»: what we bought each calendar month, what we owe every supplier and when it falls due.
//
// - A credit (آجل) invoice is owed to its supplier. Each supplier bills a month that starts on its own
//   day (month_start_day): invoices from that day up to the day before it next month form one bill, due
//   pay_after_days after the bill closes (0 = the day the next bill starts). It can be paid up to
//   pay_until_days after (a window, e.g. the 10th to the 20th); only after that day is it late.
// - Payments (and old balances, entered as negative payments) settle a supplier's bills oldest first,
//   per branch.
// - Cash (نقدى) invoices were paid from the drawer when bought; excluded suppliers are transfers between
//   our own stores or stock counts and never count as purchases.

export const PURCHASE_BRANCHES: PurchaseBranch[] = ['فرع شكري', 'فرع الشامي'];

export interface ReviewLine {
  day: string;
  branch: PurchaseBranch;
  store: string;
  payment: 'credit' | 'cash';
  supplier_code: string;
  /** Invoices taken out of the debt one by one. */
  excluded?: boolean;
  invoices: number;
  net: number;
}

export interface SupplierTerms {
  code: string;
  name: string;
  month_start_day: number;
  pay_after_days: number;
  /** Last day to pay, counted like pay_after_days; null = the same day. */
  pay_until_days?: number | null;
  excluded: boolean;
  note: string | null;
}

export interface SupplierPayment {
  id: string;
  supplier_code: string;
  branch: PurchaseBranch;
  amount: number;
  paid_on: string;
  note: string | null;
  by?: string | null;
  /** «treasury» = cash out of the branch treasury in «التقارير المجمعة», linked to this supplier. */
  source?: 'manual' | 'treasury';
}

/** Cash out of خزنة شكري / خزنة الشامي under «شركات» or «مخازن». */
export interface TreasuryPayment {
  id: string;
  branch: PurchaseBranch;
  category: string;
  amount: number;
  day: string;
  description: string | null;
  by?: string | null;
}

/** A treasury item linked to a supplier, or marked as not a supplier (ignored). */
export interface TreasuryLink {
  category: string;
  supplier_code: string | null;
  ignored: boolean;
}

export interface StoreUpload {
  store: string;
  branch: PurchaseBranch;
  file_name: string | null;
  first_day: string;
  last_day: string;
  invoices: number;
  net: number;
  report_net: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

export interface PurchaseReviewData {
  today: string;
  from: string;
  lines: ReviewLine[];
  suppliers: SupplierTerms[];
  payments: SupplierPayment[];
  uploads: StoreUpload[];
  /** Debts are followed from this day: bills due before it count as settled, payments count from it. */
  track_from?: string | null;
  treasury?: TreasuryPayment[];
  links?: TreasuryLink[];
}

/** Arabic names written differently in ePlus and in the treasury book compare equal. */
export function normalizeName(name: string, dropCommonWords = true) {
  let s = ` ${name
    .normalize('NFC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase()} `;
  if (dropCommonWords)
    s = s.replace(/ (مخزن|شركه|للتوزيع|اكسسوار|فارم|فارما)(?= )/g, ' ').replace(/ ال/g, ' ');
  return s.replace(/\s/g, '');
}

/** The supplier a treasury item most likely pays, by name; null when unsure. */
export function suggestSupplier(category: string, suppliers: SupplierTerms[]) {
  const candidates = suppliers.filter((s) => !s.excluded);
  for (const drop of [false, true]) {
    const key = normalizeName(category, drop);
    if (key.length < 3) continue;
    const exact = candidates.filter((s) => normalizeName(s.name, drop) === key);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
  }
  const key = normalizeName(category);
  if (key.length < 3) return null;
  const partial = candidates.filter((s) => {
    const name = normalizeName(s.name);
    return name.length >= 3 && (name.includes(key) || key.includes(name));
  });
  return partial.length === 1 ? partial[0] : null;
}

/** Treasury cash linked to a supplier, as payments of that supplier in that branch. */
export function treasuryPayments(data: PurchaseReviewData): SupplierPayment[] {
  const links = new Map((data.links ?? []).map((l) => [l.category, l]));
  const out: SupplierPayment[] = [];
  for (const t of data.treasury ?? []) {
    const code = links.get(t.category)?.supplier_code;
    if (!code) continue;
    out.push({
      id: `treasury:${t.id}`,
      supplier_code: code,
      branch: t.branch,
      amount: t.amount,
      paid_on: t.day,
      note:
        t.description && t.description !== t.category ? t.description : `من الخزنة: ${t.category}`,
      by: t.by ?? null,
      source: 'treasury',
    });
  }
  return out;
}

/** Manual payments and old balances, plus the linked treasury cash. */
export function allPayments(data: PurchaseReviewData): SupplierPayment[] {
  return [
    ...data.payments.map((p) => ({ ...p, source: p.source ?? ('manual' as const) })),
    ...treasuryPayments(data),
  ].sort((a, b) => a.paid_on.localeCompare(b.paid_on));
}

export interface TreasuryItem {
  category: string;
  /** Since track_from. */
  total: number;
  count: number;
  last: string;
  branches: Partial<Record<PurchaseBranch, number>>;
  link: TreasuryLink | null;
  suggestion: SupplierTerms | null;
}

/** Every treasury item paid since track_from: linked to a supplier, ignored, or still waiting. */
export function treasuryItems(data: PurchaseReviewData): TreasuryItem[] {
  const links = new Map((data.links ?? []).map((l) => [l.category, l]));
  const since = data.track_from ?? '';
  const items = new Map<string, TreasuryItem>();
  for (const t of data.treasury ?? []) {
    if (t.day < since) continue;
    let item = items.get(t.category);
    if (!item) {
      const link = links.get(t.category) ?? null;
      items.set(
        t.category,
        (item = {
          category: t.category,
          total: 0,
          count: 0,
          last: t.day,
          branches: {},
          link,
          suggestion: link ? null : suggestSupplier(t.category, data.suppliers),
        })
      );
    }
    item.total += t.amount;
    item.count += 1;
    if (t.day > item.last) item.last = t.day;
    item.branches[t.branch] = (item.branches[t.branch] ?? 0) + t.amount;
  }
  return [...items.values()].sort((a, b) => b.total - a.total);
}

const DAY = 864e5;
const toUtc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, days: number) => isoOf(toUtc(iso) + days * DAY);
export const daysBetween = (from: string, to: string) =>
  Math.round((toUtc(to) - toUtc(from)) / DAY);

const isoDay = (y: number, monthIndex: number, d: number) => isoOf(Date.UTC(y, monthIndex, d));

/** The calendar month (1st → last day) that contains `day`, or `offset` months from it. */
export function monthRange(day: string, offset = 0) {
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7) - 1 + offset;
  return { from: isoDay(y, m, 1), to: isoDay(y, m + 1, 0), key: isoDay(y, m, 1).slice(0, 7) };
}

export function isExcluded(code: string, terms: Map<string, SupplierTerms>) {
  const t = terms.get(code);
  return t ? t.excluded : false;
}

/** The supplier bill that contains `day`: from its start day to the day before the next one. */
export function billOf(day: string, monthStartDay: number) {
  const start = Math.min(Math.max(Math.round(monthStartDay) || 1, 1), 28);
  const y = +day.slice(0, 4);
  const m = +day.slice(5, 7) - 1;
  const d = +day.slice(8, 10);
  const startMonth = d >= start ? m : m - 1;
  const from = isoDay(y, startMonth, start);
  const to = addDays(isoDay(y, startMonth + 1, start), -1);
  return { from, to };
}

/** open = still running; waiting = closed, due later than a week. */
export type BillState = 'open' | 'waiting' | 'due_soon' | 'overdue' | 'paid';

export interface SupplierBill {
  supplier_code: string;
  branch: PurchaseBranch;
  from: string;
  to: string;
  /** The window to pay it opens… */
  due: string;
  /** …and closes: after this day it is late. */
  last: string;
  amount: number;
  paid: number;
  remaining: number;
  invoices: number;
  state: BillState;
  /** The bill started before the first uploaded day, so part of it may be missing. */
  partial: boolean;
}

export interface SupplierBalance {
  code: string;
  name: string;
  branch: PurchaseBranch;
  terms: SupplierTerms | null;
  credit: number;
  paid: number;
  /** The part of `paid` that came out of the treasury («التقارير المجمعة»). */
  fromTreasury: number;
  /** > 0 we owe them, < 0 they owe us (paid more than the bills). */
  balance: number;
  bills: SupplierBill[];
  overdue: number;
  dueSoon: number;
  /** The bill still running (not closed yet). */
  running: number;
  nextDue: string | null;
}

export const DUE_SOON_DAYS = 7;
/** A payment this long after a bill fell due is an advance on the next bill, not the old one paid late. */
export const ADVANCE_AFTER_DAYS = 14;

/** Every supplier's bills per branch, settled oldest first by its payments. */
export function supplierBalances(data: PurchaseReviewData): SupplierBalance[] {
  const terms = new Map(data.suppliers.map((s) => [s.code, s]));
  const firstDay = new Map<PurchaseBranch, string>();
  for (const line of data.lines) {
    const known = firstDay.get(line.branch);
    if (!known || line.day < known) firstDay.set(line.branch, line.day);
  }

  type Acc = {
    bills: Map<string, SupplierBill>;
    paid: number;
    treasury: number;
    /** Pre-tracking payments after this day pay the bills we track (they are advances). */
    advanceFrom?: string;
  };
  const acc = new Map<string, Acc>();
  const keyOf = (code: string, branch: string) => `${code}|${branch}`;
  const get = (code: string, branch: PurchaseBranch) => {
    const key = keyOf(code, branch);
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { bills: new Map(), paid: 0, treasury: 0 }));
    return a;
  };

  const since = data.track_from ?? '';
  for (const line of data.lines) {
    if (line.payment !== 'credit' || line.excluded || isExcluded(line.supplier_code, terms))
      continue;
    const t = terms.get(line.supplier_code);
    const bill = billOf(line.day, t?.month_start_day ?? 1);
    const due = addDays(bill.to, 1 + (t?.pay_after_days ?? 0));
    const last = addDays(bill.to, 1 + Math.max(t?.pay_after_days ?? 0, t?.pay_until_days ?? 0));
    const a = get(line.supplier_code, line.branch);
    // Bills whose last day to pay came before the tracking day count as settled.
    if (last < since) {
      // A long window (pay when there is cash) ends late; a payment two weeks into it is already the
      // next bill's money, so count from whichever comes first.
      const from = addDays(
        last < addDays(due, ADVANCE_AFTER_DAYS) ? last : due,
        ADVANCE_AFTER_DAYS
      );
      if (!a.advanceFrom || from > a.advanceFrom) a.advanceFrom = from;
      continue;
    }
    let b = a.bills.get(bill.from);
    if (!b) {
      b = {
        supplier_code: line.supplier_code,
        branch: line.branch,
        from: bill.from,
        to: bill.to,
        due,
        last,
        amount: 0,
        paid: 0,
        remaining: 0,
        invoices: 0,
        state: 'open',
        partial: bill.from < (firstDay.get(line.branch) ?? bill.from),
      };
      a.bills.set(bill.from, b);
    }
    b.amount += line.net;
    b.invoices += line.invoices;
  }
  // Old balances (negative) always count; payments from the tracking day on, and the ones paid in
  // advance: more than ADVANCE_AFTER_DAYS after the last bill settled before the tracking day fell due
  // (or its window opened; earlier ones are that bill paid late), so they pay the next one.
  for (const p of allPayments(data)) {
    if (isExcluded(p.supplier_code, terms)) continue;
    const a = get(p.supplier_code, p.branch);
    if (p.amount > 0 && p.paid_on < since && !(a.advanceFrom && p.paid_on > a.advanceFrom))
      continue;
    a.paid += p.amount;
    if (p.source === 'treasury') a.treasury += p.amount;
  }

  const out: SupplierBalance[] = [];
  for (const [key, a] of acc) {
    const [code, branch] = key.split('|') as [string, PurchaseBranch];
    const t = terms.get(code) ?? null;
    const bills = [...a.bills.values()].sort((x, y) => x.from.localeCompare(y.from));
    if (!bills.length && Math.abs(a.paid) < 0.5) continue;
    let left = a.paid;
    for (const b of bills) {
      b.paid = Math.max(0, Math.min(b.amount, left));
      left -= b.paid;
      b.remaining = b.amount - b.paid;
      // A bill falling due within a week counts as due soon even while it is still running.
      b.state =
        b.remaining <= 0.5
          ? 'paid'
          : b.last < data.today
            ? 'overdue'
            : daysBetween(data.today, b.due) <= DUE_SOON_DAYS
              ? 'due_soon'
              : data.today <= b.to
                ? 'open'
                : 'waiting';
    }
    const credit = bills.reduce((s, b) => s + b.amount, 0);
    const sum = (state: BillState) =>
      bills.filter((b) => b.state === state).reduce((s, b) => s + b.remaining, 0);
    const unpaid = bills.filter((b) => b.remaining > 0.5 && b.state !== 'open');
    out.push({
      code,
      name: t?.name ?? code,
      branch,
      terms: t,
      credit,
      paid: a.paid,
      fromTreasury: a.treasury,
      balance: credit - a.paid,
      bills,
      overdue: sum('overdue'),
      dueSoon: sum('due_soon'),
      running: sum('open'),
      nextDue: unpaid.length ? unpaid[0].due : null,
    });
  }
  return out.sort((x, y) => y.balance - x.balance);
}

export interface StoreMonth {
  store: string;
  branch: PurchaseBranch;
  credit: number;
  cash: number;
  excluded: number;
  invoices: number;
}

export interface BranchMonth {
  branch: PurchaseBranch;
  stores: StoreMonth[];
  credit: number;
  cash: number;
  excluded: number;
  net: number;
  invoices: number;
}

/** Purchases of one calendar month per branch and store: credit, cash and excluded apart. */
export function monthSummary(data: PurchaseReviewData, range: { from: string; to: string }) {
  const terms = new Map(data.suppliers.map((s) => [s.code, s]));
  const stores = new Map<string, StoreMonth>();
  const bySupplier = new Map<
    string,
    { code: string; branch: PurchaseBranch; credit: number; cash: number; invoices: number }
  >();
  const byDay = new Map<string, number>();
  for (const line of data.lines) {
    if (line.day < range.from || line.day > range.to) continue;
    let s = stores.get(line.store);
    if (!s)
      stores.set(
        line.store,
        (s = {
          store: line.store,
          branch: line.branch,
          credit: 0,
          cash: 0,
          excluded: 0,
          invoices: 0,
        })
      );
    if (line.excluded || isExcluded(line.supplier_code, terms)) {
      s.excluded += line.net;
      continue;
    }
    s[line.payment] += line.net;
    s.invoices += line.invoices;
    byDay.set(line.day, (byDay.get(line.day) ?? 0) + line.net);
    const k = `${line.supplier_code}|${line.branch}`;
    let sup = bySupplier.get(k);
    if (!sup)
      bySupplier.set(
        k,
        (sup = { code: line.supplier_code, branch: line.branch, credit: 0, cash: 0, invoices: 0 })
      );
    sup[line.payment] += line.net;
    sup.invoices += line.invoices;
  }
  const branches: BranchMonth[] = PURCHASE_BRANCHES.map((branch) => {
    const own = [...stores.values()]
      .filter((s) => s.branch === branch)
      .sort((a, b) => a.store.localeCompare(b.store));
    const credit = own.reduce((t, s) => t + s.credit, 0);
    const cash = own.reduce((t, s) => t + s.cash, 0);
    return {
      branch,
      stores: own,
      credit,
      cash,
      excluded: own.reduce((t, s) => t + s.excluded, 0),
      net: credit + cash,
      invoices: own.reduce((t, s) => t + s.invoices, 0),
    };
  });
  const total = {
    credit: branches.reduce((t, b) => t + b.credit, 0),
    cash: branches.reduce((t, b) => t + b.cash, 0),
    excluded: branches.reduce((t, b) => t + b.excluded, 0),
    net: branches.reduce((t, b) => t + b.net, 0),
    invoices: branches.reduce((t, b) => t + b.invoices, 0),
  };
  const suppliers = [...bySupplier.values()]
    .map((s) => ({ ...s, name: terms.get(s.code)?.name ?? s.code, net: s.credit + s.cash }))
    .sort((a, b) => b.net - a.net);
  const days = [...byDay.entries()]
    .map(([day, net]) => ({ day, net }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return { branches, total, suppliers, days };
}

export interface CashPlan {
  overdue: number;
  dueSoon: number;
  /** Closed bills due later than a week. */
  later: number;
  /** Bills still running this month: what they reach so far. */
  running: number;
  /** Everything owed: overdue + due soon + later + running. */
  owed: number;
  /** We paid more than the bills (they owe us). */
  credits: number;
  /** Next 6 due dates with what falls due on each. */
  calendar: {
    due: string;
    amount: number;
    suppliers: {
      name: string;
      branch: PurchaseBranch;
      amount: number;
      overdue: boolean;
      running: boolean;
    }[];
  }[];
}

/** The cash the suppliers will ask for, to set against the cash in the treasury. */
export function cashPlan(balances: SupplierBalance[], today: string): CashPlan {
  let overdue = 0;
  let dueSoon = 0;
  let later = 0;
  let running = 0;
  let credits = 0;
  const calendar = new Map<string, CashPlan['calendar'][number]>();
  for (const s of balances) {
    if (s.balance < -0.5) credits += -s.balance;
    for (const b of s.bills) {
      if (b.remaining <= 0.5) continue;
      if (b.state === 'open') {
        running += b.remaining;
        continue;
      }
      if (b.state === 'overdue') overdue += b.remaining;
      else if (b.state === 'due_soon') dueSoon += b.remaining;
      else later += b.remaining;
      const due = b.due < today ? today : b.due;
      let c = calendar.get(due);
      if (!c) calendar.set(due, (c = { due, amount: 0, suppliers: [] }));
      c.amount += b.remaining;
      c.suppliers.push({
        name: s.name,
        branch: s.branch,
        amount: b.remaining,
        overdue: b.last < today,
        running: today <= b.to,
      });
    }
  }
  return {
    overdue,
    dueSoon,
    later,
    running,
    owed: overdue + dueSoon + later + running,
    credits,
    calendar: [...calendar.values()]
      .sort((a, b) => a.due.localeCompare(b.due))
      .slice(0, 6)
      .map((c) => ({ ...c, suppliers: c.suppliers.sort((a, b) => b.amount - a.amount) })),
  };
}

export interface PayItem {
  code: string;
  name: string;
  /** Overdue plus what falls due within DUE_SOON_DAYS, both branches together. */
  amount: number;
  /** The part that must be paid within DUE_SOON_DAYS (late, or its last day comes this week); the rest
   * can be paid now but may wait. */
  urgent: number;
  overdue: boolean;
  /** The earliest due date among those bills… */
  due: string;
  /** …and the earliest last day to pay. */
  last: string;
  branches: { branch: PurchaseBranch; amount: number }[];
  /** One of the bills is still collecting invoices (closes on `runningTo`). */
  running: boolean;
  runningTo: string | null;
  /** Another branch paid this supplier more than its bills; worth a look before paying. */
  credits: { branch: PurchaseBranch; amount: number }[];
}

/** Who to pay this week: one row per supplier, overdue first (biggest first), then by due date. */
export function payList(balances: SupplierBalance[], today: string): PayItem[] {
  const out = new Map<string, PayItem>();
  for (const s of balances) {
    for (const b of s.bills) {
      if (b.remaining <= 0.5 || (b.state !== 'overdue' && b.state !== 'due_soon')) continue;
      let i = out.get(s.code);
      if (!i)
        out.set(
          s.code,
          (i = {
            code: s.code,
            name: s.name,
            amount: 0,
            urgent: 0,
            overdue: false,
            due: b.due,
            last: b.last,
            branches: [],
            running: false,
            runningTo: null,
            credits: balances
              .filter((x) => x.code === s.code && x.balance < -0.5)
              .map((x) => ({ branch: x.branch, amount: -x.balance })),
          })
        );
      i.amount += b.remaining;
      if (b.state === 'overdue' || daysBetween(today, b.last) <= DUE_SOON_DAYS)
        i.urgent += b.remaining;
      i.overdue ||= b.state === 'overdue';
      if (b.due < i.due) i.due = b.due;
      if (b.last < i.last) i.last = b.last;
      if (today <= b.to) {
        i.running = true;
        i.runningTo = b.to;
      }
      const br = i.branches.find((x) => x.branch === s.branch);
      if (br) br.amount += b.remaining;
      else i.branches.push({ branch: s.branch, amount: b.remaining });
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      (a.overdue
        ? b.amount - a.amount
        : a.last.localeCompare(b.last) || a.due.localeCompare(b.due) || b.amount - a.amount)
  );
}

export interface SupplierRow {
  code: string;
  name: string;
  /** Both branches together: > 0 we owe them, < 0 they owe us. */
  balance: number;
  overdue: number;
  dueSoon: number;
  running: number;
  nextDue: string | null;
  branches: SupplierBalance[];
}

/** One row per supplier with its branches under it, biggest debt first and credits last. */
export function supplierRows(balances: SupplierBalance[]): SupplierRow[] {
  const out = new Map<string, SupplierRow>();
  for (const b of balances) {
    let r = out.get(b.code);
    if (!r)
      out.set(
        b.code,
        (r = {
          code: b.code,
          name: b.name,
          balance: 0,
          overdue: 0,
          dueSoon: 0,
          running: 0,
          nextDue: null,
          branches: [],
        })
      );
    r.balance += b.balance;
    r.overdue += b.overdue;
    r.dueSoon += b.dueSoon;
    r.running += b.running;
    if (b.nextDue && (!r.nextDue || b.nextDue < r.nextDue)) r.nextDue = b.nextDue;
    r.branches.push(b);
  }
  return [...out.values()].sort((a, b) => b.balance - a.balance);
}

/** Things only the owner can settle; each one comes with the answer that settles it. */
export type ReviewIssue =
  | {
      kind: 'credit';
      key: string;
      balance: SupplierBalance;
      /** The other branch owes this supplier: the payment may have gone to the wrong branch. */
      otherBranchOwes: number;
    }
  | {
      kind: 'unpaid';
      key: string;
      balance: SupplierBalance;
      bill: SupplierBill;
      /** Days since its last day to pay. */
      late: number;
    };

/** A credit (we paid more than the bills) or an overdue bill with nothing paid on it in a long time. */
export function reviewIssues(balances: SupplierBalance[], today: string): ReviewIssue[] {
  const out: ReviewIssue[] = [];
  for (const b of balances) {
    if (b.balance < -100) {
      const other = balances
        .filter((x) => x.code === b.code && x.branch !== b.branch)
        .reduce((s, x) => s + Math.max(0, x.balance), 0);
      out.push({
        kind: 'credit',
        key: `credit|${b.code}|${b.branch}`,
        balance: b,
        otherBranchOwes: other,
      });
    }
    for (const bill of b.bills) {
      const late = daysBetween(bill.last, today);
      if (bill.state === 'overdue' && bill.paid <= 0.5 && bill.remaining > 1000 && late > 7)
        out.push({
          kind: 'unpaid',
          key: `unpaid|${b.code}|${b.branch}|${bill.from}`,
          balance: b,
          bill,
          late,
        });
    }
  }
  return out.sort(
    (a, b) =>
      (b.kind === 'credit' ? -b.balance.balance : b.kind === 'unpaid' ? b.bill.remaining : 0) -
      (a.kind === 'credit' ? -a.balance.balance : a.kind === 'unpaid' ? a.bill.remaining : 0)
  );
}

/** Stores the page expects a report from, and how fresh each one is. */
export const EXPECTED_STORES: { store: string; branch: PurchaseBranch }[] = [
  { store: 'الادارة فرع شكري', branch: 'فرع شكري' },
  { store: 'مخزن د.وائل', branch: 'فرع شكري' },
  { store: 'الفرعية الشامي', branch: 'فرع الشامي' },
  { store: 'مخزن د معاذ', branch: 'فرع الشامي' },
];

export function uploadFreshness(uploads: StoreUpload[], today: string) {
  return EXPECTED_STORES.map((s) => {
    const u = uploads.find((x) => x.store === s.store) ?? null;
    return { ...s, upload: u, daysBehind: u ? daysBetween(u.last_day, today) : null };
  });
}
