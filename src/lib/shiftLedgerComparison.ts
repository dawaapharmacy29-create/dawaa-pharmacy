import { supabase } from '@/lib/supabase';
import type { AccountantTransaction } from '@/lib/accountantReport';

// «مقارنة تسليم الشيفتات» in «التقارير المجمعة»: what the shifts handed over (shift_handovers, DawaaWael)
// next to what reached the vault in the Dawaa Bills ledger, per day. Cash is deposited in lumps, so a day
// can differ while the running difference (handed over but not yet in the vault) still closes to zero.

/** Ledger vault → shift handover branch. «خزنة باقي الفروع» has no handovers in this app. */
export const VAULT_BRANCH: Record<string, string> = {
  shamy: 'فرع الشامي',
  shokry: 'فرع شكري',
};
export const ELECTRONIC_CATEGORIES = ['فودافون كاش', 'انستا', 'فيزا'] as const;
/** Differences up to a pound are rounding, not a mismatch. */
export const MISMATCH_TOLERANCE = 1;

export interface HandoverShift {
  id: string;
  branch: string;
  shift_type: string;
  shift_date: string;
  submitted_by: string | null;
  cash_sales: number | null;
  cash_handover: number | null;
  visa_sales: number | null;
  insta_sales: number | null;
  vodafone_sales: number | null;
  is_archived: boolean | null;
}

export interface ComparisonDay {
  date: string;
  shifts: HandoverShift[];
  shiftCash: number;
  shiftElectronic: number;
  ledgerCash: number;
  ledgerElectronic: number;
  cashDiff: number;
  electronicDiff: number;
  /** Handed over minus reached the vault, from the first day of the month up to this day. */
  cashRunning: number;
  electronicRunning: number;
  mismatch: boolean;
}

const num = (value: unknown) => {
  const x = Number(value ?? 0);
  return Number.isFinite(x) ? x : 0;
};
/** The cash the accountant receives from a shift (as the shift handover page counts it). */
export const handedCash = (s: HandoverShift) => num(s.cash_handover ?? s.cash_sales);
export const handedElectronic = (s: HandoverShift) =>
  num(s.vodafone_sales) + num(s.insta_sales) + num(s.visa_sales);
const isElectronic = (t: AccountantTransaction) =>
  t.classification === 'تحصيل الكتروني' &&
  (ELECTRONIC_CATEGORIES as readonly string[]).includes(t.category_name ?? '');

/** One row per day of the month (up to `lastDay`) for the vaults chosen; each vault maps to its branch. */
export function compareShiftsWithLedger(
  transactions: AccountantTransaction[],
  shifts: HandoverShift[],
  vaults: string[],
  month: string,
  lastDay: string
): ComparisonDay[] {
  const branches = new Set(vaults.map((v) => VAULT_BRANCH[v]).filter(Boolean));
  const chosen = new Set(vaults.filter((v) => VAULT_BRANCH[v]));
  const days = new Map<string, ComparisonDay>();
  const dayOf = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = {
        date,
        shifts: [],
        shiftCash: 0,
        shiftElectronic: 0,
        ledgerCash: 0,
        ledgerElectronic: 0,
        cashDiff: 0,
        electronicDiff: 0,
        cashRunning: 0,
        electronicRunning: 0,
        mismatch: false,
      };
      days.set(date, d);
    }
    return d;
  };
  const end = `${month}-31` < lastDay ? `${month}-31` : lastDay;
  for (let day = `${month}-01`; day <= end; day = nextDay(day)) {
    if (!day.startsWith(month)) break;
    dayOf(day);
  }
  for (const s of shifts) {
    if (s.is_archived || !branches.has(s.branch) || !s.shift_date.startsWith(month)) continue;
    const d = dayOf(s.shift_date);
    d.shifts.push(s);
    d.shiftCash += handedCash(s);
    d.shiftElectronic += handedElectronic(s);
  }
  for (const t of transactions) {
    if (t.direction !== 'in' || !chosen.has(t.vault_code) || !t.date.startsWith(month)) continue;
    if (t.classification === 'مبيعات') dayOf(t.date).ledgerCash += num(t.amount);
    else if (isElectronic(t)) dayOf(t.date).ledgerElectronic += num(t.amount);
  }
  let cash = 0,
    electronic = 0;
  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      d.cashDiff = d.shiftCash - d.ledgerCash;
      d.electronicDiff = d.shiftElectronic - d.ledgerElectronic;
      cash += d.cashDiff;
      electronic += d.electronicDiff;
      d.cashRunning = cash;
      d.electronicRunning = electronic;
      d.mismatch =
        Math.abs(d.cashDiff) > MISMATCH_TOLERANCE ||
        Math.abs(d.electronicDiff) > MISMATCH_TOLERANCE;
      d.shifts.sort((a, b) => a.shift_type.localeCompare(b.shift_type, 'ar'));
      return d;
    });
}

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function comparisonTotals(days: ComparisonDay[]) {
  return days.reduce(
    (a, d) => ({
      shiftCash: a.shiftCash + d.shiftCash,
      ledgerCash: a.ledgerCash + d.ledgerCash,
      shiftElectronic: a.shiftElectronic + d.shiftElectronic,
      ledgerElectronic: a.ledgerElectronic + d.ledgerElectronic,
      shifts: a.shifts + d.shifts.length,
      mismatchDays: a.mismatchDays + (d.mismatch ? 1 : 0),
    }),
    {
      shiftCash: 0,
      ledgerCash: 0,
      shiftElectronic: 0,
      ledgerElectronic: 0,
      shifts: 0,
      mismatchDays: 0,
    }
  );
}

/** The month's handovers of the two branches (the same table the shift handover page reads). */
export async function loadMonthHandovers(month: string): Promise<HandoverShift[]> {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const all: HandoverShift[] = [];
  const PAGE = 500;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('shift_handovers')
      .select(
        'id, branch, shift_type, shift_date, submitted_by, cash_sales, cash_handover, visa_sales, insta_sales, vodafone_sales, is_archived'
      )
      .gte('shift_date', `${month}-01`)
      .lte('shift_date', last)
      .in('branch', Object.values(VAULT_BRANCH))
      .order('shift_date')
      .order('id')
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error('تعذّر تحميل تسليم الشيفتات');
    const page = (data || []) as HandoverShift[];
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return all;
}
