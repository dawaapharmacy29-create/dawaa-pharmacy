import { personKey } from '@/lib/shiftHandoverCoverage';

// One reading of a shift handover's money, used by every tab of «تسليم الشيفتات».
//
// The handover comes from DawaaWael (Base44 ShiftDelivery). Its rules, from shiftFinancials.js there:
//   المبيعات = كاش + فيزا + إنستا + فودافون + تحويلات أخرى
//   الكاش للمحاسب = الكاش − المصروفات اللي اتدفعت كاش من الدرج
//   صافي التشغيل = المبيعات − كل المصروفات
// Handovers before October 2026 had no payment split: visa/insta/vodafone were typed as expense lines.
// Those lines are payments, not expenses; they are read back as payments and never counted as spending.

export interface HandoverExpense {
  category?: string | null;
  description?: string | null;
  amount?: number | string | null;
  payment_source?: string | null;
}

export interface HandoverMoneySource {
  total_sales: number | string | null;
  total_expenses?: number | string | null;
  cash_sales?: number | string | null;
  visa_sales?: number | string | null;
  insta_sales?: number | string | null;
  vodafone_sales?: number | string | null;
  other_sales?: number | string | null;
  cash_handover?: number | string | null;
  cash_variance?: number | string | null;
  expenses?: HandoverExpense[] | null;
}

export interface ShiftMoney {
  sales: number;
  cash: number;
  visa: number;
  insta: number;
  vodafone: number;
  other: number;
  /** Everything that did not land in the drawer: visa + insta + vodafone + other. */
  transfers: number;
  /** Real spending only. */
  expenses: number;
  /** Spending paid from the drawer; it comes off the cash. */
  cashExpenses: number;
  /** The cash the accountant should receive: cash − cash expenses. */
  toAccountant: number;
  /** Sales − all spending. */
  operatingNet: number;
  /** The cash the doctor said they handed over, when it differs from toAccountant. */
  cashVariance: number;
  /** Sales minus the payment split; non-zero means the split does not add up. */
  splitGap: number;
  /** An old handover with no payment split (payments read from its expense lines). */
  legacy: boolean;
  /** Expense lines named after a payment method (they are payments, not spending). */
  paymentLines: number;
  realExpenseLines: HandoverExpense[];
}

const PAYMENT_WORDS: [keyof Pick<ShiftMoney, 'visa' | 'insta' | 'vodafone'>, string[]][] = [
  ['insta', ['انستا', 'إنستا', 'insta']],
  ['visa', ['فيزا', 'visa', 'بطاق', 'كارت']],
  ['vodafone', ['فودافون', 'vodafone']],
];

