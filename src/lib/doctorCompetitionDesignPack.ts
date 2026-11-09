import { normalizeBranchName } from '@/lib/branch';
import {
  getDoctorCompetitionMetrics,
  normalizeDoctorName,
  type DoctorCompetitionScore,
} from '@/lib/doctorCompetitionMetrics';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { supabase } from '@/lib/supabase';

export type DesignPackMode = 'day' | 'week' | 'cycle';

export interface PackSalesRow { day: string; branch: string; seller: string; staff_id: string | null; sales: number; invoices: number }
export interface PackHourRow { day: string; branch: string; hour: number; invoices: number }
export interface PackRequestRow { day: string; branch: string; staff_id: string | null; name: string | null; requests: number; fulfilled: number }
export interface PackFacts {
  sales: PackSalesRow[];
  hours: PackHourRow[];
  requests: PackRequestRow[];
  last_sale_date: string | null;
  last_import_at: string | null;
}
export interface PackWindow { start: string; end: string }
export interface PackWindows { current: PackWindow; previous: PackWindow; series: PackWindow }

/** A section is null when its source failed, so a design never prints an outage as a real zero. */
export interface PackMetricsInput {
  rows: DoctorCompetitionScore[];
  reviews: boolean;
  items: boolean;
  followups: boolean;
}

export interface PackDoctor {
  rank: number;
  name: string;
  sales: number;
  invoices: number;
  average_invoice: number;
  share_of_branch_percent: number;
  sales_change_percent: number | null;
  list_units: number | null;
  stagnant_units: number | null;
  review_average: number | null;
  review_count: number | null;
  customer_requests: number | null;
  requests_fulfilled: number | null;
  followups_completed: number | null;
  recovered_customers: number | null;
  competition_points: number | null;
}
export interface PackStar { title: string; name: string; value: string }
export interface PackDay { date: string; weekday: string; sales: number; invoices: number; average_invoice: number; top_doctor: string | null }
export interface PackBranch {
  branch: string;
  totals: {
    sales: number;
    invoices: number;
    average_invoice: number;
    sales_change_percent: number | null;
    average_change_percent: number | null;
    customer_requests: number;
    requests_fulfilled: number;
  };
  daily: PackDay[];
  best_day: PackDay | null;
  peak_hour: { hour: number; label: string; invoices: number } | null;
  doctors: PackDoctor[];
  stars: PackStar[];
  notes: string[];
}
export interface DesignPack {
  kind: 'dawaa_star_of_month_pack';
  version: 1;
  mode: DesignPackMode;
  mode_label: string;
  period: PackWindow;
  compared_with: PackWindow;
  generated_at: string;
  last_invoice_date: string | null;
  last_import_at: string | null;
  branches: PackBranch[];
}

const MODE_LABEL: Record<DesignPackMode, string> = { day: 'نجم اليوم', week: 'نجم الأسبوع', cycle: 'نجم الشهر' };
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const inWindow = (day: string, window: PackWindow) => day >= window.start && day <= window.end;
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const change = (now: number, before: number) => (before > 0 ? round(((now - before) / before) * 100, 1) : null);
const money = (value: number) => `${Math.round(value).toLocaleString('ar-EG')} ج`;
const signed = (value: number | null) =>
  value === null ? 'لا توجد فترة للمقارنة' : `${value >= 0 ? '▲ +' : '▼ '}${value.toLocaleString('ar-EG')}%`;

/** Current period, the like-for-like period before it, and the days drawn in the daily comparison. */
export function designPackWindows(mode: DesignPackMode, anchor: string): PackWindows {
  let current: PackWindow;
  let previous: PackWindow;
  if (mode === 'day') {
    current = { start: anchor, end: anchor };
    previous = { start: addDays(anchor, -1), end: addDays(anchor, -1) };
  } else if (mode === 'week') {
    current = { start: addDays(anchor, -6), end: anchor };
    previous = { start: addDays(anchor, -13), end: addDays(anchor, -7) };
  } else {
    const start = getPharmacyCycleRange(`${anchor}T12:00:00`).start;
    const previousStart = getPharmacyCycleRange(`${addDays(start, -1)}T12:00:00`).start;
    current = { start, end: anchor };
    previous = { start: previousStart, end: addDays(previousStart, dayDiff(start, anchor)) };
  }
  return { current, previous, series: { start: mode === 'cycle' ? current.start : addDays(anchor, -6), end: anchor } };
}

