import { supabase } from '@/lib/supabase';

export type PayrollAttendanceEligibilityStatus =
  | 'manual_mode'
  | 'cycle_open'
  | 'schedule_not_ready'
  | 'attendance_unresolved'
  | 'no_scheduled_workdays'
  | 'ready';

export type PayrollAttendanceEligibility = {
  staffId: string;
  staffName: string;
  monthCycle: string;
  cycleStart: string;
  cycleEnd: string;
  attendanceHoursMode: 'manual' | 'resolved';
  cycleClosed: boolean;
  scheduleGapDays: number;
  invalidScheduleDays: number;
  scheduledWorkdays: number;
  approvedWorkdays: number;
  unresolvedWorkdays: number;
  approvedPayrollHours: number;
  unresolvedDates: string[];
  readyForPayroll: boolean;
  status: PayrollAttendanceEligibilityStatus;
  reasons: string[];
};

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchPayrollAttendanceEligibility(
  staffId?: string | null,
  monthCycle?: string | null
): Promise<PayrollAttendanceEligibility | null> {
  if (!staffId || !monthCycle) return null;

  const { data, error } = await supabase.rpc('get_payroll_attendance_eligibility_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const row = data as Record<string, unknown>;
  const rawStatus = String(row.status || 'manual_mode');
  const allowed = new Set<PayrollAttendanceEligibilityStatus>([
    'manual_mode', 'cycle_open', 'schedule_not_ready', 'attendance_unresolved', 'no_scheduled_workdays', 'ready',
  ]);
  const status = (allowed.has(rawStatus as PayrollAttendanceEligibilityStatus)
    ? rawStatus
    : 'manual_mode') as PayrollAttendanceEligibilityStatus;

  return {
    staffId: String(row.staff_id || staffId),
    staffName: String(row.staff_name || ''),
    monthCycle: String(row.month_cycle || monthCycle),
    cycleStart: String(row.cycle_start || ''),
    cycleEnd: String(row.cycle_end || ''),
    attendanceHoursMode: row.attendance_hours_mode === 'resolved' ? 'resolved' : 'manual',
    cycleClosed: row.cycle_closed === true,
    scheduleGapDays: num(row.schedule_gap_days),
    invalidScheduleDays: num(row.invalid_schedule_days),
    scheduledWorkdays: num(row.scheduled_workdays),
    approvedWorkdays: num(row.approved_workdays),
    unresolvedWorkdays: num(row.unresolved_workdays),
    approvedPayrollHours: num(row.approved_payroll_hours),
    unresolvedDates: Array.isArray(row.unresolved_dates) ? row.unresolved_dates.map(String) : [],
    readyForPayroll: row.ready_for_payroll === true,
    status,
    reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
  };
}
