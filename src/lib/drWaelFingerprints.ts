import { supabase } from '@/lib/supabase';
import { matchesAppSearch } from '@/lib/appSearch';
import { cairoDayOf } from '@/lib/time/cairoDateBoundary';

// «بصمات د وائل» (migration 20261103150000): the views of the Base44 fingerprint app (fingdawaa) fed from this
// app's attendance days, punches, schedules, time off and incentive ledgers for شكري / الشامي / المخزن.
// Salaries come from employee_payroll_financial_composition_current_v1; nothing is recomputed here.

export interface DrWaelScheduleDay {
  date: string;
  start: string | null;
  end: string | null;
  off: boolean;
  scheduled: boolean;
}

export interface DrWaelEmployee {
  staff_id: string;
  name: string;
  branch: string;
  role: string | null;
  type: string | null;
  active: boolean;
  delivery: boolean;
  roaming?: boolean;
  join_date: string | null;
  week: DrWaelScheduleDay[];
  /** staff.status, e.g. «نشط» / «موقوف» / «قيد المغادرة» (migration 20261104220000). */
  status?: string | null;
  /** From the active flexible hour rule: joker / part_time / flexible; null = regular schedule. */
  work_mode?: 'joker' | 'part_time' | 'flexible' | null;
  /** His last punch on any device, ever. */
  last_punch?: string | null;
}

export interface DrWaelDay {
  staff_id: string;
  date: string;
  branch: string;
  first_in: string | null;
  last_out: string | null;
  hours: number | null;
  payable_hours: number | null;
  late_minutes: number;
  early_leave_minutes: number;
  missing_punch: boolean;
  status: string;
  resolution: string | null;
  review: boolean;
  scheduled_start: string | null;
  scheduled_end: string | null;
  time_off: boolean;
  punches: number;
  /** The other branch(es) whose device he punched on that day (migration 20261104190000); null when only his own. */
  other_branch?: string | null;
}

export interface DrWaelTimeOff {
  id: string;
  staff_id: string;
  kind: string;
  label: string | null;
  status: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  minutes: number | null;
  reason: string | null;
  decided_by: string | null;
}

export interface DrWaelIncentive {
  staff_id: string;
  performance_incentive: number;
  target_bonus: number;
  automated_total: number;
}

export interface DrWaelMovement {
  id: string;
  staff_id: string;
  type: string;
  category: string | null;
  reason: string | null;
  amount: number;
  date: string;
  status: string;
}

export interface DrWaelManualEntry {
  id: string;
  staff_id: string;
  kind: 'earning' | 'deduction' | 'adjustment' | string;
  category: string;
  amount: number;
  signed_amount: number;
  reason: string | null;
  reversal_of: string | null;
  created_at: string;
  created_by: string | null;
}

export interface DrWaelFingerprints {
  month_cycle: string;
  cycle_start: string;
  cycle_end: string;
  today: string;
  branches: string[];
  employees: DrWaelEmployee[];
  days: DrWaelDay[];
  time_off: DrWaelTimeOff[];
  incentives: DrWaelIncentive[];
  movements: DrWaelMovement[];
  manual_entries: DrWaelManualEntry[];
}

export interface DrWaelPunch {
  staff_id: string | null;
  name: string | null;
  branch: string | null;
  biometric_user_id: string | null;
  punch_time: string;
  punch_type: string | null;
  device_id: string | null;
  provider?: string | null;
  event_id?: string;
  interpreted_type?: string | null;
  interpretation_status?: string | null;
  interpretation_reason?: string | null;
}

export async function fetchDrWaelFingerprints(
  monthCycle?: string | null
): Promise<DrWaelFingerprints> {
  const { data, error } = await supabase.rpc('get_dr_wael_fingerprints_v1', {
    p_month_cycle: monthCycle || null,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('dr_wael_fingerprints_unavailable');
  return data as DrWaelFingerprints;
}

export async function fetchDrWaelDayPunches(date: string): Promise<DrWaelPunch[]> {
  const { data, error } = await supabase.rpc('get_dr_wael_day_punches_v1', { p_date: date });
  if (error) throw new Error(error.message);
  const punches = (data as { punches?: unknown } | null)?.punches;
  if (!Array.isArray(punches)) throw new Error('dr_wael_day_punches_unavailable');
  return punches as DrWaelPunch[];
}

// Smart insights (migration 20261103190000): what the last two weeks of punches say about each employee.
export interface DrWaelShiftSuggestion {
  start: string;
  end: string;
  since: string;
  days: number;
  sample: Array<{
    date: string;
    first_in: string;
    last_out: string;
    scheduled_start: string | null;
    scheduled_end: string | null;
  }>;
}

export interface DrWaelInsight {
  staff_id: string;
  branch: string;
  roaming: boolean;
  shift: DrWaelShiftSuggestion | null;
  device_branches: Record<string, number> | null;
  device_branch: string | null;
  today_branch: string | null;
  branch_suggestion: string | null;
}

export type DrWaelShiftMode = 'permanent' | 'day' | 'period';

export const WEEK_DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

export async function fetchDrWaelSmartInsights(): Promise<DrWaelInsight[]> {
  const { data, error } = await supabase.rpc('get_dr_wael_smart_insights_v1');
  if (error) throw new Error(error.message);
  const employees = (data as { employees?: unknown } | null)?.employees;
  if (!Array.isArray(employees)) throw new Error('dr_wael_insights_unavailable');
  return employees as DrWaelInsight[];
}

export async function applyDrWaelShiftChange(args: {
  staffId: string;
  start: string;
  end: string;
  mode: DrWaelShiftMode;
  from: string;
  to?: string | null;
  days?: string[] | null;
  note?: string | null;
  origin?: ShiftOrigin | null;
}): Promise<{ rows_written: number; days_rebuilt: number; days_kept_manager_approved: number }> {
  const { data, error } = await supabase.rpc('dr_wael_apply_shift_change_v1', {
    p_staff_id: args.staffId,
    p_start: args.start,
    p_end: args.end,
    p_mode: args.mode,
    p_from: args.from,
    p_to: args.to || null,
    p_days: args.days && args.days.length ? args.days : null,
    p_note: args.note || null,
    p_origin: args.origin || null,
  });
  if (error) throw new Error(error.message);
  return data as { rows_written: number; days_rebuilt: number; days_kept_manager_approved: number };
}

export async function applyDrWaelBranchChange(staffId: string, branch: string): Promise<void> {
  const { error } = await supabase.rpc('dr_wael_apply_branch_change_v1', {
    p_staff_id: staffId,
    p_branch: branch,
  });
  if (error) throw new Error(error.message);
}

export async function setDrWaelRoaming(staffId: string, roaming: boolean): Promise<void> {
  const { error } = await supabase.rpc('dr_wael_set_roaming_v1', {
    p_staff_id: staffId,
    p_roaming: roaming,
  });
  if (error) throw new Error(error.message);
}

// Working days of the week the page shows (Saturday first), from the employee's last 7 resolved days.
export function workingWeekDays(week: DrWaelScheduleDay[]): string[] {
  const names = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const working = new Set(
    week
      .filter((day) => !day.off)
      .map((day) => names[new Date(`${day.date}T12:00:00Z`).getUTCDay()])
  );
  return WEEK_DAYS.filter((day) => working.has(day));
}

const MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

// The pay cycle runs 26 → 25 and is named after the month it ends in.
export function shiftCycle(cycle: string, months: number): string {
  const [year, month] = cycle.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function cycleLabel(cycle: string): string {
  const [year, month] = cycle.split('-').map(Number);
  const previous = shiftCycle(cycle, -1);
  const previousMonth = Number(previous.slice(5, 7));
  return `26 ${MONTHS[previousMonth - 1]} – 25 ${MONTHS[month - 1]} ${year}`;
}

export function cairoTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Cairo',
  });
}

