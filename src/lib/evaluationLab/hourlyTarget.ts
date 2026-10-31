import { normalizeBranchName } from '@/lib/branch';
import { LAB_THRESHOLDS } from './catalog';

// v6.6 hourly target (owner request 2026-10-31). Pure: no I/O.
//
// 1. The branch target is spread over every Cairo hour of the cycle by the previous cycle's sales
//    curve (weekday × hour, blended with the hour-only curve; branch totals only, so it does not
//    depend on who rang the invoices), and scaled to the doctors' share of the branch in this cycle
//    (sales by managers or purchasing are nobody's share; big invoices are capped). Over the whole
//    cycle the shift's achievement therefore equals the branch's.
// 2. Each hour's target belongs to the doctors on duty in that hour (punch in → out, or an own
//    invoice), split by their weight: a primary doctor carries more than a junior one.
// 3. A doctor's target is the sum of their part of the hours they worked; the shift's achievement
//    is read on the same hours, so overlapping shifts are handled hour by hour.

const HOUR = 36e5;
const branchKey = (value: string | null | undefined) => normalizeBranchName(value || '') || '';

const CAIRO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Cairo wall clock of an instant, as a UTC-based millisecond value (for hour arithmetic). */
export function cairoWallMs(iso: string): number | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const p = Object.fromEntries(CAIRO.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
}

/** `YYYY-MM-DD|HH` of a Cairo wall-clock millisecond value. */
const keyOfWall = (wall: number) => { const iso = new Date(wall).toISOString(); return `${iso.slice(0, 10)}|${iso.slice(11, 13)}`; };
export const cairoHourKey = (iso: string) => { const wall = cairoWallMs(iso); return wall === null ? null : keyOfWall(wall); };

export interface HourlyInvoice { staffId: string | null; branch: string | null; net: number; at?: string | null }
export interface HourlyAttendance { staffId: string; firstInAt?: string | null; lastOutAt?: string | null; scheduledEndAt?: string | null }

export interface HourlyInput {
  cycle: { start: string; endExclusive: string };
  targets: Array<{ branch: string; targetAmount: number }>;
  /** The previous cycle's invoices (the sales curve and the doctors' share). */
  previousInvoices: HourlyInvoice[];
  invoices: HourlyInvoice[];
  attendance: HourlyAttendance[];
  /** Doctors of the cycle, scored or not (someone who left keeps the hours they worked). */
  pool: Array<{ id: string; branch: string | null; weight: number }>;
}

export interface HourlyResult {
  hours: number;
  /** Own capped sales and the person's part of the hourly targets. */
  own: number;
  target: number;
  /** All doctors' capped sales and the full target, on the same hours. */
  teamSales: number;
  teamTarget: number;
  ownInvoices: number;
  expectedInvoices: number;
  /** Own invoices issued with no punch of the seller around them. */
  outsidePunch: number;
  cappedInvoices: number;
  /** Share of the home branch's invoices that carry their seller (below the minimum: not measurable). */
  sellerCoverage: number;
}

export interface HourlyOutput {
  people: Map<string, HourlyResult>;
  /** Per branch: invoices by a staff member with no punch around them, of invoices with a seller. */
  attribution: Map<string, { outside: number; total: number }>;
  /** Doctors' share of the branch sales in this cycle (after the cap). */
  doctorShare: Map<string, number>;
  /** Share of each branch's invoices that carry their seller. */
  sellerCoverage: Map<string, number>;
  /** null when the previous cycle has no dated invoices: the curve cannot be built. */
  ready: boolean;
}

export const capped = (net: number) => Math.min(net, LAB_THRESHOLDS.bigInvoiceCap);

/** Hours a punch covers: [in, out] (out = last punch, else scheduled end, else in + default shift). */
function punchWindow(day: HourlyAttendance): [number, number] | null {
  const from = day.firstInAt ? cairoWallMs(day.firstInAt) : null;
  if (from === null) return null;
  const out = (day.lastOutAt && cairoWallMs(day.lastOutAt)) || (day.scheduledEndAt && cairoWallMs(day.scheduledEndAt)) || null;
  const to = out !== null && out > from ? out : from + LAB_THRESHOLDS.defaultShiftHours * HOUR;
  return [from, Math.min(to, from + LAB_THRESHOLDS.maxShiftHours * HOUR)];
}

