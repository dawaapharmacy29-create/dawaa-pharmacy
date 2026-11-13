import { normalizeBranchName } from '@/lib/branch';
import {
  getDoctorCompetitionMetrics,
  normalizeDoctorName,
  type DoctorCompetitionScore,
} from '@/lib/doctorCompetitionMetrics';
import { getPharmacyCycleRange } from '@/lib/pharmacy-cycle';
import { supabase } from '@/lib/supabase';
import {
  DEFAULT_BRANCH_REQUEST_TARGET,
  loadFollowupRequestCounts,
  loadFollowupRequestTargets,
  type FollowupRequestCount,
} from '@/lib/followupRequests/followupRequestService';
import {
  DAILY_FULL_AT_DAYS,
  loadScorecardFacts,
  SCORE_CRITERIA,
  SCORE_LABELS,
  SCORE_WEIGHTS,
  scoreBranchDoctors,
  type ScoreCriterion,
  type ScoreInput,
  type ScorecardFacts,
} from '@/lib/doctorCompetitionScorecard';

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

export interface PackAttendance {
  shift_days: number;
  on_time_days: number;
  late_days: number;
  late_minutes: number;
  early_leave_days: number;
  absence_days: number;
  under_review_days: number;
}

export interface PackDoctor {
  /** Place in the competition (by points). */
  rank: number;
  /** Place by sales alone. */
  sales_rank: number;
  /** The linked staff account; null for a seller not linked to one yet. */
  staff_id: string | null;
  name: string;
  sales: number;
  invoices: number;
  average_invoice: number;
  share_of_branch_percent: number;
  sales_change_percent: number | null;
  /** Sales in the comparison period; null when the doctor sold nothing then. */
  previous_sales: number | null;
  /** Days with at least one invoice. */
  selling_days: number;
  /** Attendance shifts when recorded, else selling days. */
  working_days: number;
  /** Sales per working day. */
  daily_average: number;
  list_units: number | null;
  /** The money the list lines brought in; null when the source is unavailable. */
  list_value: number | null;
  list_incentive: number | null;
  list_products: number | null;
  stagnant_units: number | null;
  stagnant_value: number | null;
  /** This doctor's share of the branch follow-up target (cycle only). */
  followup_target: number | null;
  attendance: PackAttendance | null;
  commitment_percent: number | null;
  /** Points per criterion out of its weight; null parts were left out. */
  score_parts: Record<ScoreCriterion, number | null> | null;
  review_average: number | null;
  review_count: number | null;
  customer_requests: number | null;
  requests_fulfilled: number | null;
  followups_completed: number | null;
  recovered_customers: number | null;
  competition_points: number | null;
  followup_requests: number | null;
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
    followup_requests: number | null;
    followup_requests_target: number;
    selling_days: number;
    daily_average: number;
    daily_invoices: number;
    list_value: number | null;
    list_incentive: number | null;
    list_units: number | null;
    late_days: number | null;
    absence_days: number | null;
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
  /** 2: points come from the eight-criterion scorecard, scored inside each branch. */
  version: 2;
  mode: DesignPackMode;
  mode_label: string;
  /** How the points are made, so a design can explain them. */
  scoring: { criterion: ScoreCriterion; label: string; weight: number }[];
  period: PackWindow;
  compared_with: PackWindow;
  generated_at: string;
  last_invoice_date: string | null;
  last_import_at: string | null;
  branches: PackBranch[];
}