export const num = (value: unknown): number => {
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/** The payment method an expense line is really naming, if any. */
export function paymentLineType(line: HandoverExpense): 'visa' | 'insta' | 'vodafone' | null {
  const label = `${line.category ?? ''} ${line.description ?? ''}`.toLowerCase();
  for (const [type, words] of PAYMENT_WORDS) {
    if (words.some((w) => label.includes(w))) return type;
  }
  return null;
}

export function shiftMoney(row: HandoverMoneySource): ShiftMoney {
  const sales = num(row.total_sales);
  const lines = Array.isArray(row.expenses) ? row.expenses : [];
  const split = {
    cash: num(row.cash_sales),
    visa: num(row.visa_sales),
    insta: num(row.insta_sales),
    vodafone: num(row.vodafone_sales),
    other: num(row.other_sales),
  };
  const legacy = Object.values(split).every((v) => v === 0) && sales > 0;

  const fromLines = { visa: 0, insta: 0, vodafone: 0 };
  let paymentLines = 0;
  const realExpenseLines: HandoverExpense[] = [];
  for (const line of lines) {
    const type = paymentLineType(line);
    if (type) {
      paymentLines += num(line.amount);
      if (legacy) fromLines[type] += num(line.amount);
    } else realExpenseLines.push(line);
  }
  if (legacy) {
    split.visa = fromLines.visa;
    split.insta = fromLines.insta;
    split.vodafone = fromLines.vodafone;
    split.cash = Math.max(0, sales - fromLines.visa - fromLines.insta - fromLines.vodafone);
  }

  const itemised = realExpenseLines.reduce((a, l) => a + num(l.amount), 0);
  // A total with no lines behind it is spending we cannot place: count it as cash.
  const expenses = lines.length ? itemised : Math.max(0, num(row.total_expenses));
  const nonCash = realExpenseLines
    .filter((l) => l.payment_source && l.payment_source !== 'cash')
    .reduce((a, l) => a + num(l.amount), 0);
  const cashExpenses = Math.max(0, expenses - nonCash);
  const transfers = split.visa + split.insta + split.vodafone + split.other;
  const toAccountant = Math.max(0, split.cash - cashExpenses);
  const variance = row.cash_handover == null ? 0 : num(row.cash_handover) - toAccountant;

  return {
    sales,
    ...split,
    transfers,
    expenses,
    cashExpenses,
    toAccountant,
    operatingNet: sales - expenses,
    cashVariance:
      Math.abs(variance) > 1
        ? variance
        : Math.abs(num(row.cash_variance)) > 1
          ? num(row.cash_variance)
          : 0,
    splitGap: legacy ? 0 : Math.round((sales - split.cash - transfers) * 100) / 100,
    legacy,
    paymentLines,
    realExpenseLines,
  };
}

export interface MoneyTotals {
  count: number;
  days: number;
  sales: number;
  cash: number;
  visa: number;
  insta: number;
  vodafone: number;
  other: number;
  transfers: number;
  expenses: number;
  cashExpenses: number;
  toAccountant: number;
  operatingNet: number;
  cashVariance: number;
}

export function totalsOf<T extends HandoverMoneySource & { shift_date: string }>(
  rows: T[]
): MoneyTotals {
  const t: MoneyTotals = {
    count: rows.length,
    days: new Set(rows.map((r) => r.shift_date)).size,
    sales: 0,
    cash: 0,
    visa: 0,
    insta: 0,
    vodafone: 0,
    other: 0,
    transfers: 0,
    expenses: 0,
    cashExpenses: 0,
    toAccountant: 0,
    operatingNet: 0,
    cashVariance: 0,
  };
  for (const row of rows) {
    const m = shiftMoney(row);
    t.sales += m.sales;
    t.cash += m.cash;
    t.visa += m.visa;
    t.insta += m.insta;
    t.vodafone += m.vodafone;
    t.other += m.other;
    t.transfers += m.transfers;
    t.expenses += m.expenses;
    t.cashExpenses += m.cashExpenses;
    t.toAccountant += m.toAccountant;
    t.operatingNet += m.operatingNet;
    t.cashVariance += m.cashVariance;
  }
  return t;
}

export const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);

// ---------------------------------------------------------------------------
// Periods. The pharmacy's month runs from the 26th to the 25th (the «دورة»).
// ---------------------------------------------------------------------------

export const addDays = (day: string, delta: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5) + 1;

/** The cycle (26th → 25th) holding a day. */
export function cycleOf(day: string): { from: string; to: string } {
  const [y, m, d] = day.split('-').map(Number);
  const start = d >= 26 ? new Date(Date.UTC(y, m - 1, 26)) : new Date(Date.UTC(y, m - 2, 26));
  const from = start.toISOString().slice(0, 10);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 25));
  return { from, to: end.toISOString().slice(0, 10) };
}

export type PeriodId = 'today' | 'yesterday' | 'week' | 'cycle' | 'prevCycle' | 'month' | 'custom';

export const PERIOD_LABELS: Record<PeriodId, string> = {
  today: 'اليوم',
  yesterday: 'أمس',
  week: 'آخر ٧ أيام',
  cycle: 'الدورة الحالية',
  prevCycle: 'الدورة اللي فاتت',
  month: 'الشهر الحالي',
  custom: 'فترة تختارها',
};

export function periodRange(
  period: PeriodId,
  today: string,
  custom?: { from: string; to: string }
): { from: string; to: string } {
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday':
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case 'week':
      return { from: addDays(today, -6), to: today };
    case 'cycle':
      return cycleOf(today);
    case 'prevCycle':
      return cycleOf(addDays(cycleOf(today).from, -1));
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    default:
      return custom && custom.from <= custom.to ? custom : { from: today, to: today };
  }
}

/** The same number of days just before a range, to compare with. */
export function previousRange(range: { from: string; to: string }) {
  const length = daysBetween(range.from, range.to);
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}

