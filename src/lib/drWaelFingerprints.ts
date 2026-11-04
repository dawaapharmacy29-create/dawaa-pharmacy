import { supabase } from '@/lib/supabase';

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