const MODE_LABEL: Record<DesignPackMode, string> = { day: 'نجم اليوم', week: 'نجم الأسبوع', cycle: 'نجم الشهر' };
const FOLLOWUP_LABEL: Record<DesignPackMode, string> = { day: 'في اليوم', week: 'في الأسبوع', cycle: 'في الدورة' };
/** "Biggest jump" needs the doctor's last-period sales to be at least this share of the branch's. */
export const JUMP_MIN_BASE_SHARE = 0.05;
/** The attendance star needs at least this many shifts. */
export const MIN_SHIFTS_FOR_COMMITMENT_STAR = 8;
const WEEKDAYS =['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

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

function tallyDoctors(rows: PackSalesRow[], keyOf: (row: PackSalesRow) => string, nameOf: (key: string) => string) {
  const map = new Map<string, Tally>();
  for (const row of rows) {
    const key = keyOf(row);
    const current = map.get(key) || { key, name: nameOf(key), staffId: row.staff_id, sales: 0, invoices: 0 };
    if (!current.staffId && row.staff_id) current.staffId = row.staff_id;
    current.sales += Number(row.sales) || 0;
    current.invoices += Number(row.invoices) || 0;
    map.set(key, current);
  }
  return map;
}

function buildBranch(
  branch: string,
  mode: DesignPackMode,
  facts: PackFacts,
  windows: PackWindows,
  metrics: PackMetricsInput | null,
  scorecard: ScorecardFacts | null,
  eligibleStaffIds: Set<string>,
  followupRequests: FollowupRequestCount[] | null,
  followupTarget: number,
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

  // The same person is typed differently on different invoices ("د دنيا" / "د دنيا الخولي"):
  // the fullest spelling becomes their one name in the ranking, the stars and the daily table.
  const nameByKey = new Map<string, string>();
  sales.forEach((row) => {
    const key = keyOf(row);
    const name = row.seller.trim().replace(/\s+/g, ' ');
    const kept = nameByKey.get(key);
    if (!kept || name.length > kept.length || (name.length === kept.length && name < kept)) nameByKey.set(key, name);
  });
  const nameOf = (key: string) => nameByKey.get(key) || key;

  const current = tallyDoctors(sales.filter((row) => inWindow(row.day, windows.current)), keyOf, nameOf);
  const previous = tallyDoctors(sales.filter((row) => inWindow(row.day, windows.previous)), keyOf, nameOf);
  const sum = (map: Map<string, Tally>, field: 'sales' | 'invoices') =>
    [...map.values()].reduce((total, row) => total + row[field], 0);
  const totalSales = sum(current, 'sales');
  const totalInvoices = sum(current, 'invoices');
  const previousSales = sum(previous, 'sales');
  const previousInvoices = sum(previous, 'invoices');
  const sellingDays = new Set(
    sales.filter((row) => inWindow(row.day, windows.current) && (Number(row.invoices) || 0) > 0).map((row) => row.day),
  ).size;

  // Customer requests: credited to the doctor who recorded them (scorecard facts). Without them,
  // the older source credits the branch's responsible person and is used only as a fallback.
  const requestsByStaff = new Map<string, { requests: number; fulfilled: number }>();
  let branchRequests = 0;
  let branchFulfilled = 0;
  const addRequests = (staffId: string | null, requests: number, fulfilled: number) => {
    branchRequests += requests;
    branchFulfilled += fulfilled;
    if (!staffId) return;
    const entry = requestsByStaff.get(staffId) || { requests: 0, fulfilled: 0 };
    entry.requests += requests;
    entry.fulfilled += fulfilled;
    requestsByStaff.set(staffId, entry);
  };
  if (scorecard) {
    scorecard.requests.filter((row) => belongs(row.branch)).forEach((row) => addRequests(row.staffId, row.requests, row.fulfilled));
  } else {
    facts.requests
      .filter((row) => belongs(row.branch) && inWindow(row.day, windows.current))
      .forEach((row) => addRequests(row.staff_id, Number(row.requests) || 0, Number(row.fulfilled) || 0));
  }

  const scoreRows = (metrics?.rows || []).filter((row) => belongs(row.branch));
  const scoreFor = (tally: Tally) =>
    scoreRows.find((row) => tally.staffId && row.staffId === tally.staffId) ||
    scoreRows.find((row) => normalizeDoctorName(row.name) === normalizeDoctorName(tally.name)) ||
    null;

  // Follow-up requests: the scorecard credits each day's requests to the branch the doctor worked in
  // that day. The fallback credits the doctor's home branch only, so nobody is counted twice.
  const followupRows: { staffId: string; branch: string; requests: number }[] | null = scorecard
    ? scorecard.followups
    : followupRequests;
  const requestsOf = (staffId: string) =>
    (followupRows || [])
      .filter((row) => row.staffId === staffId && belongs(row.branch))
      .reduce((total, row) => total + row.requests, 0);
  const branchFollowupRequests = followupRows === null
    ? null
    : followupRows.filter((row) => belongs(row.branch)).reduce((total, row) => total + row.requests, 0);

  const listOf = (staffId: string | null) =>
    scorecard && staffId ? scorecard.list.find((row) => row.staffId === staffId && belongs(row.branch)) ?? null : null;
  const attendanceOf = (staffId: string | null) =>
    scorecard?.attendance && staffId ? scorecard.attendance.find((row) => row.staffId === staffId) ?? null : null;
  const sellingDaysOf = (key: string) =>
    new Set(sales.filter((row) => inWindow(row.day, windows.current) && keyOf(row) === key && (Number(row.invoices) || 0) > 0).map((row) => row.day)).size;

  const tallies = [...current.values()];
  const inputs: ScoreInput[] = tallies.map((tally) => {
    const list = listOf(tally.staffId);
    const attendance = attendanceOf(tally.staffId);
    return {
      key: tally.key,
      sales: tally.sales,
      invoices: tally.invoices,
      sellingDays: sellingDaysOf(tally.key),
      listIncentive: scorecard ? (list?.listIncentive ?? 0) : null,
      followupRequests: followupRows === null ? null : tally.staffId ? requestsOf(tally.staffId) : 0,
      customerRequests: tally.staffId ? requestsByStaff.get(tally.staffId)?.requests ?? 0 : 0,
      attendance: attendance && attendance.shiftDays + attendance.absenceDays > 0 ? attendance : null,
    };
  });
  // The follow-up target is set per cycle; a day or a week is measured against the branch's best instead.
  const results = new Map(scoreBranchDoctors(inputs, mode === 'cycle' ? followupTarget : null).map((result) => [result.key, result]));
  const salesRank = new Map([...tallies].sort((a, b) => b.sales - a.sales).map((tally, index) => [tally.key, index + 1]));

  const doctors: PackDoctor[] = tallies
    .sort((a, b) => (results.get(b.key)?.total ?? 0) - (results.get(a.key)?.total ?? 0) || b.sales - a.sales)
    .map((tally, index) => {
      const score = scoreFor(tally);
      const result = results.get(tally.key);
      const input = inputs.find((row) => row.key === tally.key);
      const list = listOf(tally.staffId);
      const attendance = input?.attendance ?? null;
      const before = previous.get(tally.key);
      const staffRequests = tally.staffId ? requestsByStaff.get(tally.staffId) : undefined;
      return {
        rank: index + 1,
        sales_rank: salesRank.get(tally.key) ?? index + 1,
        staff_id: tally.staffId,
        name: tally.name,
        sales: round(tally.sales),
        invoices: tally.invoices,
        average_invoice: tally.invoices ? round(tally.sales / tally.invoices) : 0,
        share_of_branch_percent: totalSales ? round((tally.sales / totalSales) * 100, 1) : 0,
        sales_change_percent: before ? change(tally.sales, before.sales) : null,
        previous_sales: before ? round(before.sales) : null,
        selling_days: input?.sellingDays ?? 0,
        working_days: result?.workingDays ?? 0,
        daily_average: result?.dailyAverage ?? 0,
        list_units: list ? list.listUnits : scorecard ? 0 : metrics?.items && score ? score.listItems : null,
        list_value: scorecard ? round(list?.listValue ?? 0) : null,
        list_incentive: scorecard ? round(list?.listIncentive ?? 0) : null,
        list_products: scorecard ? list?.listProducts ?? 0 : null,
        stagnant_units: list ? list.stagnantUnits : scorecard ? 0 : metrics?.items && score ? score.stagnantItems : null,
        stagnant_value: scorecard ? round(list?.stagnantValue ?? 0) : null,
        review_average: metrics?.reviews && score?.reviewCount ? round(score.reviewTotal / score.reviewCount, 1) : null,
        review_count: metrics?.reviews && score ? score.reviewCount : null,
        customer_requests: tally.staffId ? staffRequests?.requests ?? 0 : null,
        requests_fulfilled: tally.staffId ? staffRequests?.fulfilled ?? 0 : null,
        followups_completed: metrics?.followups && score ? score.completedFollowups : null,
        recovered_customers: metrics?.followups && score ? score.recoveredCustomers : null,
        followup_requests: followupRows === null || !tally.staffId ? null : requestsOf(tally.staffId),
        followup_target: result?.followupTarget ?? null,
        attendance: attendance
          ? {
              shift_days: attendance.shiftDays,
              on_time_days: attendance.onTimeDays,
              late_days: attendance.lateDays,
              late_minutes: attendance.lateMinutes,
              early_leave_days: attendance.earlyLeaveDays,
              absence_days: attendance.absenceDays,
              under_review_days: attendance.underReviewDays,
            }
          : null,
        commitment_percent: result?.commitmentPercent ?? null,
        competition_points: result ? result.total : null,
        score_parts: result ? result.parts : null,
      };
    });

  const daily: PackDay[] = [];
  for (let day = windows.series.start; day <= windows.series.end; day = addDays(day, 1)) {
    const rows = sales.filter((row) => row.day === day);
    const daySales = rows.reduce((total, row) => total + (Number(row.sales) || 0), 0);
    const dayInvoices = rows.reduce((total, row) => total + (Number(row.invoices) || 0), 0);
    const top = bestBy([...tallyDoctors(rows, keyOf, nameOf).values()], (row) => row.sales);
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

  // A jump from a tiny base (a doctor who barely sold last period) is not a real jump.
  const hasJumpBase = (doctor: PackDoctor) =>
    doctor.previous_sales !== null && previousSales > 0 && doctor.previous_sales >= previousSales * JUMP_MIN_BASE_SHARE;
  const star = (title: string, winner: PackDoctor | null, value: (doctor: PackDoctor) => string): PackStar[] =>
    winner ? [{ title, name: winner.name, value: value(winner) }] : [];
  const stars = [
    ...star('نجم الفترة', bestBy(doctors, (d) => d.competition_points), (d) => `${(d.competition_points ?? 0).toLocaleString('ar-EG')} نقطة`),
    ...star('الأعلى مبيعًا', bestBy(doctors, (d) => d.sales), (d) => money(d.sales)),
    ...star('أعلى متوسط يومي', bestBy(doctors, (d) => (d.working_days >= DAILY_FULL_AT_DAYS ? d.daily_average : null)), (d) => `${money(d.daily_average)} في اليوم`),
    ...star('أعلى متوسط فاتورة', bestBy(doctors, (d) => (d.invoices >= 5 ? d.average_invoice : null)), (d) => money(d.average_invoice)),
    ...star('الأكتر فواتير', bestBy(doctors, (d) => d.invoices), (d) => `${d.invoices.toLocaleString('ar-EG')} فاتورة`),
    ...star('أكبر قفزة', bestBy(doctors, (d) => (hasJumpBase(d) ? d.sales_change_percent : null)), (d) => signed(d.sales_change_percent)),
    // The list is won on the incentive it earned; the units and what they sold for are shown beside it.
    ...(scorecard
      ? star('بطل اللستة', bestBy(doctors, (d) => d.list_incentive), (d) => `حافز ${money(d.list_incentive ?? 0)} · ${(d.list_units ?? 0).toLocaleString('ar-EG')} وحدة`)
      : star('بطل اللستة', bestBy(doctors, (d) => d.list_units), (d) => `${(d.list_units ?? 0).toLocaleString('ar-EG')} وحدة`)),
    ...star('بطل الرواكد', bestBy(doctors, (d) => d.stagnant_units), (d) => `${(d.stagnant_units ?? 0).toLocaleString('ar-EG')} وحدة`),
    ...star('أفضل تقييم', bestBy(doctors, (d) => ((d.review_count ?? 0) >= 3 ? d.review_average : null)), (d) => `${(d.review_average ?? 0).toLocaleString('ar-EG')}/١٠٠`),
    ...star('بطل طلبات العملاء', bestBy(doctors, (d) => d.customer_requests), (d) => `${(d.customer_requests ?? 0).toLocaleString('ar-EG')} طلب`),
    ...star('بطل طلبات المتابعة', bestBy(doctors, (d) => d.followup_requests), (d) => `${(d.followup_requests ?? 0).toLocaleString('ar-EG')} طلب`),
    ...star('الأكتر التزامًا بالحضور', bestBy(doctors, (d) => ((d.attendance?.shift_days ?? 0) >= MIN_SHIFTS_FOR_COMMITMENT_STAR ? d.commitment_percent : null)), (d) => `${(d.commitment_percent ?? 0).toLocaleString('ar-EG')}% · ${(d.attendance?.shift_days ?? 0).toLocaleString('ar-EG')} شيفت`),
  ];

  const notes: string[] = [];
  if (!totalInvoices) notes.push('مفيش فواتير مرفوعة للفرع ده في الفترة دي.');
  if (!metrics) {
    notes.push('تعذر تحميل نقاط المسابقة والتقييمات واللستة، فمش موجودة في الملف.');
  } else {
    if (!metrics.reviews) notes.push('مفيش تقييمات محادثات متاحة للفترة دي.');
    if (!metrics.items) notes.push('حوافز اللستة والرواكد مش متاحة للفترة دي.');
  }
  if (followupRows === null) notes.push('تعذر تحميل طلبات المتابعة، فمش موجودة في الملف.');
  if (!scorecard) {
    notes.push('تفاصيل المسابقة الجديدة (حافز اللستة والحضور وطلبات العملاء لكل دكتور) مش متاحة، فالنقط محسوبة من غيرها.');
  } else if (scorecard.attendance === null) {
    notes.push('الحضور مش ظاهر لحسابك، فالنقط محسوبة من غير الالتزام بالحضور.');
  } else {
    const missing = doctors.filter((d) => d.attendance === null).map((d) => d.name);
    if (missing.length) notes.push(`مفيش حضور متسجل لـ: ${missing.join('، ')} — النقط اتحسبت لهم من غير الحضور.`);
    const reviewDays = doctors.reduce((total, d) => total + (d.attendance?.under_review_days ?? 0), 0);
    if (reviewDays) notes.push(`${reviewDays.toLocaleString('ar-EG')} يوم حضور لسه تحت المراجعة ومش محسوبين في الالتزام.`);
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
      customer_requests: branchRequests,
      requests_fulfilled: branchFulfilled,
      followup_requests: branchFollowupRequests,
      followup_requests_target: followupTarget,
      selling_days: sellingDays,
      daily_average: sellingDays ? round(totalSales / sellingDays) : 0,
      daily_invoices: sellingDays ? round(totalInvoices / sellingDays, 1) : 0,
      list_value: scorecard ? round(doctors.reduce((total, d) => total + (d.list_value ?? 0), 0)) : null,
      list_incentive: scorecard ? round(doctors.reduce((total, d) => total + (d.list_incentive ?? 0), 0)) : null,
      list_units: scorecard ? round(doctors.reduce((total, d) => total + (d.list_units ?? 0), 0)) : null,
      late_days: scorecard?.attendance ? doctors.reduce((total, d) => total + (d.attendance?.late_days ?? 0), 0) : null,
      absence_days: scorecard?.attendance ? doctors.reduce((total, d) => total + (d.attendance?.absence_days ?? 0), 0) : null,
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
  /** null: the scorecard facts function is unavailable; the pack falls back to the older sources. */
  scorecard?: ScorecardFacts | null;
  eligibleStaffIds: Set<string>;
  followupRequests: FollowupRequestCount[] | null;
  followupTargets: Map<string, number>;
  branches: readonly string[];
  generatedAt: string;
}): DesignPack {
  const { mode, windows, facts, metrics, eligibleStaffIds, followupRequests, followupTargets, branches, generatedAt } = input;
  const scorecard = input.scorecard ?? null;
  return {
    kind: 'dawaa_star_of_month_pack',
    version: 2,
    mode,
    mode_label: MODE_LABEL[mode],
    scoring: SCORE_CRITERIA.map((criterion) => ({ criterion, label: SCORE_LABELS[criterion], weight: SCORE_WEIGHTS[criterion] })),
    period: windows.current,
    compared_with: windows.previous,
    generated_at: generatedAt,
    last_invoice_date: facts.last_sale_date,
    last_import_at: facts.last_import_at,
    branches: branches.map((branch) => buildBranch(branch, mode, facts, windows, metrics, scorecard, eligibleStaffIds, followupRequests, followupTargets.get(branch) ?? DEFAULT_BRANCH_REQUEST_TARGET)),
  };
}

/** One line of a doctor's other figures; parts that are unavailable are left out. */
function doctorDetails(doctor: PackDoctor): string {
  const parts: string[] = [];
  if (doctor.working_days > 0) parts.push(`متوسط اليوم ${money(doctor.daily_average)}`);
  if (doctor.list_value !== null) {
    parts.push(`حافز لستة ${money(doctor.list_incentive ?? 0)} (${(doctor.list_units ?? 0).toLocaleString('ar-EG')} وحدة بـ ${money(doctor.list_value)})`);
  } else if (doctor.list_units !== null) {
    parts.push(`لستة ${doctor.list_units.toLocaleString('ar-EG')} وحدة`);
  }
  if (doctor.followup_requests !== null) {
    const target = doctor.followup_target ? ` من ${doctor.followup_target.toLocaleString('ar-EG')}` : '';
    parts.push(`متابعات ${doctor.followup_requests.toLocaleString('ar-EG')}${target}`);
  }
  if (doctor.customer_requests !== null) parts.push(`طلبات عملاء ${doctor.customer_requests.toLocaleString('ar-EG')}`);
  if (doctor.attendance && doctor.commitment_percent !== null) {
    parts.push(`التزام ${doctor.commitment_percent.toLocaleString('ar-EG')}% (${doctor.attendance.late_days.toLocaleString('ar-EG')} تأخير من ${doctor.attendance.shift_days.toLocaleString('ar-EG')} شيفت)`);
  }
  return parts.join(' | ');
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
  ];
  if (totals.selling_days > 1) {
    lines.push(`📅 متوسط اليوم: ${money(totals.daily_average)} | ${totals.daily_invoices.toLocaleString('ar-EG')} فاتورة في اليوم (${totals.selling_days.toLocaleString('ar-EG')} يوم بيع)`);
  }
  lines.push(`🙋 طلبات العملاء: ${totals.customer_requests.toLocaleString('ar-EG')} (اتوفر منها ${totals.requests_fulfilled.toLocaleString('ar-EG')})`);
  if (totals.list_value !== null) {
    lines.push(`💊 حافز اللستة: ${money(totals.list_incentive ?? 0)} | ${(totals.list_units ?? 0).toLocaleString('ar-EG')} وحدة بـ ${money(totals.list_value)}`);
  }
  if (totals.late_days !== null) {
    lines.push(`🕘 الحضور: ${totals.late_days.toLocaleString('ar-EG')} يوم تأخير | ${(totals.absence_days ?? 0).toLocaleString('ar-EG')} غياب`);
  }
  if (totals.followup_requests !== null) {
    // The target is set per cycle, so only the cycle view is measured against it.
    const target = pack.mode === 'cycle' ? ` من ${totals.followup_requests_target.toLocaleString('ar-EG')}` : '';
    lines.push(`📝 طلبات المتابعة ${FOLLOWUP_LABEL[pack.mode]}: ${totals.followup_requests.toLocaleString('ar-EG')}${target}`);
  }
  if (branch.peak_hour) lines.push(`⏰ ساعة الذروة: ${branch.peak_hour.label}`);
  if (branch.best_day) lines.push(`🔥 أقوى يوم: ${branch.best_day.weekday} ${branch.best_day.date} — ${money(branch.best_day.sales)}`);
  if (branch.stars.length) {
    lines.push('', '⭐ النجوم');
    branch.stars.forEach((item) => lines.push(`• ${item.title}: ${item.name} — ${item.value}`));
  }
  if (branch.doctors.length) {
    lines.push('', '📊 ترتيب المسابقة (من ١٠٠ نقطة)');
    branch.doctors.forEach((doctor) => {
      const points = doctor.competition_points === null ? '' : `${doctor.competition_points.toLocaleString('ar-EG')} نقطة | `;
      const movement = doctor.sales_change_percent === null ? '' : ` | ${signed(doctor.sales_change_percent)}`;
      lines.push(`${doctor.rank.toLocaleString('ar-EG')}. ${doctor.name}: ${points}${money(doctor.sales)} | ${doctor.invoices.toLocaleString('ar-EG')} فاتورة | متوسط ${money(doctor.average_invoice)}${movement}`);
      const details = doctorDetails(doctor);
      if (details) lines.push(`   ${details}`);
    });
    lines.push('', `🧮 النقط: ${pack.scoring.map((item) => `${item.label} ${item.weight.toLocaleString('ar-EG')}`).join(' · ')}`);
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

  const [factsResult, eligibleResult, metricsResult, followupRequests, followupTargets, scorecard] = await Promise.all([
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
    // Same days as every other figure in the pack (a day, a week or the running cycle).
    loadFollowupRequestCounts(windows.current.start, windows.current.end).catch(() => null),
    loadFollowupRequestTargets().catch(() => new Map<string, number>()),
    // Until the scorecard migration is applied this fails, and the pack says so in its notes.
    loadScorecardFacts(windows.current.start, windows.current.end).catch(() => null),
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
    scorecard,
    eligibleStaffIds: new Set((eligibleResult.data || []).map((row: { staff_id: string }) => String(row.staff_id))),
    followupRequests,
    followupTargets,
    branches: params.branches,
    generatedAt: new Date().toISOString(),
  });
}