/** Change from a previous value, in percent; null when there is nothing to compare with. */
export function change(now: number, before: number): number | null {
  if (!before) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

// ---------------------------------------------------------------------------
// Groupings for the statistics tab.
// ---------------------------------------------------------------------------

export interface GroupStat extends MoneyTotals {
  key: string;
  label: string;
  avgSales: number;
  avgPerDay: number;
  expenseRate: number;
  transferShare: number;
}

function groupStat<T extends HandoverMoneySource & { shift_date: string }>(
  key: string,
  label: string,
  rows: T[]
): GroupStat {
  const t = totalsOf(rows);
  return {
    key,
    label,
    ...t,
    avgSales: t.count ? t.sales / t.count : 0,
    avgPerDay: t.days ? t.sales / t.days : 0,
    expenseRate: pct(t.expenses, t.sales),
    transferShare: pct(t.transfers, t.sales),
  };
}

export function groupBy<T extends HandoverMoneySource & { shift_date: string }>(
  rows: T[],
  keyOf: (row: T) => string,
  labelOf: (row: T) => string = keyOf
): GroupStat[] {
  const groups = new Map<string, { label: string; rows: T[] }>();
  for (const row of rows) {
    const key = keyOf(row);
    const g = groups.get(key) ?? { label: labelOf(row), rows: [] };
    g.rows.push(row);
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => groupStat(key, g.label, g.rows))
    .sort((a, b) => b.sales - a.sales);
}

/** The person who closed, one entry for «د/ أحمد» and «د احمد». */
export function closerKey(name: string | null | undefined) {
  return personKey(name) || 'غير معروف';
}

export interface DayPoint {
  day: string;
  byBranch: Record<string, number>;
  sales: number;
  expenses: number;
  transfers: number;
  shifts: number;
}

/** Sales per day in a range, every day present (0 when nothing was closed). */
export function dailySeries<T extends HandoverMoneySource & { shift_date: string; branch: string }>(
  rows: T[],
  range: { from: string; to: string },
  branches: readonly string[]
): DayPoint[] {
  const points: DayPoint[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) {
    const own = rows.filter((r) => r.shift_date === day);
    const byBranch: Record<string, number> = {};
    for (const b of branches)
      byBranch[b] = own.filter((r) => r.branch === b).reduce((a, r) => a + shiftMoney(r).sales, 0);
    const t = totalsOf(own);
    points.push({
      day,
      byBranch,
      sales: t.sales,
      expenses: t.expenses,
      transfers: t.transfers,
      shifts: own.length,
    });
  }
  return points;
}

export interface ExpenseLine {
  category: string;
  description: string;
  amount: number;
  source: string;
  branch: string;
  day: string;
  shift: string;
  by: string | null;
  handoverId: string;
}

export function expenseLines<
  T extends HandoverMoneySource & {
    id: string;
    shift_date: string;
    branch: string;
    shift_type: string;
    submitted_by?: string | null;
  },
>(rows: T[]): ExpenseLine[] {
  return rows
    .flatMap((r) => {
      const m = shiftMoney(r);
      const lines: ExpenseLine[] = m.realExpenseLines.map((e) => ({
        category: e.category?.trim() || 'غير مصنف',
        description: e.description?.trim() || '',
        amount: num(e.amount),
        source: e.payment_source || 'cash',
        branch: r.branch,
        day: r.shift_date,
        shift: r.shift_type,
        by: r.submitted_by ?? null,
        handoverId: r.id,
      }));
      const itemised = lines.reduce((a, l) => a + l.amount, 0);
      if (m.expenses - itemised > 0.5)
        lines.push({
          category: 'من غير تفاصيل',
          description: 'مسجلة كإجمالي في دواء وائل من غير بنود',
          amount: m.expenses - itemised,
          source: 'cash',
          branch: r.branch,
          day: r.shift_date,
          shift: r.shift_type,
          by: r.submitted_by ?? null,
          handoverId: r.id,
        });
      return lines;
    })
    .sort((a, b) => b.day.localeCompare(a.day) || b.amount - a.amount);
}

export function expenseCategories(lines: ExpenseLine[]) {
  const map = new Map<string, { amount: number; count: number; max: number }>();
  for (const l of lines) {
    const c = map.get(l.category) ?? { amount: 0, count: 0, max: 0 };
    c.amount += l.amount;
    c.count += 1;
    c.max = Math.max(c.max, l.amount);
    map.set(l.category, c);
  }
  const total = lines.reduce((a, l) => a + l.amount, 0);
  return [...map.entries()]
    .map(([name, c]) => ({ name, ...c, share: pct(c.amount, total) }))
    .sort((a, b) => b.amount - a.amount);
}

export const EXPENSE_SOURCE_LABEL: Record<string, string> = {
  cash: 'كاش من الدرج',
  insta: 'إنستا باي',
  vodafone: 'فودافون كاش',
  bank: 'حساب بنكي',
  other: 'أخرى',
};
