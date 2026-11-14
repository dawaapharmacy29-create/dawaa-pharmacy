import type { PurchaseBranch } from './ePlusReport';

// «مراجعة المشتريات»: what we bought each calendar month, what we owe every supplier and when it falls due.
//
// - A credit (آجل) invoice is owed to its supplier. Each supplier bills a month that starts on its own
//   day (month_start_day): invoices from that day up to the day before it next month form one bill, due
//   pay_after_days after the bill closes (0 = the day the next bill starts).
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
  invoices: number;
  net: number;
}

export interface SupplierTerms {
  code: string;
  name: string;
  month_start_day: number;
  pay_after_days: number;
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
  due: string;
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

/** Every supplier's bills per branch, settled oldest first by its payments. */
export function supplierBalances(data: PurchaseReviewData): SupplierBalance[] {
  const terms = new Map(data.suppliers.map((s) => [s.code, s]));
  const firstDay = new Map<PurchaseBranch, string>();
  for (const line of data.lines) {
    const known = firstDay.get(line.branch);
    if (!known || line.day < known) firstDay.set(line.branch, line.day);
  }

  type Acc = { bills: Map<string, SupplierBill>; paid: number };
  const acc = new Map<string, Acc>();
  const keyOf = (code: string, branch: string) => `${code}|${branch}`;
  const get = (code: string, branch: PurchaseBranch) => {
    const key = keyOf(code, branch);
    let a = acc.get(key);
    if (!a) acc.set(key, (a = { bills: new Map(), paid: 0 }));
    return a;
  };

  for (const line of data.lines) {
    if (line.payment !== 'credit' || isExcluded(line.supplier_code, terms)) continue;
    const t = terms.get(line.supplier_code);
    const bill = billOf(line.day, t?.month_start_day ?? 1);
    const a = get(line.supplier_code, line.branch);
    let b = a.bills.get(bill.from);
    if (!b) {
      b = {
        supplier_code: line.supplier_code,
        branch: line.branch,
        from: bill.from,
        to: bill.to,
        due: addDays(bill.to, 1 + (t?.pay_after_days ?? 0)),
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
  for (const p of data.payments) {
    if (isExcluded(p.supplier_code, terms)) continue;
    get(p.supplier_code, p.branch).paid += p.amount;
  }

  const out: SupplierBalance[] = [];
  for (const [key, a] of acc) {
    const [code, branch] = key.split('|') as [string, PurchaseBranch];
    const t = terms.get(code) ?? null;
    const bills = [...a.bills.values()].sort((x, y) => x.from.localeCompare(y.from));
    let left = a.paid;
    for (const b of bills) {
      b.paid = Math.max(0, Math.min(b.amount, left));
      left -= b.paid;
      b.remaining = b.amount - b.paid;
      // A bill falling due within a week counts as due soon even while it is still running.
      b.state =
        b.remaining <= 0.5
          ? 'paid'
          : b.due < data.today
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
    if (isExcluded(line.supplier_code, terms)) {
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
        overdue: b.due < today,
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