const hourLabel = (hour: number) => {
  const twelve = hour % 12 || 12;
  return `${twelve.toLocaleString('ar-EG')} ${hour < 12 ? 'صباحًا' : 'مساءً'}`;
};

function bestBy<T>(items: T[], score: (item: T) => number | null): T | null {
  let best: T | null = null;
  let top = 0;
  for (const item of items) {
    const value = score(item);
    if (value !== null && value > top) {
      top = value;
      best = item;
    }
  }
  return best;
}

interface Tally { key: string; name: string; staffId: string | null; sales: number; invoices: number }

function tallyDoctors(rows: PackSalesRow[], keyOf: (row: PackSalesRow) => string) {
  const map = new Map<string, Tally>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = map.get(key) || { key, name: row.seller.trim(), staffId: row.staff_id, sales: 0, invoices: 0 };
    current.sales += Number(row.sales) || 0;
    current.invoices += Number(row.invoices) || 0;
    map.set(key, current);
  }
  return map;
}

function buildBranch(
  branch: string,
  facts: PackFacts,
  windows: PackWindows,
  metrics: PackMetricsInput | null,
  eligibleStaffIds: Set<string>,
): PackBranch {
  const belongs = (value: string) => (normalizeBranchName(value) || value) === branch;
  // Same rule as the competition list: a linked seller must be an eligible doctor.
  const sales = facts.sales.filter(
    (row) => belongs(row.branch) && (!row.staff_id || eligibleStaffIds.has(String(row.staff_id))),
  );

  // One seller can appear linked on some invoices and not others; the name decides who is the same person.
  const staffByName = new Map<string, string>();
  sales.forEach((row) => {
    if (row.staff_id) staffByName.set(normalizeDoctorName(row.seller), row.staff_id);
  });
  const keyOf = (row: PackSalesRow) =>
    row.staff_id || staffByName.get(normalizeDoctorName(row.seller)) || `name:${normalizeDoctorName(row.seller)}`;

  const current = tallyDoctors(sales.filter((row) => inWindow(row.day, windows.current)), keyOf);
  const previous = tallyDoctors(sales.filter((row) => inWindow(row.day, windows.previous)), keyOf);
  const sum = (map: Map<string, Tally>, field: 'sales' | 'invoices') =>
    [...map.values()].reduce((total, row) => total + row[field], 0);
  const totalSales = sum(current, 'sales');
  const totalInvoices = sum(current, 'invoices');
  const previousSales = sum(previous, 'sales');
  const previousInvoices = sum(previous, 'invoices');

  const requests = facts.requests.filter((row) => belongs(row.branch) && inWindow(row.day, windows.current));
  const requestsByStaff = new Map<string, { requests: number; fulfilled: number }>();
  requests.forEach((row) => {
    if (!row.staff_id) return;
    const entry = requestsByStaff.get(row.staff_id) || { requests: 0, fulfilled: 0 };
    entry.requests += Number(row.requests) || 0;
    entry.fulfilled += Number(row.fulfilled) || 0;
    requestsByStaff.set(row.staff_id, entry);
  });

  const scoreRows = (metrics?.rows || []).filter((row) => belongs(row.branch));
  const scoreFor = (tally: Tally) =>
    scoreRows.find((row) => tally.staffId && row.staffId === tally.staffId) ||
    scoreRows.find((row) => normalizeDoctorName(row.name) === normalizeDoctorName(tally.name)) ||
    null;

  const doctors: PackDoctor[] = [...current.values()]
    .sort((a, b) => b.sales - a.sales)
    .map((tally, index) => {
      const score = scoreFor(tally);
      const before = previous.get(tally.key);
      const staffRequests = tally.staffId ? requestsByStaff.get(tally.staffId) : undefined;
      return {
        rank: index + 1,
        name: tally.name,
        sales: round(tally.sales),
        invoices: tally.invoices,
        average_invoice: tally.invoices ? round(tally.sales / tally.invoices) : 0,
        share_of_branch_percent: totalSales ? round((tally.sales / totalSales) * 100, 1) : 0,
        sales_change_percent: before ? change(tally.sales, before.sales) : null,
        list_units: metrics?.items && score ? score.listItems : null,
        stagnant_units: metrics?.items && score ? score.stagnantItems : null,
        review_average: metrics?.reviews && score?.reviewCount ? round(score.reviewTotal / score.reviewCount, 1) : null,
        review_count: metrics?.reviews && score ? score.reviewCount : null,
        customer_requests: tally.staffId ? staffRequests?.requests ?? 0 : null,
        requests_fulfilled: tally.staffId ? staffRequests?.fulfilled ?? 0 : null,
        followups_completed: metrics?.followups && score ? score.completedFollowups : null,
        recovered_customers: metrics?.followups && score ? score.recoveredCustomers : null,
        competition_points: score ? score.competitionPoints : null,
      };
    });

  const daily: PackDay[] = [];
  for (let day = windows.series.start; day <= windows.series.end; day = addDays(day, 1)) {
    const rows = sales.filter((row) => row.day === day);
    const daySales = rows.reduce((total, row) => total + (Number(row.sales) || 0), 0);
    const dayInvoices = rows.reduce((total, row) => total + (Number(row.invoices) || 0), 0);
    const top = bestBy([...tallyDoctors(rows, keyOf).values()], (row) => row.sales);
    daily.push({
      date: day,
      weekday: WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()],
      sales: round(daySales),
      invoices: dayInvoices,
      average_invoice: dayInvoices ? round(daySales / dayInvoices) : 0,
      top_doctor: top?.name ?? null,
    });
  }

  const hourTotals = new Map<number, number>();
  facts.hours
    .filter((row) => belongs(row.branch) && inWindow(row.day, windows.current))
    .forEach((row) => hourTotals.set(row.hour, (hourTotals.get(row.hour) || 0) + (Number(row.invoices) || 0)));
  const peak = bestBy([...hourTotals.entries()], ([, invoices]) => invoices);

  const star = (title: string, winner: PackDoctor | null, value: (doctor: PackDoctor) => string): PackStar[] =>
    winner ? [{ title, name: winner.name, value: value(winner) }] : [];
  const stars = [
    ...star('نجم الفترة', bestBy(doctors, (d) => d.competition_points), (d) => `${(d.competition_points ?? 0).toLocaleString('ar-EG')} نقطة`),
    ...star('الأعلى مبيعًا', bestBy(doctors, (d) => d.sales), (d) => money(d.sales)),
    ...star('أعلى متوسط فاتورة', bestBy(doctors, (d) => (d.invoices >= 5 ? d.average_invoice : null)), (d) => money(d.average_invoice)),
    ...star('الأكتر فواتير', bestBy(doctors, (d) => d.invoices), (d) => `${d.invoices.toLocaleString('ar-EG')} فاتورة`),
    ...star('أكبر قفزة', bestBy(doctors, (d) => d.sales_change_percent), (d) => signed(d.sales_change_percent)),
    ...star('بطل اللستة', bestBy(doctors, (d) => d.list_units), (d) => `${(d.list_units ?? 0).toLocaleString('ar-EG')} وحدة`),
    ...star('بطل الرواكد', bestBy(doctors, (d) => d.stagnant_units), (d) => `${(d.stagnant_units ?? 0).toLocaleString('ar-EG')} وحدة`),
    ...star('أفضل تقييم', bestBy(doctors, (d) => ((d.review_count ?? 0) >= 3 ? d.review_average : null)), (d) => `${(d.review_average ?? 0).toLocaleString('ar-EG')}/١٠٠`),
    ...star('بطل طلبات العملاء', bestBy(doctors, (d) => d.customer_requests), (d) => `${(d.customer_requests ?? 0).toLocaleString('ar-EG')} طلب`),
    ...star('بطل المتابعات', bestBy(doctors, (d) => d.followups_completed), (d) => `${(d.followups_completed ?? 0).toLocaleString('ar-EG')} متابعة`),
  ];

  const notes: string[] = [];
  if (!totalInvoices) notes.push('مفيش فواتير مرفوعة للفرع ده في الفترة دي.');
  if (!metrics) {
    notes.push('تعذر تحميل نقاط المسابقة والتقييمات واللستة، فمش موجودة في الملف.');
  } else {
    if (!metrics.reviews) notes.push('مفيش تقييمات محادثات متاحة للفترة دي.');
    if (!metrics.items) notes.push('حوافز اللستة والرواكد مش متاحة للفترة دي.');
    if (!metrics.followups) notes.push('مفيش متابعات مسجلة للفترة دي، فمتتحسبش صفر على حد.');
  }
  const unlinked = [...current.values()].filter((row) => !row.staffId).map((row) => row.name);
  if (unlinked.length) notes.push(`بائعين لسه مش مربوطين بموظف (طلبات العملاء مش محسوبة لهم): ${unlinked.join('، ')}.`);

  return {
    branch,
    totals: {
      sales: round(totalSales),
      invoices: totalInvoices,
      average_invoice: totalInvoices ? round(totalSales / totalInvoices) : 0,
      sales_change_percent: change(totalSales, previousSales),
      average_change_percent:
        totalInvoices && previousInvoices ? change(totalSales / totalInvoices, previousSales / previousInvoices) : null,
      customer_requests: requests.reduce((total, row) => total + (Number(row.requests) || 0), 0),
      requests_fulfilled: requests.reduce((total, row) => total + (Number(row.fulfilled) || 0), 0),
    },
    daily,
    best_day: bestBy(daily, (day) => day.sales),
    peak_hour: peak ? { hour: peak[0], label: hourLabel(peak[0]), invoices: peak[1] } : null,
    doctors,
    stars,
    notes,
  };
}