export function minutesLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}س ${String(m).padStart(2, '0')}د` : `${m}د`;
}

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round2 = (value: number) => Math.round(value * 100) / 100;

export type DayKind = 'present' | 'late' | 'review' | 'absent' | 'off' | 'time_off' | 'other';

// How a resolved attendance day reads in the Base44 layout. The resolution itself is the attendance
// engine's (attendance_daily_summary); this only names it.
export function dayKind(day: DrWaelDay): DayKind {
  const resolution = String(day.resolution || '');
  if (day.review) return 'review';
  if (day.time_off || resolution.includes('time_off') || resolution.includes('leave'))
    return 'time_off';
  if (resolution === 'off_day') return 'off';
  if (resolution.includes('absence') || resolution === 'employment_ended') return 'absent';
  if (day.late_minutes > 0 || resolution.includes('late')) return 'late';
  if (num(day.hours) > 0 || day.first_in) return 'present';
  return 'other';
}

export const DAY_KIND_LABELS: Record<DayKind, string> = {
  present: 'حاضر',
  late: 'متأخر',
  review: 'يحتاج مراجعة',
  absent: 'غياب',
  off: 'راحة',
  time_off: 'إجازة / إذن',
  other: 'أخرى',
};

export interface EmployeeAttendanceSummary {
  staffId: string;
  days: number;
  workedDays: number;
  hours: number;
  payableHours: number;
  lateDays: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  reviewDays: number;
  singlePunchDays: number;
  absentDays: number;
  offDays: number;
  timeOffDays: number;
}

export function summarizeEmployee(staffId: string, days: DrWaelDay[]): EmployeeAttendanceSummary {
  const own = days.filter((day) => day.staff_id === staffId);
  const summary: EmployeeAttendanceSummary = {
    staffId,
    days: own.length,
    workedDays: 0,
    hours: 0,
    payableHours: 0,
    lateDays: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    reviewDays: 0,
    singlePunchDays: 0,
    absentDays: 0,
    offDays: 0,
    timeOffDays: 0,
  };
  for (const day of own) {
    const kind = dayKind(day);
    if (num(day.hours) > 0) summary.workedDays += 1;
    summary.hours += num(day.hours);
    summary.payableHours += num(day.payable_hours);
    summary.lateMinutes += num(day.late_minutes);
    summary.earlyLeaveMinutes += num(day.early_leave_minutes);
    if (num(day.late_minutes) > 0) summary.lateDays += 1;
    if (kind === 'review') summary.reviewDays += 1;
    if (day.missing_punch && day.punches === 1) summary.singlePunchDays += 1;
    if (kind === 'absent') summary.absentDays += 1;
    if (kind === 'off') summary.offDays += 1;
    if (kind === 'time_off') summary.timeOffDays += 1;
  }
  summary.hours = round2(summary.hours);
  summary.payableHours = round2(summary.payableHours);
  return summary;
}

export interface BranchToday {
  branch: string;
  employees: number;
  present: number;
  late: number;
  review: number;
  absent: number;
  off: number;
}

// The dashboard of the Base44 app: who came in today, per branch.
export function todayByBranch(
  data: Pick<DrWaelFingerprints, 'branches' | 'employees' | 'days'>,
  today: string
): BranchToday[] {
  return data.branches.map((branch) => {
    const todays = data.days.filter((day) => day.date === today && day.branch === branch);
    const count = (kind: DayKind) => todays.filter((day) => dayKind(day) === kind).length;
    return {
      branch,
      employees: data.employees.filter((employee) => employee.active && employee.branch === branch)
        .length,
      present: todays.filter((day) => Boolean(day.first_in)).length,
      late: count('late'),
      review: count('review'),
      absent: count('absent'),
      off: count('off') + count('time_off'),
    };
  });
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

// «الحاضرون الآن»: a check-in today or last night with no check-out yet.
export function openShifts(days: DrWaelDay[], today: string): DrWaelDay[] {
  const dates = new Set([today, addDays(today, -1)]);
  return days
    .filter((day) => dates.has(day.date) && day.first_in && !day.last_out)
    .sort((a, b) => Date.parse(a.first_in || '') - Date.parse(b.first_in || ''));
}

// «يحتاج مراجعة — آخر 5 أيام»: the days before today that are late, early, absent or still under review.
export function recentExceptions(
  days: DrWaelDay[],
  today: string,
  count = 5
): Array<{ date: string; days: DrWaelDay[] }> {
  return Array.from({ length: count }, (_, i) => addDays(today, -(i + 1))).map((date) => ({
    date,
    days: days.filter((day) => {
      const kind = dayKind(day);
      return (
        day.date === date &&
        (kind === 'review' || kind === 'late' || kind === 'absent' || day.early_leave_minutes > 0)
      );
    }),
  }));
}

export interface WorkSession {
  start: string;
  end: string | null;
  minutes: number;
}

export interface WorkDayRow {
  key: string;
  staffId: string | null;
  name: string;
  branch: string | null;
  punches: string[];
  events: DrWaelPunch[];
  sessions: WorkSession[];
  grossMinutes: number;
  workMinutes: number;
  breakMinutes: number;
  singlePunch: boolean;
  unpaired: boolean;
}

// The Base44 «يوم العمل» view: punches in order, paired into sessions (in → out). A lone last punch is an
// open session to review; one punch only is «بصمة واحدة فقط». This is a reading aid for the day —
// attendance and payroll keep using the resolved days.
export function workDayRows(punches: DrWaelPunch[]): WorkDayRow[] {
  const groups = new Map<string, DrWaelPunch[]>();
  for (const punch of punches) {
    const key =
      punch.staff_id ||
      `code:${JSON.stringify([
        punch.provider,
        punch.device_id,
        punch.biometric_user_id || punch.event_id,
      ])}`;
    groups.set(key, [...(groups.get(key) || []), punch]);
  }
  const rows: WorkDayRow[] = [];
  for (const [key, list] of groups) {
    const times = list
      .map((punch) => punch.punch_time)
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    const sessions: WorkSession[] = [];
    for (let i = 0; i < times.length; i += 2) {
      const start = times[i];
      const end = times[i + 1] ?? null;
      sessions.push({
        start,
        end,
        minutes: end ? Math.max(0, (Date.parse(end) - Date.parse(start)) / 60000) : 0,
      });
    }
    const workMinutes = Math.round(sessions.reduce((sum, session) => sum + session.minutes, 0));
    const grossMinutes =
      times.length > 1
        ? Math.round((Date.parse(times[times.length - 1]) - Date.parse(times[0])) / 60000)
        : 0;
    rows.push({
      key,
      staffId: list[0].staff_id,
      name: list[0].name || `كود بصمة ${list[0].biometric_user_id || '?'}`,
      branch: list[0].branch,
      punches: times,
      events: list,
      sessions,
      grossMinutes,
      workMinutes,
      breakMinutes: Math.max(0, grossMinutes - workMinutes),
      singlePunch: times.length === 1,
      unpaired: times.length % 2 === 1,
    });
  }
  return rows.sort(
    (a, b) =>
      (a.branch || '').localeCompare(b.branch || '', 'ar') || a.name.localeCompare(b.name, 'ar')
  );
}

export interface EmployeeMoney {
  automatedIncentives: number;
  performanceIncentive: number;
  targetBonus: number;
  rewards: number;
  penalties: number;
  manualEarnings: number;
  manualDeductions: number;
  manualNet: number;
}

// The incentive and deduction ledgers of one employee for the cycle, read as they are.
export function employeeMoney(
  staffId: string,
  data: Pick<DrWaelFingerprints, 'incentives' | 'movements' | 'manual_entries'>
): EmployeeMoney {
  const truth = data.incentives.find((row) => row.staff_id === staffId);
  const moves = data.movements.filter((row) => row.staff_id === staffId);
  const manual = data.manual_entries.filter((row) => row.staff_id === staffId);
  return {
    automatedIncentives: num(truth?.automated_total),
    performanceIncentive: num(truth?.performance_incentive),
    targetBonus: num(truth?.target_bonus),
    rewards: round2(
      moves.filter((row) => row.type === 'reward').reduce((sum, row) => sum + num(row.amount), 0)
    ),
    penalties: round2(
      moves.filter((row) => row.type === 'penalty').reduce((sum, row) => sum + num(row.amount), 0)
    ),
    manualEarnings: round2(
      manual
        .filter((row) => num(row.signed_amount) > 0)
        .reduce((sum, row) => sum + num(row.signed_amount), 0)
    ),
    manualDeductions: round2(
      -manual
        .filter((row) => num(row.signed_amount) < 0)
        .reduce((sum, row) => sum + num(row.signed_amount), 0)
    ),
    manualNet: round2(manual.reduce((sum, row) => sum + num(row.signed_amount), 0)),
  };
}

export function isTodayInCycle(
  data: Pick<DrWaelFingerprints, 'today' | 'cycle_start' | 'cycle_end'>
): boolean {
  return data.today >= data.cycle_start && data.today <= data.cycle_end;
}

// Runs the per-employee payroll reads a few at a time so the page never fires dozens of heavy calls at once.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Salaries of named managers outside the three attendance branches (migration 20261103220000).
export type DrWaelPayrollStaff = Pick<
  DrWaelEmployee,
  'staff_id' | 'name' | 'branch' | 'role' | 'active'
>;

export async function fetchDrWaelPayrollExtra(): Promise<DrWaelPayrollStaff[]> {
  const { data, error } = await supabase.rpc('get_dr_wael_payroll_extra_v1');
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error('dr_wael_payroll_extra_unavailable');
  return data as DrWaelPayrollStaff[];
}

/** The page's active employees, then the extra payroll staff that are not already listed. */
export function payrollStaff(
  employees: DrWaelPayrollStaff[],
  extra: DrWaelPayrollStaff[]
): DrWaelPayrollStaff[] {
  const listed = new Set(employees.map((e) => e.staff_id));
  return [
    ...employees.filter((e) => e.active),
    ...extra.filter((e) => e.active && !listed.has(e.staff_id)),
  ];
}

// Leave for a period / ending a leave on the return day (migration 20261104170000).
export type DrWaelLeaveKind =
  | 'approved_absence'
  | 'annual_leave'
  | 'sick_leave'
  | 'exceptional_leave';

export async function setDrWaelLeave(args: {
  staffId: string;
  kind: DrWaelLeaveKind;
  from: string;
  to: string;
  reason?: string | null;
}): Promise<{ request_id: string; from: string; to: string }> {
  const { data, error } = await supabase.rpc('dr_wael_set_leave_v1', {
    p_staff_id: args.staffId,
    p_kind: args.kind,
    p_from: args.from,
    p_to: args.to,
    p_reason: args.reason || null,
  });
  if (error) throw new Error(error.message);
  return data as { request_id: string; from: string; to: string };
}

export async function endDrWaelLeave(
  requestId: string,
  returnDate: string,
  note?: string | null
): Promise<{ cancelled: boolean; days_rebuilt: number; days_kept_manager_approved: number }> {
  const { data, error } = await supabase.rpc('dr_wael_end_leave_v1', {
    p_request_id: requestId,
    p_return_date: returnDate,
    p_note: note || null,
  });
  if (error) throw new Error(error.message);
  return data as { cancelled: boolean; days_rebuilt: number; days_kept_manager_approved: number };
}

/** A leave still running on (or after) a day: approved, a full-day kind, ending on or after it. */
export function runningLeaves(
  rows: DrWaelTimeOff[],
  staffId: string,
  today: string
): DrWaelTimeOff[] {
  return rows.filter(
    (row) =>
      row.staff_id === staffId &&
      row.status === 'approved' &&
      row.kind !== 'permission' &&
      row.kind !== 'shift_swap' &&
      row.end_date >= today
  );
}

/** «9999-12-31» is how an open-ended leave («لحد ما يرجع») is stored. */
export const isOpenEnded = (endDate: string) => endDate >= '9000-01-01';

export interface PresentNow {
  staffId: string;
  name: string;
  /** The device branch of his last check-in (may differ from his own branch). */
  punchBranch: string | null;
  since: string;
}

const punchKind = (punch: DrWaelPunch): 'check_in' | 'check_out' | null => {
  const value = String(punch.interpreted_type || punch.punch_type || '').toLowerCase();
  if (value === 'check_in' || value === 'in') return 'check_in';
  if (value === 'check_out' || value === 'out') return 'check_out';
  return null;
};

// «الحاضرون الآن» straight from the punches of last night and today: the employee's last punch is a check-in made in
// the last `maxHours`. The resolved days are built only after the shift ends, so they cannot answer «who is in now».
export function presentNow(
  punches: DrWaelPunch[],
  now: Date = new Date(),
  maxHours = 16
): PresentNow[] {
  const byStaff = new Map<string, DrWaelPunch[]>();
  for (const punch of punches) {
    if (!punch.staff_id || punch.interpretation_status === 'rejected') continue;
    byStaff.set(punch.staff_id, [...(byStaff.get(punch.staff_id) || []), punch]);
  }
  const limit = now.getTime() - maxHours * 3600_000;
  const rows: PresentNow[] = [];
  for (const [staffId, list] of byStaff) {
    const sorted = [...new Map(list.map((p) => [p.event_id || p.punch_time, p])).values()].sort(
      (a, b) => Date.parse(a.punch_time) - Date.parse(b.punch_time)
    );
    const last = sorted[sorted.length - 1];
    if (!last || punchKind(last) !== 'check_in' || Date.parse(last.punch_time) < limit) continue;
    // The open session starts at the first check-in after the last check-out.
    let start = sorted.length - 1;
    while (
      start > 0 &&
      punchKind(sorted[start - 1]) === 'check_in' &&
      Date.parse(sorted[start - 1].punch_time) >= limit
    )
      start -= 1;
    rows.push({
      staffId,
      name: last.name || '—',
      punchBranch: last.branch,
      since: sorted[start].punch_time,
    });
  }
  return rows.sort((a, b) => Date.parse(a.since) - Date.parse(b.since));
}

// «ترك عمل» and «نظام الشغل» (migration 20261104220000).
export type DrWaelSeparationKind = 'resignation' | 'termination' | 'contract_end' | 'other';

/** One tap: the employee leaves after `lastDay`. Days up to it stay for payroll; empty days after it are closed. */
export async function endDrWaelEmployment(args: {
  staffId: string;
  lastDay: string;
  kind: DrWaelSeparationKind;
  note?: string | null;
}): Promise<{ last_day: string; archived: boolean; days_closed: number }> {
  const { data, error } = await supabase.rpc('dr_wael_end_employment_v1', {
    p_staff_id: args.staffId,
    p_last_day: args.lastDay,
    p_kind: args.kind,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return data as { last_day: string; archived: boolean; days_closed: number };
}

export type DrWaelWorkMode = 'regular' | 'part_time' | 'joker';

export const WORK_MODE_LABELS: Record<DrWaelWorkMode, string> = {
  regular: 'عادي',
  part_time: 'بارت تايم',
  joker: 'جوكر',
};

/** The chip to light: a flexible rule set elsewhere (no part-time / joker note) has no chip of its own. */
export function employeeWorkMode(
  employee: Pick<DrWaelEmployee, 'work_mode'>
): DrWaelWorkMode | null {
  if (employee.work_mode === 'joker' || employee.work_mode === 'part_time')
    return employee.work_mode;
  return employee.work_mode === 'flexible' ? null : 'regular';
}

/** Part-time and joker are paid by actual hours; a joker's punches count in any branch. */
export async function setDrWaelWorkMode(
  staffId: string,
  mode: DrWaelWorkMode
): Promise<{ days_rebuilt: number; days_kept_manager_approved: number }> {
  const { data, error } = await supabase.rpc('dr_wael_set_work_mode_v1', {
    p_staff_id: staffId,
    p_mode: mode,
  });
  if (error) throw new Error(error.message);
  return data as { days_rebuilt: number; days_kept_manager_approved: number };
}

export interface IdleEmployee {
  employee: DrWaelEmployee;
  /** Cairo day of his last punch, null when he never punched. */
  lastPunchDay: string | null;
  /** Days since that punch (null when never). */
  daysAway: number | null;
  stopped: boolean;
}

/**
 * «موظفين مش بيحضروا»: active employees marked «موقوف», or whose last punch is `minDays` days old or more.
 * Someone on a running leave, already leaving, part-time / joker / flexible (no fixed days) is left out.
 */
export function idleEmployees(
  employees: DrWaelEmployee[],
  timeOff: DrWaelTimeOff[],
  today: string,
  minDays = 5
): IdleEmployee[] {
  const rows: IdleEmployee[] = [];
  for (const employee of employees) {
    if (!employee.active) continue;
    const status = String(employee.status || '').trim();
    if (status === 'قيد المغادرة') continue;
    const stopped = status === 'موقوف';
    if (!stopped && employee.work_mode) continue;
    // Before migration 20261104220000 the field is missing: nothing to judge by.
    if (!stopped && employee.last_punch === undefined) continue;
    if (runningLeaves(timeOff, employee.staff_id, today).some((leave) => leave.start_date <= today))
      continue;
    const lastPunchDay = employee.last_punch ? cairoDayOf(employee.last_punch) : null;
    const daysAway = lastPunchDay
      ? Math.round(
          (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastPunchDay}T12:00:00Z`)) / 864e5
        )
      : null;
    if (!stopped && daysAway != null && daysAway < minDays) continue;
    if (
      !stopped &&
      daysAway == null &&
      (!employee.join_date || employee.join_date > addDays(today, -minDays))
    )
      continue;
    rows.push({ employee, lastPunchDay, daysAway, stopped });
  }
  return rows.sort(
    (a, b) => Number(b.stopped) - Number(a.stopped) || (b.daysAway ?? 9999) - (a.daysAway ?? 9999)
  );
}

