import {
  mergeAttendanceRowsForSubject,
  normalizeAcceptedAttendanceLogs,
  type ModernAttendanceLogRow,
  type NormalizedAttendanceRow,
} from '@/lib/attendance/attendanceReadNormalization';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export type AttendanceReadRow = NormalizedAttendanceRow;

export type AttendanceReadResult =
  | { status: 'available'; rows: AttendanceReadRow[] }
  | { status: 'unavailable'; rows: []; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Canonical attendance read boundary.
 *
 * Reads the historical daily attendance table and the modern punch-level attendance log,
 * normalizes accepted modern punches into one row per day, and lets modern data win on
 * overlapping dates. Any source failure is surfaced as unavailable instead of being
 * mistaken for zero attendance.
 */
export async function readAttendanceRange(args: {
  staffId: string;
  startDate: string;
  endDateExclusive: string;
  limit?: number;
}): Promise<AttendanceReadResult> {
  if (!isSupabaseConfigured) {
    return { status: 'unavailable', rows: [], error: 'Supabase غير مهيأ.' };
  }

  const limit = Math.min(Math.max(args.limit || 400, 1), 1000);
  const startDate = args.startDate.slice(0, 10);
  const endDateExclusive = args.endDateExclusive.slice(0, 10);

  const legacyPromise = supabase
    .from('attendance')
    .select('status,check_in,check_out,date,attendance_date,staff_id,staff_name,first_in,last_out')
    .eq('staff_id', args.staffId)
    .gte('date', startDate)
    .lt('date', endDateExclusive)
    .order('date', { ascending: true })
    .limit(limit);

  const modernPromise = UUID_RE.test(args.staffId)
    ? supabase
        .from('staff_attendance_logs')
        .select('staff_id,staff_name,shift_date,attendance_type,status,recorded_at,created_at')
        .eq('staff_id', args.staffId)
        .eq('status', 'accepted')
        .gte('shift_date', startDate)
        .lt('shift_date', endDateExclusive)
        .order('shift_date', { ascending: true })
        .order('recorded_at', { ascending: true })
        .limit(Math.min(limit * 4, 4000))
    : Promise.resolve({ data: [], error: null });

  const [legacyResult, modernResult] = await Promise.all([legacyPromise, modernPromise]);

  if (legacyResult.error || modernResult.error) {
    const messages = [legacyResult.error?.message, modernResult.error?.message].filter(Boolean);
    return {
      status: 'unavailable',
      rows: [],
      error: messages.join(' | ') || 'تعذر تحميل بيانات الحضور.',
    };
  }

  const legacyRows = ((legacyResult.data || []) as AttendanceReadRow[]).map((row) => ({
    ...row,
    source: 'legacy' as const,
  }));
  const modernRows = normalizeAcceptedAttendanceLogs(
    (modernResult.data || []) as ModernAttendanceLogRow[]
  );
  const rows = mergeAttendanceRowsForSubject(legacyRows, modernRows).slice(0, limit);

  return { status: 'available', rows };
}