export function buildDesignPack(input: {
  mode: DesignPackMode;
  windows: PackWindows;
  facts: PackFacts;
  metrics: PackMetricsInput | null;
  eligibleStaffIds: Set<string>;
  branches: readonly string[];
  generatedAt: string;
}): DesignPack {
  const { mode, windows, facts, metrics, eligibleStaffIds, branches, generatedAt } = input;
  return {
    kind: 'dawaa_star_of_month_pack',
    version: 1,
    mode,
    mode_label: MODE_LABEL[mode],
    period: windows.current,
    compared_with: windows.previous,
    generated_at: generatedAt,
    last_invoice_date: facts.last_sale_date,
    last_import_at: facts.last_import_at,
    branches: branches.map((branch) => buildBranch(branch, facts, windows, metrics, eligibleStaffIds)),
  };
}

/** The ready-to-send text for one branch. Unavailable figures are left out, never written as 0. */
export function buildBranchMessage(pack: DesignPack, branch: PackBranch): string {
  const period = pack.period.start === pack.period.end ? pack.period.end : `${pack.period.start} إلى ${pack.period.end}`;
  const { totals } = branch;
  const lines = [
    `🏆 ${pack.mode_label} — ${branch.branch}`,
    `📅 ${period}`,
    '',
    `💰 مبيعات الفرع: ${money(totals.sales)} (${signed(totals.sales_change_percent)})`,
    `🧾 الفواتير: ${totals.invoices.toLocaleString('ar-EG')}`,
    `📈 متوسط الفاتورة: ${money(totals.average_invoice)} (${signed(totals.average_change_percent)})`,
    `🙋 طلبات العملاء: ${totals.customer_requests.toLocaleString('ar-EG')} (اتوفر منها ${totals.requests_fulfilled.toLocaleString('ar-EG')})`,
  ];
  if (branch.peak_hour) lines.push(`⏰ ساعة الذروة: ${branch.peak_hour.label}`);
  if (branch.best_day) lines.push(`🔥 أقوى يوم: ${branch.best_day.weekday} ${branch.best_day.date} — ${money(branch.best_day.sales)}`);
  if (branch.stars.length) {
    lines.push('', '⭐ النجوم');
    branch.stars.forEach((item) => lines.push(`• ${item.title}: ${item.name} — ${item.value}`));
  }
  if (branch.doctors.length) {
    lines.push('', '📊 الترتيب');
    branch.doctors.forEach((doctor) => {
      const movement = doctor.sales_change_percent === null ? '' : ` | ${signed(doctor.sales_change_percent)}`;
      lines.push(`${doctor.rank.toLocaleString('ar-EG')}. ${doctor.name}: ${money(doctor.sales)} | ${doctor.invoices.toLocaleString('ar-EG')} فاتورة | متوسط ${money(doctor.average_invoice)}${movement}`);
    });
  }
  lines.push('', '📆 المقارنة اليومية');
  branch.daily.forEach((day) => {
    if (!day.invoices) {
      lines.push(`${day.weekday} ${day.date.slice(5)}: مفيش فواتير مرفوعة`);
      return;
    }
    const top = day.top_doctor ? ` | الأول: ${day.top_doctor}` : '';
    lines.push(`${day.weekday} ${day.date.slice(5)}: ${money(day.sales)} | ${day.invoices.toLocaleString('ar-EG')} فاتورة${top}`);
  });
  if (branch.notes.length) {
    lines.push('', '⚠️ ملاحظات على البيانات');
    branch.notes.forEach((note) => lines.push(`• ${note}`));
  }
  return lines.join('\n');
}