// One-click decisions next to a day waiting for review (migration 20261105230000,
// dr_wael_quick_day_decision_v1). The server re-checks the day and refuses anything that needs the
// detailed review; the buttons only offer what fits the day's state.
export type QuickDayDecision = 'to_shift_end' | 'from_shift_start' | 'absent' | 'off' | 'as_is';

export interface QuickDayOption {
  decision: QuickDayDecision;
  label: string;
  tone: 'primary' | 'danger' | 'neutral';
}

export function quickDayOptions(day: DrWaelDay): QuickDayOption[] {
  if (!day.review || day.status === 'approved') return [];
  const noPunch = !day.first_in && !day.last_out;
  switch (day.resolution) {
    case 'missing_checkout':
      return day.first_in && day.scheduled_end
        ? [
            {
              decision: 'to_shift_end',
              label: `انصرف على الميعاد (${cairoTime(day.scheduled_end)})`,
              tone: 'primary',
            },
          ]
        : [];
    case 'missing_checkin':
      return day.last_out && day.scheduled_start
        ? [
            {
              decision: 'from_shift_start',
              label: `حضر على الميعاد (${cairoTime(day.scheduled_start)})`,
              tone: 'primary',
            },
          ]
        : [];
    case 'absence_review':
      return noPunch
        ? [
            { decision: 'absent', label: 'غياب', tone: 'danger' },
            { decision: 'off', label: 'أوف / بإذن', tone: 'neutral' },
          ]
        : [];
    case 'no_schedule':
    case 'off_day':
    case 'approved_time_off':
      return noPunch ? [{ decision: 'as_is', label: 'أوف — اعتمد', tone: 'neutral' }] : [];
    case 'late':
    case 'early_leave_review':
      return day.first_in && day.last_out
        ? [
            {
              decision: 'as_is',
              label: `اعتمد اللي اشتغله (${minutesLabel(Number(day.hours || 0) * 60)})`,
              tone: 'primary',
            },
          ]
        : [];
    default:
      return [];
  }
}

