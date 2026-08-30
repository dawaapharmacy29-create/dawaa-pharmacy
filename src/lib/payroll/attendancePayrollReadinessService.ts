import { supabase } from '@/lib/supabase';

export type AttendancePayrollReadinessStatus = 'no_data' | 'needs_review' | 'ready';

export type AttendancePayrollReadiness = {
  staffId: string;
  staffName: string;
  monthCycle: string;
  cycleStart: string;
  cycleEnd: string;
  rawBiometricEvents: number;
  acceptedPunches: number;
  manualReviewPunches: number;
  rejectedPunches: number;
  pairedShifts: number;
  unpairedAcceptedPunches: number;
  candidateWorkedHours: number;
  readyForPayroll: boolean;
  status: AttendancePayrollReadinessStatus;
  reasons: string[];
};

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchAttendancePayrollReadiness(
  staffId?: string | null,
  monthCycle?: string | null
): Promise<AttendancePayrollReadiness | null> {
  if (!staffId || !monthCycle) return null;

  const { data, error } = await supabase.rpc('get_attendance_payroll_readiness_v1', {
    p_staff_id: staffId,
    p_month_cycle: monthCycle,
  });
  if (error) throw new Error(error.message);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const row = data as Record<string, unknown>;
  const status: AttendancePayrollReadinessStatus = row.status === 'ready'
    ? 'ready'
    : row.status === 'needs_review'
      ? 'needs_review'
      : 'no_data';

  return {
    staffId: String(row.staff_id || staffId),
    staffName: String(row.staff_name || ''),
    monthCycle: String(row.month_cycle || monthCycle),
    cycleStart: String(row.cycle_start || ''),
    cycleEnd: String(row.cycle_end || ''),
    rawBiometricEvents: num(row.raw_biometric_events),
    acceptedPunches: num(row.accepted_punches),
    manualReviewPunches: num(row.manual_review_punches),
    rejectedPunches: num(row.rejected_punches),
    pairedShifts: num(row.paired_shifts),
    unpairedAcceptedPunches: num(row.unpaired_accepted_punches),
    candidateWorkedHours: num(row.candidate_worked_hours),
    readyForPayroll: row.ready_for_payroll === true,
    status,
    reasons: Array.isArray(row.reasons) ? row.reasons.map(String) : [],
  };
}