export function buildPackMessage(pack: DesignPack): string {
  const body = pack.branches.map((branch) => buildBranchMessage(pack, branch)).join('\n\n━━━━━━━━━━\n\n');
  return `${body}\n\nصمملي من الملف ده تصميم قوي لكل فرع لمسابقة ${pack.mode_label}.`;
}

export async function loadDesignPack(params: {
  mode: DesignPackMode;
  anchor: string;
  branches: readonly string[];
  /** The one branch asked for, or null for all of them. */
  branch: string | null;
  userBranch?: string | null;
}): Promise<DesignPack> {
  const windows = designPackWindows(params.mode, params.anchor);
  const start = windows.previous.start < windows.series.start ? windows.previous.start : windows.series.start;

  const [factsResult, eligibleResult, metricsResult] = await Promise.all([
    supabase.rpc('get_doctor_competition_design_pack_v1', { p_start: start, p_end: windows.current.end, p_branch: params.branch }),
    supabase.rpc('get_eligible_doctor_staff_ids'),
    getDoctorCompetitionMetrics({
      period: 'custom',
      customStart: windows.current.start,
      customEnd: windows.current.end,
      branch: params.branch || 'كل الفروع',
      userBranch: params.userBranch,
      canSeeAllBranches: true,
      includeActiveRoster: true,
    }).catch(() => null),
  ]);
  if (factsResult.error) throw factsResult.error;
  if (eligibleResult.error) throw eligibleResult.error;

  return buildDesignPack({
    mode: params.mode,
    windows,
    facts: factsResult.data as PackFacts,
    metrics: metricsResult
      ? {
          rows: metricsResult.rows,
          reviews: metricsResult.metadata.hasReviewData,
          items: metricsResult.sourceHealth.invoice_item_incentives === 'ready',
          followups: metricsResult.metadata.hasFollowupData,
        }
      : null,
    eligibleStaffIds: new Set((eligibleResult.data || []).map((row: { staff_id: string }) => String(row.staff_id))),
    branches: params.branches,
    generatedAt: new Date().toISOString(),
  });
}