const QUICK_ERRORS: Array<[string, string]> = [
  ['quick_decision_needs_details', 'اليوم ده محتاج المراجعة التفصيلية'],
  ['not_authorized', 'مالكش صلاحية تعتمد اليوم ده'],
  ['invalid_or_expired_staff_session', 'الجلسة خلصت، ادخل تاني'],
  ['cycle_locked', 'الدورة دي اتقفلت في المرتبات'],
  ['permission denied for function', 'القرار السريع مش متاح لحسابك دلوقتي — كلم الإدارة'],
  ['attendance_resolution_not_finalizable_yet', 'اليوم لسه ما خلصش — استنى لحد آخر الشيفت'],
  ['missing_punch_truth_mismatch', 'البصمات اتغيرت — حدّث الصفحة'],
  ['Failed to fetch', 'النت فصل — جرّب تاني'],
];

export async function decideQuickDay(staffId: string, date: string, decision: QuickDayDecision) {
  const { data, error } = await supabase.rpc('dr_wael_quick_day_decision_v1', {
    p_staff_id: staffId,
    p_date: date,
    p_decision: decision,
  });
  if (error) {
    const message = String(error.message || '');
    throw new Error(
      QUICK_ERRORS.find(([code]) => message.includes(code))?.[1] ?? 'تعذّر حفظ القرار'
    );
  }
  return (data || {}) as { approved?: boolean; already?: boolean };
}

// ---------------------------------------------------------------------------------------------------------
// Employee search across the page: «*» matches anything, a space works like «*» («د علياء» finds «د/ علياء»)
// and أ / ة spelling differences are ignored.
const searchSpelling = (value: string) => value.replace(/ة/g, 'ه');

export function matchesEmployeeSearch(name: string | null | undefined, search: string): boolean {
  const query = searchSpelling(search.trim()).replace(/\s+/g, '*');
  if (!query) return true;
  return matchesAppSearch(searchSpelling(String(name ?? '')), query);
}

// The page data limited to some employees, so every tab shows only them.
export function limitFingerprintsToStaff(
  data: DrWaelFingerprints,
  staffIds: ReadonlySet<string>
): DrWaelFingerprints {
  const keep = <T extends { staff_id: string }>(rows: T[]) =>
    rows.filter((row) => staffIds.has(row.staff_id));
  return {
    ...data,
    employees: keep(data.employees),
    days: keep(data.days),
    time_off: keep(data.time_off),
    incentives: keep(data.incentives),
    movements: keep(data.movements),
    manual_entries: keep(data.manual_entries),
  };
}

// ---------------------------------------------------------------------------------------------------------
// Credit (migration 20261106100000): delivery discipline minutes from the payroll classification and the
// missing-punch allowance of the cycle.
export interface DrWaelDeliveryCredit {
  status: string | null;
  band: string | null;
  band_ar: string | null;
  attended_days: number;
  minimum_days: number;
  pending_days: number;
  minutes: number;
  late_minutes: number;
  early_minutes: number;
  excused_minutes: number;
  committed_credit: number;
  regular_credit: number;
  committed_per_day: number;
  regular_per_day: number;
  days: Array<{ date: string; minutes: number; late: number; early: number; exempt: boolean }>;
}

export interface DrWaelCreditRow {
  staff_id: string;
  missing_used: number;
  missing_penalized: number;
  missing_open: number;
  delivery: DrWaelDeliveryCredit | null;
}

export interface DrWaelCreditLedger {
  month_cycle: string;
  cycle_start: string;
  cycle_end: string;
  today: string;
  missing_limit: number;
  missing_penalty: number;
  rows: DrWaelCreditRow[];
}

export async function fetchDrWaelCreditLedger(
  monthCycle?: string | null
): Promise<DrWaelCreditLedger> {
  const { data, error } = await supabase.rpc('get_dr_wael_credit_ledger_v1', {
    p_month_cycle: monthCycle || null,
  });
  if (error) throw new Error(error.message);
  if (!data || !Array.isArray((data as { rows?: unknown }).rows))
    throw new Error('dr_wael_credit_unavailable');
  return data as DrWaelCreditLedger;
}

export type CreditBand = 'committed' | 'regular' | 'low';
export const CREDIT_BAND_LABELS: Record<CreditBand, string> = {
  committed: 'ملتزم',
  regular: 'عادي',
  low: 'منخفض',
};

export interface DeliveryCreditView {
  /** The band of the minutes used against the credit earned so far (same rule as payroll). */
  band: CreditBand;
  /** Payroll has classified him (he has the minimum days); otherwise the band is only the pace so far. */
  final: boolean;
  committedLeft: number;
  regularLeft: number;
  daysLeft: number;
  /** The most attended days he can still reach: approved + waiting for a decision + every day left. */
  reachableDays: number;
  canReachMinimum: boolean;
  /** The best band still possible if he attends every day left without one more minute. */
  bestBand: CreditBand;
}

const bandFor = (minutes: number, committed: number, regular: number): CreditBand =>
  minutes <= committed ? 'committed' : minutes <= regular ? 'regular' : 'low';