/** Hour keys a window covers by at least `minMinutes` (0: any overlap). */
function hoursOf([from, to]: [number, number], minMinutes: number): string[] {
  const keys: string[] = [];
  for (let start = Math.floor(from / HOUR) * HOUR; start < to; start += HOUR) {
    const overlap = (Math.min(to, start + HOUR) - Math.max(from, start)) / 6e4;
    if (overlap > 0 && overlap >= minMinutes) keys.push(keyOfWall(start));
  }
  return keys;
}

export function hourlyTargets(input: HourlyInput): HourlyOutput {
  const weightOf = new Map(input.pool.map((p) => [p.id, p.weight > 0 ? p.weight : 1]));
  const homeOf = new Map(input.pool.map((p) => [p.id, branchKey(p.branch)]));

  // 1) Sales curve of the previous cycle per branch: weekday × hour, and hour only.
  const curve = new Map<string, { wd: number[][]; hour: number[]; wdDays: number[]; days: number; total: number }>();
  const prevDays = new Map<string, Set<string>>();
  for (const invoice of input.previousInvoices) {
    const wall = invoice.at ? cairoWallMs(invoice.at) : null;
    if (wall === null) continue;
    const b = branchKey(invoice.branch);
    const c = curve.get(b) || { wd: Array.from({ length: 7 }, () => new Array(24).fill(0)), hour: new Array(24).fill(0), wdDays: new Array(7).fill(0), days: 0, total: 0 };
    const date = new Date(wall);
    c.wd[date.getUTCDay()][date.getUTCHours()] += invoice.net;
    c.hour[date.getUTCHours()] += invoice.net;
    c.total += invoice.net;
    curve.set(b, c);
    const seen = prevDays.get(b) || new Set<string>();
    prevDays.set(b, seen.add(date.toISOString().slice(0, 10)));
  }
  for (const [b, c] of curve) {
    for (const day of prevDays.get(b) || []) c.wdDays[new Date(`${day}T00:00:00Z`).getUTCDay()] += 1;
    c.days = prevDays.get(b)?.size || 0;
  }
  const expectedAt = (c: NonNullable<ReturnType<typeof curve.get>>, wd: number, hour: number) =>
    LAB_THRESHOLDS.curveWeekdayBlend * (c.wdDays[wd] ? c.wd[wd][hour] / c.wdDays[wd] : c.hour[hour] / Math.max(1, c.days))
    + (1 - LAB_THRESHOLDS.curveWeekdayBlend) * (c.hour[hour] / Math.max(1, c.days));

  // This cycle per branch: total sales, the doctors' capped sales, and invoices that carry a seller.
  const current = new Map<string, { total: number; doctors: number; invoices: number; withSeller: number }>();
  for (const invoice of input.invoices) {
    const b = branchKey(invoice.branch);
    const row = current.get(b) || { total: 0, doctors: 0, invoices: 0, withSeller: 0 };
    row.total += invoice.net;
    row.invoices += 1;
    if (invoice.staffId) row.withSeller += 1;
    if (invoice.staffId && weightOf.has(invoice.staffId)) row.doctors += capped(invoice.net);
    current.set(b, row);
  }
  const sellerCoverage = new Map([...current].map(([b, row]) => [b, row.invoices ? row.withSeller / row.invoices : 0]));

  // Target of every Cairo hour of the cycle, for the doctors of each branch.
  const hourTarget = new Map<string, number>();
  const doctorShare = new Map<string, number>();
  for (const t of input.targets) {
    const b = branchKey(t.branch);
    const c = curve.get(b);
    const now = current.get(b);
    if (!c || c.total <= 0 || !now || now.total <= 0) continue;
    // Without the seller on most invoices nobody's share can be read.
    if ((sellerCoverage.get(b) || 0) < LAB_THRESHOLDS.minSellerCoverage) continue;
    const share = Math.max(0, now.doctors / now.total);
    doctorShare.set(b, share);
    const cells: Array<[string, number]> = [];
    for (let day = Date.parse(`${input.cycle.start}T00:00:00Z`); day < Date.parse(`${input.cycle.endExclusive}T00:00:00Z`); day += 24 * HOUR) {
      const wd = new Date(day).getUTCDay();
      for (let h = 0; h < 24; h += 1) cells.push([keyOfWall(day + h * HOUR), Math.max(0, expectedAt(c, wd, h))]);
    }
    const sum = cells.reduce((s, [, v]) => s + v, 0);
    if (sum <= 0) continue;
    for (const [key, v] of cells) hourTarget.set(`${b}|${key}`, (hourTarget.get(`${b}|${key}`) || 0) + t.targetAmount * share * (v / sum));
  }

  // 2) Who was on duty in each hour, and every staff member's punched hours (for attribution).
  const punched = new Map<string, Set<string>>();
  const onDuty = new Map<string, Map<string, string>>();
  const duty = (id: string, key: string, branch: string) => {
    const hours = onDuty.get(id) || new Map<string, string>();
    if (!hours.has(key)) hours.set(key, branch);
    onDuty.set(id, hours);
  };
  for (const day of input.attendance) {
    const window = punchWindow(day);
    if (!window) continue;
    const grace = LAB_THRESHOLDS.punchGraceMinutes * 6e4;
    const set = punched.get(day.staffId) || new Set<string>();
    for (const key of hoursOf([window[0] - grace, window[1] + grace], 0)) set.add(key);
    punched.set(day.staffId, set);
    const home = homeOf.get(day.staffId);
    if (home !== undefined) for (const key of hoursOf(window, LAB_THRESHOLDS.presenceMinMinutes)) duty(day.staffId, key, home);
  }
  const keyed = input.invoices.map((invoice) => ({ ...invoice, key: invoice.at ? cairoHourKey(invoice.at) : null, b: branchKey(invoice.branch) }));
  // An own invoice proves presence: a missing punch never erases work.
  for (const invoice of keyed) if (invoice.key && invoice.staffId && homeOf.has(invoice.staffId)) duty(invoice.staffId, invoice.key, invoice.b);

  const weightOnDuty = new Map<string, number>();
  for (const [id, hours] of onDuty) for (const [key, b] of hours) weightOnDuty.set(`${b}|${key}`, (weightOnDuty.get(`${b}|${key}`) || 0) + (weightOf.get(id) || 1));

  // 3) Sales and invoice counts per hour: own, and all doctors of the branch.
  const ownSales = new Map<string, number>();
  const ownCount = new Map<string, number>();
  const teamSales = new Map<string, number>();
  const teamCount = new Map<string, number>();
  const attribution = new Map<string, { outside: number; total: number }>();
  const outside = new Map<string, number>();
  const cappedCount = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, value: number) => map.set(key, (map.get(key) || 0) + value);
  for (const invoice of keyed) {
    if (!invoice.key || !invoice.staffId) continue;
    const a = attribution.get(invoice.b) || { outside: 0, total: 0 };
    a.total += 1;
    const out = !punched.get(invoice.staffId)?.has(invoice.key);
    if (out) a.outside += 1;
    attribution.set(invoice.b, a);
    if (!homeOf.has(invoice.staffId)) continue;
    const value = capped(invoice.net);
    add(ownSales, `${invoice.staffId}|${invoice.key}`, value);
    add(teamSales, `${invoice.b}|${invoice.key}`, value);
    if (invoice.net > 0) {
      add(ownCount, `${invoice.staffId}|${invoice.key}`, 1);
      add(teamCount, `${invoice.b}|${invoice.key}`, 1);
    }
    if (out) add(outside, invoice.staffId, 1);
    if (invoice.net > LAB_THRESHOLDS.bigInvoiceCap) add(cappedCount, invoice.staffId, 1);
  }

  const people = new Map<string, HourlyResult>();
  for (const p of input.pool) {
    const weight = weightOf.get(p.id) || 1;
    const r: HourlyResult = { hours: 0, own: 0, target: 0, teamSales: 0, teamTarget: 0, ownInvoices: 0, expectedInvoices: 0, outsidePunch: outside.get(p.id) || 0, cappedInvoices: cappedCount.get(p.id) || 0,
      sellerCoverage: sellerCoverage.get(homeOf.get(p.id) || '') ?? 0 };
    for (const [key, b] of onDuty.get(p.id) || []) {
      const slot = `${b}|${key}`;
      const part = weight / (weightOnDuty.get(slot) || weight);
      r.hours += 1;
      r.target += (hourTarget.get(slot) || 0) * part;
      r.teamTarget += hourTarget.get(slot) || 0;
      r.teamSales += teamSales.get(slot) || 0;
      r.own += ownSales.get(`${p.id}|${key}`) || 0;
      r.ownInvoices += ownCount.get(`${p.id}|${key}`) || 0;
      r.expectedInvoices += (teamCount.get(slot) || 0) * part;
    }
    people.set(p.id, r);
  }
  return { people, attribution, doctorShare, sellerCoverage, ready: curve.size > 0 };
}