export function deliveryCreditView(
  credit: DrWaelDeliveryCredit,
  today: string,
  cycleEnd: string
): DeliveryCreditView {
  const daysLeft =
    today > cycleEnd
      ? 0
      : Math.round(
          (Date.parse(`${cycleEnd}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5
        ) + 1;
  const reachableDays = credit.attended_days + credit.pending_days + daysLeft;
  return {
    band: bandFor(credit.minutes, credit.committed_credit, credit.regular_credit),
    final: credit.status === 'classified',
    committedLeft: credit.committed_credit - credit.minutes,
    regularLeft: credit.regular_credit - credit.minutes,
    daysLeft,
    reachableDays,
    canReachMinimum: reachableDays >= credit.minimum_days,
    bestBand: bandFor(
      credit.minutes,
      reachableDays * credit.committed_per_day,
      reachableDays * credit.regular_per_day
    ),
  };
}

export interface CreditAlert {
  staffId: string;
  severity: 'danger' | 'warning';
  text: string;
}

// Who needs attention before the cycle closes; the worst first.
export function creditAlerts(ledger: DrWaelCreditLedger): CreditAlert[] {
  const alerts: CreditAlert[] = [];
  for (const row of ledger.rows) {
    const taken = row.missing_used + row.missing_open;
    if (taken > ledger.missing_limit) {
      alerts.push({
        staffId: row.staff_id,
        severity: 'danger',
        text: `${taken} بصمات ناقصة والسماح ${ledger.missing_limit} · كل مرة زيادة ممكن عليها خصم ${ledger.missing_penalty} ج`,
      });
    } else if (taken === ledger.missing_limit) {
      alerts.push({
        staffId: row.staff_id,
        severity: 'warning',
        text: `خلّص سماح البصمات (${ledger.missing_limit}) · المرة الجاية ممكن عليها خصم ${ledger.missing_penalty} ج`,
      });
    }
    if (!row.delivery) continue;
    const view = deliveryCreditView(row.delivery, ledger.today, ledger.cycle_end);
    if (!view.canReachMinimum) {
      alerts.push({
        staffId: row.staff_id,
        severity: 'danger',
        text: `مش هيوصل ${row.delivery.minimum_days} يوم حضور حتى لو حضر كل الباقي (أقصاه ${view.reachableDays})`,
      });
    }
    if (view.bestBand !== 'committed') {
      alerts.push({
        staffId: row.staff_id,
        severity: view.bestBand === 'low' ? 'danger' : 'warning',
        text: `${row.delivery.minutes} دقيقة تأخير/انصراف · أحسن تصنيف ممكن دلوقتي «${CREDIT_BAND_LABELS[view.bestBand]}» حتى لو حضر كل الباقي`,
      });
    }
  }
  return alerts.sort((a, b) => Number(b.severity === 'danger') - Number(a.severity === 'danger'));
}

// What a day under review means for his credit, in one line.
export function dayCreditNote(
  day: DrWaelDay,
  row: DrWaelCreditRow | undefined,
  limit: number,
  penalty: number
): string | null {
  if (!row) return null;
  if (day.resolution === 'missing_checkin' || day.resolution === 'missing_checkout') {
    const taken = row.missing_used + row.missing_open;
    return taken > limit
      ? `بصمات ناقصة ${taken} والسماح ${limit} · ممكن خصم ${penalty} ج`
      : `بصمات ناقصة ${taken} من سماح ${limit}`;
  }
  const minutes = day.late_minutes + day.early_leave_minutes;
  if (!row.delivery || minutes <= 0) return null;
  const left = row.delivery.committed_credit - row.delivery.minutes;
  return `${minutes} د على كريديت الدليفري · ${left >= 0 ? `فاضل ${left} د ملتزم` : `عدى الملتزم بـ ${-left} د`}`;
}

// ---------------------------------------------------------------------------------------------------------
// Rotating shifts (migration 20261106100000): many employees work 09–17 some weeks and 13–21 others, so one
// «suggested shift» cannot describe them. The shifts they really work are found from the resolved days, and a
// day is flagged when the whole shift (arrival AND leaving) follows another of his shifts, not the schedule.
export interface DrWaelShiftSample {
  staff_id: string;
  date: string;
  in: number;
  out: number;
  scheduled_in: number | null;
  scheduled_out: number | null;
  late: number;
  early: number;
  locked: boolean;
}

export async function fetchDrWaelShiftPatterns(): Promise<DrWaelShiftSample[]> {
  const { data, error } = await supabase.rpc('get_dr_wael_shift_patterns_v1');
  if (error) throw new Error(error.message);
  const samples = (data as { samples?: unknown } | null)?.samples;
  if (!Array.isArray(samples)) throw new Error('dr_wael_patterns_unavailable');
  return samples as DrWaelShiftSample[];
}

// The distance between two clock times, across midnight (23:50 and 00:10 are 20 minutes apart).
export function clockDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 1440;
  return diff > 720 ? 1440 - diff : diff;
}

const clockText = (minutes: number) => {
  const value = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};

export interface KnownShift {
  start: string;
  end: string;
  in: number;
  out: number;
  days: number;
  /** The same hours are in his schedule, not only in the punches. */
  scheduled: boolean;
}

const START_TOLERANCE = 60;
const END_TOLERANCE = 90;
const MIN_SHIFT_DAYS = 3;

const roundToHalfHour = (minutes: number) => Math.round(minutes / 30) * 30;

export function knownShifts(samples: DrWaelShiftSample[]): KnownShift[] {
  const clusters: Array<{ in: number; out: number; rows: DrWaelShiftSample[] }> = [];
  for (const sample of samples) {
    const cluster = clusters.find(
      (c) =>
        clockDistance(c.in, sample.in) <= START_TOLERANCE &&
        clockDistance(c.out, sample.out) <= END_TOLERANCE
    );
    if (cluster) cluster.rows.push(sample);
    else clusters.push({ in: sample.in, out: sample.out, rows: [sample] });
  }
  return clusters
    .filter((cluster) => cluster.rows.length >= MIN_SHIFT_DAYS)
    .map((cluster) => {
      const onSchedule = cluster.rows.filter(
        (row) =>
          row.scheduled_in != null &&
          row.scheduled_out != null &&
          clockDistance(row.in, row.scheduled_in) <= START_TOLERANCE &&
          clockDistance(row.out, row.scheduled_out) <= END_TOLERANCE
      );
      const counts = new Map<string, { n: number; in: number; out: number }>();
      for (const row of onSchedule) {
        const key = `${row.scheduled_in}-${row.scheduled_out}`;
        const entry = counts.get(key) || {
          n: 0,
          in: row.scheduled_in as number,
          out: row.scheduled_out as number,
        };
        entry.n += 1;
        counts.set(key, entry);
      }
      const planned = [...counts.values()].sort((a, b) => b.n - a.n)[0];
      const start = planned ? planned.in : roundToHalfHour(cluster.in);
      const end = planned ? planned.out : roundToHalfHour(cluster.out);
      return {
        start: clockText(start),
        end: clockText(end),
        in: start,
        out: end,
        days: cluster.rows.length,
        scheduled: Boolean(planned),
      };
    })
    .sort((a, b) => b.days - a.days);
}

export interface ShiftMismatch {
  sample: DrWaelShiftSample;
  shift: KnownShift;
  /** The late + early minutes the day carries now because of the other schedule. */
  minutes: number;
}

// Days whose whole shift follows another of his shifts. A plain late arrival is not one: the leaving time must
// have moved too. Days a manager approved stay out, the shift edit would not change them anyway.
export function shiftMismatches(
  samples: DrWaelShiftSample[],
  known: KnownShift[],
  today: string
): ShiftMismatch[] {
  const oldest = addDays(today, -40);
  const result: ShiftMismatch[] = [];
  for (const sample of samples) {
    if (sample.locked || sample.scheduled_in == null || sample.scheduled_out == null) continue;
    if (sample.date < oldest) continue;
    if (clockDistance(sample.in, sample.scheduled_in) < END_TOLERANCE) continue;
    if (clockDistance(sample.out, sample.scheduled_out) < END_TOLERANCE) continue;
    const shift = known.find(
      (k) =>
        clockDistance(k.in, sample.in) <= START_TOLERANCE &&
        clockDistance(k.out, sample.out) <= END_TOLERANCE
    );
    if (shift) result.push({ sample, shift, minutes: sample.late + sample.early });
  }
  return result.sort((a, b) => b.sample.date.localeCompare(a.sample.date));
}

// A shift that repeats on one weekday and differs from the schedule of that weekday, e.g. every Thursday he
// leaves at 04:00 and the schedule says 08:00. It only counts when his other days do not have the same gap, so
// someone who is late every day is not read as a «Thursday shift».
export interface WeekdayPattern {
  day: string;
  start: string;
  end: string;
  scheduledStart: string;
  scheduledEnd: string;
  days: number;
  /** The late + early minutes those days carry now. */
  minutes: number;
  /** The first of those days that a correction can still reach. */
  from: string;
  dates: string[];
}

const WEEKDAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const PATTERN_GAP = 45;
const MIN_PATTERN_DAYS = 3;

// Signed distance on the clock, -720…720.
const clockOffset = (value: number, from: number) => {
  const diff = (((value - from) % 1440) + 1440) % 1440;
  return diff > 720 ? diff - 1440 : diff;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

export function weekdayPatterns(samples: DrWaelShiftSample[], today: string): WeekdayPattern[] {
  const oldest = addDays(today, -40);
  const scheduled = samples.filter(
    (row) => row.scheduled_in != null && row.scheduled_out != null && row.date >= oldest
  );
  const result: WeekdayPattern[] = [];
  for (let dow = 0; dow < 7; dow += 1) {
    const rows = scheduled.filter((row) => weekdayOf(row.date) === dow);
    if (rows.length < MIN_PATTERN_DAYS) continue;
    const latest = rows.reduce((a, b) => (a.date > b.date ? a : b));
    const planIn = latest.scheduled_in as number;
    const planOut = latest.scheduled_out as number;
    const offsetIn = median(rows.map((row) => clockOffset(row.in, planIn)));
    const offsetOut = median(rows.map((row) => clockOffset(row.out, planOut)));
    if (Math.abs(offsetIn) < PATTERN_GAP && Math.abs(offsetOut) < PATTERN_GAP) continue;
    const near = rows.filter(
      (row) =>
        Math.abs(clockOffset(row.in, planIn) - offsetIn) <= START_TOLERANCE &&
        Math.abs(clockOffset(row.out, planOut) - offsetOut) <= END_TOLERANCE
    );
    if (near.length < MIN_PATTERN_DAYS || near.length / rows.length < 0.7) continue;
    // The same gap on his other days means a habit, not a shift of this weekday.
    const others = scheduled.filter((row) => weekdayOf(row.date) !== dow);
    if (others.length) {
      const otherIn = median(others.map((row) => clockOffset(row.in, row.scheduled_in as number)));
      const otherOut = median(
        others.map((row) => clockOffset(row.out, row.scheduled_out as number))
      );
      const sameGap = (gap: number, other: number) =>
        Math.abs(gap) >= PATTERN_GAP && Math.abs(gap - other) < PATTERN_GAP;
      if (sameGap(offsetIn, otherIn) || sameGap(offsetOut, otherOut)) continue;
    }
    const start = Math.abs(offsetIn) < PATTERN_GAP ? planIn : roundToHalfHour(planIn + offsetIn);
    const end = Math.abs(offsetOut) < PATTERN_GAP ? planOut : roundToHalfHour(planOut + offsetOut);
    const open = near.filter((row) => !row.locked);
    if (!open.length) continue;
    const dates = open.map((row) => row.date).sort();
    result.push({
      day: WEEKDAY_NAMES[dow],
      start: clockText(start),
      end: clockText(end),
      scheduledStart: clockText(planIn),
      scheduledEnd: clockText(planOut),
      days: near.length,
      minutes: open.reduce((sum, row) => sum + row.late + row.early, 0),
      from: dates[0],
      dates,
    });
  }
  return result.sort((a, b) => b.minutes - a.minutes);
}

export interface ShiftProfile {
  known: KnownShift[];
  mismatches: ShiftMismatch[];
  weekly: WeekdayPattern[];
  rotating: boolean;
}

export function shiftProfiles(
  samples: DrWaelShiftSample[],
  today: string
): Map<string, ShiftProfile> {
  const byStaff = new Map<string, DrWaelShiftSample[]>();
  for (const sample of samples) {
    const list = byStaff.get(sample.staff_id) || [];
    list.push(sample);
    byStaff.set(sample.staff_id, list);
  }
  const profiles = new Map<string, ShiftProfile>();
  for (const [staffId, rows] of byStaff) {
    const known = knownShifts(rows);
    const weekly = weekdayPatterns(rows, today);
    const covered = new Set(weekly.flatMap((pattern) => pattern.dates));
    profiles.set(staffId, {
      known,
      mismatches: shiftMismatches(rows, known, today).filter((m) => !covered.has(m.sample.date)),
      weekly,
      rotating: known.length >= 2,
    });
  }
  return profiles;
}

// ---------------------------------------------------------------------------------------------------------
// Punch reading (migration 20261106140000): the open days read against the shifts he really works, the suggested
// shift included. It only reads: nothing changes until a manager applies the shift for the scope he chooses.
export interface DrWaelOpenDay {
  staff_id: string;
  date: string;
  resolution: string | null;
  late: number;
  early: number;
  scheduled_in: string | null;
  scheduled_out: string | null;
}

export interface DrWaelOpenPunches {
  days: DrWaelOpenDay[];
  punches: Array<{ staff_id: string; at: string }>;
}

export async function fetchDrWaelOpenPunches(): Promise<DrWaelOpenPunches> {
  const { data, error } = await supabase.rpc('get_dr_wael_open_day_punches_v1');
  if (error) throw new Error(error.message);
  const result = data as Partial<DrWaelOpenPunches> | null;
  if (!Array.isArray(result?.days) || !Array.isArray(result?.punches))
    throw new Error('dr_wael_open_punches_unavailable');
  return { days: result.days, punches: result.punches };
}

export type ReadingSource = 'suggested' | 'known' | 'punches';

export interface PunchReading {
  staff_id: string;
  /** The open day this reading explains. */
  date: string;
  start: string;
  end: string;
  source: ReadingSource;
  /** The suggested shift, or one that is really in his schedule, not only a repeating pattern. */
  trusted: boolean;
  /** Cairo wall clock, null when that punch is the missing one. */
  inAt: string | null;
  outAt: string | null;
  late: number;
  early: number;
  /** What the day carries now on the schedule. */
  nowMinutes: number;
}

// Wall-clock minutes, so a date and a clock add up without a timezone in the way.
const wallMinutes = (at: string) => Math.round(Date.parse(`${at}:00Z`) / 60000);
const clockValue = (text: string) => {
  const [h, m] = text.split(':').map(Number);
  return h * 60 + m;
};

const READ_START_TOLERANCE = 90;
const READ_END_TOLERANCE = 120;
const MIN_PAIR_MINUTES = 180;
const MAX_PAIR_MINUTES = 16 * 60;
// The resolutions where a pair of punches can be trusted to be one shift without a known shift behind it.
const UNPAIRED = new Set([
  'missing_checkin',
  'missing_checkout',
  'worked_on_off',
  'needs_event_review',
]);

const nearest = (points: number[], target: number, tolerance: number) => {
  let best: number | null = null;
  for (const point of points) {
    if (Math.abs(point - target) > tolerance) continue;
    if (best == null || Math.abs(point - target) < Math.abs(best - target)) best = point;
  }
  return best;
};

const wallText = (minutes: number) => new Date(minutes * 60000).toISOString().slice(0, 16);

interface ShiftCandidate {
  start: string;
  end: string;
  source: ReadingSource;
  trusted?: boolean;
}

export function readOpenDay(
  day: DrWaelOpenDay,
  punchTimes: string[],
  candidates: ShiftCandidate[]
): PunchReading | null {
  const dayStart = wallMinutes(`${day.date}T00:00`);
  const points = punchTimes
    .map(wallMinutes)
    .filter((point) => point >= dayStart - 480 && point < dayStart + 1440 + 720);
  if (!points.length) return null;
  const planned =
    day.scheduled_in && day.scheduled_out
      ? { in: clockValue(day.scheduled_in), out: clockValue(day.scheduled_out) }
      : null;
  const nowMinutes = day.late + day.early;
  type Found = PunchReading & { score: number };
  let best: Found | null = null;

  // A day on the schedule counts as another shift only when arrival AND leaving both moved, the same rule as
  // shiftMismatches: someone who came late on his own shift is late, whatever other shifts he has.
  const movedFromSchedule = (first: number, last: number) =>
    !planned ||
    (clockDistance((first - dayStart + 1440) % 1440, planned.in) >= END_TOLERANCE &&
      clockDistance((last - dayStart + 2880) % 1440, planned.out) >= END_TOLERANCE);
  // One punch can only be read on a day with no schedule to read it against.
  const onePunchAllowed = day.resolution === 'worked_on_off' && !planned;

  for (const candidate of candidates) {
    const startClock = clockValue(candidate.start);
    const endClock = clockValue(candidate.end);
    const start = dayStart + startClock;
    const end = start + ((endClock - startClock + 1440) % 1440 || 1440);
    const first = nearest(points, start, READ_START_TOLERANCE);
    const last = nearest(points, end, READ_END_TOLERANCE);
    const whole = first != null && last != null;
    if (!whole && !(onePunchAllowed && (first != null || last != null))) continue;
    if (whole && (last - first < MIN_PAIR_MINUTES || !movedFromSchedule(first, last))) continue;
    const score =
      (whole ? 1000 : 0) +
      (candidate.source === 'suggested' ? 50 : 0) -
      (first != null ? Math.abs(first - start) : 60) -
      (last != null ? Math.abs(last - end) : 60);
    if (best && best.score >= score) continue;
    best = {
      staff_id: day.staff_id,
      date: day.date,
      start: candidate.start,
      end: candidate.end,
      source: candidate.source,
      trusted: candidate.trusted ?? candidate.source === 'suggested',
      inAt: first != null ? wallText(first) : null,
      outAt: last != null ? wallText(last) : null,
      late: first != null ? Math.max(0, first - start) : 0,
      early: last != null ? Math.max(0, end - last) : 0,
      nowMinutes,
      score,
    };
  }
  if (best) {
    const { score: _score, ...reading } = best;
    return reading;
  }

  // No shift of his fits, but two punches hours apart are one working shift: the hours come from the punches.
  if (!day.resolution || !UNPAIRED.has(day.resolution)) return null;
  const own = points
    .filter((point) => point >= dayStart && point < dayStart + 1440 + 480)
    .sort((a, b) => a - b);
  for (let i = 0; i < own.length - 1; i += 1) {
    if (own[i] >= dayStart + 1440) break;
    const gap = own[i + 1] - own[i];
    if (gap < MIN_PAIR_MINUTES || gap > MAX_PAIR_MINUTES || !movedFromSchedule(own[i], own[i + 1]))
      continue;
    const start = roundToHalfHour(own[i] - dayStart);
    const end = roundToHalfHour(own[i + 1] - dayStart);
    return {
      staff_id: day.staff_id,
      date: day.date,
      start: clockText(start),
      end: clockText(end),
      source: 'punches',
      trusted: false,
      inAt: wallText(own[i]),
      outAt: wallText(own[i + 1]),
      late: 0,
      early: 0,
      nowMinutes,
    };
  }
  return null;
}

// Every open day that the punches explain, keyed `${staff_id}-${date}`.
export function punchReadings(
  open: DrWaelOpenPunches | null,
  profiles: Map<string, ShiftProfile>,
  insights: Map<string, DrWaelInsight>
): Map<string, PunchReading> {
  const result = new Map<string, PunchReading>();
  if (!open) return result;
  const byStaff = new Map<string, string[]>();
  for (const punch of open.punches) {
    const list = byStaff.get(punch.staff_id) || [];
    list.push(punch.at);
    byStaff.set(punch.staff_id, list);
  }
  for (const day of open.days) {
    const suggested = insights.get(day.staff_id)?.shift;
    const candidates: ShiftCandidate[] = [
      ...(suggested
        ? [{ start: suggested.start, end: suggested.end, source: 'suggested' as const }]
        : []),
      ...(profiles.get(day.staff_id)?.known || []).map((shift) => ({
        start: shift.start,
        end: shift.end,
        source: 'known' as const,
        trusted: shift.scheduled,
      })),
    ];
    const reading = readOpenDay(day, byStaff.get(day.staff_id) || [], candidates);
    if (reading) result.set(`${day.staff_id}-${day.date}`, reading);
  }
  return result;
}

// The dates a weekday falls on inside a period, to show how many days a change will touch.
export function datesInPeriod(from: string, to: string, weekDays: string[] | null): number {
  if (!from || !to || to < from) return 0;
  let count = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!weekDays || weekDays.includes(WEEKDAY_NAMES[weekdayOf(date)])) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------------------------------------
// Quick decisions: every open day becomes one sentence and one recommended action. The clear ones follow fixed
// rules and go in one click; only the rest ask for an opinion, one at a time. Nothing runs without that click.
export const QUICK_SMALL_MINUTES = 15;
export const QUICK_SHIFT_MINUTES = 30;

export type QuickAction =
  | { type: 'decide'; decision: QuickDayDecision; label: string; tone: QuickDayOption['tone'] }
  | { type: 'shift'; start: string; end: string; label: string }
  | { type: 'details'; label: string };

export type QuickGroup = 'forgot' | 'shift' | 'small' | 'absence' | 'minutes' | 'other' | 'stopped';

export interface QuickItem {
  day: DrWaelDay;
  group: QuickGroup;
  /** One of the agreed rules covers it, so it can run with the others in one click. */
  clear: boolean;
  /** What the system understood, when it adds to what happened. */
  why: string | null;
  primary: QuickAction;
  secondary: QuickAction | null;
}

export interface QuickPlan {
  clear: QuickItem[];
  ask: QuickItem[];
}

const DETAILS: QuickAction = { type: 'details', label: 'راجع التفاصيل' };

const shiftAction = (reading: PunchReading): QuickAction => ({
  type: 'shift',
  start: reading.start,
  end: reading.end,
  label: `اعتبره شيفت ${reading.start}–${reading.end}`,
});

const fromOption = (option: QuickDayOption): QuickAction => ({ type: 'decide', ...option });

function readingWhy(reading: PunchReading): string {
  const minutes = reading.late + reading.early;
  const onShift =
    reading.source === 'punches'
      ? 'الشيفت ده من البصمة بس ومش من شيفتاته، اتأكد إنه مش تأخير'
      : minutes
        ? `عليه ${minutes} د على الشيفت ده`
        : 'مظبوط على الشيفت ده';
  const now = reading.nowMinutes ? ` بدل ${reading.nowMinutes} د دلوقتي` : '';
  return `البصمة ماشية على شيفت ${reading.start}–${reading.end}: ${onShift}${now}`;
}

// `readings` come from punchReadings, `allowance` is how many forgotten punches each employee still has.
export function quickPlan(
  days: DrWaelDay[],
  today: string,
  readings: Map<string, PunchReading>,
  flexible: ReadonlySet<string>,
  allowance: (staffId: string) => number,
  /** Stopped or inactive: a day with no punch is not a question, it closes with the others. */
  stopped: ReadonlySet<string> = new Set()
): QuickPlan {
  const left = new Map<string, number>();
  const items: QuickItem[] = [];
  // Oldest first, so the allowance goes to the first forgotten punches like it does in payroll.
  const open = days
    .filter((day) => day.review && day.status !== 'approved' && day.date < today)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const day of open) {
    const options = quickDayOptions(day);
    const first = options[0] ? fromOption(options[0]) : null;
    const second = options[1] ? fromOption(options[1]) : null;
    const minutes = day.late_minutes + day.early_leave_minutes;
    if (flexible.has(day.staff_id)) {
      items.push({
        day,
        group: 'other',
        clear: false,
        why: null,
        primary: DETAILS,
        secondary: null,
      });
      continue;
    }
    if (stopped.has(day.staff_id) && day.resolution === 'absence_review' && first) {
      items.push({
        day,
        group: 'stopped',
        clear: true,
        why: null,
        primary: first,
        secondary: second,
      });
      continue;
    }
    const reading = readings.get(`${day.staff_id}-${day.date}`);
    if (reading) {
      const onShift = reading.late + reading.early;
      const whole = Boolean(reading.inAt && reading.outAt);
      items.push({
        day,
        group: 'shift',
        clear:
          reading.trusted &&
          whole &&
          onShift <= QUICK_SHIFT_MINUTES &&
          reading.source !== 'punches',
        why: readingWhy(reading),
        primary: shiftAction(reading),
        secondary: first || DETAILS,
      });
      continue;
    }
    if ((day.resolution === 'missing_checkin' || day.resolution === 'missing_checkout') && first) {
      const remaining = left.has(day.staff_id)
        ? (left.get(day.staff_id) as number)
        : allowance(day.staff_id);
      left.set(day.staff_id, remaining - 1);
      items.push({
        day,
        group: 'forgot',
        clear: remaining > 0,
        why: remaining > 0 ? null : 'خلّص سماح نسيان البصمة، فالقرار ده ممكن يبقى عليه خصم',
        primary: first,
        secondary: DETAILS,
      });
      continue;
    }
    if (day.resolution === 'absence_review' && first) {
      items.push({
        day,
        group: 'absence',
        clear: false,
        why: null,
        primary: first,
        secondary: second,
      });
      continue;
    }
    if ((day.resolution === 'late' || day.resolution === 'early_leave_review') && first) {
      items.push({
        day,
        group: minutes <= QUICK_SMALL_MINUTES ? 'small' : 'minutes',
        clear: minutes <= QUICK_SMALL_MINUTES,
        why: null,
        primary: first,
        secondary: DETAILS,
      });
      continue;
    }
    items.push({
      day,
      group: 'other',
      clear:
        Boolean(first) &&
        options.length === 1 &&
        first?.type === 'decide' &&
        first.tone === 'neutral',
      why: null,
      primary: first || DETAILS,
      secondary: first ? DETAILS : null,
    });
  }
  const newestFirst = (a: QuickItem, b: QuickItem) => b.day.date.localeCompare(a.day.date);
  return {
    clear: items.filter((item) => item.clear).sort(newestFirst),
    ask: items.filter((item) => !item.clear).sort(newestFirst),
  };
}

// -------------------------------------------------------------------------------------------------
// Manual punches (migration 20261107170000): one row per punch typed by hand in the cycle.
export type ManualPunchType = 'check_in' | 'check_out';

export interface DrWaelManualPunch {
  id: string;
  staff_id: string;
  date: string;
  type: ManualPunchType;
  at: string;
  reason: string | null;
  by: string | null;
  /** Its number in the cycle's missing-punch allowance; null when it never went through that count. */
  occurrence_no: number | null;
  allowance_limit: number | null;
  penalized: boolean;
  day_status: string | null;
  resolution: string | null;
  counted: boolean;
}

export interface DrWaelManualPunches {
  month_cycle: string;
  cycle_start: string;
  cycle_end: string;
  missing_limit: number;
  rows: DrWaelManualPunch[];
}

export async function fetchDrWaelManualPunches(
  monthCycle?: string | null
): Promise<DrWaelManualPunches> {
  const { data, error } = await supabase.rpc('get_dr_wael_manual_punches_v1', {
    p_month_cycle: monthCycle || null,
  });
  if (error) throw new Error(error.message);
  if (!data || !Array.isArray((data as { rows?: unknown }).rows))
    throw new Error('dr_wael_manual_punches_unavailable');
  return data as DrWaelManualPunches;
}

export interface RecordedManualPunch {
  occurrence_no: number;
  allowance_limit: number;
  over_allowance: boolean;
  day_status: string | null;
}

export async function recordDrWaelManualPunch(args: {
  staffId: string;
  date: string;
  type: ManualPunchType;
  time: string;
  nextDay: boolean;
  note?: string | null;
}): Promise<RecordedManualPunch> {
  const { data, error } = await supabase.rpc('dr_wael_record_manual_punch_v1', {
    p_staff_id: args.staffId,
    p_date: args.date,
    p_type: args.type,
    p_time: args.time,
    p_next_day: args.nextDay,
    p_note: args.note || null,
  });
  if (error) throw new Error(error.message);
  return data as RecordedManualPunch;
}

const MANUAL_PUNCH_ERRORS: ReadonlyArray<readonly [string, string]> = [
  ['not_authorized', 'مفيش صلاحية'],
  ['manual_punch_date_out_of_range', 'اليوم لازم يكون في آخر 40 يوم ومش في المستقبل'],
  ['manual_punch_in_future', 'الوقت ده لسه ماجاش'],
  ['manual_punch_staff_not_active', 'الموظف مش نشط'],
  ['manual_punch_cycle_locked', 'مرتب الفترة دي اتقفل، مينفعش تسجل فيها'],
  ['manual_punch_day_approved', 'اليوم ده اتعتمد بقرار مدير، افتحه الأول من مراجعة اليوم'],
  ['manual_punch_already_exists', 'فيه بصمة من النوع ده في اليوم ده بالفعل'],
];

export function manualPunchErrorText(error: unknown): string {
  const text = error instanceof Error ? error.message : '';
  return MANUAL_PUNCH_ERRORS.find(([key]) => text.includes(key))?.[1] || 'ماتسجلتش، حاول تاني';
}

export interface ManualPunchSummary {
  total: number;
  counted: number;
  notCounted: number;
  insideAllowance: number;
  overAllowance: number;
  outsideCount: number;
  penalized: number;
}

export function summarizeManualPunches(rows: DrWaelManualPunch[]): ManualPunchSummary {
  const summary: ManualPunchSummary = {
    total: rows.length,
    counted: 0,
    notCounted: 0,
    insideAllowance: 0,
    overAllowance: 0,
    outsideCount: 0,
    penalized: 0,
  };
  for (const row of rows) {
    if (row.counted) summary.counted += 1;
    else summary.notCounted += 1;
    if (row.occurrence_no == null) summary.outsideCount += 1;
    else if (row.occurrence_no <= (row.allowance_limit ?? 2)) summary.insideAllowance += 1;
    else summary.overAllowance += 1;
    if (row.penalized) summary.penalized += 1;
  }
  return summary;
}

// A check-out on an overnight shift, or one earlier in the clock than that day's check-in, belongs to the morning
// after the shift's day. Only a default: the screen shows the date and lets the manager flip it.
export function manualPunchFallsNextDay(args: {
  type: ManualPunchType;
  time: string;
  firstIn: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
}): boolean {
  if (args.type !== 'check_out' || !args.time) return false;
  const time = args.time.slice(0, 5);
  if (args.firstIn) return time < cairoTime(args.firstIn);
  if (args.shiftStart && args.shiftEnd)
    return args.shiftEnd.slice(0, 5) <= args.shiftStart.slice(0, 5);
  return false;
}

export const ALL_BRANCHES = 'كل الفروع';
/** The name a branch reads by on the screen: staff of «كل الفروع» are the management, not a branch. */
export const branchLabel = (branch: string) => (branch === ALL_BRANCHES ? 'الإدارة' : branch);
/** Staff the attendance engine never reads: they have no shift to edit and their days come from punches. */
export const isOutsideEngine = (employee: Pick<DrWaelEmployee, 'branch'>) =>
  employee.branch === ALL_BRANCHES;

// ---------------------------------------------------------------------------
// كريديت الالتزام والمرونة: who asked for each shift change, next to the punctuality numbers.
// For the managers to read only: it does not touch pay, deductions or the delivery classification.
// ---------------------------------------------------------------------------

export type ShiftOrigin = 'management' | 'employee' | 'correction';

export const SHIFT_ORIGINS: ReadonlyArray<readonly [ShiftOrigin, string]> = [
  ['management', 'بطلب مننا'],
  ['employee', 'من الموظف'],
  ['correction', 'تصحيح جدول'],
];

export const SHIFT_ORIGIN_EFFECT: Record<ShiftOrigin, string> = {
  management: 'له',
  employee: 'عليه',
  correction: 'محايد',
};

export interface DrWaelShiftChange {
  id: string;
  staff_id: string;
  name?: string;
  at: string;
  mode: DrWaelShiftMode;
  from: string;
  to: string | null;
  start: string;
  end: string;
  old_start: string | null;
  old_end: string | null;
  old_hours: number | null;
  new_hours: number | null;
  origin: ShiftOrigin | null;
  note: string | null;
  /** Made outside this page: the day review or the employee form. */
  source?: 'attendance_review' | 'team_schedule' | null;
}

export interface DrWaelStaffCreditRow {
  staff_id: string;
  name: string;
  branch: string;
  attended_days: number;
  late_minutes: number;
  early_minutes: number;
  excused_minutes: number;
  minutes: number;
  absent_days: number;
  missing_used: number;
  management: number;
  employee: number;
  correction: number;
  unclassified: number;
  reduced: number;
  changes: DrWaelShiftChange[];
}

export interface DrWaelStaffCredit {
  month_cycle: string;
  cycle_start: string;
  cycle_end: string;
  today: string;
  committed_per_day: number;
  regular_per_day: number;
  rows: DrWaelStaffCreditRow[];
  unclassified: DrWaelShiftChange[];
}

export async function fetchDrWaelStaffCredit(
  monthCycle?: string | null
): Promise<DrWaelStaffCredit> {
  const { data, error } = await supabase.rpc('get_dr_wael_staff_credit_v1', {
    p_month_cycle: monthCycle || null,
  });
  if (error) throw new Error(error.message);
  if (!data || !Array.isArray((data as { rows?: unknown }).rows))
    throw new Error('dr_wael_staff_credit_unavailable');
  return data as DrWaelStaffCredit;
}

export async function setDrWaelShiftOrigin(changeId: string, origin: ShiftOrigin): Promise<void> {
  const { error } = await supabase.rpc('dr_wael_set_shift_origin_v1', {
    p_change_id: changeId,
    p_origin: origin,
  });
  if (error) throw new Error(error.message);
}

export interface StaffCreditView {
  /** Null until there is an approved attended day to judge by. */
  band: CreditBand | null;
  minutesPerDay: number;
  /** له minus عليه. */
  balance: number;
  flexLabel: string;
}

/** The delivery minutes-per-day limits applied to everyone; an approved absence rules out «ملتزم». */
export function staffCreditView(
  row: DrWaelStaffCreditRow,
  limits: Pick<DrWaelStaffCredit, 'committed_per_day' | 'regular_per_day'>
): StaffCreditView {
  const days = row.attended_days;
  let band: CreditBand | null = null;
  if (days > 0) {
    if (row.minutes <= days * limits.committed_per_day) band = 'committed';
    else if (row.minutes <= days * limits.regular_per_day) band = 'regular';
    else band = 'low';
    if (band === 'committed' && row.absent_days > 0) band = 'regular';
  }
  const balance = row.management - row.employee;
  const flexLabel =
    !row.management && !row.employee
      ? 'مفيش تغييرات'
      : balance > 0
        ? 'متعاون'
        : balance < 0
          ? 'بيغيّر من نفسه'
          : 'متوازن';
  return { band, minutesPerDay: days ? Math.round(row.minutes / days) : 0, balance, flexLabel };
}

/** Most flexible first, then the fewest minutes per day. Nobody leads a list on a zero. */
export function staffCreditLeaders(
  rows: DrWaelStaffCreditRow[],
  limits: Pick<DrWaelStaffCredit, 'committed_per_day' | 'regular_per_day'>,
  count = 3
): { committed: DrWaelStaffCreditRow[]; flexible: DrWaelStaffCreditRow[] } {
  const perDay = (row: DrWaelStaffCreditRow) => staffCreditView(row, limits).minutesPerDay;
  return {
    committed: rows
      .filter((row) => staffCreditView(row, limits).band === 'committed')
      .sort((a, b) => perDay(a) - perDay(b) || b.attended_days - a.attended_days)
      .slice(0, count),
    flexible: rows
      .filter((row) => row.management - row.employee > 0)
      .sort(
        (a, b) => b.management - b.employee - (a.management - a.employee) || perDay(a) - perDay(b)
      )
      .slice(0, count),
  };
}

export function sortStaffCredit(
  rows: DrWaelStaffCreditRow[],
  limits: Pick<DrWaelStaffCredit, 'committed_per_day' | 'regular_per_day'>
): DrWaelStaffCreditRow[] {
  return [...rows].sort((a, b) => {
    const left = staffCreditView(a, limits);
    const right = staffCreditView(b, limits);
    return (
      right.balance - left.balance ||
      left.minutesPerDay - right.minutesPerDay ||
      a.name.localeCompare(b.name, 'ar')
    );
  });
}

// ---------------------------------------------------------------------------
// Faster manual punches: start on what is actually missing.
// ---------------------------------------------------------------------------

export interface ManualPunchSuggestion {
  date: string;
  type: ManualPunchType;
  /** Why this one was picked; null when it is only the default. */
  hint: string | null;
}

const OPEN_MISSING = new Set(['missing_checkin', 'missing_checkout']);

const missingPunchDays = (days: DrWaelDay[], today: string, within: number) =>
  days
    .filter(
      (day) =>
        day.status !== 'approved' &&
        day.date < today &&
        day.date >= addDays(today, -within) &&
        OPEN_MISSING.has(day.resolution || '')
    )
    .sort((a, b) => b.date.localeCompare(a.date));

/** The newest day still missing a punch, else today's next punch. */
export function manualPunchSuggestion(days: DrWaelDay[], today: string): ManualPunchSuggestion {
  const open = missingPunchDays(days, today, 7)[0];
  if (open) {
    const type: ManualPunchType = open.resolution === 'missing_checkin' ? 'check_in' : 'check_out';
    return {
      date: open.date,
      type,
      hint: `ناقص ${type === 'check_in' ? 'حضور' : 'انصراف'} يوم ${open.date.slice(5)}`,
    };
  }
  const now = days.find((day) => day.date === today);
  return {
    date: today,
    type: now?.first_in && !now.last_out ? 'check_out' : 'check_in',
    hint: null,
  };
}

export interface ManualPunchQueueItem {
  employee: DrWaelEmployee;
  date: string;
  type: ManualPunchType;
}

/** Active employees with a punch missing in the last days, newest first: one tap opens them. */
export function manualPunchQueue(
  employees: DrWaelEmployee[],
  days: DrWaelDay[],
  today: string,
  within = 3
): ManualPunchQueueItem[] {
  const seen = new Set<string>();
  const rows: ManualPunchQueueItem[] = [];
  const byId = new Map(employees.map((employee) => [employee.staff_id, employee]));
  for (const day of missingPunchDays(days, today, within)) {
    const employee = byId.get(day.staff_id);
    if (!employee?.active || employee.work_mode || seen.has(day.staff_id)) continue;
    seen.add(day.staff_id);
    rows.push({
      employee,
      date: day.date,
      type: day.resolution === 'missing_checkin' ? 'check_in' : 'check_out',
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Overtime as quick decisions, on the same rows and the same approval as the old page.
// ---------------------------------------------------------------------------

export const QUICK_OVERTIME_HOURS = 2;

export type OvertimeBucket = 'clear' | 'ask' | 'day_first';

export interface OvertimeQuickRow {
  id: string;
  staff_id: string;
  staff_name: string;
  attendance_date: string;
  overtime_hours: number;
  overtime_amount: number | null;
}

export interface OvertimeQuickItem<T extends OvertimeQuickRow = OvertimeQuickRow> {
  row: T;
  bucket: OvertimeBucket;
  /** Why it needs a look; null for the clear ones. */
  why: string | null;
}

/**
 * clear: the day is approved and on time, up to QUICK_OVERTIME_HOURS, with a known amount.
 * day_first: the day itself is not approved yet, so the database refuses the approval.
 * ask: everything else. Late then staying after the shift is usually another shift, not overtime.
 */
export function overtimePlan<T extends OvertimeQuickRow>(
  rows: T[],
  days: DrWaelDay[],
  cycleStart: string,
  cycleEnd: string
): OvertimeQuickItem<T>[] {
  const byDay = new Map(days.map((day) => [`${day.staff_id}-${day.date}`, day]));
  return rows
    .filter((row) => {
      const date = String(row.attendance_date).slice(0, 10);
      return date >= cycleStart && date <= cycleEnd;
    })
    .map((row): OvertimeQuickItem<T> => {
      const day = byDay.get(`${row.staff_id}-${String(row.attendance_date).slice(0, 10)}`);
      if (!day || day.status !== 'approved')
        return { row, bucket: 'day_first', why: 'اعتمد اليوم نفسه الأول' };
      if (day.resolution === 'late' || day.resolution === 'very_late')
        return { row, bucket: 'ask', why: 'اتأخر وقعد بعد الميعاد: ممكن يكون شيفت تاني' };
      if (day.resolution !== 'on_time' && day.resolution !== 'worked_on_off')
        return { row, bucket: 'ask', why: 'اليوم مش مظبوط على الجدول' };
      if (row.overtime_amount == null)
        return { row, bucket: 'ask', why: 'مفيش سعر ساعة محسوب ليه' };
      if (Number(row.overtime_hours) > QUICK_OVERTIME_HOURS)
        return { row, bucket: 'ask', why: `أكتر من ${QUICK_OVERTIME_HOURS} ساعة` };
      return { row, bucket: 'clear', why: null };
    })
    .sort((a, b) => String(b.row.attendance_date).localeCompare(String(a.row.attendance_date)));
}
